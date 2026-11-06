import { neon } from "@neondatabase/serverless";
import { requireAuth } from "@/lib/server-auth";

type CreateBookingBody = {
  origin_address: string;
  destination_address: string;
  origin_latitude: number;
  origin_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  ride_time: number;
  driver_id: number;
  expected_amount: number;
};

export async function POST(request: Request) {
  try {
    const authUserId = await requireAuth(request);

    if (authUserId instanceof Response) {
      return authUserId;
    }

    const body = await request.json();

    const {
      origin_address,
      destination_address,
      origin_latitude,
      origin_longitude,
      destination_latitude,
      destination_longitude,
      ride_time,
      driver_id,
      expected_amount,
    } = body as CreateBookingBody;

    if (
      !origin_address ||
      !destination_address ||
      origin_latitude === undefined ||
      origin_longitude === undefined ||
      destination_latitude === undefined ||
      destination_longitude === undefined ||
      !ride_time ||
      !driver_id ||
      expected_amount === undefined
    ) {
      return Response.json(
        { error: "Missing required booking fields." },
        { status: 400 },
      );
    }

    const amountInCents = Math.round(Number(expected_amount) * 100);

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return Response.json(
        { error: "Invalid expected amount." },
        { status: 400 },
      );
    }

    const sql = neon(`${process.env.DATABASE_URL}`);

    // Validate that the driver exists in the database.
    // The drivers table has no price column — fare validation
    // is not yet implemented (Phase 2N.5 dependency).
    const drivers = await sql`
      SELECT id FROM drivers WHERE id = ${driver_id}
    `;

    if (drivers.length === 0) {
      return Response.json(
        { error: "Selected driver is not available." },
        { status: 400 },
      );
    }

    // Create the booking attempt with status "pending".
    // The clerk_user_id comes from the verified Clerk token,
    // never from the request body.
    const rows = await sql`
      INSERT INTO booking_attempts (
        clerk_user_id,
        origin_address,
        destination_address,
        origin_latitude,
        origin_longitude,
        destination_latitude,
        destination_longitude,
        ride_time,
        driver_id,
        expected_amount,
        currency,
        status
      ) VALUES (
        ${authUserId},
        ${origin_address},
        ${destination_address},
        ${origin_latitude},
        ${origin_longitude},
        ${destination_latitude},
        ${destination_longitude},
        ${ride_time},
        ${driver_id},
        ${amountInCents},
        'eur',
        'pending'
      )
      RETURNING id, status
    `;

    return Response.json(
      {
        booking_attempt_id: rows[0].id,
        status: rows[0].status,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Booking attempt creation failed:", error);
    return Response.json(
      { error: "Unable to create booking attempt." },
      { status: 500 },
    );
  }
}

/**
 * GET /api/booking?id=<uuid>
 * Retrieves a booking attempt by ID. Only the owner can read it.
 */
export async function GET(request: Request) {
  try {
    const authUserId = await requireAuth(request);

    if (authUserId instanceof Response) {
      return authUserId;
    }

    const url = new URL(request.url);
    const bookingId = url.searchParams.get("id");

    if (!bookingId) {
      return Response.json(
        { error: "Booking attempt ID is required." },
        { status: 400 },
      );
    }

    const sql = neon(`${process.env.DATABASE_URL}`);

    const rows = await sql`
      SELECT * FROM booking_attempts WHERE id = ${bookingId}
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
        { error: "You are not authorized to view this booking." },
        { status: 403 },
      );
    }

    return Response.json({ data: booking });
  } catch (error) {
    console.error("Booking attempt lookup failed:", error);
    return Response.json(
      { error: "Unable to retrieve booking attempt." },
      { status: 500 },
    );
  }
}
