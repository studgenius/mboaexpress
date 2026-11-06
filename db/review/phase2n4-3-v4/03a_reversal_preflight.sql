-- Phase 2N.4.3 v4 reversal, step A (run BEFORE 01_forward.sql). REVIEW DRAFT: not executed.
-- Drift check: live pre-v4 rows must match the rollback drift manifest exactly, and the archive must match its checksums.
-- Run in a maintenance window with application writes paused, then run 01_forward.sql, then 03b_reversal_postcheck.sql.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  v_actual_md5 text;
  v_manifest record;
  v_drift bigint;
BEGIN
  IF to_regclass('public.rollback_archive_manifest') IS NULL THEN
    RAISE EXCEPTION 'REVERSAL: no archive to restore';
  END IF;
  IF to_regclass('public.payment_attempts') IS NOT NULL THEN
    RAISE EXCEPTION 'REVERSAL: forward migration already applied';
  END IF;

  FOR v_manifest IN SELECT * FROM public.rollback_archive_manifest LOOP
    IF v_manifest.table_name = 'payment_attempts' THEN
      SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id::text), '')) INTO v_actual_md5
      FROM public.rollback_archive_payment_attempts t;
    ELSIF v_manifest.table_name = 'payment_attempt_transitions' THEN
      SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) INTO v_actual_md5
      FROM public.rollback_archive_payment_attempt_transitions t;
    ELSIF v_manifest.table_name = 'ride_links' THEN
      SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.ride_id), '')) INTO v_actual_md5
      FROM public.rollback_archive_ride_links t;
    ELSIF v_manifest.table_name = 'webhook_links' THEN
      SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id::text), '')) INTO v_actual_md5
      FROM public.rollback_archive_webhook_links t;
    ELSE
      RAISE EXCEPTION 'REVERSAL: unknown manifest entry %', v_manifest.table_name;
    END IF;
    IF v_actual_md5 IS DISTINCT FROM v_manifest.content_md5 THEN
      RAISE EXCEPTION 'REVERSAL: archive checksum mismatch for %', v_manifest.table_name;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_drift FROM (
    SELECT 'rides' AS t, r.ride_id::text AS k, md5(r::text) AS h FROM public.rides r
    UNION ALL
    SELECT 'booking_attempts', b.id::text, md5(b::text) FROM public.booking_attempts b
    UNION ALL
    SELECT 'webhook_events', w.id::text, md5(w::text) FROM public.webhook_events w
  ) live
  FULL OUTER JOIN public.rollback_drift_rows d ON d.table_name = live.t AND d.row_key = live.k
  WHERE live.h IS DISTINCT FROM d.row_md5;

  IF v_drift > 0 THEN
    RAISE EXCEPTION 'REVERSAL: % pre-v4 rows changed since rollback; manual review required', v_drift;
  END IF;
END $$;

COMMIT;
