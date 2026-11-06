import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import {
  createRideFromBooking,
  getBookingByPaymentIntent,
  updateBookingStatusSafe,
} from "@/lib/ride-service";
import { RideCreationError } from "@/lib/payment-verification";

/**
 * Stripe Webhook Endpoint
 *
 * Processes Stripe events idempotently:
 * - payment_intent.succeeded → creates ride from booking attempt
 * - payment_intent.payment_failed → marks booking attempt as failed
 * - payment_intent.canceled → marks booking attempt as canceled
 * - charge.refunded → marks booking attempt as refunded
 * - charge.dispute.created → marks booking attempt as disputed
 *
 * Lifecycle guards:
 * - A "failed" event cannot overwrite a "succeeded" or "ride_created" state.
 * - A stale "succeeded" event cannot undo a "refunded" or "disputed" state.
 * - Refund and dispute events never trigger ride creation.
 * - A webhook event is only marked "processed" after all durable work succeeds.
 *   Transient failures (DB down, Stripe API error) release the event claim so
 *   Stripe's retry processes the event again.
 */

type NeonSql = ReturnType<typeof neon>;

export async function POST(request: Request) {
  const signingSecret = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!signingSecret || !secretKey) {
    console.error(
      "Webhook signing secret or Stripe secret key is not configured",
    );
    return Response.json(
      { error: "Webhook processing is unavailable." },
      { status: 500 },
    );
  }

  // Read the raw body for Stripe signature verification.
  // The Stripe SDK requires the exact raw bytes — JSON parsing
  // would break the signature.
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  if (!signature) {
    console.error("Missing Stripe-Signature header");
    return Response.json(
      { error: "Missing signature header." },
      { status: 400 },
    );
  }

  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      signingSecret,
    );
  } catch {
    // Invalid signature — reject without processing.
    // Do not log the signature or raw body.
    console.error("Stripe webhook signature verification failed");
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  const sql: NeonSql = neon(`${process.env.DATABASE_URL}`);

  // Idempotency: insert a placeholder row to claim the event.
  // If the insert fails with a unique constraint violation, the
  // event was already seen.
  let eventId: string | undefined;
  const eventPaymentIntentId = getEventPaymentIntentId(event);

  try {
    const inserted = await sql`
      INSERT INTO webhook_events (stripe_event_id, event_type, payment_intent_id, processed)
      VALUES (${event.id}, ${event.type}, ${eventPaymentIntentId}, false)
      RETURNING id
    `;
    const rows = Array.isArray(inserted) ? inserted : [];
    eventId = (rows[0] as { id: string } | undefined)?.id;
  } catch {
    // Duplicate event — already processed or being processed.
    const existing = await sql`
      SELECT processed FROM webhook_events
      WHERE stripe_event_id = ${event.id}
    `;
    const rows = Array.isArray(existing) ? existing : [];

    if (rows.length > 0 && (rows[0] as { processed: boolean }).processed) {
      return Response.json(
        { received: true, duplicate: true },
        { status: 200 },
      );
    }

    // If not yet processed (race condition), return 409 so Stripe
    // retries after the first delivery completes.
    return Response.json(
      { error: "Event is being processed." },
      { status: 409 },
    );
  }

  // Process the event based on its type.
  let resultStatus = "ok";
  let resultDetail = "";

  try {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const piId = paymentIntent.id;

    switch (event.type) {
      case "payment_intent.succeeded": {
        await handlePaymentSucceeded(stripe, sql, piId);
        break;
      }
      case "payment_intent.payment_failed": {
        await handlePaymentFailed(sql, piId);
        break;
      }
      case "payment_intent.canceled": {
        await handlePaymentCanceled(sql, piId);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const chargePiId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;

        if (chargePiId) {
          await handleRefunded(sql, chargePiId);
        }
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = dispute.charge as string;

        const charge = await stripe.charges.retrieve(chargeId);
        const disputePiId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;

        if (disputePiId) {
          await handleDisputed(sql, disputePiId);
        }
        break;
      }
      default:
        resultStatus = "ignored";
        resultDetail = `unhandled_event_type:${event.type}`;
    }
  } catch (error) {
    if (error instanceof RideCreationError) {
      // Expected business-logic failures (no booking, ownership mismatch,
      // terminal status) are acknowledged so Stripe does not retry.
      resultStatus = "ride_creation_error";
      resultDetail = error.code;
      await markProcessed(sql, eventId!, resultStatus, resultDetail);
      return Response.json(
        { received: true, status: resultStatus },
        { status: 200 },
      );
    }

    // Unexpected errors (DB down, Stripe API failure) — leave the
    // event UNPROCESSED so Stripe retries. Do not mark as processed.
    // Release the claim so Stripe's retry reprocesses the event instead of
    // hitting the duplicate path and never running the work.
    console.error("Webhook processing error:", error);
    await releaseEventClaim(sql, eventId!);
    return Response.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }

  await markProcessed(sql, eventId!, resultStatus, resultDetail);
  return Response.json({ received: true }, { status: 200 });
}

function getEventPaymentIntentId(event: Stripe.Event): string | null {
  const object = event.data.object as {
    id?: unknown;
    payment_intent?: unknown;
  };

  if (event.type.startsWith("payment_intent.")) {
    return typeof object.id === "string" ? object.id : null;
  }

  if (event.type === "charge.refunded") {
    if (typeof object.payment_intent === "string") return object.payment_intent;
    const expanded = object.payment_intent as
      { id?: unknown } | null | undefined;
    return typeof expanded?.id === "string" ? expanded.id : null;
  }

  return null;
}

async function releaseEventClaim(sql: NeonSql, eventId: string): Promise<void> {
  await sql`
    DELETE FROM webhook_events
    WHERE id = ${eventId} AND processed = false
  `;
}

/**
 * Marks a webhook event as processed with its result.
 * Called only after all durable work for the event has succeeded.
 */
async function markProcessed(
  sql: NeonSql,
  eventId: string,
  resultStatus: string,
  resultDetail: string,
): Promise<void> {
  await sql`
    UPDATE webhook_events
    SET processed = true, result_status = ${resultStatus}, result_detail = ${resultDetail}
    WHERE id = ${eventId}
  `;
}

/**
 * Handles payment_intent.succeeded:
 * 1. Looks up the booking attempt by PaymentIntent ID.
 * 2. Retrieves the PI from Stripe to verify current status.
 * 3. Checks ownership metadata.
 * 4. Uses the shared idempotent ride-creation service.
 * 5. Only updates booking status to "succeeded" AFTER ride creation
 *    succeeds — if ride creation fails with a transient error, the
 *    event stays unprocessed and Stripe retries.
 */
async function handlePaymentSucceeded(
  stripe: Stripe,
  sql: NeonSql,
  paymentIntentId: string,
): Promise<void> {
  const booking = await getBookingByPaymentIntent(paymentIntentId);

  if (!booking) {
    throw new RideCreationError(
      "NO_BOOKING_ATTEMPT",
      "No booking attempt found for this PaymentIntent.",
      404,
    );
  }

  // Guard: if booking is already in a terminal state (refunded, disputed,
  // failed, canceled), a stale success event must not undo it.
  if (
    booking.status === "refunded" ||
    booking.status === "disputed" ||
    booking.status === "canceled"
  ) {
    throw new RideCreationError(
      "BOOKING_TERMINAL",
      `Booking is in terminal state "${booking.status}".`,
      409,
    );
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  const intentOwner = paymentIntent.metadata?.clerk_user_id;

  if (!intentOwner) {
    throw new RideCreationError(
      "NO_OWNERSHIP_METADATA",
      "PaymentIntent has no ownership metadata.",
      403,
    );
  }

  // Create the ride first. Only update booking to "succeeded" after
  // ride creation completes — this ensures the webhook event stays
  // unprocessed (and retried by Stripe) if ride creation fails with
  // a transient error.
  await createRideFromBooking(booking, paymentIntent, intentOwner);

  // Ride created successfully — update booking status using the
  // guarded transition (succeeded → ride_created is allowed).
  await updateBookingStatusSafe(booking.id, booking.status, "ride_created");
}

/**
 * Handles payment_intent.payment_failed:
 * Updates booking status to "failed" only if the transition is allowed.
 * If the booking is already "succeeded" or "ride_created", the failure
 * event is stale and silently ignored (no ride status corruption).
 */
async function handlePaymentFailed(
  sql: NeonSql,
  paymentIntentId: string,
): Promise<void> {
  const booking = await getBookingByPaymentIntent(paymentIntentId);

  let transitioned = false;
  if (booking) {
    transitioned = await updateBookingStatusSafe(
      booking.id,
      booking.status,
      "failed",
    );
  }

  // Only update ride status if the booking transition was allowed.
  // A stale failure event for an already-succeeded booking must not
  // corrupt the ride's payment_status.
  if (!transitioned) return;

  const existing = await sql`
    SELECT ride_id FROM rides WHERE payment_intent_id = ${paymentIntentId}
  `;
  const rows = Array.isArray(existing) ? existing : [];

  if (rows.length > 0) {
    await sql`
      UPDATE rides SET payment_status = 'failed'
      WHERE payment_intent_id = ${paymentIntentId}
    `;
  }
}

/**
 * Handles payment_intent.canceled:
 * Updates booking status to "canceled" only if the transition is allowed.
 */
async function handlePaymentCanceled(
  sql: NeonSql,
  paymentIntentId: string,
): Promise<void> {
  const booking = await getBookingByPaymentIntent(paymentIntentId);

  let transitioned = false;
  if (booking) {
    transitioned = await updateBookingStatusSafe(
      booking.id,
      booking.status,
      "canceled",
    );
  }

  if (!transitioned) return;

  const existing = await sql`
    SELECT ride_id FROM rides WHERE payment_intent_id = ${paymentIntentId}
  `;
  const rows = Array.isArray(existing) ? existing : [];

  if (rows.length > 0) {
    await sql`
      UPDATE rides SET payment_status = 'canceled'
      WHERE payment_intent_id = ${paymentIntentId}
    `;
  }
}

/**
 * Handles charge.refunded:
 * Updates booking status to "refunded" and ride payment_status.
 * Refund never triggers ride creation.
 */
async function handleRefunded(
  sql: NeonSql,
  paymentIntentId: string,
): Promise<void> {
  const booking = await getBookingByPaymentIntent(paymentIntentId);

  if (booking) {
    await updateBookingStatusSafe(booking.id, booking.status, "refunded");
  }

  // Refund always updates ride status — it can come after succeeded
  // or ride_created, and the ride must reflect the refund.
  const existing = await sql`
    SELECT ride_id FROM rides WHERE payment_intent_id = ${paymentIntentId}
  `;
  const rows = Array.isArray(existing) ? existing : [];

  if (rows.length > 0) {
    await sql`
      UPDATE rides SET payment_status = 'refunded'
      WHERE payment_intent_id = ${paymentIntentId}
    `;
  }
}

/**
 * Handles charge.dispute.created:
 * Updates booking status to "disputed" and ride payment_status.
 * Dispute never triggers ride creation.
 */
async function handleDisputed(
  sql: NeonSql,
  paymentIntentId: string,
): Promise<void> {
  const booking = await getBookingByPaymentIntent(paymentIntentId);

  if (booking) {
    await updateBookingStatusSafe(booking.id, booking.status, "disputed");
  }

  // Dispute always updates ride status — it can come after refunded.
  const existing = await sql`
    SELECT ride_id FROM rides WHERE payment_intent_id = ${paymentIntentId}
  `;
  const rows = Array.isArray(existing) ? existing : [];

  if (rows.length > 0) {
    await sql`
      UPDATE rides SET payment_status = 'disputed'
      WHERE payment_intent_id = ${paymentIntentId}
    `;
  }
}
