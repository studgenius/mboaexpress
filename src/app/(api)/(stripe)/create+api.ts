import Stripe from "stripe";
import { createHash } from "crypto";
import { neon } from "@neondatabase/serverless";
import { requireAuth } from "@/lib/server-auth";
import { linkPaymentIntentToBooking } from "@/lib/ride-service";
import { RideCreationError } from "@/lib/payment-verification";

const CURRENCY = "eur";

const NON_PAYABLE_BOOKING_STATUSES = new Set([
  "canceled",
  "refunded",
  "disputed",
  "ride_created",
]);

const REUSABLE_PI_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "succeeded",
]);

/**
 * Returns true only when the PaymentIntent belongs to this user and this
 * booking attempt, and matches the server-stored amount and currency.
 */
function isPaymentIntentForBooking(
  paymentIntent: Stripe.PaymentIntent,
  bookingId: string,
  authUserId: string,
  amountInCents: number,
): boolean {
  return (
    paymentIntent.metadata?.clerk_user_id === authUserId &&
    paymentIntent.metadata?.booking_attempt_id === bookingId &&
    paymentIntent.amount === amountInCents &&
    paymentIntent.currency.toLowerCase() === CURRENCY
  );
}

async function resolveCustomerId(
  stripe: Stripe,
  name: string,
  email: string,
  authUserId: string,
): Promise<string> {
  const existing = await stripe.customers.list({ email, limit: 10 });
  const owned = existing.data.find(
    (customer) => customer.metadata?.clerk_user_id === authUserId,
  );

  if (owned) {
    return owned.id;
  }

  const emailHash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");

  const customer = await stripe.customers.create(
    {
      name,
      email,
      metadata: { clerk_user_id: authUserId },
    },
    { idempotencyKey: `customer:${authUserId}:${emailHash}` },
  );

  return customer.id;
}

export async function POST(request: Request) {
  try {
    const authUserId = await requireAuth(request);

    if (authUserId instanceof Response) {
      return authUserId;
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      console.error("Stripe secret key is not configured");
      return Response.json(
        { error: "Payment processing is unavailable." },
        { status: 500 },
      );
    }

    const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });

    const body = await request.json();

    const { name, email, amount, booking_attempt_id } = body;

    if (!name || !email || amount === undefined || !booking_attempt_id) {
      return Response.json(
        { error: "Missing required payment fields." },
        { status: 400 },
      );
    }

    const amountInCents = Math.round(Number(amount) * 100);

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return Response.json(
        { error: "Invalid payment amount." },
        { status: 400 },
      );
    }

    const sql = neon(`${process.env.DATABASE_URL}`);

    const rows = await sql`
      SELECT id, clerk_user_id, expected_amount, status, payment_intent_id
      FROM booking_attempts WHERE id = ${booking_attempt_id}
    `;

    if (rows.length === 0) {
      return Response.json(
        { error: "Booking attempt not found." },
        { status: 404 },
      );
    }

    const booking = rows[0];

    if (booking.clerk_user_id !== authUserId) {
      return Response.json(
        { error: "You are not authorized to use this booking." },
        { status: 403 },
      );
    }

    if (booking.expected_amount !== amountInCents) {
      return Response.json(
        { error: "Payment amount does not match the booking." },
        { status: 400 },
      );
    }

    if (NON_PAYABLE_BOOKING_STATUSES.has(booking.status)) {
      return Response.json(
        { error: "This booking can no longer be paid." },
        { status: 409 },
      );
    }

    // A booking that already has a PaymentIntent reuses it. A PaymentIntent
    // that does not belong to this booking and user is never handed out.
    if (booking.payment_intent_id) {
      let existingPI: Stripe.PaymentIntent;

      try {
        existingPI = await stripe.paymentIntents.retrieve(
          booking.payment_intent_id,
        );
      } catch {
        console.error("Existing PaymentIntent could not be retrieved");
        return Response.json(
          { error: "Payment is temporarily unavailable. Please try again." },
          { status: 503 },
        );
      }

      if (
        !isPaymentIntentForBooking(
          existingPI,
          booking.id,
          authUserId,
          amountInCents,
        )
      ) {
        console.error("Existing PaymentIntent does not match its booking");
        return Response.json(
          { error: "Payment for this booking could not be verified." },
          { status: 409 },
        );
      }

      if (existingPI.status === "processing") {
        return Response.json(
          {
            error:
              "Payment is still processing. Please wait before trying again.",
          },
          { status: 409 },
        );
      }

      if (!REUSABLE_PI_STATUSES.has(existingPI.status)) {
        return Response.json(
          {
            error:
              "This payment can no longer be completed. Start a new booking.",
          },
          { status: 409 },
        );
      }

      return Response.json({
        paymentIntent: {
          id: existingPI.id,
          client_secret: existingPI.client_secret,
        },
        customer: existingPI.customer as string,
      });
    }

    const customerId = await resolveCustomerId(stripe, name, email, authUserId);

    // The idempotency key is derived from the booking attempt, so concurrent
    // or repeated requests for the same booking resolve to one PaymentIntent.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: CURRENCY,
        customer: customerId,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        metadata: {
          clerk_user_id: authUserId,
          booking_attempt_id: booking.id,
        },
      },
      { idempotencyKey: `booking-attempt-payment-intent:${booking.id}` },
    );

    await linkPaymentIntentToBooking(booking.id, paymentIntent.id);

    return Response.json({
      paymentIntent: {
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      },
      customer: customerId,
    });
  } catch (error) {
    if (error instanceof RideCreationError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    console.error("Payment intent creation failed:", error);
    return Response.json(
      { error: "Unable to create payment. Please try again." },
      { status: 500 },
    );
  }
}
