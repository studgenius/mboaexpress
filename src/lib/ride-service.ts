import { neon } from "@neondatabase/serverless";
import type Stripe from "stripe";
import {
  RideCreationError,
  verifyPaymentIntentForBooking,
} from "@/lib/payment-verification";

export type BookingAttempt = {
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

export type CreateRideFromBookingResult = {
  created: boolean;
  ride: Record<string, unknown>;
};

/**
 * Booking status transition table. Defines which statuses can be
 * reached from which, preventing out-of-order or stale events from
 * corrupting the booking lifecycle.
 *
 * "succeeded" can only transition to "ride_created", "refunded", or
 * "disputed" — not back to "failed" or "canceled".
 *
 * "failed" is not terminal: Stripe keeps the same PaymentIntent after a
 * declined card, so the customer can pay again and that PaymentIntent can
 * still succeed.
 */
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(["payment_intent_created", "failed", "canceled"]),
  payment_intent_created: new Set(["succeeded", "failed", "canceled"]),
  succeeded: new Set(["ride_created", "refunded", "disputed"]),
  ride_created: new Set(["refunded", "disputed"]),
  failed: new Set(["payment_intent_created", "succeeded", "ride_created"]),
  canceled: new Set([]),
  refunded: new Set(["disputed"]),
  disputed: new Set([]),
};

/**
 * Returns true if transitioning from `from` to `to` is allowed.
 * Same-status transitions (idempotent re-writes) are always allowed.
 */
export function isTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.has(to) : false;
}

/**
 * Terminal statuses that should never allow a new ride to be created.
 */
const TERMINAL_STATUSES = new Set(["canceled", "refunded", "disputed"]);

function getSql() {
  return neon(`${process.env.DATABASE_URL}`);
}

/**
 * Looks up a booking attempt by PaymentIntent ID.
 * Returns null if not found.
 */
export async function getBookingByPaymentIntent(
  paymentIntentId: string,
): Promise<BookingAttempt | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM booking_attempts WHERE payment_intent_id = ${paymentIntentId}
  `;
  return (rows[0] as BookingAttempt) ?? null;
}

/**
 * Looks up a booking attempt by its ID.
 * Returns null if not found.
 */
export async function getBookingById(
  bookingId: string,
): Promise<BookingAttempt | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM booking_attempts WHERE id = ${bookingId}
  `;
  return (rows[0] as BookingAttempt) ?? null;
}

/**
 * Updates the status of a booking attempt.
 */
export async function updateBookingStatus(
  bookingId: string,
  status: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE booking_attempts
    SET status = ${status}, updated_at = now()
    WHERE id = ${bookingId}
  `;
}

/**
 * Links a PaymentIntent ID to a booking attempt. The link is rejected if the
 * booking already points at a different PaymentIntent, so a concurrent request
 * cannot silently replace the payment a booking was created with.
 */
export async function linkPaymentIntentToBooking(
  bookingId: string,
  paymentIntentId: string,
): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    UPDATE booking_attempts
    SET payment_intent_id = ${paymentIntentId},
        status = 'payment_intent_created',
        updated_at = now()
    WHERE id = ${bookingId}
      AND (payment_intent_id IS NULL OR payment_intent_id = ${paymentIntentId})
    RETURNING id
  `;

  if (rows.length === 0) {
    throw new RideCreationError(
      "PAYMENT_BOOKING_CONFLICT",
      "This booking already has a different payment.",
      409,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

/**
 * Idempotently creates a ride from a verified booking attempt and
 * PaymentIntent. This is the single shared entry point for ride
 * creation, used by both the client-facing recovery endpoint
 * and the Stripe webhook handler.
 *
 * Guarantees:
 * - No duplicate ride for the same payment_intent_id (unique index,
 *   with a fallback read when a concurrent insert wins the race)
 * - Ownership, booking reference, currency, and amount are verified
 *   against server-stored booking values (see verifyPaymentIntentForBooking)
 * - PaymentIntent status must be "succeeded"
 * - Fare is derived from the PaymentIntent amount (in cents), which
 *   has been verified to equal the booking's stored amount
 * - Booking attempt status is updated to "ride_created" on success
 *
 * Returns { created: true, ride } on first creation, or
 * { created: false, ride } if the ride already existed.
 */
export async function createRideFromBooking(
  booking: BookingAttempt,
  paymentIntent: Stripe.PaymentIntent,
  authUserId: string,
): Promise<CreateRideFromBookingResult> {
  verifyPaymentIntentForBooking(booking, paymentIntent, authUserId);

  if (paymentIntent.status !== "succeeded") {
    throw new RideCreationError(
      "PAYMENT_NOT_SUCCEEDED",
      `Payment has not succeeded (status: ${paymentIntent.status}).`,
      402,
    );
  }

  // Refunded, disputed, and canceled bookings must never produce a ride.
  if (TERMINAL_STATUSES.has(booking.status)) {
    throw new RideCreationError(
      "BOOKING_TERMINAL",
      `Booking is in terminal state "${booking.status}" and cannot produce a ride.`,
      409,
    );
  }

  const sql = getSql();

  // Check for an existing ride with this payment_intent_id.
  // The unique index on rides.payment_intent_id enforces this at
  // the DB level, but checking first lets us return the existing
  // ride gracefully instead of throwing a constraint violation.
  const existing = await sql`
    SELECT * FROM rides WHERE payment_intent_id = ${paymentIntent.id}
  `;

  if (existing.length > 0) {
    // Update booking status if it hasn't been marked yet
    if (booking.status !== "ride_created") {
      await updateBookingStatus(booking.id, "ride_created");
    }
    return { created: false, ride: existing[0] };
  }

  // Derive fare from the verified PaymentIntent amount (in cents).
  // This matches the existing convention: fare_price is stored in cents.
  const verifiedFarePrice = paymentIntent.amount;

  let response;

  try {
    response = await sql`
      INSERT INTO rides (
          origin_address,
          destination_address,
          origin_latitude,
          origin_longitude,
          destination_latitude,
          destination_longitude,
          ride_time,
          fare_price,
          payment_status,
          driver_id,
          user_id,
          payment_intent_id
      ) VALUES (
          ${booking.origin_address},
          ${booking.destination_address},
          ${booking.origin_latitude},
          ${booking.origin_longitude},
          ${booking.destination_latitude},
          ${booking.destination_longitude},
          ${booking.ride_time},
          ${verifiedFarePrice},
          'paid',
          ${booking.driver_id},
          ${authUserId},
          ${paymentIntent.id}
      )
      RETURNING *;
    `;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // A concurrent request created the ride between the check and the insert.
    const raced = await sql`
      SELECT * FROM rides WHERE payment_intent_id = ${paymentIntent.id}
    `;

    if (raced.length === 0) {
      throw error;
    }

    await updateBookingStatus(booking.id, "ride_created");
    return { created: false, ride: raced[0] };
  }

  await updateBookingStatus(booking.id, "ride_created");

  return { created: true, ride: response[0] };
}

/**
 * Retrieves a ride by its associated PaymentIntent ID.
 * Returns null if no ride exists for this PaymentIntent.
 */
export async function getRideByPaymentIntentId(
  paymentIntentId: string,
): Promise<Record<string, unknown> | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM rides WHERE payment_intent_id = ${paymentIntentId}
  `;
  return (rows[0] as Record<string, unknown>) ?? null;
}

/**
 * Updates the booking status only if the transition is allowed by
 * the lifecycle table. Silently no-ops on disallowed transitions
 * (e.g. a stale "failed" event arriving after "succeeded").
 *
 * Returns true if the transition was applied, false if skipped.
 */
export async function updateBookingStatusSafe(
  bookingId: string,
  currentStatus: string,
  newStatus: string,
): Promise<boolean> {
  if (!isTransitionAllowed(currentStatus, newStatus)) {
    return false;
  }
  await updateBookingStatus(bookingId, newStatus);
  return true;
}
