/**
 * Phase 2N.4.3 Mocked Retry Lifecycle Tests
 *
 * Covers webhook isolation (claim contents, failure release and retry,
 * dispute retry, terminal bookings) and recovery of failed, canceled,
 * refunded, and cross-user payments. Stripe, Neon, and Clerk are mocked.
 * These tests do not prove the Stripe integration.
 *
 * Run with: npx tsx tests/phase2n4_3-retry-lifecycle.test.ts
 */

import { Module } from "module";

const AUTH_USER_A = "clerk-user-A";
const AUTH_USER_B = "clerk-user-B";

process.env.CLERK_SECRET_KEY = "test-clerk-secret";
process.env.STRIPE_SECRET_KEY = "test-stripe-secret";
process.env.STRIPE_WEBHOOK_SIGNING_SECRET = "test-webhook-secret";
process.env.DATABASE_URL = "postgres://test";

type MockPI = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, string> | null;
  latest_charge?: string | null;
};

type MockBooking = {
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
};

type MockWebhookEvent = {
  stripe_event_id: string;
  event_type: string;
  payment_intent_id: string | null;
  processed: boolean;
};

let paymentIntents: Record<string, MockPI> = {};
let charges: Record<
  string,
  {
    id: string;
    disputed: boolean;
    refunded: boolean;
    amount_refunded: number;
    payment_intent: string | null;
  }
> = {};
let bookings: Record<string, MockBooking> = {};
let rides: Record<string, unknown>[] = [];
let webhookEvents: Record<string, MockWebhookEvent> = {};
let failNextRideInsert = false;
let chargeRetrieveFails = false;
let piRetrieveFails = false;

const mockStripe = {
  webhooks: {
    constructEventAsync: async (rawBody: string, signature: string) => {
      if (signature === "invalid-signature") {
        throw new Error("No signatures found matching the expected signature");
      }
      return JSON.parse(rawBody);
    },
  },
  paymentIntents: {
    retrieve: async (id: string): Promise<MockPI> => {
      if (piRetrieveFails) throw new Error("stripe unavailable");
      const pi = paymentIntents[id];
      if (!pi) throw new Error("No such payment_intent: " + id);
      return { ...pi };
    },
  },
  charges: {
    retrieve: async (id: string) => {
      if (chargeRetrieveFails) throw new Error("stripe unavailable");
      const charge = charges[id];
      if (!charge) throw new Error("No such charge: " + id);
      return { ...charge };
    },
  },
};

function createMockSql() {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");

    if (query.includes("INSERT INTO webhook_events")) {
      const eventId = values[0] as string;
      if (webhookEvents[eventId]) {
        throw new Error("duplicate key value violates unique constraint");
      }
      webhookEvents[eventId] = {
        stripe_event_id: eventId,
        event_type: values[1] as string,
        payment_intent_id: values[2] as string | null,
        processed: false,
      };
      return [{ id: "we_" + eventId }];
    }

    if (query.includes("SELECT processed FROM webhook_events")) {
      const evt = webhookEvents[values[0] as string];
      return evt ? [{ processed: evt.processed }] : [];
    }

    if (
      query.includes("UPDATE webhook_events") &&
      query.includes("SET processed = true")
    ) {
      const stripeEventId = String(values[values.length - 1]).replace(
        "we_",
        "",
      );
      if (webhookEvents[stripeEventId]) {
        webhookEvents[stripeEventId].processed = true;
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

    if (
      query.includes("SELECT * FROM booking_attempts WHERE payment_intent_id")
    ) {
      return Object.values(bookings).filter(
        (b) => b.payment_intent_id === values[0],
      );
    }

    if (query.includes("SELECT * FROM booking_attempts WHERE id")) {
      const booking = bookings[values[0] as string];
      return booking ? [booking] : [];
    }

    if (
      query.includes("UPDATE booking_attempts") &&
      query.includes("SET status")
    ) {
      const booking = bookings[values[1] as string];
      if (booking) booking.status = values[0] as string;
      return [];
    }

    if (query.includes("SELECT * FROM rides WHERE payment_intent_id")) {
      return rides.filter((r) => r.payment_intent_id === values[0]);
    }

    if (query.includes("SELECT ride_id FROM rides WHERE payment_intent_id")) {
      return rides.filter((r) => r.payment_intent_id === values[0]);
    }

    if (query.includes("INSERT INTO rides")) {
      if (failNextRideInsert) {
        failNextRideInsert = false;
        throw new Error("connection reset by peer");
      }
      const ride: Record<string, unknown> = {
        ride_id: rides.length + 1,
        fare_price: values[7],
        payment_status: "paid",
        driver_id: values[8],
        user_id: values[9],
        payment_intent_id: values[10],
      };
      rides.push(ride);
      return [ride];
    }

    if (query.includes("UPDATE rides SET payment_status")) {
      const piId = values[0];
      let status = "unknown";
      if (query.includes("'failed'")) status = "failed";
      else if (query.includes("'canceled'")) status = "canceled";
      else if (query.includes("'refunded'")) status = "refunded";
      else if (query.includes("'disputed'")) status = "disputed";
      rides.forEach((r) => {
        if (r.payment_intent_id === piId) r.payment_status = status;
      });
      return [];
    }

    return [];
  };
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
      requireAuth: async (): Promise<string> => AUTH_USER_A,
    };
  }
  return originalRequire.apply(this, [id]);
};

function resetState() {
  paymentIntents = {};
  charges = {};
  bookings = {};
  rides = [];
  webhookEvents = {};
  failNextRideInsert = false;
  chargeRetrieveFails = false;
  piRetrieveFails = false;
}

function addBooking(
  id: string,
  paymentIntentId: string | null,
  overrides: Partial<MockBooking> = {},
) {
  bookings[id] = {
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

function addPaymentIntent(
  id: string,
  status: string,
  bookingId: string,
  owner = AUTH_USER_A,
  latestCharge: string | null = null,
): MockPI {
  const pi: MockPI = {
    id,
    status,
    amount: 5000,
    currency: "eur",
    metadata: { clerk_user_id: owner, booking_attempt_id: bookingId },
    latest_charge: latestCharge,
  };
  paymentIntents[id] = pi;
  return pi;
}

function eventBody(type: string, eventId: string, object: unknown): string {
  return JSON.stringify({ id: eventId, type, data: { object } });
}

function webhookRequest(body: string): Request {
  return new Request("http://localhost/(api)/(stripe)/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": "valid-signature",
    },
    body,
  });
}

async function callWebhook(body: string) {
  const { POST } = await import("../src/app/(api)/(stripe)/webhook+api");
  return POST(webhookRequest(body));
}

async function callRecover(bookingId: string) {
  const { POST } = await import("../src/app/(api)/booking/recover+api");
  return POST(
    new Request("http://localhost/booking/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking_attempt_id: bookingId }),
    }),
  );
}

type TestResult = { name: string; status: "PASS" | "FAIL"; detail: string };
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

async function runAllTests() {
  await test("Success after a declined attempt on the same PaymentIntent creates the ride", async () => {
    resetState();
    addBooking("ba_1", "pi_1", { status: "failed" });
    addPaymentIntent("pi_1", "requires_payment_method", "ba_1");
    await callWebhook(
      eventBody(
        "payment_intent.payment_failed",
        "evt_1a",
        paymentIntents["pi_1"],
      ),
    );
    assert(
      bookings["ba_1"].status === "failed",
      `After failure expected "failed", got ${bookings["ba_1"].status}`,
    );

    paymentIntents["pi_1"].status = "succeeded";
    const res = await callWebhook(
      eventBody("payment_intent.succeeded", "evt_1b", paymentIntents["pi_1"]),
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
    assert(
      bookings["ba_1"].status === "ride_created",
      `Expected "ride_created", got ${bookings["ba_1"].status}`,
    );
  });

  await test("Late failure event cannot overwrite a succeeded booking", async () => {
    resetState();
    addBooking("ba_2", "pi_2", { status: "succeeded" });
    addPaymentIntent("pi_2", "succeeded", "ba_2");

    const res = await callWebhook(
      eventBody(
        "payment_intent.payment_failed",
        "evt_2",
        paymentIntents["pi_2"],
      ),
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      bookings["ba_2"].status === "succeeded",
      `Expected "succeeded", got ${bookings["ba_2"].status}`,
    );
  });

  await test("Webhook claim stores the PaymentIntent it belongs to", async () => {
    resetState();
    addBooking("ba_3", "pi_3");
    addPaymentIntent("pi_3", "succeeded", "ba_3");

    await callWebhook(
      eventBody("payment_intent.succeeded", "evt_3", paymentIntents["pi_3"]),
    );
    assert(
      webhookEvents["evt_3"].payment_intent_id === "pi_3",
      `Expected claim PI "pi_3", got ${webhookEvents["evt_3"].payment_intent_id}`,
    );
    assert(
      webhookEvents["evt_3"].processed === true,
      "Event should be processed after success",
    );
  });

  await test("Unexpected ride insert failure returns 500, releases the claim, and the retry creates the ride", async () => {
    resetState();
    addBooking("ba_4", "pi_4");
    addPaymentIntent("pi_4", "succeeded", "ba_4");
    const body = eventBody(
      "payment_intent.succeeded",
      "evt_4",
      paymentIntents["pi_4"],
    );

    failNextRideInsert = true;
    const first = await callWebhook(body);
    assert(
      first.status === 500,
      `First delivery: expected 500, got ${first.status}`,
    );
    assert(
      webhookEvents["evt_4"] === undefined,
      "Claim should be released after a transient failure",
    );
    assert(
      rides.length === 0,
      "No ride should exist after the failed delivery",
    );

    const retry = await callWebhook(body);
    assert(retry.status === 200, `Retry: expected 200, got ${retry.status}`);
    assert(rides.length === 1, `Retry: expected 1 ride, got ${rides.length}`);
    assert(
      bookings["ba_4"].status === "ride_created",
      `Expected "ride_created", got ${bookings["ba_4"].status}`,
    );
  });

  await test("Dispute lookup failure returns 500 and the retry records the dispute", async () => {
    resetState();
    addBooking("ba_5", "pi_5", { status: "ride_created" });
    rides.push({
      ride_id: 1,
      payment_intent_id: "pi_5",
      payment_status: "paid",
    });
    charges["ch_5"] = {
      id: "ch_5",
      disputed: true,
      refunded: false,
      amount_refunded: 0,
      payment_intent: "pi_5",
    };
    const body = eventBody("charge.dispute.created", "evt_5", {
      id: "dp_5",
      charge: "ch_5",
    });

    chargeRetrieveFails = true;
    const first = await callWebhook(body);
    assert(
      first.status === 500,
      `First delivery: expected 500, got ${first.status}`,
    );
    assert(
      bookings["ba_5"].status === "ride_created",
      "Dispute must not be recorded when lookup fails",
    );

    chargeRetrieveFails = false;
    const retry = await callWebhook(body);
    assert(retry.status === 200, `Retry: expected 200, got ${retry.status}`);
    assert(
      bookings["ba_5"].status === "disputed",
      `Expected "disputed", got ${bookings["ba_5"].status}`,
    );
    assert(
      rides[0].payment_status === "disputed",
      `Expected ride "disputed", got ${rides[0].payment_status}`,
    );
  });

  await test("Succeeded event for a canceled booking creates no ride and is acknowledged", async () => {
    resetState();
    addBooking("ba_6", "pi_6", { status: "canceled" });
    addPaymentIntent("pi_6", "succeeded", "ba_6");

    const res = await callWebhook(
      eventBody("payment_intent.succeeded", "evt_6", paymentIntents["pi_6"]),
    );
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(rides.length === 0, "No ride for a canceled booking");
    assert(
      webhookEvents["evt_6"].processed === true,
      "Terminal rejection should be acknowledged",
    );
  });

  await test("Recovery creates the ride for a failed booking whose PaymentIntent later succeeded", async () => {
    resetState();
    addBooking("ba_7", "pi_7", { status: "failed" });
    addPaymentIntent("pi_7", "succeeded", "ba_7");

    const res = await callRecover("ba_7");
    const data = (await res.json()) as {
      booking_status: string;
      payment_status: string;
      created?: boolean;
    };
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(
      data.booking_status === "ride_created",
      `Expected "ride_created", got ${data.booking_status}`,
    );
    assert(
      data.payment_status === "paid",
      `Expected "paid", got ${data.payment_status}`,
    );
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  await test("Recovery reports a canceled booking without creating a ride", async () => {
    resetState();
    addBooking("ba_8", "pi_8", { status: "canceled" });
    addPaymentIntent("pi_8", "succeeded", "ba_8");

    const res = await callRecover("ba_8");
    const data = (await res.json()) as {
      booking_status: string;
      ride?: unknown;
    };
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      data.booking_status === "canceled",
      `Expected "canceled", got ${data.booking_status}`,
    );
    assert(data.ride === undefined, "No ride should be returned");
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery reports a declined PaymentIntent as its current Stripe status without a ride", async () => {
    resetState();
    addBooking("ba_9", "pi_9", { status: "failed" });
    addPaymentIntent("pi_9", "requires_payment_method", "ba_9");

    const res = await callRecover("ba_9");
    const data = (await res.json()) as { payment_status: string };
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      data.payment_status === "requires_payment_method",
      `Got ${data.payment_status}`,
    );
    assert(rides.length === 0, "No ride for a declined payment");
  });

  await test("Recovery reports a refunded charge without creating a ride", async () => {
    resetState();
    addBooking("ba_10", "pi_10", { status: "succeeded" });
    addPaymentIntent("pi_10", "succeeded", "ba_10", AUTH_USER_A, "ch_10");
    charges["ch_10"] = {
      id: "ch_10",
      disputed: false,
      refunded: true,
      amount_refunded: 5000,
      payment_intent: "pi_10",
    };

    const res = await callRecover("ba_10");
    const data = (await res.json()) as { payment_status: string };
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      data.payment_status === "refunded",
      `Expected "refunded", got ${data.payment_status}`,
    );
    assert(rides.length === 0, "No ride for a refunded charge");
  });

  await test("Recovery rejects a booking owned by another user", async () => {
    resetState();
    addBooking("ba_11", "pi_11", {
      clerk_user_id: AUTH_USER_B,
      status: "failed",
    });
    addPaymentIntent("pi_11", "succeeded", "ba_11", AUTH_USER_B);

    const res = await callRecover("ba_11");
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(rides.length === 0, "No ride for another user's booking");
  });

  await test("Recovery rejects a PaymentIntent that references a different booking", async () => {
    resetState();
    addBooking("ba_12", "pi_12", { status: "failed" });
    addPaymentIntent("pi_12", "succeeded", "ba_other");

    const res = await callRecover("ba_12");
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(rides.length === 0, "No ride for a mismatched PaymentIntent");
  });

  await test("Recovery returns 503 when Stripe cannot retrieve the PaymentIntent", async () => {
    resetState();
    addBooking("ba_13", "pi_13", { status: "failed" });
    addPaymentIntent("pi_13", "succeeded", "ba_13");
    piRetrieveFails = true;

    const res = await callRecover("ba_13");
    assert(res.status === 503, `Expected 503, got ${res.status}`);
    assert(rides.length === 0, "No ride when verification is unavailable");
  });

  console.log("\n  Phase 2N.4.3 Mocked Retry Lifecycle Test Results\n");
  let failCount = 0;
  for (const r of results) {
    console.log(`  ${r.status === "PASS" ? "✓" : "✗"} [${r.status}] ${r.name}`);
    if (r.detail) console.log(`      → ${r.detail}`);
    if (r.status === "FAIL") failCount++;
  }
  console.log(
    `\n  Total: ${results.length} | PASS: ${results.length - failCount} | FAIL: ${failCount}\n`,
  );
  if (failCount > 0) process.exitCode = 1;
}

runAllTests().catch((e) => {
  console.error("Test runner failed:", e);
  process.exit(1);
});
