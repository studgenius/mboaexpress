// Phase 2N.4.3 v5 concurrency tests. REVIEW DRAFT. NOT EXECUTED.
// Each database function call is its own transaction on its own connection, so
// the races below are real. Fixtures are committed: use a disposable database.
//
// Usage: TEST_DATABASE_URL=postgres://... node 04_concurrency.test.mjs
// Requires 01_forward.sql applied and at least one drivers row.
// Requires Node 22+ or neonConfig.webSocketConstructor set to 'ws'.

import { Pool } from '@neondatabase/serverless';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is required. The production DATABASE_URL is never read here.');
  process.exit(2);
}

const pool = new Pool({ connectionString: url, max: 4 });
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const failures = [];

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

const race = (calls) => Promise.allSettled(calls.map((fn) => fn(pool)));
const value = (s) => (s.status === 'fulfilled' ? s.value.rows[0] : { error: s.reason.message });

async function seedBooking(method, label, amount, status) {
  const clerk = `race_${label}_${run}`;
  const { rows } = await pool.query('SELECT min(id) AS driver FROM drivers');
  const { rows: b } = await pool.query(
    `INSERT INTO booking_attempts (clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
       destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status, payment_method_code)
     VALUES ($1, 'A', 'B', 0, 0, 1, 1, 10, $2, $3, 'XAF', $4, $5) RETURNING id`,
    [clerk, rows[0].driver, amount, status, method],
  );
  return { id: b[0].id, clerk, driver: rows[0].driver };
}

async function scenarioCashDoubleCollection() {
  const bk = await seedBooking('cash', 'cashcol', 1500, 'pending');
  await pool.query('SELECT confirm_cash_booking($1, $2)', [bk.id, bk.clerk]);
  const results = await race([
    (p) => p.query('SELECT record_cash_collection($1,$2,$3,$4,$5) AS r', [bk.id, bk.driver, 'driver', 1500, 'XAF']),
    (p) => p.query('SELECT record_cash_collection($1,$2,$3,$4,$5) AS r', [bk.id, bk.driver, 'driver', 1500, 'XAF']),
  ]);
  const outcomes = results.map((s) => value(s).r ?? value(s).error);
  const collected = outcomes.filter((o) => o === 'collected').length;
  check('C1 two concurrent cash confirmations record exactly one collection', collected === 1, outcomes.join('|'));
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM cash_collections WHERE booking_attempt_id = $1', [bk.id]);
  check('C1b one cash_collections row', rows[0].n === 1, `rows=${rows[0].n}`);
}

async function scenarioConcurrentConfirm() {
  const bk = await seedBooking('cash', 'confirm', 1200, 'pending');
  const results = await race([
    (p) => p.query('SELECT confirm_cash_booking($1,$2) AS r', [bk.id, bk.clerk]),
    (p) => p.query('SELECT confirm_cash_booking($1,$2) AS r', [bk.id, bk.clerk]),
  ]);
  const outcomes = results.map((s) => value(s).r ?? value(s).error);
  check('C2 concurrent confirm creates exactly one cash ride', outcomes.filter((o) => o === 'confirmed').length === 1, outcomes.join('|'));
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM rides WHERE booking_attempt_id = $1', [bk.id]);
  check('C2b one ride row for the booking', rows[0].n === 1, `rides=${rows[0].n}`);
}

async function scenarioDuplicateWebhook() {
  const evt = `evt_race_${run}`;
  const deliver = (p) =>
    p.query(`SELECT process_stripe_event($1,'payment_intent.payment_failed',now(),NULL,NULL,NULL,NULL,NULL,NULL,'h') AS r`, [evt]);
  const results = await race([deliver, deliver]);
  const outcomes = results.map((s) => value(s).r ?? value(s).error);
  check('W1 concurrent duplicate deliveries process once', outcomes.filter((o) => o === 'duplicate').length === 1, outcomes.join('|'));
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM webhook_events WHERE stripe_event_id = $1', [evt]);
  check('W1b one dedupe row', rows[0].n === 1, `rows=${rows[0].n}`);
}

async function scenarioRefundOversubscription() {
  const bk = await seedBooking('card_stripe', 'refund', 1500, 'succeeded');
  const results = await race([
    (p) => p.query('SELECT request_refund($1,$2,$3,$4,$5,$6) AS r', [bk.id, bk.clerk, 'rider', 1000, 'XAF', 'first']),
    (p) => p.query('SELECT request_refund($1,$2,$3,$4,$5,$6) AS r', [bk.id, bk.clerk, 'rider', 1000, 'XAF', 'second']),
  ]);
  const accepted = results.filter((s) => s.status === 'fulfilled').length;
  check('R1 two concurrent 1000 XAF refunds on a 1500 XAF payment: one accepted', accepted === 1, `accepted=${accepted}`);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::int AS total FROM refund_requests WHERE booking_attempt_id = $1 AND status IN ('requested','approved','processing','succeeded')`,
    [bk.id],
  );
  check('R1b active refunds never exceed captured amount', rows[0].total <= 1500, `total=${rows[0].total}`);
}

async function main() {
  try {
    await scenarioCashDoubleCollection();
    await scenarioConcurrentConfirm();
    await scenarioDuplicateWebhook();
    await scenarioRefundOversubscription();
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
