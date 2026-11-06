import type Stripe from "stripe";
import type { BookingAttempt } from "@/lib/ride-service";

export class RideCreationError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Verifies that a PaymentIntent belongs to the authenticated user and to this
 * exact booking attempt, and that its currency and amount match the
 * server-stored booking values. Throws RideCreationError on any mismatch.
 */
export function verifyPaymentIntentForBooking(
  booking: BookingAttempt,
  paymentIntent: Stripe.PaymentIntent,
  authUserId: string,
): void {
  if (booking.clerk_user_id !== authUserId) {
    throw new RideCreationError(
      "BOOKING_OWNERSHIP_MISMATCH",
      "Booking attempt does not belong to the authenticated user.",
      403,
    );
  }

  const intentOwner = paymentIntent.metadata?.clerk_user_id;
  if (!intentOwner || intentOwner !== authUserId) {
    throw new RideCreationError(
      "PAYMENT_OWNERSHIP_MISMATCH",
      "PaymentIntent does not belong to the authenticated user.",
      403,
    );
  }

  if (
    booking.payment_intent_id !== paymentIntent.id ||
    paymentIntent.metadata?.booking_attempt_id !== booking.id
  ) {
    throw new RideCreationError(
      "PAYMENT_BOOKING_MISMATCH",
      "PaymentIntent does not belong to this booking attempt.",
      409,
    );
  }

  if (paymentIntent.currency.toLowerCase() !== booking.currency.toLowerCase()) {
    throw new RideCreationError(
      "CURRENCY_MISMATCH",
      "Payment currency does not match booking attempt.",
      400,
    );
  }

  if (paymentIntent.amount !== booking.expected_amount) {
    throw new RideCreationError(
      "AMOUNT_MISMATCH",
      "Payment amount does not match the booking.",
      409,
    );
  }
}
