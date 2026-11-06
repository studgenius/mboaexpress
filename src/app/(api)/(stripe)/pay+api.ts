import Stripe from "stripe";
import { requireAuth } from "@/lib/server-auth";

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

    const stripe = new Stripe(secretKey);

    const body = await request.json();

    const { payment_method_id, payment_intent_id } = body;

    if (!payment_method_id || !payment_intent_id) {
      return Response.json(
        { error: "Missing required payment information." },
        { status: 400 },
      );
    }

    // Retrieve the PaymentIntent from Stripe before any mutation.
    // This verifies the PaymentIntent exists and lets us check
    // server-generated ownership metadata before attaching a
    // payment method or confirming.
    let paymentIntent: Stripe.PaymentIntent;

    try {
      paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    } catch {
      console.error("Failed to retrieve payment intent for verification");
      return Response.json(
        { error: "Payment could not be verified." },
        { status: 404 },
      );
    }

    // Reject PaymentIntents whose server-generated ownership metadata
    // does not match the authenticated Clerk user. This prevents
    // any user from confirming another user's PaymentIntent.
    const intentOwner = paymentIntent.metadata?.clerk_user_id;

    if (!intentOwner || intentOwner !== authUserId) {
      console.error("Payment intent ownership mismatch");
      return Response.json(
        { error: "You are not authorized to complete this payment." },
        { status: 403 },
      );
    }

    // Use the PaymentIntent's verified customer association.
    // The client no longer supplies customer_id — we derive it
    // from the PaymentIntent itself, which was created by our
    // server with the authenticated user's Stripe customer.
    const verifiedCustomerId = paymentIntent.customer as string | null;

    if (!verifiedCustomerId) {
      console.error("Payment intent has no associated customer");
      return Response.json(
        { error: "Payment could not be verified." },
        { status: 400 },
      );
    }

    // Attach the payment method to the verified customer
    await stripe.paymentMethods.attach(payment_method_id, {
      customer: verifiedCustomerId,
    });

    // Confirm the PaymentIntent
    const confirmedIntent = await stripe.paymentIntents.confirm(
      payment_intent_id,
      {
        payment_method: payment_method_id,
      },
    );

    // Return only the minimal status information the client needs.
    // Never expose the raw Stripe PaymentIntent object.
    return Response.json({
      success: true,
      status: confirmedIntent.status,
      client_secret: confirmedIntent.client_secret,
    });
  } catch (error) {
    console.error("Payment confirmation failed:", error);
    return Response.json(
      { error: "Payment confirmation failed. Please try again." },
      { status: 500 },
    );
  }
}
