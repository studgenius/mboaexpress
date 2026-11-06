import { verifyToken } from "@clerk/backend";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

const ALLOWED_PARTIES: string[] = [
  "https://mboaexpress.com",
  "http://localhost:8081",
  "http://localhost:8082",
];

function getAzpClaim(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    return typeof payload.azp === "string" ? payload.azp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extracts the Bearer token from the Authorization header, verifies it
 * with Clerk's backend SDK, and returns the authenticated user ID.
 *
 * Fail-closed: if CLERK_SECRET_KEY is not configured, every request is
 * rejected with 500. Missing, malformed, or expired tokens return 401.
 *
 * Origin validation: if the JWT contains an `azp` (authorized party)
 * claim, it must match one of ALLOWED_PARTIES. Tokens without `azp`
 * (e.g. from native apps where the Origin header is absent) are accepted,
 * per Clerk's documentation that azp may be omitted.
 *
 * Never logs tokens, secrets, or full authorization headers.
 */
export async function getAuthUserId(request: Request): Promise<AuthResult> {
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!secretKey) {
    console.error("CLERK_SECRET_KEY is not configured");
    return {
      ok: false,
      status: 500,
      error: "Server authentication is not configured.",
    };
  }

  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      error: "Authorization header is required.",
    };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      ok: false,
      status: 401,
      error: "Invalid authorization header format.",
    };
  }

  const token = match[1];

  try {
    const verified = await verifyToken(token, { secretKey });

    const azp = getAzpClaim(token);
    if (typeof azp === "string" && !ALLOWED_PARTIES.includes(azp)) {
      return {
        ok: false,
        status: 401,
        error: "Token origin is not authorized.",
      };
    }

    if (!verified.sub) {
      return {
        ok: false,
        status: 401,
        error: "Token payload is missing user identity.",
      };
    }

    return { ok: true, userId: verified.sub };
  } catch {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired session token.",
    };
  }
}

/**
 * Wraps getAuthUserId for routes that need to respond with a standard
 * JSON error. Returns the userId on success, or a Response on failure.
 */
export async function requireAuth(
  request: Request,
): Promise<string | Response> {
  const result = await getAuthUserId(request);

  if (result.ok) {
    return result.userId;
  }

  return Response.json(
    { error: result.error },
    { status: result.status },
  );
}
