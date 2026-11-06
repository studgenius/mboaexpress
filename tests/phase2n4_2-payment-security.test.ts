/**
 * Phase 2N.4.2 Mocked Payment Security Tests
 *
 * Exercises the Stripe PaymentIntent creation route (booking-attempt
 * idempotency) and the booking recovery route (server-side PaymentIntent
 * verification, refund/dispute handling, duplicate ride prevention) with
 * Stripe, Neon, and auth mocked. The real ride service and payment
 * verification code run unchanged.
 *
 * These mocks do not prove the Stripe integration. They check that our code
 * makes the right decisions for the responses we model.
 *
 * Run with: npx tsx tests/phase2n4_2-payment-security.test.ts
 */

import { Module } from "module";

const AUTH_USER_A = "clerk-user-A";
const AUTH_USER_B = "clerk-user-B";
const STRIPE_SECRET_VALUE = "test-stripe-secret-do-not-log";

process.env.CLERK_SECRET_KEY = "test-clerk-secret";
process.env.STRIPE_SECRET_KEY = STRIPE_SECRET_VALUE;
process.env.DATABASE_URL = "postgres://test";

type BookingRow = {
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
};

type RideRow = {
  id: number;
  payment_intent_id: string;
  fare_price: number;
  user_id: string;
  payment_status: string;
};

type MockPI = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, string> | null;
  customer: string | null;
  client_secret: string | null;
  latest_charge: string | null;
};

type MockCharge = {
  id: string;
  disputed: boolean;
  refunded: boolean;
  amount_refunded: number;
};

type MockCustomer = {
  id: string;
  email: string;
  metadata: Record<string, string>;
};

let authUser: string | null = AUTH_USER_A;
let bookings: Record<string, BookingRow> = {};
let rides: RideRow[] = [];
let paymentIntents: Record<string, MockPI> = {};
let charges: Record<string, MockCharge> = {};
let customers: MockCustomer[] = [];
let idempotentPIs = new Map<string, string>();
let piCreateCalls: {
  params: Record<string, unknown>;
  idempotencyKey: string | undefined;
}[] = [];
let customerCreateCalls = 0;
let stripeRetrieveFails = false;
let onPiCreate: ((bookingId: string) => void) | null = null;
let idSequence = 0;

function resetState(): void {
  authUser = AUTH_USER_A;
  bookings = {};
  rides = [];
  paymentIntents = {};
  charges = {};
  customers = [];
  idempotentPIs = new Map();
  piCreateCalls = [];
  customerCreateCalls = 0;
  stripeRetrieveFails = false;
  onPiCreate = null;
}

// Stripe returns the original PaymentIntent for a repeated idempotency key,
// so the mock does the same.
const mockStripe = {
  paymentIntents: {
    retrieve: async (id: string): Promise<MockPI> => {
      if (stripeRetrieveFails) throw new Error("stripe unavailable");
      const pi = paymentIntents[id];
      if (!pi) throw new Error("No such payment_intent: " + id);
      return { ...pi };
    },
    create: async (
      params: Record<string, unknown>,
      options?: { idempotencyKey?: string },
    ): Promise<MockPI> => {
      const key = options?.idempotencyKey;
      piCreateCalls.push({ params, idempotencyKey: key });

      if (key && idempotentPIs.has(key)) {
        return { ...paymentIntents[idempotentPIs.get(key) as string] };
      }

      idSequence += 1;
      const id = `pi_created_${idSequence}`;
      const metadata = params.metadata as Record<string, string>;
      paymentIntents[id] = {
        id,
        status: "requires_payment_method",
        amount: params.amount as number,
        currency: params.currency as string,
        metadata,
        customer: (params.customer as string) ?? null,
        client_secret: `${id}_secret`,
        latest_charge: null,
      };
      if (key) idempotentPIs.set(key, id);
      onPiCreate?.(metadata.booking_attempt_id);
      return { ...paymentIntents[id] };
    },
  },
  customers: {
    list: async ({ email }: { email: string }) => ({
      data: customers.filter((c) => c.email === email).map((c) => ({ ...c })),
    }),
    create: async (params: {
      name: string;
      email: string;
      metadata: Record<string, string>;
    }): Promise<MockCustomer> => {
      customerCreateCalls += 1;
      idSequence += 1;
      const customer: MockCustomer = {
        id: `cus_created_${idSequence}`,
        email: params.email,
        metadata: params.metadata,
      };
      customers.push(customer);
      return { ...customer };
    },
  },
  charges: {
    retrieve: async (id: string): Promise<MockCharge> => {
      const charge = charges[id];
      if (!charge) throw new Error("No such charge: " + id);
      return { ...charge };
    },
  },
};

// Models the SQL the routes and ride service issue. The rides table has a
// unique index on payment_intent_id, which the insert mock enforces.
const mockSql = async (
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<Record<string, unknown>[]> => {
  const query = strings.join("?");

  if (query.includes("FROM booking_attempts WHERE id")) {
    const booking = bookings[values[0] as string];
    return booking ? [{ ...booking }] : [];
  }

  if (query.includes("FROM booking_attempts WHERE payment_intent_id")) {
    return Object.values(bookings)
      .filter((b) => b.payment_intent_id === values[0])
      .map((b) => ({ ...b }));
  }

  if (
    query.includes("UPDATE booking_attempts") &&
    query.includes("SET payment_intent_id")
  ) {
    const paymentIntentId = values[0] as string;
    const booking = bookings[values[1] as string];
    if (
      !booking ||
      (booking.payment_intent_id !== null &&
        booking.payment_intent_id !== paymentIntentId)
    ) {
      return [];
    }
    booking.payment_intent_id = paymentIntentId;
    booking.status = "payment_intent_created";
    return [{ id: booking.id }];
  }

  if (
    query.includes("UPDATE booking_attempts") &&
    query.includes("SET status")
  ) {
    const booking = bookings[values[1] as string];
    if (booking) booking.status = values[0] as string;
    return [];
  }

  if (query.includes("FROM rides WHERE payment_intent_id")) {
    return rides
      .filter((r) => r.payment_intent_id === values[0])
      .map((r) => ({ ...r }));
  }

  if (query.includes("INSERT INTO rides")) {
    const paymentIntentId = values[10] as string;
    if (rides.some((r) => r.payment_intent_id === paymentIntentId)) {
      throw Object.assign(new Error("duplicate key value"), { code: "23505" });
    }
    const ride: RideRow = {
      id: rides.length + 1,
      payment_intent_id: paymentIntentId,
      fare_price: values[7] as number,
      user_id: values[9] as string,
      payment_status: "paid",
    };
    rides.push(ride);
    return [{ ...ride }];
  }

  throw new Error("Unexpected SQL in test mock: " + query);
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
      requireAuth: async (): Promise<string | Response> => {
        if (!authUser) {
          return Response.json(
            { error: "Invalid or expired session token." },
            { status: 401 },
          );
        }
        return authUser;
      },
    };
  }
  return originalRequire.apply(this, [id]);
};

// ── Helpers ─────────────────────────────────────────────────────────

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callRecover(body: unknown): Promise<Response> {
  const { POST } = await import("../src/app/(api)/booking/recover+api");
  return POST(jsonRequest(body));
}

async function callCreate(body: unknown): Promise<Response> {
  const { POST } = await import("../src/app/(api)/(stripe)/create+api");
  return POST(jsonRequest(body));
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function seedBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  const row: BookingRow = {
    id: "ba_1",
    clerk_user_id: AUTH_USER_A,
    payment_intent_id: null,
    origin_address: "Origin Street",
    destination_address: "Destination Avenue",
    origin_latitude: 3.8674,
    origin_longitude: 11.5174,
    destination_latitude: 4.0511,
    destination_longitude: 9.7679,
    ride_time: 30,
    driver_id: 1,
    expected_amount: 5000,
    currency: "eur",
    status: "pending",
    ...overrides,
  };
  bookings[row.id] = row;
  return row;
}

function seedPI(id: string, overrides: Partial<MockPI> = {}): MockPI {
  const pi: MockPI = {
    id,
    status: "succeeded",
    amount: 5000,
    currency: "eur",
    metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: "ba_1" },
    customer: "cus_1",
    client_secret: `${id}_secret`,
    latest_charge: null,
    ...overrides,
  };
  paymentIntents[id] = pi;
  return pi;
}

/** A booking already linked to pi_1, whose metadata points back to it. */
function seedLinked(
  status: string = "payment_intent_created",
  piOverrides: Partial<MockPI> = {},
): void {
  seedBooking({ payment_intent_id: "pi_1", status });
  seedPI("pi_1", piOverrides);
}

type TestResult = { name: string; status: "PASS" | "FAIL"; detail?: string };
const results: TestResult[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  resetState();
  try {
    await fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

const CREATE_BODY = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  amount: 50,
  booking_attempt_id: "ba_1",
};

// ── Tests ───────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  // Recovery: PaymentIntent verification

  await test("Recovery rejects a PaymentIntent in the wrong currency", async () => {
    seedLinked("payment_intent_created", { currency: "usd" });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery rejects a PaymentIntent amount that differs from the booking", async () => {
    seedLinked("payment_intent_created", { amount: 4900 });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery rejects a PaymentIntent with no booking reference in metadata", async () => {
    seedLinked("payment_intent_created", {
      metadata: { clerk_user_id: AUTH_USER_A },
    });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery rejects a PaymentIntent whose metadata names another booking", async () => {
    seedLinked("payment_intent_created", {
      metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: "ba_9" },
    });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery by PaymentIntent rejects metadata pointing at a different booking", async () => {
    seedBooking({ id: "ba_2", payment_intent_id: "pi_2" });
    seedPI("pi_2", {
      metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: "ba_1" },
    });
    const res = await callRecover({ payment_intent_id: "pi_2" });
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery rejects another user's booking attempt", async () => {
    seedBooking({ clerk_user_id: AUTH_USER_B, payment_intent_id: "pi_1" });
    seedPI("pi_1");
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Recovery rejects a PaymentIntent owned by another user", async () => {
    seedLinked("payment_intent_created", {
      metadata: { clerk_user_id: AUTH_USER_B, booking_attempt_id: "ba_1" },
    });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Client-supplied amount, currency, status and payment status are ignored", async () => {
    seedLinked("payment_intent_created", { status: "requires_payment_method" });
    const res = await callRecover({
      booking_attempt_id: "ba_1",
      amount: 1,
      currency: "usd",
      status: "succeeded",
      payment_status: "paid",
      fare_price: 1,
    });
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      data.payment_status === "requires_payment_method",
      `Expected Stripe status, got ${String(data.payment_status)}`,
    );
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Canceled PaymentIntent is reported as canceled, never paid", async () => {
    seedLinked("payment_intent_created", { status: "canceled" });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data.payment_status === "canceled", "Expected canceled");
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Authentication-required PaymentIntent stays pending and creates no ride", async () => {
    seedLinked("payment_intent_created", { status: "requires_action" });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data.payment_status === "requires_action", "Expected pending state");
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Refunded charge on a succeeded PaymentIntent is not reported as paid", async () => {
    seedLinked("payment_intent_created", { latest_charge: "ch_1" });
    charges.ch_1 = {
      id: "ch_1",
      disputed: false,
      refunded: true,
      amount_refunded: 5000,
    };
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      data.payment_status === "refunded",
      `Expected refunded, got ${String(data.payment_status)}`,
    );
    assert(
      rides.length === 0,
      "No ride should be created for a refunded charge",
    );
  });

  await test("Disputed charge on a succeeded PaymentIntent is not reported as paid", async () => {
    seedLinked("payment_intent_created", { latest_charge: "ch_1" });
    charges.ch_1 = {
      id: "ch_1",
      disputed: true,
      refunded: false,
      amount_refunded: 0,
    };
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      data.payment_status === "disputed",
      `Expected disputed, got ${String(data.payment_status)}`,
    );
    assert(
      rides.length === 0,
      "No ride should be created for a disputed charge",
    );
  });

  await test("Booking already marked refunded never creates a ride", async () => {
    seedLinked("refunded");
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  await test("Unknown PaymentIntent returns 404", async () => {
    const res = await callRecover({ payment_intent_id: "pi_unknown" });
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("Stripe outage during recovery returns 503 and creates no ride", async () => {
    seedLinked();
    stripeRetrieveFails = true;
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    assert(res.status === 503, `Expected 503, got ${res.status}`);
    assert(rides.length === 0, "No ride should be created");
  });

  // Recovery: verified success and duplicate ride prevention

  await test("Verified succeeded PaymentIntent creates one paid ride at the Stripe amount", async () => {
    seedLinked();
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(res);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(data.payment_status === "paid", "Expected paid");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
    assert(
      rides[0].fare_price === 5000,
      "Fare must come from the PaymentIntent amount",
    );
    assert(
      rides[0].user_id === AUTH_USER_A,
      "Ride must belong to the booking owner",
    );
    assert(
      bookings.ba_1.status === "ride_created",
      "Booking should be ride_created",
    );
  });

  await test("Repeated recovery returns the existing ride without a duplicate", async () => {
    seedLinked();
    const first = await callRecover({ booking_attempt_id: "ba_1" });
    const second = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(second);
    assert(first.status === 201, `Expected first 201, got ${first.status}`);
    assert(second.status === 200, `Expected second 200, got ${second.status}`);
    assert(data.created === false, "Second call should not create a ride");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  await test("Ride created earlier by the webhook is returned, not duplicated", async () => {
    seedLinked();
    rides.push({
      id: 99,
      payment_intent_id: "pi_1",
      fare_price: 5000,
      user_id: AUTH_USER_A,
      payment_status: "paid",
    });
    const res = await callRecover({ booking_attempt_id: "ba_1" });
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(data.created === false, "Existing ride should be returned");
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  await test("Concurrent recovery requests produce exactly one ride", async () => {
    seedLinked();
    const [a, b] = await Promise.all([
      callRecover({ booking_attempt_id: "ba_1" }),
      callRecover({ booking_attempt_id: "ba_1" }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert(
      JSON.stringify(statuses) === JSON.stringify([200, 201]),
      `Expected one 201 and one 200, got ${statuses.join(",")}`,
    );
    assert(rides.length === 1, `Expected 1 ride, got ${rides.length}`);
  });

  // Booking creation: Stripe idempotency and safe reuse

  await test("Creation rejects a missing booking attempt reference", async () => {
    seedBooking();
    const res = await callCreate({
      name: "Ada",
      email: "ada@example.com",
      amount: 50,
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(piCreateCalls.length === 0, "No PaymentIntent should be created");
  });

  await test("Creation rejects another user's booking attempt", async () => {
    seedBooking({ clerk_user_id: AUTH_USER_B });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
    assert(piCreateCalls.length === 0, "No PaymentIntent should be created");
  });

  await test("Creation rejects a client amount that differs from the booking", async () => {
    seedBooking();
    const res = await callCreate({ ...CREATE_BODY, amount: 49 });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
    assert(piCreateCalls.length === 0, "No PaymentIntent should be created");
  });

  await test("Creation refuses bookings that can no longer be paid", async () => {
    for (const status of ["canceled", "refunded", "disputed", "ride_created"]) {
      seedBooking({ status });
      const res = await callCreate(CREATE_BODY);
      assert(res.status === 409, `${status}: expected 409, got ${res.status}`);
    }
    assert(piCreateCalls.length === 0, "No PaymentIntent should be created");
  });

  await test("First creation uses a booking-derived idempotency key and server amount", async () => {
    seedBooking();
    const res = await callCreate(CREATE_BODY);
    const data = await jsonOf(res);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(piCreateCalls.length === 1, "Expected one PaymentIntent create");
    const call = piCreateCalls[0];
    assert(
      call.idempotencyKey === "booking-attempt-payment-intent:ba_1",
      `Unexpected idempotency key: ${String(call.idempotencyKey)}`,
    );
    assert(
      call.params.amount === 5000,
      "Amount must be the booking amount in cents",
    );
    assert(call.params.currency === "eur", "Currency must be eur");
    assert(
      JSON.stringify(call.params.metadata) ===
        JSON.stringify({
          clerk_user_id: AUTH_USER_A,
          booking_attempt_id: "ba_1",
        }),
      "PaymentIntent metadata must name the owner and booking attempt",
    );
    const paymentIntent = data.paymentIntent as { id: string };
    assert(
      bookings.ba_1.payment_intent_id === paymentIntent.id,
      "Booking must link the PaymentIntent",
    );
    assert(
      bookings.ba_1.status === "payment_intent_created",
      "Booking status should advance",
    );
  });

  await test("Repeated creation reuses the linked PaymentIntent without a new one", async () => {
    seedBooking();
    const first = await jsonOf(await callCreate(CREATE_BODY));
    const second = await callCreate(CREATE_BODY);
    const secondData = await jsonOf(second);
    assert(second.status === 200, `Expected 200, got ${second.status}`);
    assert(
      piCreateCalls.length === 1,
      `Expected 1 create, got ${piCreateCalls.length}`,
    );
    assert(
      (secondData.paymentIntent as { id: string }).id ===
        (first.paymentIntent as { id: string }).id,
      "Repeat call must return the same PaymentIntent",
    );
  });

  await test("Concurrent creation for one booking yields a single PaymentIntent", async () => {
    seedBooking();
    const [a, b] = await Promise.all([
      callCreate(CREATE_BODY),
      callCreate(CREATE_BODY),
    ]);
    const dataA = await jsonOf(a);
    const dataB = await jsonOf(b);
    assert(
      a.status === 200 && b.status === 200,
      `Expected 200s, got ${a.status}, ${b.status}`,
    );
    assert(
      (dataA.paymentIntent as { id: string }).id ===
        (dataB.paymentIntent as { id: string }).id,
      "Both requests must resolve to the same PaymentIntent",
    );
    assert(
      Object.keys(paymentIntents).length === 1,
      "Exactly one PaymentIntent may exist",
    );
    assert(
      piCreateCalls.every(
        (call) => call.idempotencyKey === "booking-attempt-payment-intent:ba_1",
      ),
      "Every create must carry the booking-derived idempotency key",
    );
  });

  await test("A PaymentIntent that loses the link race is rejected, not swapped in", async () => {
    seedBooking();
    onPiCreate = (bookingId) => {
      seedPI("pi_rival", {
        status: "requires_payment_method",
        metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: bookingId },
      });
      bookings[bookingId].payment_intent_id = "pi_rival";
    };
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(
      bookings.ba_1.payment_intent_id === "pi_rival",
      "Booking must keep the first PaymentIntent",
    );
  });

  await test("Existing PaymentIntent owned by another user is never handed out", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", {
      status: "requires_payment_method",
      metadata: { clerk_user_id: AUTH_USER_B, booking_attempt_id: "ba_1" },
    });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(
      piCreateCalls.length === 0,
      "No new PaymentIntent should be created",
    );
  });

  await test("Existing PaymentIntent with another booking reference is rejected", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", {
      status: "requires_payment_method",
      metadata: { clerk_user_id: AUTH_USER_A, booking_attempt_id: "ba_other" },
    });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
  });

  await test("Existing PaymentIntent with a different amount is rejected", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", { status: "requires_payment_method", amount: 4900 });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
  });

  await test("Canceled existing PaymentIntent is not reused", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", { status: "canceled" });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(
      piCreateCalls.length === 0,
      "No new PaymentIntent should be created",
    );
  });

  await test("Processing existing PaymentIntent returns a processing message", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", { status: "processing" });
    const res = await callCreate(CREATE_BODY);
    const data = await jsonOf(res);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
    assert(
      String(data.error).includes("processing"),
      "Message should say processing",
    );
  });

  await test("Existing PaymentIntent that cannot be retrieved returns 503", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", { status: "requires_payment_method" });
    stripeRetrieveFails = true;
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 503, `Expected 503, got ${res.status}`);
  });

  await test("Existing Stripe customer owned by the user is reused", async () => {
    seedBooking();
    customers.push({
      id: "cus_existing",
      email: "ada@example.com",
      metadata: { clerk_user_id: AUTH_USER_A },
    });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(customerCreateCalls === 0, "No customer should be created");
    assert(
      piCreateCalls[0].params.customer === "cus_existing",
      "PaymentIntent must use the existing customer",
    );
  });

  await test("Stripe customer owned by another user with the same email is not reused", async () => {
    seedBooking();
    customers.push({
      id: "cus_b",
      email: "ada@example.com",
      metadata: { clerk_user_id: AUTH_USER_B },
    });
    const res = await callCreate(CREATE_BODY);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      customerCreateCalls === 1,
      "A customer owned by this user must be created",
    );
    assert(
      piCreateCalls[0].params.customer !== "cus_b",
      "Another user's customer must not be used",
    );
  });

  await test("Secret key and Stripe error details stay out of responses and logs", async () => {
    seedBooking({ payment_intent_id: "pi_1" });
    seedPI("pi_1", { status: "requires_payment_method" });
    stripeRetrieveFails = true;

    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(" "));
    };
    let responseText = "";
    try {
      const res = await callCreate(CREATE_BODY);
      responseText = await res.text();
    } finally {
      console.error = originalError;
    }

    const combined = responseText + logged.join("\n");
    assert(
      !combined.includes(STRIPE_SECRET_VALUE),
      "Secret key must never appear in output",
    );
  });

  // ── Report ──────────────────────────────────────────────────────

  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("  Phase 2N.4.2 Mocked Payment Security Test Results");
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

  if (failCount > 0) process.exitCode = 1;
}

runAllTests().catch((e) => {
  console.error("Test runner failed:", e);
  process.exit(1);
});
