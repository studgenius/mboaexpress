import Stripe from "stripe";
import { requireAuth } from "@/lib/server-auth";
import {
  createRideFromBooking,
  getBookingByPaymentIntent,
} from "@/lib/ride-service";
import { RideCreationError } from "@/lib/payment-verification";

export async function POST(request: Request) {
  try {
    const authUserId = await requireAuth(request);

    if (authUserId instanceof Response) {
      return authUserId;
    }

    const body = await request.json();
    const { payment_intent_id } = body;

    if (!payment_intent_id) {
      return Response.json(
        { error: "Missing payment_intent_id." },
        { status: 400 },
      );
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

    // Retrieve the PaymentIntent from Stripe to verify ownership,
    // status, and amount.
    let paymentIntent: Stripe.PaymentIntent;

    try {
      paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    } catch {
      console.error("Failed to retrieve payment intent for ride creation");
      return Response.json(
        { error: "Payment could not be verified." },
        { status: 404 },
      );
    }

    // Verify ownership via PaymentIntent metadata
    const intentOwner = paymentIntent.metadata?.clerk_user_id;

    if (!intentOwner || intentOwner !== authUserId) {
      console.error("Payment intent ownership mismatch on ride creation");
      return Response.json(
        { error: "You are not authorized to create this ride." },
        { status: 403 },
      );
    }

    // Look up the booking attempt for this PaymentIntent. The booking
    // attempt contains the ride details (addresses, coordinates, etc.)
    // that were recorded before payment was initiated.
    const booking = await getBookingByPaymentIntent(payment_intent_id);

    if (!booking) {
      return Response.json(
        { error: "No booking attempt found for this payment." },
        { status: 404 },
      );
    }

    // Verify the booking belongs to the authenticated user
    if (booking.clerk_user_id !== authUserId) {
      return Response.json(
        { error: "You are not authorized to create this ride." },
        { status: 403 },
      );
    }

    // Use the shared idempotent ride-creation service. This is the
    // same code path the webhook uses, ensuring consistency and
    // duplicate safety.
    const result = await createRideFromBooking(
      booking,
      paymentIntent,
      authUserId,
    );

    return Response.json(
      { data: result.ride, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof RideCreationError) {
      return Response.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    console.error("Error creating ride:", error);
    return Response.json(
      { error: "Unable to create ride. Please try again." },
      { status: 500 },
    );
  }
}
