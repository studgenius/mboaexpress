import Stripe from "stripe";

export async function POST(request: Request) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      console.error("STRIPE_SECRET_KEY is missing");

      return Response.json(
        {
          error: "Stripe secret key is not configured.",
        },
        { status: 500 },
      );
    }

    const stripe = new Stripe(secretKey);

    const body = await request.json();

    const { payment_method_id, payment_intent_id, customer_id } = body;

    if (!payment_method_id || !payment_intent_id || !customer_id) {
      return Response.json(
        {
          error: "Missing required payment information.",
        },
        { status: 400 },
      );
    }

    await stripe.paymentMethods.attach(payment_method_id, {
      customer: customer_id,
    });

    const result = await stripe.paymentIntents.confirm(payment_intent_id, {
      payment_method: payment_method_id,
    });

    return Response.json({
      success: true,
      message: "Payment successfully confirmed",
      result,
    });
  } catch (error) {
    console.error("Stripe payment error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Payment confirmation failed.",
      },
      { status: 500 },
    );
  }
}
