export const WEB_BOOKING_STORAGE_KEY = "mboa_web_booking_attempt";
export const MAX_RECOVERY_POLLS = 10;
export const RECOVERY_POLL_INTERVAL_MS = 1500;

const PAYMENT_RETURN_PARAMS = [
  "payment_intent",
  "payment_intent_client_secret",
  "redirect_status",
];

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredBookingAttempt = {
  bookingAttemptId: string;
  fingerprint: string;
};

export type RecoveryPayload = {
  booking_status: string;
  payment_status: string;
  ride?: Record<string, unknown> | null;
};

export type RecoveryOutcome =
  "ride_created" | "terminal_failure" | "unpaid" | "processing";

export type ReconcileOptions = {
  maxPolls?: number;
  intervalMs?: number;
  wait?: (ms: number) => Promise<void>;
};

export function classifyRecovery(payload: RecoveryPayload): RecoveryOutcome {
  if (
    payload.booking_status === "refunded" ||
    payload.booking_status === "disputed"
  ) {
    return "terminal_failure";
  }

  if (payload.ride) {
    return "ride_created";
  }

  // A succeeded charge without a ride is still being reconciled server-side.
  // Never report it as failed while money may have moved.
  if (payload.payment_status === "succeeded") {
    return "processing";
  }

  if (
    payload.booking_status === "failed" ||
    payload.booking_status === "canceled" ||
    payload.payment_status === "canceled" ||
    payload.payment_status === "refunded" ||
    payload.payment_status === "disputed"
  ) {
    return "terminal_failure";
  }

  if (payload.payment_status === "processing") {
    return "processing";
  }

  return "unpaid";
}

/**
 * Polls the recovery endpoint until the outcome is final or the poll budget
 * is spent. Errors from the recover call are thrown so the caller keeps the
 * stored booking attempt for another attempt.
 */
export async function reconcileBookingAttempt(
  bookingAttemptId: string,
  recover: (bookingAttemptId: string) => Promise<RecoveryPayload>,
  options: ReconcileOptions = {},
): Promise<RecoveryOutcome> {
  const maxPolls = options.maxPolls ?? MAX_RECOVERY_POLLS;
  const intervalMs = options.intervalMs ?? RECOVERY_POLL_INTERVAL_MS;
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const outcome = classifyRecovery(await recover(bookingAttemptId));

    if (outcome !== "processing") {
      return outcome;
    }

    if (attempt < maxPolls - 1) {
      await wait(intervalMs);
    }
  }

  return "processing";
}

export function readStoredBookingAttempt(
  storage: StorageLike,
): StoredBookingAttempt | null {
  const raw = storage.getItem(WEB_BOOKING_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredBookingAttempt>;

    if (
      typeof parsed.bookingAttemptId === "string" &&
      typeof parsed.fingerprint === "string"
    ) {
      return {
        bookingAttemptId: parsed.bookingAttemptId,
        fingerprint: parsed.fingerprint,
      };
    }
  } catch {
    // Unreadable value is discarded below.
  }

  storage.removeItem(WEB_BOOKING_STORAGE_KEY);
  return null;
}

export function writeStoredBookingAttempt(
  storage: StorageLike,
  value: StoredBookingAttempt,
): void {
  storage.setItem(WEB_BOOKING_STORAGE_KEY, JSON.stringify(value));
}

/**
 * Keeps the stored attempt until the outcome is final. Only a created ride or
 * a confirmed terminal failure allows the stored attempt to be discarded.
 */
export function settleStoredBookingAttempt(
  storage: StorageLike,
  outcome: RecoveryOutcome,
): void {
  if (outcome === "ride_created" || outcome === "terminal_failure") {
    storage.removeItem(WEB_BOOKING_STORAGE_KEY);
  }
}

export function buildBookingFingerprint(input: {
  driverId: number | string;
  amount: string;
  rideTime: number;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
}): string {
  return JSON.stringify([
    String(input.driverId),
    input.amount,
    input.rideTime,
    input.originLatitude,
    input.originLongitude,
    input.destinationLatitude,
    input.destinationLongitude,
  ]);
}

/**
 * Returns the stored booking attempt when it matches the current booking
 * inputs, so a page reload resumes the same PaymentIntent instead of creating
 * a new booking and a new PaymentIntent.
 */
export async function resolveBookingAttemptId(
  storage: StorageLike,
  fingerprint: string,
  createBooking: () => Promise<string>,
): Promise<string> {
  const stored = readStoredBookingAttempt(storage);

  if (stored && stored.fingerprint === fingerprint) {
    return stored.bookingAttemptId;
  }

  const bookingAttemptId = await createBooking();
  writeStoredBookingAttempt(storage, { bookingAttemptId, fingerprint });
  return bookingAttemptId;
}

export function stripPaymentReturnParams(url: URL): string {
  const clean = new URL(url.href);

  for (const key of PAYMENT_RETURN_PARAMS) {
    clean.searchParams.delete(key);
  }

  return clean.toString();
}
