/**
 * Phase 2N.4.1 Web Recovery Tests (mocked)
 *
 * Exercises the web recovery library together with the real booking recovery
 * and PaymentIntent creation routes, using mocked Stripe, Neon, Clerk, and
 * ride-service. No live charges, refunds, or database writes.
 *
 * Run with: npx tsx tests/phase2n4_1-web-recovery.test.ts
 */

import { Module } from "module";
import {
  buildBookingFingerprint,
  classifyRecovery,
  reconcileBookingAttempt,
  resolveBookingAttemptId,
  settleStoredBookingAttempt,
  stripPaymentReturnParams,
  WEB_BOOKING_STORAGE_KEY,
  writeStoredBookingAttempt,
  type RecoveryPayload,
  type StorageLike,
} from "../lib/web-booking-recovery";

process.env.CLERK_SECRET_KEY = "test-clerk-secret";
process.env.STRIPE_SECRET_KEY = "test-stripe-secret";
process.env.DATABASE_URL = "postgres://test";

const USER_A = "clerk-user-A";
const USER_B = "clerk-user-B";

type Booking = {
  id: string;
  clerk_user_id: string;
  payment_intent_id: string | null;
  status: string;
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
};

type MockPI = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  client_secret: string;
  customer: string;
  metadata: Record<string, string>;
};

let bookings: Record<string, Booking> = {};
let intents: Record<string, MockPI> = {};
let piCreateCalls = 0;
let bookingCreateCalls = 0;
let rideCreateError: Error | null = null;
let bookingLookupFails = false;
let authUser: string | null = USER_A;

const mockStripe = {
  paymentIntents: {
    retrieve: async (id: string): Promise<MockPI> => {
      const pi = intents[id];
      if (!pi) throw new Error("No such payment_intent: " + id);
      return { ...pi };
    },
    create: async (params: {
      amount: number;
      currency: string;
      customer: string;
      metadata: Record<string, string>;
    }): Promise<MockPI> => {
      piCreateCalls++;
      const id = `pi_${piCreateCalls}`;
      intents[id] = {
        id,
        status: "requires_payment_method",
        amount: params.amount,
        currency: params.currency,
        client_secret: `${id}_secret`,
        customer: params.customer,
        metadata: params.metadata,
      };
      return { ...intents[id] };
    },
  },
  customers: {
    list: async () => ({ data: [{ id: "cus_existing" }] }),
    create: async () => ({ id: "cus_new" }),
  },
};

async function mockSql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> {
  const query = strings.join("?");
  if (!query.includes("FROM booking_attempts")) {
    throw new Error("Unexpected query in test: " + query);
  }
  const booking = bookings[values[0] as string];
  return booking ? [{ ...booking }] : [];
}

const rideServiceMock = {
  getBookingById: async (id: string): Promise<Booking | null> => {
    if (bookingLookupFails) throw new Error("db unavailable");
    return bookings[id] ?? null;
  },
  getBookingByPaymentIntent: async (piId: string): Promise<Booking | null> =>
    Object.values(bookings).find((b) => b.payment_intent_id === piId) ?? null,
  getRideByPaymentIntentId: async () => null,
  createRideFromBooking: async (booking: Booking) => {
    if (rideCreateError) throw rideCreateError;
    return {
      ride: { id: `ride_${booking.id}`, payment_status: "paid" },
      created: true,
    };
  },
  linkPaymentIntentToBooking: async (bookingId: string, piId: string) => {
    bookings[bookingId].payment_intent_id = piId;
    bookings[bookingId].status = "payment_intent_created";
  },
};

const originalRequire = Module.prototype.require;

Module.prototype.require = function (id: string) {
  if (id === "stripe") {
    return function StripeConstructor() {
      return mockStripe;
    };
  }
  if (id === "@neondatabase/serverless") {
    return { neon: () => mockSql };
  }
  if (id === "@/lib/server-auth") {
    return {
      requireAuth: async (): Promise<string | Response> =>
        authUser ??
        Response.json(
          { error: "Invalid or expired session token." },
          { status: 401 },
        ),
    };
  }
  if (id === "@/lib/ride-service") {
    return rideServiceMock;
  }
  return originalRequire.apply(this, [id]);
};

function makeBooking(id: string, overrides: Partial<Booking> = {}): Booking {
  return {
    id,
    clerk_user_id: USER_A,
    payment_intent_id: null,
    status: "pending",
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
    ...overrides,
  };
}

function seedPaidBooking(bookingId: string, piStatus: string): void {
  const piId = `pi_seed_${bookingId}`;
  intents[piId] = {
    id: piId,
    status: piStatus,
    amount: 5000,
    currency: "eur",
    client_secret: `${piId}_secret`,
    customer: "cus_existing",
    metadata: { clerk_user_id: USER_A, booking_attempt_id: bookingId },
  };
  bookings[bookingId] = makeBooking(bookingId, {
    payment_intent_id: piId,
    status: "payment_intent_created",
  });
}

async function recoverPayload(bookingId: string): Promise<RecoveryPayload> {
  const { POST } = await import("../src/app/(api)/booking/recover+api");
  const res = await POST(
    new Request("http://localhost/(api)/booking/recover", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ booking_attempt_id: bookingId }),
    }),
  );
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok && typeof json.booking_status !== "string") {
    throw new Error(`Recovery request failed with status ${res.status}`);
  }
  return json as RecoveryPayload;
}

async function requestPaymentIntent(
  bookingId: string,
): Promise<{ id: string; client_secret: string }> {
  const { POST } = await import("../src/app/(api)/(stripe)/create+api");
  const res = await POST(
    new Request("http://localhost/(api)/(stripe)/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        name: "Test Rider",
        email: "rider@example.com",
        amount: "50.00",
        booking_attempt_id: bookingId,
      }),
    }),
  );
  const json = (await res.json()) as {
    paymentIntent?: { id: string; client_secret: string };
    error?: string;
  };
  if (!res.ok || !json.paymentIntent) {
    throw new Error(json.error ?? `Create failed with status ${res.status}`);
  }
  return json.paymentIntent;
}

function createStorage(): {
  storage: StorageLike;
  entries: Map<string, string>;
} {
  const entries = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
  return { storage, entries };
}

const noWait = async () => {};

type TestResult = { name: string; status: "PASS" | "FAIL"; detail: string };
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  resetState();
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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function resetState(): void {
  bookings = {};
  intents = {};
  piCreateCalls = 0;
  bookingCreateCalls = 0;
  rideCreateError = null;
  bookingLookupFails = false;
  authUser = USER_A;
}

async function runAllTests(): Promise<void> {
  await test("1. Successful recovery clears the stored booking attempt", async () => {
    const { storage, entries } = createStorage();
    seedPaidBooking("ba_1", "succeeded");
    writeStoredBookingAttempt(storage, {
      bookingAttemptId: "ba_1",
      fingerprint: "fp",
    });

    const outcome = await reconcileBookingAttempt("ba_1", recoverPayload, {
      wait: noWait,
    });
    assert(outcome === "ride_created", `expected ride_created, got ${outcome}`);

    settleStoredBookingAttempt(storage, outcome);
    assert(!entries.has(WEB_BOOKING_STORAGE_KEY), "storage should be cleared");
  });

  await test("2. Temporary failure keeps the stored booking attempt", async () => {
    const { storage, entries } = createStorage();
    seedPaidBooking("ba_2", "succeeded");
    writeStoredBookingAttempt(storage, {
      bookingAttemptId: "ba_2",
      fingerprint: "fp",
    });

    rideCreateError = new Error("transient database error");
    const outcome = await reconcileBookingAttempt("ba_2", recoverPayload, {
      maxPolls: 2,
      wait: noWait,
    });
    assert(outcome === "processing", `expected processing, got ${outcome}`);
    settleStoredBookingAttempt(storage, outcome);
    assert(
      entries.has(WEB_BOOKING_STORAGE_KEY),
      "ID should be kept on transient failure",
    );

    rideCreateError = null;
    bookingLookupFails = true;
    let threw = false;
    try {
      const networkOutcome = await reconcileBookingAttempt(
        "ba_2",
        recoverPayload,
        {
          wait: noWait,
        },
      );
      settleStoredBookingAttempt(storage, networkOutcome);
    } catch {
      threw = true;
    }
    assert(threw, "network failure should surface as an error");
    assert(
      entries.has(WEB_BOOKING_STORAGE_KEY),
      "ID should be kept on network failure",
    );
  });

  await test("3. Payment still pending keeps the stored booking attempt", async () => {
    const { storage, entries } = createStorage();
    seedPaidBooking("ba_3", "requires_action");
    writeStoredBookingAttempt(storage, {
      bookingAttemptId: "ba_3",
      fingerprint: "fp",
    });

    const outcome = await reconcileBookingAttempt("ba_3", recoverPayload, {
      wait: noWait,
    });
    assert(outcome === "unpaid", `expected unpaid, got ${outcome}`);
    settleStoredBookingAttempt(storage, outcome);
    assert(
      entries.has(WEB_BOOKING_STORAGE_KEY),
      "ID should be kept while payment is pending",
    );

    intents["pi_seed_ba_3"].status = "processing";
    const processing = await reconcileBookingAttempt("ba_3", recoverPayload, {
      maxPolls: 2,
      wait: noWait,
    });
    assert(
      processing === "processing",
      `expected processing, got ${processing}`,
    );
    settleStoredBookingAttempt(storage, processing);
    assert(
      entries.has(WEB_BOOKING_STORAGE_KEY),
      "ID should be kept while processing",
    );
  });

  await test("4. Page reload reuses the booking and PaymentIntent", async () => {
    const fingerprint = buildBookingFingerprint({
      driverId: 1,
      amount: "50.00",
      rideTime: 30,
      originLatitude: 3.8674,
      originLongitude: 11.5174,
      destinationLatitude: 4.0511,
      destinationLongitude: 9.7679,
    });
    const { storage } = createStorage();
    const createBooking = async () => {
      bookingCreateCalls++;
      const id = `ba_reload_${bookingCreateCalls}`;
      bookings[id] = makeBooking(id);
      return id;
    };

    const firstId = await resolveBookingAttemptId(
      storage,
      fingerprint,
      createBooking,
    );
    const firstPi = await requestPaymentIntent(firstId);

    const reloadedId = await resolveBookingAttemptId(
      storage,
      fingerprint,
      createBooking,
    );
    const reloadedPi = await requestPaymentIntent(reloadedId);

    assert(
      bookingCreateCalls === 1,
      `expected 1 booking, got ${bookingCreateCalls}`,
    );
    assert(
      firstId === reloadedId,
      "reload should reuse the booking attempt ID",
    );
    assert(
      piCreateCalls === 1,
      `expected 1 PaymentIntent, got ${piCreateCalls}`,
    );
    assert(
      firstPi.id === reloadedPi.id,
      "reload should return the same PaymentIntent",
    );
  });

  await test("5. Cross-user recovery and creation are rejected", async () => {
    const { storage, entries } = createStorage();
    seedPaidBooking("ba_5", "succeeded");
    writeStoredBookingAttempt(storage, {
      bookingAttemptId: "ba_5",
      fingerprint: "fp",
    });

    authUser = USER_B;

    const { POST: recover } =
      await import("../src/app/(api)/booking/recover+api");
    const recoverRes = await recover(
      new Request("http://localhost/(api)/booking/recover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer b",
        },
        body: JSON.stringify({ booking_attempt_id: "ba_5" }),
      }),
    );
    assert(
      recoverRes.status === 403,
      `recover expected 403, got ${recoverRes.status}`,
    );

    let rejected = false;
    try {
      await reconcileBookingAttempt("ba_5", recoverPayload, { wait: noWait });
    } catch {
      rejected = true;
    }
    assert(rejected, "reconcile should not treat a 403 as an outcome");
    assert(
      entries.has(WEB_BOOKING_STORAGE_KEY),
      "ID should be kept on a rejected recovery",
    );

    let createStatus = 0;
    const { POST: create } =
      await import("../src/app/(api)/(stripe)/create+api");
    const createRes = await create(
      new Request("http://localhost/(api)/(stripe)/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer b",
        },
        body: JSON.stringify({
          name: "Other",
          email: "other@example.com",
          amount: "50.00",
          booking_attempt_id: "ba_5",
        }),
      }),
    );
    createStatus = createRes.status;
    assert(createStatus === 403, `create expected 403, got ${createStatus}`);
    assert(
      piCreateCalls === 0,
      "no PaymentIntent should be created for another user",
    );
  });

  await test("Return parameters are removed from the URL", async () => {
    const cleaned = stripPaymentReturnParams(
      new URL(
        "https://mboaexpress.com/book-ride?payment_intent=pi_1&payment_intent_client_secret=s&redirect_status=succeeded&keep=1",
      ),
    );
    assert(
      cleaned === "https://mboaexpress.com/book-ride?keep=1",
      `got ${cleaned}`,
    );
  });

  await test("classifyRecovery never reports a succeeded charge without a ride as failed", async () => {
    const outcome = classifyRecovery({
      booking_status: "failed",
      payment_status: "succeeded",
    });
    assert(outcome === "processing", `expected processing, got ${outcome}`);
  });
}

runAllTests().then(() => {
  Module.prototype.require = originalRequire;

  console.log("\n=== Phase 2N.4.1 Web Recovery Tests ===\n");
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "PASS") {
      passed++;
      console.log(`  PASS  ${r.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${r.name}\n        ${r.detail}`);
    }
  }
  console.log(
    `\n${passed} passed, ${failed} failed, ${results.length} total\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
});
