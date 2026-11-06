import Stripe from "stripe";
import { requireAuth } from "@/lib/server-auth";
import {
  createRideFromBooking,
  getBookingByPaymentIntent,
  getBookingById,
  getRideByPaymentIntentId,
} from "@/lib/ride-service";
import {
  RideCreationError,
  verifyPaymentIntentForBooking,
} from "@/lib/payment-verification";

/**
 * Booking Recovery Endpoint
 *
 * POST /(api)/booking/recover
 *
 * Reconciles a booking attempt's state after payment completion,
 * 3DS authentication, or page reload. The client sends only a
 * booking_attempt_id or payment_intent_id — never ride details or
 * a payment status.
 *
 * The server:
 * 1. Authenticates the Clerk user.
 * 2. Retrieves the booking attempt and verifies ownership.
 * 3. Retrieves the PaymentIntent from Stripe (server-side only).
 * 4. Verifies PI ownership, status, and currency.
 * 5. If payment succeeded, creates or retrieves the ride via the
 *    shared idempotent service.
 * 6. Returns a minimal response with the booking status, payment
 *    status, and ride (if created).
 *
 * The endpoint never accepts ride details or a paid status from the
 * client as authoritative. It cannot be used to query another user's
 * booking or PaymentIntent.
 */

type RecoverResponse = {
  booking_status: string;
  payment_status: string;
  ride?: Record<string, unknown>;
  created?: boolean;
};

export async function POST(request: Request) {
  try {
    const authUserId = await requireAuth(request);

    if (authUserId instanceof Response) {
      return authUserId;
    }

    const body = await request.json();
    const { booking_attempt_id, payment_intent_id } = body as {
      booking_attempt_id?: string;
      payment_intent_id?: string;
    };

    if (!booking_attempt_id && !payment_intent_id) {
      return Response.json(
        { error: "booking_attempt_id or payment_intent_id is required." },
        { status: 400 },
      );
    }

    // Look up the booking attempt — by ID or by PaymentIntent ID.
    let booking;

    if (booking_attempt_id) {
      booking = await getBookingById(booking_attempt_id);
    } else if (payment_intent_id) {
      booking = await getBookingByPaymentIntent(payment_intent_id!);
    }

    if (!booking) {
      return Response.json(
        { error: "Booking attempt not found." },
        { status: 404 },
      );
    }

    // Verify the booking belongs to the authenticated user.
    if (booking.clerk_user_id !== authUserId) {
      return Response.json(
        { error: "You are not authorized to access this booking." },
        { status: 403 },
      );
    }

    // If the booking has no PaymentIntent yet, it hasn't started payment.
    if (!booking.payment_intent_id) {
      const response: RecoverResponse = {
        booking_status: booking.status,
        payment_status: "none",
      };
      return Response.json(response, { status: 200 });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      console.error("Stripe secret key is not configured");
      return Response.json(
        { error: "Payment verification is unavailable." },
        { status: 500 },
      );
    }

    const stripe = new Stripe(secretKey);

    // Retrieve the PaymentIntent from Stripe to verify current state.
    let paymentIntent: Stripe.PaymentIntent;

    try {
      paymentIntent = await stripe.paymentIntents.retrieve(
        booking.payment_intent_id,
      );
    } catch {
      console.error("Failed to retrieve payment intent for recovery");
      return Response.json(
        { error: "Payment could not be verified." },
        { status: 503 },
      );
    }

    // Currency, amount, owner, and booking reference must match the
    // server-stored booking before any payment state is reported.
    try {
      verifyPaymentIntentForBooking(booking, paymentIntent, authUserId);
    } catch (error) {
      if (error instanceof RideCreationError) {
        console.error("Payment verification failed on recovery:", error.code);
        return Response.json(
          { error: error.message },
          { status: error.statusCode },
        );
      }
      throw error;
    }

    // Map the PI status to a client-safe payment status string.
    const piStatus = paymentIntent.status;

    // If the booking is in a terminal state (refunded, disputed), return
    // that state without attempting ride creation.
    if (booking.status === "refunded" || booking.status === "disputed") {
      const existingRide = await getRideByPaymentIntentId(
        booking.payment_intent_id,
      );
      const response: RecoverResponse = {
        booking_status: booking.status,
        payment_status: existingRide
          ? (existingRide.payment_status as string)
          : booking.status,
        ride: existingRide ?? undefined,
      };
      return Response.json(response, { status: 200 });
    }

    // A succeeded PaymentIntent can still have been refunded or disputed.
    // Those charges must not be reported as a normal paid ride.
    if (piStatus === "succeeded" && paymentIntent.latest_charge) {
      const chargeId =
        typeof paymentIntent.latest_charge === "string"
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge.id;

      let charge: Stripe.Charge;

      try {
        charge = await stripe.charges.retrieve(chargeId);
      } catch {
        console.error("Failed to retrieve charge for recovery");
        const response: RecoverResponse = {
          booking_status: booking.status,
          payment_status: "succeeded",
        };
        return Response.json(response, { status: 503 });
      }

      if (charge.disputed || charge.refunded || charge.amount_refunded > 0) {
        const existingRide = await getRideByPaymentIntentId(paymentIntent.id);
        const response: RecoverResponse = {
          booking_status: booking.status,
          payment_status: charge.disputed ? "disputed" : "refunded",
          ride: existingRide ?? undefined,
        };
        return Response.json(response, { status: 200 });
      }
    }

    // If payment has not yet succeeded, return the current pending state.
    // The client should poll or retry.
    if (piStatus !== "succeeded") {
      const response: RecoverResponse = {
        booking_status: booking.status,
        payment_status: piStatus,
      };
      return Response.json(response, { status: 200 });
    }

    // Payment succeeded — use the shared idempotent service to create
    // or retrieve the ride. If the webhook already created it, this
    // returns the existing ride.
    try {
      const result = await createRideFromBooking(
        booking,
        paymentIntent,
        authUserId,
      );

      const response: RecoverResponse = {
        booking_status: "ride_created",
        payment_status: "paid",
        ride: result.ride,
        created: result.created,
      };
      return Response.json(response, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof RideCreationError) {
        // If the booking is in a terminal state, return that state.
        if (error.code === "BOOKING_TERMINAL") {
          const existingRide = await getRideByPaymentIntentId(
            booking.payment_intent_id,
          );
          const response: RecoverResponse = {
            booking_status: booking.status,
            payment_status: existingRide
              ? (existingRide.payment_status as string)
              : booking.status,
            ride: existingRide ?? undefined,
          };
          return Response.json(response, { status: 200 });
        }

        return Response.json(
          { error: error.message },
          { status: error.statusCode },
        );
      }

      // Transient failure (DB down, etc.) — return a retryable state.
      console.error("Recovery ride creation failed:", error);
      const response: RecoverResponse = {
        booking_status: booking.status,
        payment_status: "succeeded",
      };
      return Response.json(response, { status: 503 });
    }
  } catch (error) {
    console.error("Booking recovery failed:", error);
    return Response.json(
      { error: "Unable to recover booking. Please try again." },
      { status: 500 },
    );
  }
}
