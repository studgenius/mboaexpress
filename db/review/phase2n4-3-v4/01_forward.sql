-- Phase 2N.4.3 v4 forward migration. REVIEW DRAFT: not approved, not executed.
-- Target: Neon, database neondb, schema public. One transaction.
-- Verified read-only on 2026-11-06: rides = 2 rows, both payment_status 'paid', no PaymentIntent;
-- booking_attempts = 0 rows; webhook_events = 0 rows; RLS off on all three; no policies; no grants to other roles.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- 0. Preflight
DO $$
DECLARE
  v_count bigint;
BEGIN
  IF to_regclass('public.payment_attempts') IS NOT NULL
     OR to_regclass('public.payment_attempt_transitions') IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: payment attempt tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND (
       (table_name = 'rides' AND column_name IN ('booking_attempt_id', 'payment_attempt_id'))
    OR (table_name = 'webhook_events' AND column_name = 'payment_attempt_id')
    OR (table_name = 'booking_attempts' AND column_name = 'current_payment_attempt_id'))) THEN
    RAISE EXCEPTION 'PREFLIGHT: payment attempt columns already exist';
  END IF;
  IF to_regclass('public.rollback_archive_manifest') IS NULL THEN
    SELECT count(*) INTO v_count FROM public.rides WHERE payment_intent_id IS NOT NULL;
    IF v_count > 0 THEN
      RAISE EXCEPTION 'PREFLIGHT: % rides carry a PaymentIntent; manual charge mapping required', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM public.booking_attempts
     WHERE payment_intent_id IS NOT NULL AND status NOT IN ('pending', 'payment_intent_created', 'canceled');
    IF v_count > 0 THEN
      RAISE EXCEPTION 'PREFLIGHT: % bookings with PaymentIntents need manual charge mapping', v_count;
    END IF;
  END IF;
END $$;

-- 1. Snapshot of pre-v4 booking pointers (used by rollback). Kept until explicitly dropped.
DO $$
BEGIN
  IF to_regclass('public.payment_v4_snapshot_booking_attempts') IS NULL THEN
    CREATE TABLE public.payment_v4_snapshot_booking_attempts AS
      SELECT id, status, payment_intent_id FROM public.booking_attempts;
    ALTER TABLE public.payment_v4_snapshot_booking_attempts ADD PRIMARY KEY (id);
  END IF;
END $$;

-- 2. Composite keys for owner-matched references.
ALTER TABLE public.booking_attempts
  ADD CONSTRAINT booking_attempts_id_owner_key UNIQUE (id, clerk_user_id);

-- 3. One row per PaymentIntent attempt.
CREATE TABLE public.payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_attempt_id UUID NOT NULL,
  clerk_user_id VARCHAR(255) NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  payment_intent_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'payment_intent_created', 'succeeded', 'duplicate_paid', 'mismatch_held',
                      'failed', 'abandoned', 'canceled', 'refunded', 'disputed')),
  charge_review_status VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (charge_review_status IN ('none', 'required', 'refund_confirmed')),
  canceled_at TIMESTAMPTZ,
  last_stripe_event_at TIMESTAMPTZ,
  reconcile_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_attempts >= 0),
  next_reconcile_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempts_booking_owner_fk
    FOREIGN KEY (booking_attempt_id, clerk_user_id)
    REFERENCES public.booking_attempts (id, clerk_user_id),
  CONSTRAINT payment_attempts_booking_number_key UNIQUE (booking_attempt_id, attempt_number),
  CONSTRAINT payment_attempts_payment_intent_id_key UNIQUE (payment_intent_id),
  CONSTRAINT payment_attempts_stripe_charge_id_key UNIQUE (stripe_charge_id),
  CONSTRAINT payment_attempts_id_booking_key UNIQUE (id, booking_attempt_id),
  CONSTRAINT payment_attempts_id_owner_key UNIQUE (id, clerk_user_id),
  CONSTRAINT payment_attempts_id_pi_key UNIQUE (id, payment_intent_id),
  CONSTRAINT payment_attempts_state_shape_chk CHECK (
       (status IN ('pending', 'failed', 'abandoned')
          AND payment_intent_id IS NULL AND stripe_charge_id IS NULL AND canceled_at IS NULL)
    OR (status = 'payment_intent_created'
          AND payment_intent_id IS NOT NULL AND stripe_charge_id IS NULL AND canceled_at IS NULL)
    OR (status = 'canceled'
          AND payment_intent_id IS NOT NULL AND canceled_at IS NOT NULL
          AND (stripe_charge_id IS NULL OR charge_review_status <> 'none'))
    OR (status IN ('succeeded', 'disputed')
          AND payment_intent_id IS NOT NULL AND stripe_charge_id IS NOT NULL
          AND canceled_at IS NULL AND charge_review_status = 'none')
    OR (status = 'refunded'
          AND payment_intent_id IS NOT NULL AND stripe_charge_id IS NOT NULL AND canceled_at IS NULL)
    OR (status IN ('duplicate_paid', 'mismatch_held')
          AND payment_intent_id IS NOT NULL AND stripe_charge_id IS NOT NULL
          AND canceled_at IS NULL AND charge_review_status = 'required')
  )
);

-- At most one in-flight attempt per booking.
CREATE UNIQUE INDEX payment_attempts_one_open_per_booking_idx
  ON public.payment_attempts (booking_attempt_id)
  WHERE status IN ('pending', 'payment_intent_created');

-- At most one settled attempt per booking.
CREATE UNIQUE INDEX payment_attempts_one_settled_per_booking_idx
  ON public.payment_attempts (booking_attempt_id)
  WHERE status IN ('succeeded', 'disputed')
     OR (status = 'refunded' AND charge_review_status = 'none');

CREATE INDEX payment_attempts_hold_idx
  ON public.payment_attempts (booking_attempt_id)
  WHERE charge_review_status = 'required';

CREATE INDEX payment_attempts_reconcile_idx
  ON public.payment_attempts (next_reconcile_at)
  WHERE status = 'pending';

-- 4. Append-only transition log.
CREATE TABLE public.payment_attempt_transitions (
  id BIGSERIAL PRIMARY KEY,
  payment_attempt_id UUID NOT NULL REFERENCES public.payment_attempts (id),
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  charge_review_from VARCHAR(20),
  charge_review_to VARCHAR(20) NOT NULL,
  event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Booking pointer to its current attempt; widen booking status for holds.
ALTER TABLE public.booking_attempts ADD COLUMN current_payment_attempt_id UUID;

ALTER TABLE public.booking_attempts DROP CONSTRAINT booking_attempts_status_check;
ALTER TABLE public.booking_attempts ADD CONSTRAINT booking_attempts_status_check
  CHECK (status IN ('pending', 'payment_intent_created', 'succeeded', 'failed', 'canceled',
                    'refunded', 'disputed', 'ride_created', 'under_review'));

ALTER TABLE public.booking_attempts
  ADD CONSTRAINT booking_attempts_current_attempt_fk
  FOREIGN KEY (current_payment_attempt_id, id)
  REFERENCES public.payment_attempts (id, booking_attempt_id);

-- 6. Rides: link to booking and attempt. Legacy rides keep NULL links.
ALTER TABLE public.rides
  ADD COLUMN booking_attempt_id UUID,
  ADD COLUMN payment_attempt_id UUID;

ALTER TABLE public.rides
  ADD CONSTRAINT rides_booking_owner_fk
    FOREIGN KEY (booking_attempt_id, user_id) REFERENCES public.booking_attempts (id, clerk_user_id),
  ADD CONSTRAINT rides_payment_attempt_owner_fk
    FOREIGN KEY (payment_attempt_id, user_id) REFERENCES public.payment_attempts (id, clerk_user_id),
  ADD CONSTRAINT rides_payment_attempt_booking_fk
    FOREIGN KEY (payment_attempt_id, booking_attempt_id) REFERENCES public.payment_attempts (id, booking_attempt_id),
  ADD CONSTRAINT rides_payment_attempt_intent_fk
    FOREIGN KEY (payment_attempt_id, payment_intent_id) REFERENCES public.payment_attempts (id, payment_intent_id),
  ADD CONSTRAINT rides_payment_link_shape_chk CHECK (
       (payment_intent_id IS NULL AND payment_attempt_id IS NULL AND booking_attempt_id IS NULL)
    OR (payment_intent_id IS NOT NULL AND payment_attempt_id IS NOT NULL AND booking_attempt_id IS NOT NULL));

CREATE UNIQUE INDEX rides_booking_attempt_id_unique_idx
  ON public.rides (booking_attempt_id)
  WHERE booking_attempt_id IS NOT NULL;

-- 7. Webhook events: bound to the attempt that owns the same PaymentIntent.
ALTER TABLE public.webhook_events ADD COLUMN payment_attempt_id UUID;

ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_payment_attempt_fk
  FOREIGN KEY (payment_attempt_id, payment_intent_id)
  REFERENCES public.payment_attempts (id, payment_intent_id);

CREATE INDEX webhook_events_payment_attempt_idx
  ON public.webhook_events (payment_attempt_id)
  WHERE payment_attempt_id IS NOT NULL;

-- 8. Data load. Fresh run: map existing PaymentIntents (none today). Reversal: restore archive.
DO $$
BEGIN
  IF to_regclass('public.rollback_archive_payment_attempts') IS NULL THEN
    INSERT INTO public.payment_attempts
      (booking_attempt_id, clerk_user_id, attempt_number, payment_intent_id, status, canceled_at, created_at, updated_at)
    SELECT b.id, b.clerk_user_id, 1, b.payment_intent_id,
           CASE WHEN b.status = 'canceled' THEN 'canceled' ELSE 'payment_intent_created' END,
           CASE WHEN b.status = 'canceled' THEN b.updated_at END,
           b.created_at, b.updated_at
    FROM public.booking_attempts b
    WHERE b.payment_intent_id IS NOT NULL;
  ELSE
    INSERT INTO public.payment_attempts
      (id, booking_attempt_id, clerk_user_id, attempt_number, payment_intent_id, stripe_charge_id, status,
       charge_review_status, canceled_at, last_stripe_event_at, reconcile_attempts, next_reconcile_at,
       created_at, updated_at)
    SELECT id, booking_attempt_id, clerk_user_id, attempt_number, payment_intent_id, stripe_charge_id, status,
           charge_review_status, canceled_at, last_stripe_event_at, reconcile_attempts, next_reconcile_at,
           created_at, updated_at
    FROM public.rollback_archive_payment_attempts;

    INSERT INTO public.payment_attempt_transitions
      (id, payment_attempt_id, from_status, to_status, charge_review_from, charge_review_to, event_at, created_at)
    SELECT id, payment_attempt_id, from_status, to_status, charge_review_from, charge_review_to, event_at, created_at
    FROM public.rollback_archive_payment_attempt_transitions;
    PERFORM setval(pg_get_serial_sequence('public.payment_attempt_transitions', 'id'),
                   coalesce((SELECT max(id) FROM public.payment_attempt_transitions), 1),
                   EXISTS (SELECT 1 FROM public.payment_attempt_transitions));

    UPDATE public.rides r
    SET booking_attempt_id = a.booking_attempt_id, payment_attempt_id = a.payment_attempt_id
    FROM public.rollback_archive_ride_links a
    WHERE a.ride_id = r.ride_id;

    UPDATE public.webhook_events w
    SET payment_attempt_id = a.payment_attempt_id
    FROM public.rollback_archive_webhook_links a
    WHERE a.id = w.id;
  END IF;
END $$;

-- 9. Pure matrices and predicates.
CREATE FUNCTION public.payment_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT (p_from, p_to) IN (
    ('pending', 'payment_intent_created'), ('pending', 'failed'), ('pending', 'abandoned'),
    ('payment_intent_created', 'canceled'), ('payment_intent_created', 'succeeded'),
    ('payment_intent_created', 'duplicate_paid'), ('payment_intent_created', 'mismatch_held'),
    ('succeeded', 'disputed'), ('succeeded', 'refunded'),
    ('disputed', 'succeeded'), ('disputed', 'refunded'),
    ('duplicate_paid', 'refunded'), ('mismatch_held', 'refunded'))
$$;

CREATE FUNCTION public.payment_attempt_blocks_booking(p_status text, p_review text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_review = 'required'
      OR p_status IN ('succeeded', 'disputed')
      OR (p_status = 'refunded' AND p_review = 'none')
$$;

-- 10. Booking target computation: the single source of truth for pointer and status.
CREATE FUNCTION public.booking_target_state(p_booking uuid,
  OUT o_attempt_id uuid, OUT o_intent_id varchar, OUT o_status varchar)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_hold boolean;
  v_ride boolean;
  v_status varchar;
  v_pi varchar;
  v_id uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.payment_attempts pa
                 WHERE pa.booking_attempt_id = p_booking AND pa.charge_review_status = 'required') INTO v_hold;
  SELECT EXISTS (SELECT 1 FROM public.rides r WHERE r.booking_attempt_id = p_booking) INTO v_ride;

  SELECT pa.id, pa.payment_intent_id, pa.status INTO v_id, v_pi, v_status
  FROM public.payment_attempts pa
  WHERE pa.booking_attempt_id = p_booking
  ORDER BY CASE
             WHEN pa.status IN ('succeeded', 'disputed') OR (pa.status = 'refunded' AND pa.charge_review_status = 'none') THEN 0
             WHEN pa.status IN ('pending', 'payment_intent_created') THEN 1
             WHEN pa.charge_review_status = 'required' THEN 2
             ELSE 3
           END,
           pa.attempt_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    o_attempt_id := NULL; o_intent_id := NULL; o_status := NULL;
    RETURN;
  END IF;

  o_attempt_id := v_id;
  o_intent_id := v_pi;
  o_status := CASE
    WHEN v_hold THEN 'under_review'
    WHEN v_status = 'succeeded' AND v_ride THEN 'ride_created'
    WHEN v_status = 'duplicate_paid' OR v_status = 'mismatch_held' THEN 'under_review'
    WHEN v_status = 'abandoned' THEN 'failed'
    ELSE v_status
  END;
END $$;

CREATE FUNCTION public.refresh_booking_state(p_booking uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM public.booking_target_state(p_booking);
  IF t.o_attempt_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.booking_attempts ba
  SET current_payment_attempt_id = t.o_attempt_id,
      payment_intent_id = t.o_intent_id,
      status = t.o_status,
      updated_at = now()
  WHERE ba.id = p_booking;
END $$;

-- 11. Booking consistency: stored pointer, PaymentIntent and status must equal the computed target.
CREATE FUNCTION public.assert_booking_consistent(p_booking uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_b public.booking_attempts%ROWTYPE;
  v_t record;
BEGIN
  SELECT * INTO v_b FROM public.booking_attempts WHERE id = p_booking;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO v_t FROM public.booking_target_state(p_booking);
  IF v_t.o_attempt_id IS NULL THEN
    IF v_b.current_payment_attempt_id IS NOT NULL OR v_b.payment_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'consistency: booking % has payment references but no attempts', p_booking;
    END IF;
    RETURN;
  END IF;
  IF v_b.current_payment_attempt_id IS DISTINCT FROM v_t.o_attempt_id
     OR v_b.payment_intent_id IS DISTINCT FROM v_t.o_intent_id
     OR v_b.status IS DISTINCT FROM v_t.o_status THEN
    RAISE EXCEPTION 'consistency: booking % pointer, PaymentIntent or status differs from its computed target', p_booking;
  END IF;
END $$;

-- 12. Attempt-level triggers.
CREATE FUNCTION public.payment_attempts_guard_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status <> 'pending' OR NEW.payment_intent_id IS NOT NULL OR NEW.stripe_charge_id IS NOT NULL
     OR NEW.canceled_at IS NOT NULL OR NEW.charge_review_status <> 'none' THEN
    RAISE EXCEPTION 'payment attempts must start pending with no Stripe references';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_attempts pa
             WHERE pa.booking_attempt_id = NEW.booking_attempt_id
               AND public.payment_attempt_blocks_booking(pa.status, pa.charge_review_status)) THEN
    RAISE EXCEPTION 'payment_blocked: booking is settled or under review';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.payment_attempts_guard_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.booking_attempt_id IS DISTINCT FROM OLD.booking_attempt_id
     OR NEW.clerk_user_id IS DISTINCT FROM OLD.clerk_user_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number THEN
    RAISE EXCEPTION 'payment attempt identity is immutable';
  END IF;
  IF OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id THEN
    RAISE EXCEPTION 'PaymentIntent reference is write-once';
  END IF;
  IF OLD.stripe_charge_id IS NOT NULL AND NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id THEN
    RAISE EXCEPTION 'charge reference is write-once';
  END IF;
  IF OLD.canceled_at IS NOT NULL AND NEW.canceled_at IS DISTINCT FROM OLD.canceled_at THEN
    RAISE EXCEPTION 'cancellation time is write-once';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.payment_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'forbidden payment attempt transition % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.charge_review_status IS DISTINCT FROM OLD.charge_review_status
     AND NOT ((OLD.charge_review_status = 'none' AND NEW.charge_review_status = 'required')
           OR (OLD.charge_review_status = 'required' AND NEW.charge_review_status = 'refund_confirmed')) THEN
    RAISE EXCEPTION 'forbidden charge review transition % -> %', OLD.charge_review_status, NEW.charge_review_status;
  END IF;
  IF OLD.last_stripe_event_at IS NOT NULL
     AND (NEW.last_stripe_event_at IS NULL OR NEW.last_stripe_event_at < OLD.last_stripe_event_at) THEN
    RAISE EXCEPTION 'event clock cannot move backwards';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.payment_attempts_log_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.charge_review_status IS DISTINCT FROM OLD.charge_review_status THEN
    INSERT INTO public.payment_attempt_transitions
      (payment_attempt_id, from_status, to_status, charge_review_from, charge_review_to, event_at)
    VALUES (NEW.id, OLD.status, NEW.status, OLD.charge_review_status, NEW.charge_review_status, NEW.last_stripe_event_at);
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.reject_log_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'payment attempt transition log is append-only';
END $$;

CREATE FUNCTION public.trg_attempt_booking_consistent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_booking_consistent(NEW.booking_attempt_id);
  RETURN NULL;
END $$;

CREATE FUNCTION public.trg_booking_consistent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.assert_booking_consistent(NEW.id);
  RETURN NULL;
END $$;

-- 13. Ride guard: a ride with a PaymentIntent needs the current, succeeded attempt; its links are immutable.
CREATE FUNCTION public.rides_guard_paid_current_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.payment_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.payment_attempts pa
    JOIN public.booking_attempts ba ON ba.id = pa.booking_attempt_id
    WHERE pa.id = NEW.payment_attempt_id
      AND pa.status = 'succeeded'
      AND ba.current_payment_attempt_id = pa.id) THEN
    RAISE EXCEPTION 'ride requires the current succeeded payment attempt';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.rides_link_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.booking_attempt_id IS NOT NULL
     AND (NEW.booking_attempt_id IS DISTINCT FROM OLD.booking_attempt_id
          OR NEW.payment_attempt_id IS DISTINCT FROM OLD.payment_attempt_id) THEN
    RAISE EXCEPTION 'ride payment links are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_attempts_guard_insert BEFORE INSERT ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.payment_attempts_guard_insert();
CREATE TRIGGER payment_attempts_guard_update BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.payment_attempts_guard_update();
CREATE TRIGGER payment_attempts_log_transition AFTER UPDATE ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.payment_attempts_log_transition();
CREATE TRIGGER payment_attempt_transitions_append_only BEFORE UPDATE OR DELETE ON public.payment_attempt_transitions
  FOR EACH ROW EXECUTE FUNCTION public.reject_log_mutation();
CREATE CONSTRAINT TRIGGER payment_attempts_booking_consistent
  AFTER INSERT OR UPDATE ON public.payment_attempts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_attempt_booking_consistent();
CREATE CONSTRAINT TRIGGER booking_attempts_consistent
  AFTER INSERT OR UPDATE OF current_payment_attempt_id, payment_intent_id, status ON public.booking_attempts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.trg_booking_consistent();
CREATE TRIGGER rides_guard_paid_current_attempt BEFORE INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.rides_guard_paid_current_attempt();
CREATE TRIGGER rides_link_immutable BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.rides_link_immutable();

-- 14. Ride creation from a succeeded attempt (only caller: apply_success).
CREATE FUNCTION public.create_ride_for_attempt(p_attempt uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.rides
    (origin_address, destination_address, origin_latitude, origin_longitude,
     destination_latitude, destination_longitude, ride_time, fare_price, payment_status,
     driver_id, user_id, payment_intent_id, booking_attempt_id, payment_attempt_id)
  SELECT b.origin_address, b.destination_address, b.origin_latitude, b.origin_longitude,
         b.destination_latitude, b.destination_longitude, b.ride_time, b.expected_amount, 'paid',
         b.driver_id, b.clerk_user_id, pa.payment_intent_id, b.id, pa.id
  FROM public.payment_attempts pa
  JOIN public.booking_attempts b ON b.id = pa.booking_attempt_id
  WHERE pa.id = p_attempt;
END $$;

-- 15. Retry gate: the only way to start a payment attempt. Locks the booking first.
CREATE FUNCTION public.open_payment_attempt(p_booking uuid, p_clerk varchar)
RETURNS TABLE (out_attempt_id uuid, out_attempt_number integer, out_created boolean)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_b public.booking_attempts%ROWTYPE;
  v_open_id uuid;
  v_open_no integer;
  v_next integer;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_b FROM public.booking_attempts WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR v_b.clerk_user_id <> p_clerk THEN
    RAISE EXCEPTION 'booking_not_found';
  END IF;

  SELECT pa.id, pa.attempt_number INTO v_open_id, v_open_no
  FROM public.payment_attempts pa
  WHERE pa.booking_attempt_id = p_booking AND pa.status IN ('pending', 'payment_intent_created');
  IF FOUND THEN
    RETURN QUERY SELECT v_open_id, v_open_no, false;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_attempts pa
             WHERE pa.booking_attempt_id = p_booking
               AND public.payment_attempt_blocks_booking(pa.status, pa.charge_review_status)) THEN
    RAISE EXCEPTION 'booking_not_retryable';
  END IF;

  SELECT coalesce(max(pa.attempt_number), 0) + 1 INTO v_next
  FROM public.payment_attempts pa WHERE pa.booking_attempt_id = p_booking;

  INSERT INTO public.payment_attempts (booking_attempt_id, clerk_user_id, attempt_number, status)
  VALUES (p_booking, p_clerk, v_next, 'pending')
  RETURNING id INTO v_new_id;

  PERFORM public.refresh_booking_state(p_booking);
  RETURN QUERY SELECT v_new_id, v_next, true;
END $$;

-- 16. PaymentIntent link: from the creation response, payment_intent.created, or reconciliation.
CREATE FUNCTION public.link_payment_intent(p_attempt uuid, p_clerk varchar, p_pi varchar,
  p_amount integer, p_currency varchar, p_event_at timestamptz)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_booking_id uuid;
  v_b public.booking_attempts%ROWTYPE;
  v_a public.payment_attempts%ROWTYPE;
BEGIN
  SELECT pa.booking_attempt_id INTO v_booking_id FROM public.payment_attempts pa WHERE pa.id = p_attempt;
  IF NOT FOUND THEN RETURN 'unknown_attempt'; END IF;

  SELECT * INTO v_b FROM public.booking_attempts WHERE id = v_booking_id FOR UPDATE;
  SELECT * INTO v_a FROM public.payment_attempts WHERE id = p_attempt FOR UPDATE;

  IF v_b.clerk_user_id <> p_clerk OR v_a.clerk_user_id <> p_clerk THEN RETURN 'rejected_owner'; END IF;
  IF v_b.expected_amount <> p_amount OR lower(v_b.currency) <> lower(p_currency) THEN RETURN 'rejected_amount'; END IF;
  IF v_a.payment_intent_id = p_pi THEN RETURN 'already_linked'; END IF;
  IF v_a.payment_intent_id IS NOT NULL THEN RETURN 'rejected_pi_conflict'; END IF;
  IF v_a.status <> 'pending' THEN RETURN 'rejected_terminal'; END IF;
  IF v_b.current_payment_attempt_id IS DISTINCT FROM v_a.id THEN RETURN 'rejected_not_current'; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_attempts pa WHERE pa.payment_intent_id = p_pi) THEN
    RETURN 'rejected_pi_in_use';
  END IF;

  UPDATE public.payment_attempts pa
  SET payment_intent_id = p_pi,
      status = 'payment_intent_created',
      last_stripe_event_at = greatest(coalesce(pa.last_stripe_event_at, p_event_at), p_event_at),
      updated_at = now()
  WHERE pa.id = p_attempt;
  PERFORM public.refresh_booking_state(v_booking_id);
  RETURN 'linked';
END $$;

-- 17. Stripe definitively rejected creation (no PaymentIntent exists): pending -> failed.
CREATE FUNCTION public.mark_creation_rejected(p_attempt uuid, p_clerk varchar) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_booking_id uuid;
  v_a public.payment_attempts%ROWTYPE;
BEGIN
  SELECT pa.booking_attempt_id INTO v_booking_id FROM public.payment_attempts pa WHERE pa.id = p_attempt;
  IF NOT FOUND THEN RETURN 'unknown_attempt'; END IF;
  PERFORM 1 FROM public.booking_attempts WHERE id = v_booking_id FOR UPDATE;
  SELECT * INTO v_a FROM public.payment_attempts WHERE id = p_attempt FOR UPDATE;
  IF v_a.clerk_user_id <> p_clerk THEN RETURN 'rejected_owner'; END IF;
  IF v_a.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  UPDATE public.payment_attempts SET status = 'failed', updated_at = now() WHERE id = p_attempt;
  PERFORM public.refresh_booking_state(v_booking_id);
  RETURN 'failed';
END $$;

-- 18. Manual abandonment (operator only). Allowed only for a pending attempt with no PaymentIntent.
CREATE FUNCTION public.manual_abandon_attempt(p_attempt uuid) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  SELECT pa.booking_attempt_id INTO v_booking_id FROM public.payment_attempts pa WHERE pa.id = p_attempt;
  IF NOT FOUND THEN RETURN 'unknown_attempt'; END IF;
  PERFORM 1 FROM public.booking_attempts WHERE id = v_booking_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.payment_attempts pa
                 WHERE pa.id = p_attempt AND pa.status = 'pending' AND pa.payment_intent_id IS NULL) THEN
    RETURN 'not_abandonable';
  END IF;
  UPDATE public.payment_attempts SET status = 'abandoned', updated_at = now() WHERE id = p_attempt;
  PERFORM public.refresh_booking_state(v_booking_id);
  RETURN 'abandoned';
END $$;

-- 19. Success. Money facts are never dropped as stale; they are recorded and held when unsafe.
CREATE FUNCTION public.apply_success(p_pi varchar, p_charge varchar, p_amount integer, p_currency varchar,
  p_event_at timestamptz)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_booking_id uuid;
  v_b public.booking_attempts%ROWTYPE;
  v_a public.payment_attempts%ROWTYPE;
  v_other_blocks boolean;
  v_amount_ok boolean;
BEGIN
  SELECT pa.booking_attempt_id INTO v_booking_id FROM public.payment_attempts pa WHERE pa.payment_intent_id = p_pi;
  IF NOT FOUND THEN RETURN 'unknown_payment_intent'; END IF;
  SELECT * INTO v_b FROM public.booking_attempts WHERE id = v_booking_id FOR UPDATE;
  SELECT * INTO v_a FROM public.payment_attempts WHERE payment_intent_id = p_pi FOR UPDATE;

  IF v_a.stripe_charge_id IS NOT NULL THEN
    IF v_a.stripe_charge_id = p_charge THEN RETURN 'already_applied'; END IF;
    RETURN 'charge_conflict';
  END IF;

  v_amount_ok := v_b.expected_amount = p_amount AND lower(v_b.currency) = lower(p_currency);

  IF v_a.status = 'canceled' THEN
    UPDATE public.payment_attempts
    SET stripe_charge_id = p_charge, charge_review_status = 'required',
        last_stripe_event_at = greatest(coalesce(last_stripe_event_at, p_event_at), p_event_at), updated_at = now()
    WHERE id = v_a.id;
    PERFORM public.refresh_booking_state(v_booking_id);
    RETURN 'late_success_held';
  END IF;

  IF v_a.status <> 'payment_intent_created' THEN RETURN 'unexpected_status'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.payment_attempts pa
                 WHERE pa.booking_attempt_id = v_b.id AND pa.id <> v_a.id
                   AND public.payment_attempt_blocks_booking(pa.status, pa.charge_review_status)) INTO v_other_blocks;

  IF NOT v_amount_ok THEN
    UPDATE public.payment_attempts
    SET status = 'mismatch_held', stripe_charge_id = p_charge, charge_review_status = 'required',
        last_stripe_event_at = greatest(coalesce(last_stripe_event_at, p_event_at), p_event_at), updated_at = now()
    WHERE id = v_a.id;
    PERFORM public.refresh_booking_state(v_booking_id);
    RETURN 'amount_mismatch_held';
  END IF;

  IF v_other_blocks THEN
    UPDATE public.payment_attempts
    SET status = 'duplicate_paid', stripe_charge_id = p_charge, charge_review_status = 'required',
        last_stripe_event_at = greatest(coalesce(last_stripe_event_at, p_event_at), p_event_at), updated_at = now()
    WHERE id = v_a.id;
    PERFORM public.refresh_booking_state(v_booking_id);
    RETURN 'duplicate_paid_held';
  END IF;

  UPDATE public.payment_attempts
  SET status = 'succeeded', stripe_charge_id = p_charge,
      last_stripe_event_at = greatest(coalesce(last_stripe_event_at, p_event_at), p_event_at), updated_at = now()
  WHERE id = v_a.id;
  PERFORM public.refresh_booking_state(v_booking_id);
  PERFORM public.create_ride_for_attempt(v_a.id);
  PERFORM public.refresh_booking_state(v_booking_id);
  RETURN 'succeeded';
END $$;

-- 20. Cancellation confirmed by Stripe. Stale cancellation events cannot move an attempt back.
CREATE FUNCTION public.apply_pi_canceled(p_pi varchar, p_event_at timestamptz) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_booking_id uuid;
  v_a public.payment_attempts%ROWTYPE;
BEGIN
  SELECT pa.booking_attempt_id INTO v_booking_id FROM public.payment_attempts pa WHERE pa.payment_intent_id = p_pi;
  IF NOT FOUND THEN RETURN 'unknown_payment_intent'; END IF;
  PERFORM 1 FROM public.booking_attempts WHERE id = v_booking_id FOR UPDATE;
  SELECT * INTO v_a FROM public.payment_attempts WHERE payment_intent_id = p_pi FOR UPDATE;

  IF v_a.status = 'canceled' THEN RETURN 'already_applied'; END IF;
  IF v_a.status <> 'payment_intent_created' THEN RETURN 'ignored_status'; END IF;
  IF v_a.last_stripe_event_at IS NOT NULL AND p_event_at < v_a.last_stripe_event_at THEN
    RETURN 'stale_ignored';
  END IF;

  UPDATE public.payment_attempts
  SET status = 'canceled', canceled_at = now(),
      last_stripe_event_at = greatest(coalesce(last_stripe_event_at, p_event_at), p_event_at), updated_at = now()
  WHERE id = v_a.id;
  PERFORM public.refresh_booking_state(v_booking_id);
  RETURN 'canceled';
END $$;

-- 21. Charge lifecycle: refund, dispute, dispute outcome.
CREATE FUNCTION public.apply_charge_event(p_charge varchar, p_action varchar, p_event_at timestamptz)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_booking_id uuid;
  v_a public.payment_attempts%ROWTYPE;
  v_status varchar;
  v_review varchar;
  v_result text := 'ignored';
BEGIN
  SELECT pa.booking_attempt_id INTO v_booking_id FROM public.payment_attempts pa WHERE pa.stripe_charge_id = p_charge;
  IF NOT FOUND THEN RETURN 'unknown_charge'; END IF;
  PERFORM 1 FROM public.booking_attempts WHERE id = v_booking_id FOR UPDATE;
  SELECT * INTO v_a FROM public.payment_attempts WHERE stripe_charge_id = p_charge FOR UPDATE;

  IF p_action <> 'refunded' AND v_a.last_stripe_event_at IS NOT NULL AND p_event_at < v_a.last_stripe_event_at THEN
    RETURN 'stale_ignored';
  END IF;

  v_status := v_a.status;
  v_review := v_a.charge_review_status;

  IF p_action = 'refunded' THEN
    IF v_a.status IN ('succeeded', 'disputed') THEN
      v_status := 'refunded'; v_result := 'refunded';
    ELSIF v_a.status IN ('duplicate_paid', 'mismatch_held') THEN
      v_status := 'refunded'; v_review := 'refund_confirmed'; v_result := 'refunded';
    ELSIF v_a.status = 'canceled' AND v_a.charge_review_status = 'required' THEN
      v_review := 'refund_confirmed'; v_result := 'hold_released';
    ELSE
      v_result := 'already_applied';
    END IF;
  ELSIF p_action = 'disputed' THEN
    IF v_a.status = 'succeeded' THEN
      v_status := 'disputed'; v_result := 'disputed';
    ELSE
      v_result := 'ignored_status';
    END IF;
  ELSIF p_action = 'dispute_won' THEN
    IF v_a.status = 'disputed' THEN
      v_status := 'succeeded'; v_result := 'dispute_won';
    ELSE
      v_result := 'ignored_status';
    END IF;
  ELSIF p_action = 'dispute_lost' THEN
    IF v_a.status = 'disputed' THEN
      v_status := 'refunded'; v_result := 'dispute_lost';
    ELSE
      v_result := 'ignored_status';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown charge action %', p_action;
  END IF;

  IF v_status IS DISTINCT FROM v_a.status OR v_review IS DISTINCT FROM v_a.charge_review_status THEN
    UPDATE public.payment_attempts
    SET status = v_status, charge_review_status = v_review,
        last_stripe_event_at = greatest(coalesce(last_stripe_event_at, p_event_at), p_event_at), updated_at = now()
    WHERE id = v_a.id;
    PERFORM public.refresh_booking_state(v_booking_id);
  END IF;
  RETURN v_result;
END $$;

-- 22. Webhook entry point. One call = one transaction. Retryable results raise, which rolls back the
--     dedupe row too, so Stripe redelivers the event.
CREATE FUNCTION public.process_stripe_event(
  p_event_id varchar, p_type varchar, p_created timestamptz,
  p_pi varchar, p_charge varchar, p_attempt uuid, p_clerk varchar,
  p_amount integer, p_currency varchar, p_dispute_outcome varchar)
RETURNS text LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_result text;
BEGIN
  INSERT INTO public.webhook_events (stripe_event_id, event_type, payment_intent_id, processed, result_status)
  VALUES (p_event_id, p_type, p_pi, false, 'received')
  ON CONFLICT (stripe_event_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  CASE p_type
    WHEN 'payment_intent.created' THEN
      IF p_attempt IS NULL OR p_pi IS NULL THEN
        v_result := 'ignored_no_metadata';
      ELSE
        v_result := public.link_payment_intent(p_attempt, p_clerk, p_pi, p_amount, p_currency, p_created);
      END IF;
    WHEN 'payment_intent.succeeded' THEN
      v_result := public.apply_success(p_pi, p_charge, p_amount, p_currency, p_created);
    WHEN 'payment_intent.canceled' THEN
      v_result := public.apply_pi_canceled(p_pi, p_created);
    WHEN 'payment_intent.payment_failed' THEN
      v_result := 'recorded_only';
    WHEN 'charge.refunded' THEN
      v_result := public.apply_charge_event(p_charge, 'refunded', p_created);
    WHEN 'charge.dispute.created' THEN
      v_result := public.apply_charge_event(p_charge, 'disputed', p_created);
    WHEN 'charge.dispute.closed' THEN
      IF p_dispute_outcome = 'won' THEN
        v_result := public.apply_charge_event(p_charge, 'dispute_won', p_created);
      ELSIF p_dispute_outcome = 'lost' THEN
        v_result := public.apply_charge_event(p_charge, 'dispute_lost', p_created);
      ELSE
        v_result := 'ignored_unknown_outcome';
      END IF;
    ELSE
      v_result := 'ignored_unhandled';
  END CASE;

  IF v_result = 'unknown_payment_intent' OR v_result = 'unknown_charge' THEN
    RAISE EXCEPTION 'retryable: % for event %', v_result, p_event_id;
  END IF;

  UPDATE public.webhook_events w
  SET processed = true,
      result_status = v_result,
      payment_attempt_id = (SELECT pa.id FROM public.payment_attempts pa WHERE pa.payment_intent_id = p_pi)
  WHERE w.id = v_id;

  RETURN v_result;
END $$;

-- 23. Data-load refresh: every booking with attempts gets its pointer, PaymentIntent and status computed once.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT booking_attempt_id AS id FROM public.payment_attempts LOOP
    PERFORM public.refresh_booking_state(r.id);
  END LOOP;
END $$;

-- 24. Post-check: every booking consistent, every ride link valid, nothing written outside the matrix.
DO $$
DECLARE
  r record;
  v_bad bigint;
BEGIN
  FOR r IN SELECT id FROM public.booking_attempts LOOP
    PERFORM public.assert_booking_consistent(r.id);
  END LOOP;
  SELECT count(*) INTO v_bad FROM public.rides
  WHERE payment_intent_id IS NOT NULL AND payment_attempt_id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'POSTCHECK: % rides with PaymentIntent lack an attempt link', v_bad;
  END IF;
END $$;

-- 25. Privileges: no other database roles exist today (verified); still remove PUBLIC execute on the
--     state functions so only the owner role used by the application can call them.
REVOKE EXECUTE ON FUNCTION public.open_payment_attempt(uuid, varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_payment_intent(uuid, varchar, varchar, integer, varchar, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_creation_rejected(uuid, varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manual_abandon_attempt(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_success(varchar, varchar, integer, varchar, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_pi_canceled(varchar, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_charge_event(varchar, varchar, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_stripe_event(varchar, varchar, timestamptz, varchar, varchar, uuid, varchar, integer, varchar, varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_ride_for_attempt(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_booking_state(uuid) FROM PUBLIC;

COMMIT;
