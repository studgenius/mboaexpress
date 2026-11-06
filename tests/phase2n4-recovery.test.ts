/**
 * Phase 2N.4 Mocked Recovery, Lifecycle, and Concurrency Tests
 *
 * Tests the booking recovery endpoint, lifecycle transition guards,
 * PI reuse, and out-of-order event safety using mocked Stripe, Neon
 * DB, and Clerk auth. No live charges, refunds, or real DB writes.
 *
 * Run with: npx tsx tests/phase2n4-recovery.test.ts
 */

import { Module } from "module";

// ── Env setup ───────────────────────────────────────────────────────

const CLERK_SECRET_KEY = "test-clerk-secret";
const STRIPE_SECRET_KEY = "test-stripe-secret";
const STRIPE_WEBHOOK_SIGNING_SECRET = "test-webhook-secret";
const AUTH_USER_A = "clerk-user-A";
const AUTH_USER_B = "clerk-user-B";

process.env.CLERK_SECRET_KEY = CLERK_SECRET_KEY;
process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SIGNING_SECRET = STRIPE_WEBHOOK_SIGNING_SECRET;
process.env.DATABASE_URL = "postgres://test";

// ── Mock data stores ────────────────────────────────────────────────

type MockPI = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, string> | null;
  customer: string | null;
  client_secret: string | null;
};

let paymentIntents: Record<string, MockPI> = {};
let bookingAttempts: Record<
  string,
  {
    id: string;
    clerk_user_id: string;
    payment_intent_id: string | null;
    origin_address: string;
    destination_address: string;
    origin_latitude: number;
    origin_longitude: number;
    destination_latitude: number;
    destination_longitude: number;
    ride_time: number;
    driver_id: number;
    expected_amount: number;
    currency: string;
    status: string;
  }
> = {};
let rides: Record<string, unknown>[] = [];
let webhookEvents: Record<
  string,
  { stripe_event_id: string; event_type: string; processed: boolean }
> = {};
let charges: Record<string, { payment_intent: string | null }> = {};
let drivers: Record<number, { id: number }> = {};

// ── Mock Stripe ─────────────────────────────────────────────────────

const mockStripe = {
  webhooks: {
    constructEventAsync: async (
      _rawBody: string,
      signature: string,
      _secret: string,
    ): Promise<any> => {
      if (signature === "invalid-signature") {
        throw new Error("No signatures found matching the expected signature");
      }
      return JSON.parse(_rawBody);
    },
  },
  paymentIntents: {
    retrieve: async (id: string): Promise<MockPI> => {
      const pi = paymentIntents[id];
      if (!pi) throw new Error("No such payment_intent: " + id);
      return { ...pi };
    },
  },
  charges: {
    retrieve: async (id: string): Promise<any> => {
      const charge = charges[id];
      if (!charge) throw new Error("No such charge: " + id);
      return { ...charge };
    },
  },
};

// ── Mock neon (shared instance) ─────────────────────────────────────

function createMockSql() {
  const sqlFn = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");

    // webhook_events INSERT (claim event)
    if (query.includes("INSERT INTO webhook_events")) {
      const eventId = values[0] as string;
      if (webhookEvents[eventId]) {
        throw new Error("duplicate key value violates unique constraint");
      }
      webhookEvents[eventId] = {
        stripe_event_id: eventId,
        event_type: values[1] as string,
        processed: false,
      };
      return [{ id: "we_" + eventId }];
    }

    // webhook_events SELECT (duplicate check)
    if (query.includes("SELECT processed FROM webhook_events")) {
      const eventId = values[0] as string;
      const evt = webhookEvents[eventId];
      return evt ? [evt] : [];
    }

    // webhook_events UPDATE (mark processed)
    if (
      query.includes("UPDATE webhook_events") &&
      query.includes("SET processed")
    ) {
      // Variants:
      // 1. 4 values: SET processed = ${0}, result_status = ${1}, result_detail = ${2} WHERE id = ${3}
      // 2. 1 value: SET processed = false, result_status = 'error', result_detail = '...' WHERE id = ${0}
      const weId = (values.length === 1 ? values[0] : values[3]) as
        string | undefined;
      if (weId) {
        const stripeEventId = String(weId).replace("we_", "");
        if (webhookEvents[stripeEventId]) {
          webhookEvents[stripeEventId].processed =
            values.length === 1 ? false : true;
        }
      }
      return [];
    }

    // booking_attempts SELECT by payment_intent_id
    if (
      query.includes("SELECT * FROM booking_attempts WHERE payment_intent_id")
    ) {
      const piId = values[0] as string;
      return Object.values(bookingAttempts).filter(
        (b) => b.payment_intent_id === piId,
      );
    }

    // booking_attempts SELECT by id
    if (query.includes("SELECT * FROM booking_attempts WHERE id")) {
      const bookingId = values[0] as string;
      const found = bookingAttempts[bookingId];
      return found ? [found] : [];
    }

    // booking_attempts SELECT (for create+api.ts: id, clerk_user_id, expected_amount, status, payment_intent_id)
    if (query.includes("SELECT id, clerk_user_id, expected_amount, status")) {
      const bookingId = values[0] as string;
      const found = bookingAttempts[bookingId];
      return found ? [found] : [];
    }

    // booking_attempts UPDATE status (both updateBookingStatus and updateBookingStatusSafe)
    if (
      query.includes("UPDATE booking_attempts") &&
      query.includes("SET status")
    ) {
      const status = values[0] as string;
      const bookingId = values[1] as string;
      if (bookingAttempts[bookingId]) {
        bookingAttempts[bookingId].status = status;
      }
      return [];
    }

    // rides SELECT * by payment_intent_id
    if (query.includes("SELECT * FROM rides WHERE payment_intent_id")) {
      const piId = values[0] as string;
      return rides.filter((r) => r.payment_intent_id === piId);
    }

    // rides SELECT ride_id by payment_intent_id
    if (query.includes("SELECT ride_id FROM rides WHERE payment_intent_id")) {
      const piId = values[0] as string;
      return rides.filter((r) => r.payment_intent_id === piId);
    }

    // rides INSERT
    if (query.includes("INSERT INTO rides")) {
      const newRide: Record<string, unknown> = {
        ride_id: rides.length + 1,
        origin_address: values[0],
        destination_address: values[1],
        origin_latitude: values[2],
        origin_longitude: values[3],
        destination_latitude: values[4],
        destination_longitude: values[5],
        ride_time: values[6],
        fare_price: values[7],
        payment_status: "paid",
        driver_id: values[8],
        user_id: values[9],
        payment_intent_id: values[10],
        created_at: new Date().toISOString(),
      };
      rides.push(newRide);
      return [newRide];
    }

    // rides UPDATE payment_status
    if (query.includes("UPDATE rides SET payment_status")) {
      const piId = values[0] as string;
      let status = "unknown";
      if (query.includes("'failed'")) status = "failed";
      else if (query.includes("'canceled'")) status = "canceled";
      else if (query.includes("'refunded'")) status = "refunded";
      else if (query.includes("'disputed'")) status = "disputed";
      rides.forEach((r) => {
        if (r.payment_intent_id === piId) {
          r.payment_status = status;
        }
      });
      return [];
    }

    // drivers SELECT (for booking+api.ts)
    if (query.includes("SELECT id FROM drivers WHERE id")) {
      const driverId = values[0] as number;
      return drivers[driverId] ? [drivers[driverId]] : [];
    }

    // booking_attempts INSERT (for booking+api.ts)
    if (query.includes("INSERT INTO booking_attempts")) {
      const bookingId = "ba_" + Object.keys(bookingAttempts).length;
      bookingAttempts[bookingId] = {
        id: bookingId,
        clerk_user_id: values[0] as string,
        origin_address: values[1] as string,
        destination_address: values[2] as string,
        origin_latitude: values[3] as number,
        origin_longitude: values[4] as number,
        destination_latitude: values[5] as number,
        destination_longitude: values[6] as number,
        ride_time: values[7] as number,
        driver_id: values[8] as number,
        expected_amount: values[9] as number,
        currency: "eur",
        status: "pending",
        payment_intent_id: null,
      };
      return [{ id: bookingId, status: "pending" }];
    }

    return [];
  };
  return sqlFn;
}

// ── Mock requireAuth ────────────────────────────────────────────────

let mockAuthUserId: string | null = AUTH_USER_A;

const originalRequire = Module.prototype.require;
const sharedSql = createMockSql();

Module.prototype.require = function (id: string) {
  if (id === "stripe") {
    return function StripeConstructor() {
      return mockStripe;
    };
  }
  if (id === "@neondatabase/serverless") {
    return { neon: () => sharedSql };
  }
  if (id === "@/lib/server-auth") {
    return {
      requireAuth: async (): Promise<string | Response> => {
        if (!mockAuthUserId) {
          return Response.json(
            { error: "Invalid or expired session token." },
            { status: 401 },
          );
        }
        return mockAuthUserId;
      },
    };
  }
  return originalRequire.apply(this, [id]);
};

// ── Helpers ─────────────────────────────────────────────────────────

function makePI(id: string, overrides: Partial<MockPI> = {}): MockPI {
  return {
    id,
    status: "succeeded",
    amount: 5000,
    currency: "eur",
    metadata: {
      clerk_user_id: AUTH_USER_A,
      booking_attempt_id: "ba_" + id.slice(3),
    },
    customer: "cus_test",
    client_secret: "pi_secret_" + id,
    ...overrides,
  };
}

function makeBooking(
  id: string,
  paymentIntentId: string | null,
  overrides: Partial<(typeof bookingAttempts)[string]> = {},
): void {
  bookingAttempts[id] = {
    id,
    clerk_user_id: AUTH_USER_A,
    payment_intent_id: paymentIntentId,
    origin_address: "123 Main St",
    destination_address: "456 Oak Ave",
    origin_latitude: 3.8674,
    origin_longitude: 11.5174,
    destination_latitude: 4.0511,
    destination_longitude: 9.7679,
    ride_time: 30,
    driver_id: 1,
    expected_amount: 5000,
    currency: "eur",
    status: "payment_intent_created",
    ...overrides,
  };
}

function makeEvent(
  type: string,
  eventId: string,
  paymentIntentId: string,
  overrides: Partial<MockPI> = {},
): string {
  const pi =
    paymentIntents[paymentIntentId] || makePI(paymentIntentId, overrides);
  paymentIntents[paymentIntentId] = pi;

  return JSON.stringify({
    id: eventId,
    type,
    data: { object: pi },
  });
}

function makeChargeEvent(
  type: string,
  eventId: string,
  chargeId: string,
  paymentIntentId: string,
): string {
  charges[chargeId] = { payment_intent: paymentIntentId };
  return JSON.stringify({
    id: eventId,
    type,
    data: {
      object: {
        id: chargeId,
        payment_intent: paymentIntentId,
      },
    },
  });
}

function makeRecoveryRequest(body: unknown): Request {
  return new Request("http://localhost/(api)/booking/recover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

async function callRecover(body: unknown) {
  const { POST } = await import("../src/app/(api)/booking/recover+api");
  return POST(makeRecoveryRequest(body));
}

function makeWebhookRequest(
  rawBody: string,
  signature = "valid-signature",
): Request {
  return new Request("http://localhost/(api)/(stripe)/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: rawBody,
  });
}

async function callWebhook(rawBody: string, signature?: string) {
  const { POST } = await import("../src/app/(api)/(stripe)/webhook+api");
  return POST(makeWebhookRequest(rawBody, signature));
}

// ── Test runner ─────────────────────────────────────────────────────

type TestResult = {
  name: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  detail: string;
};

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, status: "PASS", detail: "" });
  } catch (err) {
    results.push({
      name,
      status: "FAIL",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function resetState() {
  paymentIntents = {};
  bookingAttempts = {};
  rides = [];
  webhookEvents = {};
  charges = {};
  drivers = { 1: { id: 1 } };
  mockAuthUserId = AUTH_USER_A;
}

// ── Tests ───────────────────────────────────────────────────────────

async function runAllTests() {
  // Test 1: Recovery endpoint creates ride after successful payment
  await test("Recovery endpoint creates ride after successful payment", async () => {
    resetState();
    makeBooking("ba_001", "pi_001");
    paymentIntents["pi_001"] = makePI("pi_001");

    const res = await callRecover({ booking_attempt_id: "ba_001" });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert(data.ride !== undefined, "Response should contain ride");
    assert(data.created === true, "Should be created=true");
    assert(
      data.payment_status === "paid",
      `Expected "paid", got ${data.payment_status}`,
    );
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 2: Recovery returns existing ride if webhook already created it
  await test("Recovery returns existing ride if webhook already created it", async () => {
    resetState();
    makeBooking("ba_002", "pi_002");
    paymentIntents["pi_002"] = makePI("pi_002");
    rides.push({
      ride_id: 42,
      payment_intent_id: "pi_002",
      payment_status: "paid",
      fare_price: 5000,
      user_id: AUTH_USER_A,
    });

    const res = await callRecover({ booking_attempt_id: "ba_002" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.created === false, "Should be created=false");
    assert(data.ride.ride_id === 42, "Should return existing ride");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 3: Recovery rejects cross-user access
  await test("Recovery rejects cross-user access", async () => {
    resetState();
    makeBooking("ba_003", "pi_003", { clerk_user_id: AUTH_USER_B });
    paymentIntents["pi_003"] = makePI("pi_003", {
      metadata: { clerk_user_id: AUTH_USER_B },
    });

    const res = await callRecover({ booking_attempt_id: "ba_003" });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // Test 4: Recovery rejects unauthenticated requests
  await test("Recovery rejects unauthenticated requests", async () => {
    resetState();
    mockAuthUserId = null;
    makeBooking("ba_004", "pi_004");
    paymentIntents["pi_004"] = makePI("pi_004");

    const res = await callRecover({ booking_attempt_id: "ba_004" });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Test 5: Recovery returns pending state when PI has not succeeded
  await test("Recovery returns pending state when PI has not succeeded", async () => {
    resetState();
    makeBooking("ba_005", "pi_005");
    paymentIntents["pi_005"] = makePI("pi_005", {
      status: "requires_action",
    });

    const res = await callRecover({ booking_attempt_id: "ba_005" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.ride === undefined, "No ride should exist");
    assert(
      data.payment_status === "requires_action",
      `Expected requires_action, got ${data.payment_status}`,
    );
    assert(rides.length === 0, "No ride should be created");
  });

  // Test 6: Recovery returns booking not found for non-existent ID
  await test("Recovery returns 404 for non-existent booking", async () => {
    resetState();
    const res = await callRecover({ booking_attempt_id: "nonexistent" });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // Test 7: Recovery by payment_intent_id instead of booking_attempt_id
  await test("Recovery by payment_intent_id works", async () => {
    resetState();
    makeBooking("ba_007", "pi_007");
    paymentIntents["pi_007"] = makePI("pi_007");

    const res = await callRecover({ payment_intent_id: "pi_007" });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const data = await res.json();
    assert(data.ride !== undefined, "Should contain ride");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 8: Recovery rejects PI ownership mismatch
  await test("Recovery rejects PI ownership mismatch", async () => {
    resetState();
    makeBooking("ba_008", "pi_008");
    paymentIntents["pi_008"] = makePI("pi_008", {
      metadata: { clerk_user_id: AUTH_USER_B },
    });

    const res = await callRecover({ booking_attempt_id: "ba_008" });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // Test 9: Recovery returns refund state without creating a new ride
  await test("Recovery returns refund state for refunded booking", async () => {
    resetState();
    makeBooking("ba_009", "pi_009", { status: "refunded" });
    paymentIntents["pi_009"] = makePI("pi_009");
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_009",
      payment_status: "refunded",
    });

    const res = await callRecover({ booking_attempt_id: "ba_009" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(
      data.booking_status === "refunded",
      `Expected "refunded", got ${data.booking_status}`,
    );
    assert(
      data.payment_status === "refunded",
      `Expected "refunded", got ${data.payment_status}`,
    );
    assert(rides.length === 1, "No new ride should be created");
  });

  // Test 10: Duplicate recovery requests return the same ride
  await test("Duplicate recovery requests return the same ride", async () => {
    resetState();
    makeBooking("ba_010", "pi_010");
    paymentIntents["pi_010"] = makePI("pi_010");

    const res1 = await callRecover({ booking_attempt_id: "ba_010" });
    assert(res1.status === 201, `First: expected 201, got ${res1.status}`);

    const res2 = await callRecover({ booking_attempt_id: "ba_010" });
    assert(res2.status === 200, `Second: expected 200, got ${res2.status}`);
    const data2 = await res2.json();
    assert(data2.created === false, "Second should return created=false");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 11: Concurrent webhook and recovery do not duplicate rides
  await test("Concurrent webhook and recovery do not duplicate rides", async () => {
    resetState();
    makeBooking("ba_011", "pi_011");
    paymentIntents["pi_011"] = makePI("pi_011");

    // Webhook creates the ride first
    const webhookBody = makeEvent(
      "payment_intent.succeeded",
      "evt_011",
      "pi_011",
    );
    const res1 = await callWebhook(webhookBody);
    assert(res1.status === 200, `Webhook: expected 200, got ${res1.status}`);
    assert(rides.length === 1, "One ride after webhook");

    // Recovery should return the existing ride
    const res2 = await callRecover({ booking_attempt_id: "ba_011" });
    assert(res2.status === 200, `Recovery: expected 200, got ${res2.status}`);
    const data2 = await res2.json();
    assert(data2.created === false, "Recovery should return created=false");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 12: Stale failure event cannot overwrite succeeded state
  await test("Stale failure event cannot overwrite succeeded state", async () => {
    resetState();
    makeBooking("ba_012", "pi_012", { status: "ride_created" });
    paymentIntents["pi_012"] = makePI("pi_012");
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_012",
      payment_status: "paid",
    });

    const failBody = makeEvent(
      "payment_intent.payment_failed",
      "evt_012",
      "pi_012",
      { status: "requires_payment_method" },
    );
    const res = await callWebhook(failBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);

    // Booking status should NOT transition from ride_created to failed
    assert(
      bookingAttempts["ba_012"].status === "ride_created",
      `Booking should stay "ride_created", got "${bookingAttempts["ba_012"].status}"`,
    );
  });

  // Test 13: Stale success event cannot undo refund state
  await test("Stale success event cannot undo refund state", async () => {
    resetState();
    makeBooking("ba_013", "pi_013", { status: "refunded" });
    paymentIntents["pi_013"] = makePI("pi_013");
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_013",
      payment_status: "refunded",
    });

    const successBody = makeEvent(
      "payment_intent.succeeded",
      "evt_013",
      "pi_013",
    );
    const res = await callWebhook(successBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);

    // Booking should stay refunded, no new ride created
    assert(
      bookingAttempts["ba_013"].status === "refunded",
      `Booking should stay "refunded", got "${bookingAttempts["ba_013"].status}"`,
    );
    assert(rides.length === 1, "No new ride should be created");
    assert(rides[0].payment_status === "refunded", "Ride should stay refunded");
  });

  // Test 14: Refund event does not trigger ride creation
  await test("Refund event does not trigger ride creation", async () => {
    resetState();
    makeBooking("ba_014", "pi_014", { status: "ride_created" });
    paymentIntents["pi_014"] = makePI("pi_014");
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_014",
      payment_status: "paid",
    });

    const refundBody = makeChargeEvent(
      "charge.refunded",
      "evt_014",
      "ch_014",
      "pi_014",
    );
    const res = await callWebhook(refundBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(rides.length === 1, "No new ride should be created");
    assert(
      bookingAttempts["ba_014"].status === "refunded",
      `Expected "refunded", got "${bookingAttempts["ba_014"].status}"`,
    );
  });

  // Test 15: Pending payment never reported as paid
  await test("Pending payment is never reported as paid", async () => {
    resetState();
    makeBooking("ba_015", "pi_015", { status: "payment_intent_created" });
    paymentIntents["pi_015"] = makePI("pi_015", {
      status: "requires_payment_method",
    });

    const res = await callRecover({ booking_attempt_id: "ba_015" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.ride === undefined, "No ride should exist");
    assert(
      data.payment_status !== "paid",
      "Pending payment should not be reported as paid",
    );
    assert(rides.length === 0, "No ride should be created");
  });

  // Test 16: No raw Stripe object in recovery response
  await test("No raw Stripe object in recovery response", async () => {
    resetState();
    makeBooking("ba_016", "pi_016");
    paymentIntents["pi_016"] = makePI("pi_016");

    const res = await callRecover({ booking_attempt_id: "ba_016" });
    const data = await res.json();
    const dataStr = JSON.stringify(data);
    assert(
      !dataStr.includes("charges") && !dataStr.includes("next_action"),
      "Response should not contain raw Stripe object fields",
    );
    assert(
      !dataStr.includes("last_payment_error"),
      "Response should not contain last_payment_error",
    );
  });

  // Test 17: Recovery with booking that has no PaymentIntent
  await test("Recovery with no PaymentIntent returns payment_status none", async () => {
    resetState();
    makeBooking("ba_017", null, { status: "pending" });

    const res = await callRecover({ booking_attempt_id: "ba_017" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(
      data.payment_status === "none",
      `Expected "none", got ${data.payment_status}`,
    );
    assert(data.ride === undefined, "No ride should exist");
  });

  // Test 18: Out-of-order success then failure then refund
  await test("Out-of-order success, failure, refund events are safe", async () => {
    resetState();
    makeBooking("ba_018", "pi_018");
    paymentIntents["pi_018"] = makePI("pi_018");

    // Success first
    const successBody = makeEvent(
      "payment_intent.succeeded",
      "evt_018a",
      "pi_018",
    );
    const res1 = await callWebhook(successBody);
    assert(res1.status === 200, `Success: expected 200, got ${res1.status}`);
    assert(rides.length === 1, "One ride after success");

    // Failure arrives (stale) — should not corrupt state
    const failBody = makeEvent(
      "payment_intent.payment_failed",
      "evt_018b",
      "pi_018",
      { status: "requires_payment_method" },
    );
    const res2 = await callWebhook(failBody);
    assert(res2.status === 200, `Failure: expected 200, got ${res2.status}`);
    assert(
      bookingAttempts["ba_018"].status === "ride_created",
      `Booking should stay "ride_created", got "${bookingAttempts["ba_018"].status}"`,
    );

    // Refund arrives — should update both booking and ride
    const refundBody = makeChargeEvent(
      "charge.refunded",
      "evt_018c",
      "ch_018",
      "pi_018",
    );
    const res3 = await callWebhook(refundBody);
    assert(res3.status === 200, `Refund: expected 200, got ${res3.status}`);
    assert(
      bookingAttempts["ba_018"].status === "refunded",
      `Booking should be "refunded", got "${bookingAttempts["ba_018"].status}"`,
    );
    assert(
      rides[0].payment_status === "refunded",
      `Ride should be "refunded", got "${rides[0].payment_status}"`,
    );
    assert(rides.length === 1, "Still one ride, no duplicates");
  });

  // Test 19: Missing both booking_attempt_id and payment_intent_id
  await test("Recovery with neither ID returns 400", async () => {
    resetState();
    const res = await callRecover({});
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // Test 20: Recovery returns disputed state correctly
  await test("Recovery returns disputed state for disputed booking", async () => {
    resetState();
    makeBooking("ba_020", "pi_020", { status: "disputed" });
    paymentIntents["pi_020"] = makePI("pi_020");
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_020",
      payment_status: "disputed",
    });

    const res = await callRecover({ booking_attempt_id: "ba_020" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(
      data.booking_status === "disputed",
      `Expected "disputed", got ${data.booking_status}`,
    );
    assert(
      data.payment_status === "disputed",
      `Expected "disputed", got ${data.payment_status}`,
    );
  });

  // ── Report ────────────────────────────────────────────────────────

  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("  Phase 2N.4 Mocked Recovery & Lifecycle Test Results");
  console.log(
    "═══════════════════════════════════════════════════════════════\n",
  );

  let passCount = 0;
  let failCount = 0;

  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : "✗";
    console.log(`  ${icon} [${r.status}] ${r.name}`);
    if (r.detail) {
      console.log(`      → ${r.detail}`);
    }
    if (r.status === "PASS") passCount++;
    else failCount++;
  }

  console.log(
    `\n  Total: ${results.length} | PASS: ${passCount} | FAIL: ${failCount}\n`,
  );
}

runAllTests().catch((e) => {
  console.error("Test runner failed:", e);
  process.exit(1);
});
