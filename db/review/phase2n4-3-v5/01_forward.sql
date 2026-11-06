-- Phase 2N.4.3 v5 forward migration. REVIEW DRAFT. NOT EXECUTED.
--
-- Base: live migrations 20261011120000 (rides.payment_intent_id) and
-- 20261011130000 (booking_attempts, webhook_events). Replaces the v4 draft,
-- which was never applied. Do not apply v4 and v5 in sequence.
--
-- Amount convention: every amount column holds integer MINOR units of its
-- currency. XAF has exponent 0 (whole francs, never multiplied by 100).
-- EUR has exponent 2 (cents, Stripe convention). Code must never convert XAF.
--
-- Historical data: the two existing rides are classified payment_classification
-- = 'legacy_unknown'. Their amounts, currency-less fare_price, payment_status
-- and timestamps are not modified. Their payment fields are immutable.
--
-- Transaction control is applied by the migration runner, not in this file.

-- 0. Guards: refuse to run if live rows fall outside the v5 vocabulary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM booking_attempts
    WHERE status NOT IN ('pending','payment_intent_created','authorized','cash_confirmed',
                         'succeeded','ride_created','failed','canceled','released',
                         'refunded','disputed','held_for_review')
       OR currency NOT IN ('XAF','EUR')
  ) THEN
    RAISE EXCEPTION 'booking_attempts holds values outside the v5 vocabulary; review before running';
  END IF;
END $$;

-- 1. Payment method reference. Explicit flags decide whether a ride may exist without a PaymentIntent.
CREATE TABLE payment_methods (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  display_name TEXT NOT NULL,
  requires_payment_intent BOOLEAN NOT NULL,
  allows_no_intent BOOLEAN NOT NULL,
  is_active BOOLEAN NOT NULL,
  CHECK (requires_payment_intent <> allows_no_intent)
);

INSERT INTO payment_methods (code, display_name, requires_payment_intent, allows_no_intent, is_active) VALUES
  ('card_stripe',     'Card (Stripe)',                    true,  false, true),
  ('cash',            'Cash',                             false, true,  true),
  ('legacy_unknown',  'Legacy record, method not known',  false, true,  false),
  ('mtn_momo',        'MTN Mobile Money (reserved)',      false, false, false),
  ('orange_money',    'Orange Money (reserved)',          false, false, false);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- 2. booking_attempts: new status vocabulary, XAF default, method reference.
ALTER TABLE booking_attempts DROP CONSTRAINT IF EXISTS booking_attempts_status_check;
ALTER TABLE booking_attempts
  ADD CONSTRAINT booking_attempts_status_check CHECK (status IN (
    'pending','payment_intent_created','authorized','cash_confirmed','succeeded',
    'ride_created','failed','canceled','released','refunded','disputed','held_for_review')),
  ADD COLUMN payment_method_code TEXT REFERENCES payment_methods (code),
  ADD CONSTRAINT booking_attempts_amount_positive_chk CHECK (expected_amount > 0);

ALTER TABLE booking_attempts
  ALTER COLUMN currency SET DEFAULT 'XAF',
  ADD CONSTRAINT booking_attempts_currency_chk CHECK (currency IN ('XAF','EUR'));

CREATE FUNCTION booking_attempts_require_method() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_method_code IS NULL THEN
    RAISE EXCEPTION 'booking attempt requires a payment method';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER booking_attempts_require_method_trg BEFORE INSERT ON booking_attempts
  FOR EACH ROW EXECUTE FUNCTION booking_attempts_require_method();

-- 3. rides: explicit classification, method, currency, booking link, independent settlement.
ALTER TABLE rides
  ADD COLUMN payment_classification TEXT NOT NULL DEFAULT 'legacy_unknown'
    CHECK (payment_classification IN ('legacy_unknown','native')),
  ADD COLUMN payment_method_code TEXT REFERENCES payment_methods (code),
  ADD COLUMN payment_currency TEXT CHECK (payment_currency IN ('XAF','EUR')),
  ADD COLUMN booking_attempt_id UUID REFERENCES booking_attempts (id),
  ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (settlement_status IN ('not_applicable','pending','settled','held'));

ALTER TABLE rides ALTER COLUMN payment_classification SET DEFAULT 'native';

ALTER TABLE rides
  ADD CONSTRAINT rides_payment_status_chk CHECK (payment_status IS NULL OR payment_status IN (
    'unpaid','cash_pending','cash_collected','paid','failed','refunded','disputed','held_for_review'));

CREATE UNIQUE INDEX rides_booking_attempt_id_unique_idx
  ON rides (booking_attempt_id) WHERE booking_attempt_id IS NOT NULL;

CREATE FUNCTION rides_enforce_payment_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m payment_methods%ROWTYPE;
  b booking_attempts%ROWTYPE;
BEGIN
  IF OLD IS NOT NULL AND OLD.payment_classification = 'legacy_unknown' THEN
    IF NEW.payment_classification IS DISTINCT FROM OLD.payment_classification
       OR NEW.payment_method_code IS DISTINCT FROM OLD.payment_method_code
       OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
       OR NEW.payment_currency IS DISTINCT FROM OLD.payment_currency
       OR NEW.fare_price IS DISTINCT FROM OLD.fare_price THEN
      RAISE EXCEPTION 'legacy ride payment fields are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payment_classification = 'legacy_unknown' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO m FROM payment_methods WHERE code = NEW.payment_method_code;
  IF NOT FOUND OR NOT m.is_active THEN
    RAISE EXCEPTION 'payment method % is not active', NEW.payment_method_code;
  END IF;
  IF NEW.booking_attempt_id IS NULL OR NEW.payment_currency IS NULL THEN
    RAISE EXCEPTION 'native ride requires booking link and currency';
  END IF;
  IF m.requires_payment_intent AND NEW.payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'payment method % requires a PaymentIntent', m.code;
  END IF;
  IF m.allows_no_intent AND NEW.payment_intent_id IS NOT NULL THEN
    RAISE EXCEPTION 'payment method % must not carry a PaymentIntent', m.code;
  END IF;

  SELECT * INTO b FROM booking_attempts WHERE id = NEW.booking_attempt_id;
  IF NOT FOUND
     OR b.payment_method_code IS DISTINCT FROM NEW.payment_method_code
     OR b.currency IS DISTINCT FROM NEW.payment_currency
     OR b.payment_intent_id IS DISTINCT FROM NEW.payment_intent_id THEN
    RAISE EXCEPTION 'ride payment does not match its booking attempt';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER rides_enforce_payment_rules_trg BEFORE INSERT OR UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION rides_enforce_payment_rules();

-- 4. webhook_events: provider and audit fields. Existing UNIQUE(stripe_event_id) is the dedupe key.
ALTER TABLE webhook_events
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe',
  ADD COLUMN payload_sha256 TEXT,
  ADD COLUMN processed_at TIMESTAMPTZ;

-- 5. Money ledger. Append-only. One row per money movement, idempotent per provider reference.
CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_attempt_id UUID NOT NULL REFERENCES booking_attempts (id),
  kind TEXT NOT NULL CHECK (kind IN ('authorization','release','charge','refund','dispute','cash_collection')),
  provider TEXT NOT NULL CHECK (provider IN ('stripe','cash')),
  provider_ref TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('XAF','EUR')),
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  CHECK ((provider = 'cash') = (provider_ref IS NULL))
);

CREATE UNIQUE INDEX payment_transactions_provider_ref_uidx
  ON payment_transactions (provider, kind, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE INDEX payment_transactions_booking_idx ON payment_transactions (booking_attempt_id);

CREATE FUNCTION reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_transactions is append-only';
END $$;

CREATE TRIGGER payment_transactions_append_only BEFORE UPDATE OR DELETE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

-- 6. Cash collections. One confirmed collection per booking. Rider response is recorded separately.
CREATE TABLE cash_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_attempt_id UUID NOT NULL UNIQUE REFERENCES booking_attempts (id),
  driver_id INTEGER NOT NULL,
  recorded_by TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('XAF','EUR')),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rider_response TEXT NOT NULL DEFAULT 'none' CHECK (rider_response IN ('none','acknowledged','disputed')),
  rider_responded_at TIMESTAMPTZ,
  CHECK ((rider_response = 'none') = (rider_responded_at IS NULL))
);

-- 7. Refund requests. Rider may request. Only support/admin/system decide. Driver never.
CREATE TABLE refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_attempt_id UUID NOT NULL REFERENCES booking_attempts (id),
  requested_by TEXT NOT NULL,
  requester_role TEXT NOT NULL CHECK (requester_role IN ('rider','support','admin','system')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('XAF','EUR')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  status TEXT NOT NULL CHECK (status IN ('requested','approved','rejected','processing','succeeded','failed')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  provider_refund_ref TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refund_requests_booking_idx ON refund_requests (booking_attempt_id);

-- 8. Row level security: deny by default. Server code connects as the table owner.
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;

-- 9. Functions. Each is callable only by the server role.
CREATE FUNCTION link_payment_intent(p_booking UUID, p_clerk TEXT, p_pi TEXT, p_amount INTEGER, p_currency TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE b booking_attempts%ROWTYPE;
BEGIN
  SELECT * INTO b FROM booking_attempts WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.clerk_user_id <> p_clerk THEN RAISE EXCEPTION 'REJECTED: booking not found'; END IF;
  IF b.payment_method_code <> 'card_stripe' THEN RAISE EXCEPTION 'REJECTED: booking is not a card booking'; END IF;
  IF b.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF p_amount <> b.expected_amount OR p_currency <> b.currency THEN RETURN 'amount_mismatch'; END IF;
  UPDATE booking_attempts
     SET payment_intent_id = p_pi, status = 'payment_intent_created', updated_at = now()
   WHERE id = b.id;
  RETURN 'linked';
END $$;

CREATE FUNCTION create_ride_from_booking(p_booking booking_attempts, p_event_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rides (
    user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, fare_price,
    payment_status, payment_intent_id, payment_method_code, payment_currency,
    booking_attempt_id, payment_classification, settlement_status
  ) VALUES (
    p_booking.clerk_user_id, p_booking.origin_address, p_booking.destination_address,
    p_booking.origin_latitude, p_booking.origin_longitude, p_booking.destination_latitude,
    p_booking.destination_longitude, p_booking.ride_time, p_booking.driver_id, p_booking.expected_amount,
    'paid', p_booking.payment_intent_id, p_booking.payment_method_code, p_booking.currency,
    p_booking.id, 'native', 'pending'
  );
END $$;

CREATE FUNCTION process_stripe_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_event_at TIMESTAMPTZ,
  p_payment_intent TEXT,
  p_charge TEXT,
  p_refund TEXT,
  p_refund_status TEXT,
  p_amount INTEGER,
  p_currency TEXT,
  p_payload_sha256 TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  b booking_attempts%ROWTYPE;
  rr refund_requests%ROWTYPE;
  v_refunded INTEGER;
  v_result TEXT;
BEGIN
  INSERT INTO webhook_events (stripe_event_id, event_type, payment_intent_id, payload_sha256, processed)
  VALUES (p_event_id, p_event_type, p_payment_intent, p_payload_sha256, false)
  ON CONFLICT (stripe_event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  IF p_event_type = 'refund.updated' THEN
    SELECT * INTO rr FROM refund_requests WHERE provider_refund_ref = p_refund FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RETRYABLE: refund % not yet recorded', p_refund; END IF;
    SELECT * INTO b FROM booking_attempts WHERE id = rr.booking_attempt_id FOR UPDATE;

    IF p_refund_status = 'succeeded' AND rr.status = 'succeeded' THEN
      v_result := 'already_applied';
    ELSIF p_refund_status = 'succeeded' AND rr.status = 'processing' THEN
      IF p_amount IS DISTINCT FROM rr.amount OR p_currency IS DISTINCT FROM rr.currency THEN
        UPDATE booking_attempts SET status = 'held_for_review', updated_at = now() WHERE id = b.id;
        v_result := 'held_refund_mismatch';
      ELSE
        UPDATE refund_requests SET status = 'succeeded', updated_at = now() WHERE id = rr.id;
        INSERT INTO payment_transactions (booking_attempt_id, kind, provider, provider_ref, amount, currency, status, occurred_at, created_by)
        VALUES (b.id, 'refund', 'stripe', p_refund, rr.amount, rr.currency, 'succeeded', p_event_at, 'stripe_webhook');
        SELECT COALESCE(SUM(amount), 0) INTO v_refunded FROM payment_transactions
         WHERE booking_attempt_id = b.id AND kind = 'refund' AND status = 'succeeded';
        IF v_refunded >= b.expected_amount THEN
          UPDATE booking_attempts SET status = 'refunded', updated_at = now() WHERE id = b.id;
          UPDATE rides SET payment_status = 'refunded' WHERE booking_attempt_id = b.id;
        END IF;
        v_result := 'refund_succeeded';
      END IF;
    ELSIF p_refund_status = 'failed' AND rr.status = 'processing' THEN
      UPDATE refund_requests SET status = 'failed', updated_at = now() WHERE id = rr.id;
      v_result := 'refund_failed';
    ELSE
      v_result := 'ignored_state';
    END IF;

  ELSIF p_payment_intent IS NULL THEN
    v_result := 'ignored_event_type';

  ELSE
    SELECT * INTO b FROM booking_attempts WHERE payment_intent_id = p_payment_intent FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RETRYABLE: unknown payment intent %', p_payment_intent; END IF;

    IF p_amount IS NOT NULL AND (p_amount IS DISTINCT FROM b.expected_amount OR p_currency IS DISTINCT FROM b.currency) THEN
      UPDATE booking_attempts SET status = 'held_for_review', updated_at = now() WHERE id = b.id;
      v_result := 'held_amount_mismatch';

    ELSIF p_event_type = 'payment_intent.amount_capturable_updated' THEN
      IF b.status = 'payment_intent_created' THEN
        UPDATE booking_attempts SET status = 'authorized', updated_at = now() WHERE id = b.id;
        INSERT INTO payment_transactions (booking_attempt_id, kind, provider, provider_ref, amount, currency, status, occurred_at, created_by)
        VALUES (b.id, 'authorization', 'stripe', p_payment_intent, b.expected_amount, b.currency, 'succeeded', p_event_at, 'stripe_webhook');
        v_result := 'authorized';
      ELSE
        v_result := 'ignored_state';
      END IF;

    ELSIF p_event_type = 'payment_intent.succeeded' THEN
      IF b.status IN ('succeeded','ride_created') THEN
        v_result := 'already_applied';
      ELSIF b.status IN ('payment_intent_created','authorized') THEN
        UPDATE booking_attempts SET status = 'succeeded', updated_at = now() WHERE id = b.id;
        INSERT INTO payment_transactions (booking_attempt_id, kind, provider, provider_ref, amount, currency, status, occurred_at, created_by)
        VALUES (b.id, 'charge', 'stripe', p_charge, b.expected_amount, b.currency, 'succeeded', p_event_at, 'stripe_webhook');
        PERFORM create_ride_from_booking(b, p_event_at);
        v_result := 'succeeded';
      ELSE
        UPDATE booking_attempts SET status = 'held_for_review', updated_at = now() WHERE id = b.id;
        v_result := 'held_late_success';
      END IF;

    ELSIF p_event_type = 'payment_intent.canceled' THEN
      IF b.status = 'authorized' THEN
        UPDATE booking_attempts SET status = 'released', updated_at = now() WHERE id = b.id;
        INSERT INTO payment_transactions (booking_attempt_id, kind, provider, provider_ref, amount, currency, status, occurred_at, created_by)
        VALUES (b.id, 'release', 'stripe', p_payment_intent, b.expected_amount, b.currency, 'succeeded', p_event_at, 'stripe_webhook');
        v_result := 'released';
      ELSIF b.status = 'payment_intent_created' THEN
        UPDATE booking_attempts SET status = 'canceled', updated_at = now() WHERE id = b.id;
        v_result := 'canceled';
      ELSIF b.status IN ('released','canceled') THEN
        v_result := 'already_applied';
      ELSE
        v_result := 'ignored_state';
      END IF;

    ELSIF p_event_type = 'payment_intent.payment_failed' THEN
      IF b.status = 'payment_intent_created' THEN
        UPDATE booking_attempts SET status = 'failed', updated_at = now() WHERE id = b.id;
        v_result := 'failed';
      ELSE
        v_result := 'ignored_state';
      END IF;

    ELSIF p_event_type = 'charge.dispute.created' THEN
      IF b.status IN ('succeeded','ride_created') THEN
        UPDATE booking_attempts SET status = 'disputed', updated_at = now() WHERE id = b.id;
        UPDATE rides SET payment_status = 'disputed' WHERE booking_attempt_id = b.id;
        INSERT INTO payment_transactions (booking_attempt_id, kind, provider, provider_ref, amount, currency, status, occurred_at, created_by)
        VALUES (b.id, 'dispute', 'stripe', p_charge, b.expected_amount, b.currency, 'succeeded', p_event_at, 'stripe_webhook');
        v_result := 'disputed';
      ELSE
        v_result := 'ignored_state';
      END IF;

    ELSE
      v_result := 'ignored_event_type';
    END IF;
  END IF;

  UPDATE webhook_events
     SET processed = true, result_status = v_result, processed_at = now()
   WHERE stripe_event_id = p_event_id;
  RETURN v_result;
END $$;

CREATE FUNCTION confirm_cash_booking(p_booking UUID, p_clerk TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE b booking_attempts%ROWTYPE;
BEGIN
  SELECT * INTO b FROM booking_attempts WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.clerk_user_id <> p_clerk THEN RAISE EXCEPTION 'REJECTED: booking not found'; END IF;
  IF b.payment_method_code <> 'cash' THEN RAISE EXCEPTION 'REJECTED: booking is not a cash booking'; END IF;
  IF b.status <> 'pending' THEN RETURN 'not_pending'; END IF;

  UPDATE booking_attempts SET status = 'cash_confirmed', updated_at = now() WHERE id = b.id;
  INSERT INTO rides (
    user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, fare_price,
    payment_status, payment_intent_id, payment_method_code, payment_currency,
    booking_attempt_id, payment_classification, settlement_status
  ) VALUES (
    b.clerk_user_id, b.origin_address, b.destination_address, b.origin_latitude, b.origin_longitude,
    b.destination_latitude, b.destination_longitude, b.ride_time, b.driver_id, b.expected_amount,
    'cash_pending', NULL, 'cash', b.currency, b.id, 'native', 'not_applicable'
  );
  RETURN 'confirmed';
END $$;

CREATE FUNCTION record_cash_collection(p_booking UUID, p_driver_id INTEGER, p_actor TEXT, p_amount INTEGER, p_currency TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE b booking_attempts%ROWTYPE;
BEGIN
  SELECT * INTO b FROM booking_attempts WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REJECTED: booking not found'; END IF;
  IF b.payment_method_code <> 'cash' THEN RETURN 'not_cash'; END IF;
  IF b.status <> 'cash_confirmed' THEN RETURN 'not_confirmed'; END IF;
  IF b.driver_id <> p_driver_id THEN RETURN 'driver_mismatch'; END IF;
  IF p_amount <> b.expected_amount OR p_currency <> b.currency THEN RETURN 'amount_mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM cash_collections WHERE booking_attempt_id = b.id) THEN RETURN 'already_collected'; END IF;

  INSERT INTO cash_collections (booking_attempt_id, driver_id, recorded_by, amount, currency)
  VALUES (b.id, p_driver_id, p_actor, p_amount, p_currency);
  INSERT INTO payment_transactions (booking_attempt_id, kind, provider, provider_ref, amount, currency, status, occurred_at, created_by)
  VALUES (b.id, 'cash_collection', 'cash', NULL, p_amount, p_currency, 'succeeded', now(), p_actor);
  UPDATE rides SET payment_status = 'cash_collected', settlement_status = 'pending'
   WHERE booking_attempt_id = b.id;
  RETURN 'collected';
END $$;

CREATE FUNCTION respond_cash_collection(p_booking UUID, p_clerk TEXT, p_response TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE b booking_attempts%ROWTYPE;
BEGIN
  IF p_response NOT IN ('acknowledged','disputed') THEN RAISE EXCEPTION 'REJECTED: invalid response'; END IF;
  SELECT * INTO b FROM booking_attempts WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.clerk_user_id <> p_clerk THEN RAISE EXCEPTION 'REJECTED: booking not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cash_collections WHERE booking_attempt_id = b.id) THEN RETURN 'not_collected'; END IF;
  IF EXISTS (SELECT 1 FROM cash_collections WHERE booking_attempt_id = b.id AND rider_response <> 'none') THEN
    RETURN 'already_responded';
  END IF;

  UPDATE cash_collections SET rider_response = p_response, rider_responded_at = now()
   WHERE booking_attempt_id = b.id;
  IF p_response = 'disputed' THEN
    UPDATE rides SET payment_status = 'held_for_review' WHERE booking_attempt_id = b.id;
  END IF;
  RETURN p_response;
END $$;

CREATE FUNCTION request_refund(
  p_booking UUID, p_actor TEXT, p_role TEXT, p_amount INTEGER, p_currency TEXT, p_reason TEXT
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  b booking_attempts%ROWTYPE;
  v_active INTEGER;
  v_id UUID;
  v_status TEXT;
BEGIN
  IF p_role NOT IN ('rider','support','admin','system') THEN RAISE EXCEPTION 'REJECTED: role may not request refunds'; END IF;
  SELECT * INTO b FROM booking_attempts WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REJECTED: booking not found'; END IF;
  IF p_role = 'rider' AND b.clerk_user_id <> p_actor THEN RAISE EXCEPTION 'REJECTED: booking not found'; END IF;
  IF p_role = 'system' AND p_reason <> 'auto:driver_cancelled_before_pickup' THEN
    RAISE EXCEPTION 'REJECTED: automatic refund rule not recognised';
  END IF;
  IF b.payment_method_code <> 'card_stripe' THEN RAISE EXCEPTION 'REJECTED: refunds are handled manually for this payment method'; END IF;
  IF b.status NOT IN ('succeeded','ride_created') THEN RAISE EXCEPTION 'REJECTED: booking has no captured payment to refund'; END IF;
  IF p_currency <> b.currency OR p_amount <= 0 THEN RAISE EXCEPTION 'REJECTED: invalid refund amount'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_active FROM refund_requests
   WHERE booking_attempt_id = b.id AND status IN ('requested','approved','processing','succeeded');
  IF v_active + p_amount > b.expected_amount THEN RAISE EXCEPTION 'REJECTED: refund exceeds captured amount'; END IF;

  v_status := CASE WHEN p_role = 'system' THEN 'approved' ELSE 'requested' END;
  INSERT INTO refund_requests (booking_attempt_id, requested_by, requester_role, amount, currency, reason, status,
                               decided_by, decided_at)
  VALUES (b.id, p_actor, p_role, p_amount, p_currency, p_reason, v_status,
          CASE WHEN p_role = 'system' THEN p_actor END,
          CASE WHEN p_role = 'system' THEN now() END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION decide_refund(p_request UUID, p_actor TEXT, p_role TEXT, p_approve BOOLEAN) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE rr refund_requests%ROWTYPE;
BEGIN
  IF p_role NOT IN ('support','admin') THEN RAISE EXCEPTION 'REJECTED: only support or admin may decide refunds'; END IF;
  SELECT * INTO rr FROM refund_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REJECTED: refund request not found'; END IF;
  IF rr.status <> 'requested' THEN RETURN 'not_requested'; END IF;
  UPDATE refund_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = p_actor, decided_at = now(), updated_at = now()
   WHERE id = rr.id;
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END $$;

CREATE FUNCTION set_refund_processing(p_request UUID, p_refund_ref TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE rr refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO rr FROM refund_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REJECTED: refund request not found'; END IF;
  IF rr.status = 'processing' AND rr.provider_refund_ref = p_refund_ref THEN RETURN 'already_set'; END IF;
  IF rr.status <> 'approved' THEN RETURN 'not_approved'; END IF;
  UPDATE refund_requests
     SET status = 'processing', provider_refund_ref = p_refund_ref, updated_at = now()
   WHERE id = rr.id;
  RETURN 'processing';
END $$;

REVOKE EXECUTE ON FUNCTION link_payment_intent(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_ride_from_booking(booking_attempts, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION process_stripe_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION confirm_cash_booking(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_cash_collection(UUID, INTEGER, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION respond_cash_collection(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION request_refund(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decide_refund(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION set_refund_processing(UUID, TEXT) FROM PUBLIC, anon, authenticated;
