import { neon } from "@neondatabase/serverless";
import { requireAuth } from "@/lib/server-auth";

export async function GET(request: Request) {
  const authResult = await requireAuth(request);

  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const response = await sql`SELECT * FROM drivers`;

    return Response.json({ data: response });
  } catch (error) {
    console.log(error);
    return Response.json({ error: error });
  }
}
