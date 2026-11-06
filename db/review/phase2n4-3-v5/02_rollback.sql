-- Phase 2N.4.3 v5 rollback. REVIEW DRAFT. NOT EXECUTED.
-- Reverses 01_forward.sql. Never drops rides, booking_attempts or webhook_events rows.
-- Every v5-only record is copied to an archive schema with a per-row md5 manifest
-- before its live object is dropped. Run only after the pre-flight checks in the
-- README (deployment step 6) have passed on the same database.

-- 0. Refuse when live rows use statuses the pre-v5 schema cannot hold.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM booking_attempts
    WHERE status NOT IN ('pending','payment_intent_created','succeeded','failed','canceled',
                         'refunded','disputed','ride_created')
  ) THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED: booking_attempts has v5-only statuses; resolve them manually first';
  END IF;
END $$;

-- 1. Archive v5-only data with hashes.
CREATE SCHEMA IF NOT EXISTS phase2n4_3_v5_archive;

CREATE TABLE phase2n4_3_v5_archive.manifest (
  archived_table TEXT NOT NULL,
  row_key TEXT NOT NULL,
  row_md5 TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (archived_table, row_key)
);

CREATE TABLE phase2n4_3_v5_archive.payment_transactions AS TABLE payment_transactions;
CREATE TABLE phase2n4_3_v5_archive.cash_collections AS TABLE cash_collections;
CREATE TABLE phase2n4_3_v5_archive.refund_requests AS TABLE refund_requests;
CREATE TABLE phase2n4_3_v5_archive.payment_methods AS TABLE payment_methods;

CREATE TABLE phase2n4_3_v5_archive.webhook_audit AS
  SELECT stripe_event_id, provider, payload_sha256, processed_at FROM webhook_events;
CREATE TABLE phase2n4_3_v5_archive.ride_v5_fields AS
  SELECT id, payment_classification, payment_method_code, payment_currency,
         booking_attempt_id, settlement_status FROM rides;
CREATE TABLE phase2n4_3_v5_archive.booking_v5_fields AS
  SELECT id, payment_method_code, currency FROM booking_attempts;

INSERT INTO phase2n4_3_v5_archive.manifest (archived_table, row_key, row_md5)
SELECT 'payment_transactions', id::text, md5(t::text) FROM payment_transactions t
UNION ALL
SELECT 'cash_collections', id::text, md5(c::text) FROM cash_collections c
UNION ALL
SELECT 'refund_requests', id::text, md5(r::text) FROM refund_requests r
UNION ALL
SELECT 'ride_v5_fields', id::text, md5(x::text) FROM phase2n4_3_v5_archive.ride_v5_fields x
UNION ALL
SELECT 'booking_v5_fields', id::text, md5(x::text) FROM phase2n4_3_v5_archive.booking_v5_fields x;

-- 2. Drop v5 functions and triggers.
DROP TRIGGER IF EXISTS payment_transactions_append_only ON payment_transactions;
DROP TRIGGER IF EXISTS rides_enforce_payment_rules_trg ON rides;
DROP TRIGGER IF EXISTS booking_attempts_require_method_trg ON booking_attempts;

DROP FUNCTION IF EXISTS set_refund_processing(UUID, TEXT);
DROP FUNCTION IF EXISTS decide_refund(UUID, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS request_refund(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS respond_cash_collection(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS record_cash_collection(UUID, INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS confirm_cash_booking(UUID, TEXT);
DROP FUNCTION IF EXISTS process_stripe_event(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_ride_from_booking(booking_attempts, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS link_payment_intent(UUID, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS rides_enforce_payment_rules();
DROP FUNCTION IF EXISTS booking_attempts_require_method();
DROP FUNCTION IF EXISTS reject_ledger_mutation();

-- 3. Drop v5 tables (data is archived above).
DROP TABLE IF EXISTS refund_requests;
DROP TABLE IF EXISTS cash_collections;
DROP TABLE IF EXISTS payment_transactions;

-- 4. Restore pre-v5 columns and constraints.
DROP INDEX IF EXISTS rides_booking_attempt_id_unique_idx;
ALTER TABLE rides
  DROP CONSTRAINT IF EXISTS rides_payment_status_chk,
  DROP COLUMN IF EXISTS settlement_status,
  DROP COLUMN IF EXISTS booking_attempt_id,
  DROP COLUMN IF EXISTS payment_currency,
  DROP COLUMN IF EXISTS payment_method_code,
  DROP COLUMN IF EXISTS payment_classification;

ALTER TABLE booking_attempts
  DROP CONSTRAINT IF EXISTS booking_attempts_currency_chk,
  DROP CONSTRAINT IF EXISTS booking_attempts_amount_positive_chk,
  DROP CONSTRAINT IF EXISTS booking_attempts_status_check,
  DROP COLUMN IF EXISTS payment_method_code;
ALTER TABLE booking_attempts
  ALTER COLUMN currency SET DEFAULT 'eur',
  ADD CONSTRAINT booking_attempts_status_check CHECK (status IN (
    'pending','payment_intent_created','succeeded','failed','canceled','refunded','disputed','ride_created'));

ALTER TABLE webhook_events
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS payload_sha256,
  DROP COLUMN IF EXISTS processed_at;

DROP TABLE IF EXISTS payment_methods;

ALTER TABLE booking_attempts DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE rides DISABLE ROW LEVEL SECURITY;

-- 5. Archive schema is kept. Dropping it is a separate, explicitly approved step.
