-- Phase 2N.4.3 v4 reversal, step C (run AFTER 01_forward.sql restored the data). REVIEW DRAFT: not executed.
-- Verifies the restored state matches the archive exactly. Does not drop the archive; that is a separate approved step.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  v_bad bigint;
  v_manifest record;
  v_booking record;
  v_actual text;
BEGIN
  FOR v_manifest IN SELECT * FROM public.rollback_archive_manifest WHERE table_name = 'payment_attempts' LOOP
    SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id::text), '')) INTO v_actual
    FROM public.payment_attempts t;
    IF v_actual IS DISTINCT FROM v_manifest.content_md5 THEN
      RAISE EXCEPTION 'REVERSAL POSTCHECK: payment_attempts differ from archive';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_bad
  FROM public.rollback_archive_ride_links a
  JOIN public.rides r ON r.ride_id = a.ride_id
  WHERE r.booking_attempt_id IS DISTINCT FROM a.booking_attempt_id
     OR r.payment_attempt_id IS DISTINCT FROM a.payment_attempt_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'REVERSAL POSTCHECK: % ride links differ from archive', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.rollback_archive_webhook_links a
  JOIN public.webhook_events w ON w.id = a.id
  WHERE w.payment_attempt_id IS DISTINCT FROM a.payment_attempt_id;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'REVERSAL POSTCHECK: % webhook links differ from archive', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.rollback_archive_payment_attempt_transitions a
  WHERE NOT EXISTS (SELECT 1 FROM public.payment_attempt_transitions t WHERE t.id = a.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'REVERSAL POSTCHECK: % transition rows missing', v_bad;
  END IF;

  FOR v_booking IN
    SELECT DISTINCT pa.booking_attempt_id AS id FROM public.payment_attempts pa
  LOOP
    PERFORM public.assert_booking_consistent(v_booking.id);
  END LOOP;
END $;

COMMIT;
