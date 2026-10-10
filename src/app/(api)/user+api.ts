import { neon } from "@neondatabase/serverless";

export async function POST(req: Request) {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const { name, email, clerk_Id } = await req.json();

    if (!name || !email || !clerk_Id) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const response = await sql`
      INSERT INTO users (
        name,
        email,
        clerk_Id
      )
      VALUES (
        ${name},
        ${email},
        ${clerk_Id}
      )
      RETURNING *
    `;

    return Response.json({ data: response[0] }, { status: 201 });
  } catch (error) {
    console.error("Create user error:", error);

    return Response.json({ error: "Failed to create user" }, { status: 500 });
  }
}
