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

    const { name, email, amount, rideId } = body;

    if (!name || !email || amount === undefined) {
      return Response.json(
        {
          error: "Missing required payment fields.",
        },
        { status: 400 },
      );
    }

    const amountInCents = Math.round(Number(amount) * 100);

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return Response.json(
        {
          error: "Invalid payment amount.",
        },
        { status: 400 },
      );
    }

    // Find existing Stripe customer
    const existingCustomers = await stripe.customers.list({
      email,
      limit: 1,
    });

    let customer;

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        name,
        email,
      });
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents,
        currency: "eur",
        customer: customer.id,

        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },

        metadata: rideId
          ? {
              ride_id: String(rideId),
            }
          : undefined,
      },
      {
        idempotencyKey: rideId ? `ride-payment-${rideId}` : undefined,
      },
    );

    return Response.json({
      paymentIntent: {
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      },
      customer: customer.id,
    });
  } catch (error) {
    console.error("Stripe create error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create Stripe payment.",
      },
      { status: 500 },
    );
  }
}
