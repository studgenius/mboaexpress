/**
 * Phase 2N.3 Mocked Webhook and Booking Tests
 *
 * Tests the webhook endpoint and booking recovery flow using mocked
 * Stripe, Neon DB, and Clerk auth. No live charges, refunds, or
 * real DB writes.
 *
 * Run with: npx tsx tests/phase2n3-webhook.test.ts
 */

// ── Mock setup ──────────────────────────────────────────────────────

// ── Module interception ─────────────────────────────────────────────

import { Module } from "module";

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
    created_at: string;
    updated_at: string;
  }
> = {};
let rides: Record<string, unknown>[] = [];
let webhookEvents: Record<
  string,
  { stripe_event_id: string; event_type: string; processed: boolean }
> = {};
let charges: Record<string, { payment_intent: string | null }> = {};

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
      // Parse the event from the raw body
      const parsed = JSON.parse(_rawBody);
      return parsed;
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

// ── Mock neon ───────────────────────────────────────────────────────

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
      // markProcessed binds (result_status, result_detail, id); the id is last.
      const weId = values[values.length - 1] as string | undefined;
      if (weId) {
        const stripeEventId = String(weId).replace("we_", "");
        if (webhookEvents[stripeEventId]) {
          webhookEvents[stripeEventId].processed = true;
        }
      }
      return [];
    }

    if (query.includes("DELETE FROM webhook_events")) {
      const stripeEventId = String(values[0]).replace("we_", "");
      if (
        webhookEvents[stripeEventId] &&
        !webhookEvents[stripeEventId].processed
      ) {
        delete webhookEvents[stripeEventId];
      }
      return [];
    }

    // booking_attempts SELECT by payment_intent_id
    if (
      query.includes("SELECT * FROM booking_attempts WHERE payment_intent_id")
    ) {
      const piId = values[0] as string;
      const found = Object.values(bookingAttempts).filter(
        (b) => b.payment_intent_id === piId,
      );
      return found;
    }

    // booking_attempts UPDATE status
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

    // rides SELECT * by payment_intent_id (used by ride-service)
    if (query.includes("SELECT * FROM rides WHERE payment_intent_id")) {
      const piId = values[0] as string;
      return rides.filter((r) => r.payment_intent_id === piId);
    }

    // rides SELECT ride_id by payment_intent_id (used by webhook handlers)
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
    // The SQL uses literal status strings, so values[0] is the payment_intent_id.
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

    return [];
  };
  return sqlFn;
}

const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string) {
  if (id === "stripe") {
    return function StripeConstructor() {
      return mockStripe;
    };
  }
  if (id === "@neondatabase/serverless") {
    const sharedSql = createMockSql();
    return { neon: () => sharedSql };
  }
  if (id === "@/lib/server-auth") {
    return {
      requireAuth: async (): Promise<string | Response> => {
        return AUTH_USER_A;
      },
    };
  }
  return originalRequire.apply(this, [id]);
};

// ── Helpers ─────────────────────────────────────────────────────────

function makeEvent(
  type: string,
  eventId: string,
  paymentIntentId: string,
  overrides: Partial<MockPI> = {},
): string {
  const pi = paymentIntents[paymentIntentId] || {
    id: paymentIntentId,
    status: "succeeded",
    amount: 5000,
    currency: "eur",
    metadata: {
      clerk_user_id: AUTH_USER_A,
      booking_attempt_id: "ba_" + paymentIntentId.slice(3),
    },
    customer: "cus_test",
    client_secret: "pi_secret_" + paymentIntentId,
    ...overrides,
  };
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

function makeDisputeEvent(
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
        id: "dp_test",
        charge: chargeId,
      },
    },
  });
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
    created_at: "2026-11-06T10:00:00Z",
    updated_at: "2026-11-06T10:00:00Z",
    ...overrides,
  };
}

function makeWebhookRequest(
  rawBody: string,
  signature: string = "valid-signature",
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
}

// ── Tests ───────────────────────────────────────────────────────────

async function runAllTests() {
  // Test 1: Invalid webhook signature is rejected
  await test("Invalid webhook signature is rejected", async () => {
    resetState();
    const rawBody = makeEvent("payment_intent.succeeded", "evt_001", "pi_001");
    const res = await callWebhook(rawBody, "invalid-signature");
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // Test 2: Missing Stripe-Signature header is rejected
  await test("Missing Stripe-Signature header is rejected", async () => {
    resetState();
    const rawBody = makeEvent("payment_intent.succeeded", "evt_002", "pi_002");
    const req = new Request("http://localhost/(api)/(stripe)/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
    const { POST } = await import("../src/app/(api)/(stripe)/webhook+api");
    const res = await POST(req);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // Test 3: Valid successful-payment event creates a ride
  await test("Valid successful-payment event creates a ride", async () => {
    resetState();
    makeBooking("ba_003", "pi_003");
    const rawBody = makeEvent("payment_intent.succeeded", "evt_003", "pi_003");

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
    assert(
      rides[0].payment_intent_id === "pi_003",
      "Ride should be linked to PI",
    );
    assert(
      rides[0].payment_status === "paid",
      `Expected payment_status "paid", got ${rides[0].payment_status}`,
    );
  });

  // Test 4: Duplicate event delivery does not create a duplicate ride
  await test("Duplicate event delivery does not create duplicate ride", async () => {
    resetState();
    makeBooking("ba_004", "pi_004");
    const rawBody = makeEvent("payment_intent.succeeded", "evt_004", "pi_004");

    const res1 = await callWebhook(rawBody);
    assert(
      res1.status === 200,
      `First delivery: expected 200, got ${res1.status}`,
    );

    const res2 = await callWebhook(rawBody);
    assert(
      res2.status === 200,
      `Second delivery: expected 200, got ${res2.status}`,
    );
    const data2 = await res2.json();
    assert(
      data2.duplicate === true,
      "Second delivery should be marked duplicate",
    );
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 5: Event with no matching booking attempt
  await test("Event with no matching booking attempt is handled gracefully", async () => {
    resetState();
    // No booking attempt created
    const rawBody = makeEvent("payment_intent.succeeded", "evt_005", "pi_005");

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  // Test 6: PaymentIntent linked to another user's booking attempt
  await test("PaymentIntent linked to another user's booking attempt is rejected", async () => {
    resetState();
    // Booking belongs to user B, but PI metadata says user A
    makeBooking("ba_003", "pi_006", { clerk_user_id: AUTH_USER_B });
    paymentIntents["pi_006"] = {
      id: "pi_006",
      status: "succeeded",
      amount: 5000,
      currency: "eur",
      metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: "ba_003" },
      customer: "cus_test",
      client_secret: "secret",
    };

    const rawBody = makeEvent("payment_intent.succeeded", "evt_006", "pi_006");
    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      rides.length === 0,
      "No ride should be created for mismatched ownership",
    );
  });

  // Test 7: Failed payment updates booking and ride status
  // Booking starts as "payment_intent_created" (not yet succeeded).
  // The failure transition payment_intent_created → failed is allowed.
  await test("Failed payment updates booking and ride status", async () => {
    resetState();
    makeBooking("ba_004", "pi_007", { status: "payment_intent_created" });
    // Simulate an existing ride (e.g. from a prior success that was
    // overwritten — but in this test the booking hasn't succeeded yet).
    // No ride exists yet since payment hasn't succeeded.

    const rawBody = makeEvent(
      "payment_intent.payment_failed",
      "evt_007",
      "pi_007",
      { status: "requires_payment_method" },
    );

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      bookingAttempts["ba_004"].status === "failed",
      `Expected booking status "failed", got ${bookingAttempts["ba_004"].status}`,
    );
    // No ride should exist since payment never succeeded
    assert(rides.length === 0, "No ride should exist for failed payment");
  });

  // Test 8: Canceled payment updates booking and ride status
  await test("Canceled payment updates booking and ride status", async () => {
    resetState();
    makeBooking("ba_005", "pi_008");
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_008",
      payment_status: "paid",
    });

    const rawBody = makeEvent("payment_intent.canceled", "evt_008", "pi_008", {
      status: "canceled",
    });

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      bookingAttempts["ba_005"].status === "canceled",
      `Expected booking status "canceled", got ${bookingAttempts["ba_005"].status}`,
    );
    assert(
      rides[0].payment_status === "canceled",
      `Expected ride payment_status "canceled", got ${rides[0].payment_status}`,
    );
    assert(rides.length === 1, "Ride should not be deleted on cancel");
  });

  // Test 9: Refunded payment updates booking and ride status
  await test("Refunded payment updates booking and ride status", async () => {
    resetState();
    makeBooking("ba_006", "pi_009", { status: "ride_created" });
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_009",
      payment_status: "paid",
    });

    const rawBody = makeChargeEvent(
      "charge.refunded",
      "evt_009",
      "ch_009",
      "pi_009",
    );

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      bookingAttempts["ba_006"].status === "refunded",
      `Expected booking status "refunded", got ${bookingAttempts["ba_006"].status}`,
    );
    assert(
      rides[0].payment_status === "refunded",
      `Expected ride payment_status "refunded", got ${rides[0].payment_status}`,
    );
    assert(rides.length === 1, "Ride should not be deleted on refund");
  });

  // Test 10: Disputed payment updates booking and ride status
  await test("Disputed payment updates booking and ride status", async () => {
    resetState();
    makeBooking("ba_007", "pi_010", { status: "ride_created" });
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_010",
      payment_status: "paid",
    });

    const rawBody = makeDisputeEvent(
      "charge.dispute.created",
      "evt_010",
      "ch_010",
      "pi_010",
    );

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      bookingAttempts["ba_007"].status === "disputed",
      `Expected booking status "disputed", got ${bookingAttempts["ba_007"].status}`,
    );
    assert(
      rides[0].payment_status === "disputed",
      `Expected ride payment_status "disputed", got ${rides[0].payment_status}`,
    );
    assert(rides.length === 1, "Ride should not be deleted on dispute");
  });

  // Test 11: Concurrent webhook + client processing does not duplicate rides
  await test("Concurrent webhook + client processing does not duplicate rides", async () => {
    resetState();
    makeBooking("ba_011", "pi_011");

    // Simulate the webhook creating the ride first
    const rawBody = makeEvent("payment_intent.succeeded", "evt_011", "pi_011");
    const res1 = await callWebhook(rawBody);
    assert(res1.status === 200, `Webhook: expected 200, got ${res1.status}`);
    assert(rides.length === 1, "One ride after webhook");

    // Now simulate the client also trying to create the same ride
    // (via the shared service directly)
    const { createRideFromBooking } = await import("../src/lib/ride-service");
    const pi = paymentIntents["pi_011"] as unknown as Parameters<
      typeof createRideFromBooking
    >[1];
    const booking = Object.values(bookingAttempts)[0];
    const result = await createRideFromBooking(booking, pi, AUTH_USER_A);
    assert(!result.created, "Second creation should return created=false");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Test 12: No raw Stripe object is returned to clients
  await test("No raw Stripe object is returned to clients", async () => {
    resetState();
    makeBooking("ba_009", "pi_012");
    const rawBody = makeEvent("payment_intent.succeeded", "evt_012", "pi_012");

    const res = await callWebhook(rawBody);
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

  // Test 13: PaymentIntent with no ownership metadata is rejected
  await test("PaymentIntent with no ownership metadata is rejected", async () => {
    resetState();
    makeBooking("ba_010", "pi_013");
    paymentIntents["pi_013"] = {
      id: "pi_013",
      status: "succeeded",
      amount: 5000,
      currency: "eur",
      metadata: null,
      customer: "cus_test",
      client_secret: "secret",
    };

    const rawBody = makeEvent("payment_intent.succeeded", "evt_013", "pi_013");
    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      rides.length === 0,
      "No ride should be created without ownership metadata",
    );
  });

  // Test 14: Failure then success on the same PaymentIntent.
  // A failure event moves the booking to "failed", which is not terminal:
  // the customer can retry on the same PaymentIntent, and a later success
  // must create the ride.
  await test("Out-of-order events handled safely", async () => {
    resetState();
    makeBooking("ba_011", "pi_014");

    // First: failure event
    const failBody = makeEvent(
      "payment_intent.payment_failed",
      "evt_014a",
      "pi_014",
      { status: "requires_payment_method" },
    );
    const res1 = await callWebhook(failBody);
    assert(
      res1.status === 200,
      `Failure event: expected 200, got ${res1.status}`,
    );
    assert(
      bookingAttempts["ba_011"].status === "failed",
      `Booking should be "failed" after failure event, got "${bookingAttempts["ba_011"].status}"`,
    );

    // Then: success event on the same PaymentIntent. A declined card leaves the
    // PaymentIntent reusable, so a later success must still create the ride.
    paymentIntents["pi_014"].status = "succeeded";
    paymentIntents["pi_014"].metadata = {
      clerk_user_id: AUTH_USER_A,
      booking_attempt_id: "ba_011",
    };
    const successBody = makeEvent(
      "payment_intent.succeeded",
      "evt_014b",
      "pi_014",
    );
    const res2 = await callWebhook(successBody);
    assert(
      res2.status === 200,
      `Success event: expected 200, got ${res2.status}`,
    );
    assert(
      rides.length === 1,
      `Expected 1 ride after success, got ${rides.length}`,
    );
    assert(
      bookingAttempts["ba_011"].status === "ride_created",
      `Booking should be "ride_created", got "${bookingAttempts["ba_011"].status}"`,
    );
  });

  // Test 15: Unhandled event type is acknowledged
  await test("Unhandled event type is acknowledged", async () => {
    resetState();
    const rawBody = makeEvent("payment_intent.created", "evt_015", "pi_015", {
      status: "requires_payment_method",
    });

    const res = await callWebhook(rawBody);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // ── Report ────────────────────────────────────────────────────────

  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("  Phase 2N.3 Mocked Webhook & Booking Test Results");
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
