// Phase 2N.4.3 v4 two-session concurrency test. REVIEW DRAFT: not executed.
// Runs against an ISOLATED test database only. Fixtures are COMMITTED, so the
// database must be disposable (fresh Neon branch or local Postgres) and discarded
// after the run. Deletes are not used: the attempt transition log is append-only.
//
// Usage:
//   TEST_DATABASE_URL=postgres://... node 05_concurrency.test.mjs
// Requires 01_forward.sql to be applied to that database and at least one drivers row.
// Requires Node 22+ (global WebSocket) or neonConfig.webSocketConstructor set to 'ws'.

import { Pool } from '@neondatabase/serverless';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is required. The production DATABASE_URL is never read here.');
  process.exit(2);
}

const pool = new Pool({ connectionString: url, max: 4 });
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clerk = `race_${run}`;
const failures = [];

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

async function session(fn) {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

async function seedBooking(c, label) {
  const id = crypto.randomUUID();
  const { rows } = await c.query('SELECT min(id) AS driver FROM public.drivers');
  await c.query(
    `INSERT INTO public.booking_attempts
       (id, clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
        destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status)
     VALUES ($1, $2, 'A', 'B', 0, 0, 1, 1, 10, $3, 1500, 'eur', 'pending')`,
    [id, `${clerk}_${label}`, rows[0].driver],
  );
  return { id, clerk: `${clerk}_${label}` };
}

// Two sessions, each in its own transaction, released together, both committed.
async function raceCommitted(makeOps) {
  return session((a) =>
    session(async (b) => {
      const [opA, opB] = makeOps;
      await Promise.all([a.query('BEGIN'), b.query('BEGIN')]);
      const settled = await Promise.allSettled([opA(a), opB(b)]);
      await Promise.all([a.query('COMMIT'), b.query('COMMIT')]);
      return settled;
    }),
  );
}

async function scenarioRetryRace() {
  const bk = await session((c) => seedBooking(c, 'retry'));
  const open = (c) =>
    c.query('SELECT out_attempt_id, out_created FROM public.open_payment_attempt($1, $2)', [bk.id, bk.clerk]);
  const [r1, r2] = await raceCommitted([open, open]);
  const created = [r1, r2].filter((r) => r.status === 'fulfilled' && r.value.rows[0].out_created);
  check('R1 concurrent retries create exactly one attempt', created.length === 1, `created=${created.length}`);

  const n = await session((c) =>
    c.query(
      `SELECT count(*)::int AS n FROM public.payment_attempts
       WHERE booking_attempt_id = $1 AND status IN ('pending','payment_intent_created')`,
      [bk.id],
    ),
  );
  check('R2 one open attempt persisted after commit', n.rows[0].n === 1, `open=${n.rows[0].n}`);
  return bk;
}

async function scenarioSingleRide() {
  const bk = await session((c) => seedBooking(c, 'ride'));
  const attempt = await session((c) =>
    c.query('SELECT out_attempt_id FROM public.open_payment_attempt($1, $2)', [bk.id, bk.clerk]),
  );
  const attemptId = attempt.rows[0].out_attempt_id;
  const pi = `pi_ride_${run}`;
  await session((c) => c.query('SELECT public.link_payment_intent($1,$2,$3,$4,$5,now())', [attemptId, bk.clerk, pi, 1500, 'eur']));

  const succeed = (c) =>
    c.query('SELECT public.apply_success($1,$2,$3,$4,now()) AS r', [pi, `ch_ride_${run}`, 1500, 'eur']);
  const [s1, s2] = await raceCommitted([succeed, succeed]);
  const outcomes = [s1, s2].map((s) => (s.status === 'fulfilled' ? s.value.rows[0].r : `error:${s.reason.message}`));
  const rides = await session((c) =>
    c.query('SELECT count(*)::int AS n FROM public.rides WHERE booking_attempt_id = $1', [bk.id]),
  );
  check('R3 concurrent success creates exactly one ride', rides.rows[0].n === 1, `rides=${rides.rows[0].n}, outcomes=${outcomes.join('|')}`);
  return { bk, attemptId, pi };
}

async function scenarioStaleAttemptCannotOverwrite() {
  const bk = await session((c) => seedBooking(c, 'stale'));
  const first = (
    await session((c) => c.query('SELECT out_attempt_id FROM public.open_payment_attempt($1,$2)', [bk.id, bk.clerk]))
  ).rows[0].out_attempt_id;
  const pi1 = `pi_stale1_${run}`;
  await session((c) => c.query('SELECT public.link_payment_intent($1,$2,$3,$4,$5,now())', [first, bk.clerk, pi1, 1500, 'eur']));
  await session((c) => c.query('SELECT public.apply_pi_canceled($1, now())', [pi1]));

  const second = (
    await session((c) => c.query('SELECT out_attempt_id FROM public.open_payment_attempt($1,$2)', [bk.id, bk.clerk]))
  ).rows[0].out_attempt_id;

  const late = (c) => c.query('SELECT public.apply_success($1,$2,$3,$4,now()) AS r', [pi1, `ch_stale1_${run}`, 1500, 'eur']);
  const [lateResult] = await raceCommitted([late, late]);

  const after = await session((c) =>
    c.query('SELECT current_payment_attempt_id AS p FROM public.booking_attempts WHERE id = $1', [bk.id]),
  );
  check('R4 late success on old attempt does not move the current pointer', after.rows[0].p === second, `pointer=${after.rows[0].p}`);
  const oldState = await session((c) =>
    c.query('SELECT status FROM public.payment_attempts WHERE id = $1', [first]),
  );
  check(
    'R4b old attempt is not marked succeeded',
    oldState.rows[0].status !== 'succeeded',
    `status=${oldState.rows[0].status}, late=${lateResult.status}`,
  );
}

async function scenarioDuplicateWebhook() {
  const evt = `evt_dup_${run}`;
  const deliver = (c) =>
    c.query(
      `SELECT public.process_stripe_event($1,'payment_intent.payment_failed',now(),NULL,NULL,NULL,NULL,NULL,NULL,NULL) AS r`,
      [evt],
    );
  const [d1, d2] = await raceCommitted([deliver, deliver]);
  const results = [d1, d2].map((d) => (d.status === 'fulfilled' ? d.value.rows[0].r : `error:${d.reason.message}`));
  const rows = await session((c) =>
    c.query('SELECT count(*)::int AS n FROM public.webhook_events WHERE stripe_event_id = $1', [evt]),
  );
  check('R5 duplicate delivery stores exactly one dedupe row', rows.rows[0].n === 1, `rows=${rows.rows[0].n}`);
  check('R5b one delivery is a duplicate', results.includes('duplicate'), results.join('|'));
}

async function main() {
  try {
    await scenarioRetryRace();
    await scenarioSingleRide();
    await scenarioStaleAttemptCannotOverwrite();
    await scenarioDuplicateWebhook();
    const final = await session((c) =>
      c.query('SELECT count(*)::int AS n FROM public.booking_attempts WHERE clerk_user_id LIKE $1', [`${clerk}%`]),
    );
    check('R6 fixture bookings persisted as committed', final.rows[0].n >= 3, `bookings=${final.rows[0].n}`);
  } catch (err) {
    failures.push(`error: ${err.message}`);
    console.error('TEST ERROR', err.message);
  } finally {
    await pool.end();
  }
  if (failures.length > 0) {
    console.error(`${failures.length} failure(s)`);
    process.exitCode = 1;
  }
}

main();
