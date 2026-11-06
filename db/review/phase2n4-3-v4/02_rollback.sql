-- Phase 2N.4.3 v4 rollback. REVIEW DRAFT: not approved, not executed.
-- Archives all v4 data (with md5 manifest), restores pre-v4 booking pointers from the forward snapshot,
-- drops v4 objects, then records a per-row drift manifest of the pre-v4 tables for the reversal check.
-- Refuses to run when pre-v4 code could not represent the data (multiple attempts, holds, duplicates, under_review).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 0. Preflight
DO $$
BEGIN
  IF to_regclass('public.payment_attempts') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK: forward migration is not applied';
  END IF;
  IF to_regclass('public.rollback_archive_manifest') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK: an archive already exists; resolve it before rolling back again';
  END IF;
  IF to_regclass('public.payment_v4_snapshot_booking_attempts') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK: pre-v4 booking snapshot is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_attempts
             WHERE attempt_number > 1 OR charge_review_status <> 'none'
                OR status IN ('duplicate_paid', 'mismatch_held', 'abandoned')) THEN
    RAISE EXCEPTION 'ROLLBACK: attempts the pre-v4 schema cannot represent exist; manual decision required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.booking_attempts WHERE status = 'under_review') THEN
    RAISE EXCEPTION 'ROLLBACK: bookings under review exist; resolve them first';
  END IF;
END $$;

-- 1. Archive with checksums.
CREATE TABLE public.rollback_archive_payment_attempts AS SELECT * FROM public.payment_attempts;
CREATE TABLE public.rollback_archive_payment_attempt_transitions AS SELECT * FROM public.payment_attempt_transitions;
CREATE TABLE public.rollback_archive_ride_links AS
  SELECT r.ride_id, r.booking_attempt_id, r.payment_attempt_id FROM public.rides r
  WHERE r.booking_attempt_id IS NOT NULL OR r.payment_attempt_id IS NOT NULL;
CREATE TABLE public.rollback_archive_webhook_links AS
  SELECT w.id, w.payment_attempt_id FROM public.webhook_events w WHERE w.payment_attempt_id IS NOT NULL;

CREATE TABLE public.rollback_archive_manifest (
  table_name TEXT PRIMARY KEY,
  row_count BIGINT NOT NULL,
  content_md5 TEXT NOT NULL
);

INSERT INTO public.rollback_archive_manifest (table_name, row_count, content_md5)
SELECT 'payment_attempts', count(*),
       md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id::text), ''))
FROM public.rollback_archive_payment_attempts t;

INSERT INTO public.rollback_archive_manifest (table_name, row_count, content_md5)
SELECT 'payment_attempt_transitions', count(*),
       md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), ''))
FROM public.rollback_archive_payment_attempt_transitions t;

INSERT INTO public.rollback_archive_manifest (table_name, row_count, content_md5)
SELECT 'ride_links', count(*),
       md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.ride_id), ''))
FROM public.rollback_archive_ride_links t;

INSERT INTO public.rollback_archive_manifest (table_name, row_count, content_md5)
SELECT 'webhook_links', count(*),
       md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id::text), ''))
FROM public.rollback_archive_webhook_links t;

-- 2. Drop v4 triggers on pre-v4 tables first, so the restore below does not trip the consistency check.
DROP TRIGGER IF EXISTS booking_attempts_consistent ON public.booking_attempts;
DROP TRIGGER IF EXISTS rides_guard_paid_current_attempt ON public.rides;
DROP TRIGGER IF EXISTS rides_link_immutable ON public.rides;

-- 3. Restore pre-v4 booking status and PaymentIntent from the forward snapshot.
UPDATE public.booking_attempts b
SET status = s.status,
    payment_intent_id = s.payment_intent_id
FROM public.payment_v4_snapshot_booking_attempts s
WHERE s.id = b.id;

-- 4. Drop v4 columns and tables. Dropping a column removes its constraints and indexes.
ALTER TABLE public.rides
  DROP COLUMN booking_attempt_id,
  DROP COLUMN payment_attempt_id;

ALTER TABLE public.webhook_events DROP COLUMN payment_attempt_id;

ALTER TABLE public.booking_attempts DROP COLUMN current_payment_attempt_id;
ALTER TABLE public.booking_attempts DROP CONSTRAINT booking_attempts_id_owner_key;
ALTER TABLE public.booking_attempts DROP CONSTRAINT booking_attempts_status_check;
ALTER TABLE public.booking_attempts ADD CONSTRAINT booking_attempts_status_check
  CHECK (status IN ('pending', 'payment_intent_created', 'succeeded', 'failed', 'canceled',
                    'refunded', 'disputed', 'ride_created'));

DROP TABLE public.payment_attempt_transitions;
DROP TABLE public.payment_attempts;

DROP FUNCTION public.apply_charge_event(varchar, varchar, timestamptz);
DROP FUNCTION public.apply_pi_canceled(varchar, timestamptz);
DROP FUNCTION public.apply_success(varchar, varchar, integer, varchar, timestamptz);
DROP FUNCTION public.process_stripe_event(varchar, varchar, timestamptz, varchar, varchar, uuid, varchar, integer, varchar, varchar);
DROP FUNCTION public.manual_abandon_attempt(uuid);
DROP FUNCTION public.mark_creation_rejected(uuid, varchar);
DROP FUNCTION public.link_payment_intent(uuid, varchar, varchar, integer, varchar, timestamptz);
DROP FUNCTION public.open_payment_attempt(uuid, varchar);
DROP FUNCTION public.create_ride_for_attempt(uuid);
DROP FUNCTION public.rides_guard_paid_current_attempt();
DROP FUNCTION public.rides_link_immutable();
DROP FUNCTION public.trg_booking_consistent();
DROP FUNCTION public.trg_attempt_booking_consistent();
DROP FUNCTION public.reject_log_mutation();
DROP FUNCTION public.payment_attempts_log_transition();
DROP FUNCTION public.payment_attempts_guard_update();
DROP FUNCTION public.payment_attempts_guard_insert();
DROP FUNCTION public.assert_booking_consistent(uuid);
DROP FUNCTION public.refresh_booking_state(uuid);
DROP FUNCTION public.booking_target_state(uuid);
DROP FUNCTION public.payment_attempt_blocks_booking(text, text);
DROP FUNCTION public.payment_transition_allowed(text, text);

-- 5. Post-check: no v4 objects remain; pre-v4 booking statuses match the snapshot.
DO $$
DECLARE
  v_bad bigint;
BEGIN
  IF to_regclass('public.payment_attempts') IS NOT NULL
     OR to_regclass('public.payment_attempt_transitions') IS NOT NULL THEN
    RAISE EXCEPTION 'POSTCHECK: v4 tables still exist';
  END IF;
  SELECT count(*) INTO v_bad
  FROM public.booking_attempts b
  JOIN public.payment_v4_snapshot_booking_attempts s ON s.id = b.id
  WHERE b.status IS DISTINCT FROM s.status OR b.payment_intent_id IS DISTINCT FROM s.payment_intent_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'POSTCHECK: % bookings differ from the pre-v4 snapshot', v_bad;
  END IF;
END $$;

-- 6. Drift manifest of the pre-v4 rows as they stand after rollback. The reversal compares against this.
CREATE TABLE public.rollback_drift_rows (
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_md5 TEXT NOT NULL,
  PRIMARY KEY (table_name, row_key)
);

INSERT INTO public.rollback_drift_rows (table_name, row_key, row_md5)
SELECT 'rides', r.ride_id::text, md5(r::text) FROM public.rides r;
INSERT INTO public.rollback_drift_rows (table_name, row_key, row_md5)
SELECT 'booking_attempts', b.id::text, md5(b::text) FROM public.booking_attempts b;
INSERT INTO public.rollback_drift_rows (table_name, row_key, row_md5)
SELECT 'webhook_events', w.id::text, md5(w::text) FROM public.webhook_events w;

COMMIT;
