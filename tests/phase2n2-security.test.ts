/**
 * Phase 2N.2 Mocked Security Tests (updated for Phase 2N.3)
 *
 * Tests the ride/create+api.ts endpoint against all security scenarios
 * using mocked Stripe and Neon DB. No live charges, no real DB writes.
 *
 * Run with: npx tsx tests/phase2n2-security.test.ts
 */

// ── Mock setup ──────────────────────────────────────────────────────

// ── Module interception ─────────────────────────────────────────────

import { Module } from "module";

const CLERK_SECRET_KEY = "test-clerk-secret";
const STRIPE_SECRET_KEY = "test-stripe-secret";
const AUTH_USER_A = "clerk-user-A";
const AUTH_USER_B = "clerk-user-B";

process.env.CLERK_SECRET_KEY = CLERK_SECRET_KEY;
process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
process.env.DATABASE_URL = "postgres://test";

// ── Mock data stores ────────────────────────────────────────────────

let insertedRides: Record<string, unknown>[] = [];
let existingRides: Record<string, unknown>[] = [];
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

type MockPI = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, string> | null;
  customer: string | null;
  client_secret: string | null;
};

// ── Mock Stripe ─────────────────────────────────────────────────────

const mockStripe = {
  paymentIntents: {
    retrieve: async (id: string): Promise<MockPI> => {
      const pi = paymentIntents[id];
      if (!pi) {
        const err = new Error("No such payment_intent: " + id);
        (err as unknown as { type: string }).type = "StripeInvalidRequestError";
        throw err;
      }
      return { ...pi };
    },
  },
};

// ── Mock neon (shared instance) ─────────────────────────────────────

function createMockSql() {
  const sqlFn = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");

    // booking_attempts SELECT by payment_intent_id
    if (
      query.includes("SELECT * FROM booking_attempts WHERE payment_intent_id")
    ) {
      const piId = values[0] as string;
      return Object.values(bookingAttempts).filter(
        (b) => b.payment_intent_id === piId,
      );
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

    // rides SELECT by payment_intent_id
    if (query.includes("SELECT * FROM rides WHERE payment_intent_id")) {
      const piId = values[0] as string;
      return existingRides.filter((r) => r.payment_intent_id === piId);
    }

    // INSERT INTO rides
    // The SQL template has a literal "paid" (not a ${} parameter),
    // so the values array skips it. Values map to:
    // [0]origin_address [1]destination_address [2]origin_latitude
    // [3]origin_longitude [4]destination_latitude [5]destination_longitude
    // [6]ride_time [7]fare_price [8]driver_id [9]user_id [10]payment_intent_id
    if (query.includes("INSERT INTO rides")) {
      const newRide: Record<string, unknown> = {
        ride_id: insertedRides.length + 1,
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
      insertedRides.push(newRide);
      return [newRide];
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
      requireAuth: async (request: Request): Promise<string | Response> => {
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
    metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: "ba_" + id },
    customer: "cus_test123",
    client_secret: "pi_secret_" + id,
    ...overrides,
  };
}

function makeBookingForPI(
  piId: string,
  overrides: Partial<(typeof bookingAttempts)[string]> = {},
): void {
  const bookingId = "ba_" + piId;
  bookingAttempts[bookingId] = {
    id: bookingId,
    clerk_user_id: AUTH_USER_A,
    payment_intent_id: piId,
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

function createRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    payment_intent_id: "pi_test_001",
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/(api)/ride/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

async function callCreateRoute(body: unknown) {
  const { POST } = await import("../src/app/(api)/ride/create+api");
  return POST(makeRequest(body));
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
  insertedRides = [];
  existingRides = [];
  paymentIntents = {};
  bookingAttempts = {};
  mockAuthUserId = AUTH_USER_A;
}

// ── Tests ───────────────────────────────────────────────────────────

async function runAllTests() {
  // Test 1: Missing authentication is rejected
  await test("Missing authentication is rejected", async () => {
    resetState();
    mockAuthUserId = null;
    paymentIntents["pi_test_001"] = makePI("pi_test_001");
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 2: Missing payment_intent_id is rejected
  await test("Missing payment_intent_id is rejected", async () => {
    resetState();
    const body: Partial<ReturnType<typeof createRequestBody>> =
      createRequestBody();
    delete body.payment_intent_id;

    const res = await callCreateRoute(body);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 3: PaymentIntent belonging to another user is rejected
  await test("PaymentIntent belonging to another user is rejected", async () => {
    resetState();
    mockAuthUserId = AUTH_USER_A;
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      metadata: { clerk_user_id: AUTH_USER_B },
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 4: Unsuccessful PaymentIntent cannot create a paid ride
  await test("Unsuccessful PaymentIntent cannot create a paid ride", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      status: "processing",
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 4b: Canceled PaymentIntent cannot create a paid ride
  await test("Canceled PaymentIntent cannot create a paid ride", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      status: "canceled",
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 4c: PaymentIntent requiring action cannot create a paid ride
  await test("PaymentIntent requiring action cannot create a paid ride", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      status: "requires_action",
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 5: Successful, correctly owned PaymentIntent creates a ride
  await test("Successful, correctly owned PaymentIntent creates a ride", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      status: "succeeded",
      amount: 5000,
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(insertedRides.length === 1, "Exactly one ride should be inserted");

    const ride = insertedRides[0];
    assert(
      ride.payment_status === "paid",
      `Expected payment_status "paid", got: ${ride.payment_status}`,
    );
    assert(
      ride.fare_price === 5000,
      `Expected fare_price 5000 (from PI amount), got: ${ride.fare_price}`,
    );
    assert(
      ride.user_id === AUTH_USER_A,
      `Expected user_id "${AUTH_USER_A}", got: ${ride.user_id}`,
    );
    assert(
      ride.payment_intent_id === "pi_test_001",
      `Expected payment_intent_id "pi_test_001", got: ${ride.payment_intent_id}`,
    );
  });

  // Test 6: Repeating the same ride-creation request does not create a duplicate
  await test("Repeating same ride-creation request does not create a duplicate", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001");
    makeBookingForPI("pi_test_001");

    // Simulate an existing ride for this PaymentIntent
    existingRides.push({
      ride_id: 42,
      payment_intent_id: "pi_test_001",
      payment_status: "paid",
      fare_price: 5000,
      user_id: AUTH_USER_A,
    });

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(insertedRides.length === 0, "No new ride should be inserted");
    const data = await res.json();
    assert(
      data.created === false,
      `Expected created=false, got: ${data.created}`,
    );
  });

  // Test 7: fare_price from client is ignored — server uses PI amount
  await test("Client-supplied fare_price is ignored — server uses PI amount", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      amount: 7500,
    });
    makeBookingForPI("pi_test_001", { expected_amount: 7500 });

    const res = await callCreateRoute(
      createRequestBody({
        fare_price: 1,
        payment_status: "free",
      }),
    );
    assert(res.status === 201, `Expected 201, got ${res.status}`);

    const ride = insertedRides[0];
    assert(
      ride.fare_price === 7500,
      `Expected fare_price 7500 (from PI), got: ${ride.fare_price}`,
    );
    assert(
      ride.payment_status === "paid",
      `Expected payment_status "paid" (server-set), got: ${ride.payment_status}`,
    );
  });

  // Test 8: Non-existent PaymentIntent is rejected
  await test("Non-existent PaymentIntent is rejected", async () => {
    resetState();
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 9: Currency mismatch is rejected
  await test("Currency mismatch is rejected", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      currency: "usd",
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 10: PaymentIntent with no ownership metadata is rejected
  await test("PaymentIntent with no ownership metadata is rejected", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001", {
      metadata: null,
    });
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 11: No booking attempt found for PaymentIntent
  await test("No booking attempt found for PaymentIntent is rejected", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001");
    // No booking attempt created

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 12: Booking attempt belonging to another user is rejected
  await test("Booking attempt belonging to another user is rejected", async () => {
    resetState();
    mockAuthUserId = AUTH_USER_A;
    paymentIntents["pi_test_001"] = makePI("pi_test_001");
    makeBookingForPI("pi_test_001", { clerk_user_id: AUTH_USER_B });

    const res = await callCreateRoute(createRequestBody());
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(insertedRides.length === 0, "No ride should be inserted");
  });

  // Test 13: No raw Stripe object is returned to clients
  await test("No raw Stripe object is returned to clients", async () => {
    resetState();
    paymentIntents["pi_test_001"] = makePI("pi_test_001");
    makeBookingForPI("pi_test_001");

    const res = await callCreateRoute(createRequestBody());
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

  // ── Report ────────────────────────────────────────────────────────

  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("  Phase 2N.2 Mocked Security Test Results (updated for 2N.3)");
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
