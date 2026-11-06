-- Phase 2N.4.3 v4 rehearsal tests. REVIEW DRAFT: not executed.
-- Run only against a Neon branch copy after 01_forward.sql has been applied there.
-- Everything runs inside one transaction that ends in ROLLBACK, so no fixture data persists.
-- Precondition: at least one row in public.drivers (rides reference drivers).
-- Concurrency cases (two sessions racing) are in 05_concurrency.test.mjs.

BEGIN;

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_pattern text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'TEST FAIL: no error (wanted %) for: %', p_pattern, p_sql;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'TEST FAIL%' THEN
    RAISE;
  END IF;
  IF SQLERRM NOT LIKE p_pattern THEN
    RAISE EXCEPTION 'TEST FAIL: wanted %, got "%" for: %', p_pattern, SQLERRM, p_sql;
  END IF;
  RAISE NOTICE 'PASS error: %', p_pattern;
END $f$;

CREATE FUNCTION pg_temp.expect_eq(p_label text, p_actual text, p_expected text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'TEST FAIL %: expected %, got %', p_label, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'PASS %', p_label;
END $f$;

DO $t$
DECLARE
  v_driver integer := (SELECT min(id) FROM public.drivers);
  bA uuid := '10000000-0000-0000-0000-00000000000a';
  bB uuid := '10000000-0000-0000-0000-00000000000b';
  bC uuid := '10000000-0000-0000-0000-00000000000c';
  bD uuid := '10000000-0000-0000-0000-00000000000d';
  bE uuid := '10000000-0000-0000-0000-00000000000e';
  bF uuid := '10000000-0000-0000-0000-00000000000f';
  v_a1 uuid; v_b1 uuid; v_b2 uuid; v_c1 uuid; v_d1 uuid; v_d2 uuid; v_e1 uuid; v_f1 uuid;
  v_n integer; v_created boolean; v_res text; v_status text; v_count bigint; v_t timestamptz := '2030-01-01 00:00:10+00';
  v_pair record;
BEGIN
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: no drivers row available';
  END IF;

  INSERT INTO public.booking_attempts
    (id, clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
     destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status)
  VALUES
    (bA, 'user_a', 'O', 'D', 4.05, 9.70, 4.06, 9.71, 10, v_driver, 1500, 'eur', 'pending'),
    (bB, 'user_b', 'O', 'D', 4.05, 9.70, 4.06, 9.71, 10, v_driver, 1500, 'eur', 'pending'),
    (bC, 'user_c', 'O', 'D', 4.05, 9.70, 4.06, 9.71, 10, v_driver, 1500, 'eur', 'pending'),
    (bD, 'user_d', 'O', 'D', 4.05, 9.70, 4.06, 9.71, 10, v_driver, 1500, 'eur', 'pending'),
    (bE, 'user_e', 'O', 'D', 4.05, 9.70, 4.06, 9.71, 10, v_driver, 1500, 'eur', 'pending'),
    (bF, 'user_f', 'O', 'D', 4.05, 9.70, 4.06, 9.71, 10, v_driver, 1500, 'eur', 'pending');

  -- A. Retry gate, one in-flight attempt, write-once references, ride after success
  SELECT out_attempt_id, out_attempt_number, out_created INTO v_a1, v_n, v_created
  FROM public.open_payment_attempt(bA, 'user_a');
  PERFORM pg_temp.expect_eq('A1 first open', v_n || '/' || v_created, '1/true');

  SELECT out_attempt_id, out_created INTO v_pair FROM public.open_payment_attempt(bA, 'user_a');
  PERFORM pg_temp.expect_eq('A2 second open returns in-flight attempt', (v_pair.out_attempt_id = v_a1)::text || '/' || v_pair.out_created, 'true/false');

  PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.open_payment_attempt(%L, 'user_b')$q$, bA), '%booking_not_found%');
  PERFORM pg_temp.expect_eq('A3 link rejects wrong amount', public.link_payment_intent(v_a1, 'user_a', 'pi_a1', 999, 'eur', v_t), 'rejected_amount');
  PERFORM pg_temp.expect_eq('A4 link rejects wrong owner', public.link_payment_intent(v_a1, 'user_b', 'pi_a1', 1500, 'eur', v_t), 'rejected_owner');
  PERFORM pg_temp.expect_eq('A5 link ok', public.link_payment_intent(v_a1, 'user_a', 'pi_a1', 1500, 'eur', v_t), 'linked');
  PERFORM pg_temp.expect_eq('A6 link replay', public.link_payment_intent(v_a1, 'user_a', 'pi_a1', 1500, 'eur', v_t), 'already_linked');
  PERFORM pg_temp.expect_eq('A7 different PI on linked attempt', public.link_payment_intent(v_a1, 'user_a', 'pi_a1b', 1500, 'eur', v_t), 'rejected_pi_conflict');
  PERFORM pg_temp.expect_error(format($q$UPDATE public.payment_attempts SET payment_intent_id = 'pi_other' WHERE id = %L$q$, v_a1), '%write-once%');
  PERFORM pg_temp.expect_error(format($q$UPDATE public.payment_attempts SET status = 'pending' WHERE id = %L$q$, v_a1), '%forbidden payment attempt transition%');

  PERFORM pg_temp.expect_eq('A8 success', public.apply_success('pi_a1', 'ch_a1', 1500, 'eur', v_t + interval '1 second'), 'succeeded');
  PERFORM pg_temp.expect_eq('A9 duplicate charge event', public.apply_success('pi_a1', 'ch_a1', 1500, 'eur', v_t + interval '1 second'), 'already_applied');
  SELECT count(*) INTO v_count FROM public.rides WHERE booking_attempt_id = bA AND payment_intent_id = 'pi_a1';
  PERFORM pg_temp.expect_eq('A10 one ride created', v_count::text, '1');
  PERFORM pg_temp.expect_error(format($q$INSERT INTO public.payment_attempts (booking_attempt_id, clerk_user_id, attempt_number, status) VALUES (%L, 'user_a', 2, 'pending')$q$, bA), '%payment_blocked%');
  PERFORM pg_temp.expect_error(format($q$SELECT * FROM public.open_payment_attempt(%L, 'user_a')$q$, bA), '%booking_not_retryable%');
  PERFORM pg_temp.expect_eq('A11 booking ride_created', (SELECT status FROM public.booking_attempts WHERE id = bA), 'ride_created');
  PERFORM pg_temp.expect_eq('A12 refund', public.apply_charge_event('ch_a1', 'refunded', v_t + interval '2 seconds'), 'refunded');
  PERFORM pg_temp.expect_eq('A13 booking refunded', (SELECT status FROM public.booking_attempts WHERE id = bA), 'refunded');

  -- B. Late success after cancel, then duplicate payment on the retry, then both refunded manually
  SELECT out_attempt_id INTO v_b1 FROM public.open_payment_attempt(bB, 'user_b');
  PERFORM public.link_payment_intent(v_b1, 'user_b', 'pi_b1', 1500, 'eur', v_t);
  PERFORM pg_temp.expect_eq('B1 cancel', public.apply_pi_canceled('pi_b1', v_t + interval '1 second'), 'canceled');
  SELECT out_attempt_id, out_attempt_number INTO v_b2, v_n FROM public.open_payment_attempt(bB, 'user_b');
  PERFORM pg_temp.expect_eq('B2 retry opens attempt 2', v_n::text, '2');
  PERFORM pg_temp.expect_eq('B3 late success held', public.apply_success('pi_b1', 'ch_b1', 1500, 'eur', v_t + interval '2 seconds'), 'late_success_held');
  PERFORM pg_temp.expect_eq('B4 booking under review', (SELECT status FROM public.booking_attempts WHERE id = bB), 'under_review');
  PERFORM pg_temp.expect_eq('B5 link retry PI', public.link_payment_intent(v_b2, 'user_b', 'pi_b2', 1500, 'eur', v_t + interval '3 seconds'), 'linked');
  PERFORM pg_temp.expect_eq('B6 duplicate payment held', public.apply_success('pi_b2', 'ch_b2', 1500, 'eur', v_t + interval '4 seconds'), 'duplicate_paid_held');
  PERFORM pg_temp.expect_eq('B7 no ride for duplicate', (SELECT count(*)::text FROM public.rides WHERE booking_attempt_id = bB), '0');
  PERFORM pg_temp.expect_eq('B8 refund late hold', public.apply_charge_event('ch_b1', 'refunded', v_t + interval '5 seconds'), 'hold_released');
  PERFORM pg_temp.expect_eq('B9 refund duplicate', public.apply_charge_event('ch_b2', 'refunded', v_t + interval '6 seconds'), 'refunded');
  PERFORM pg_temp.expect_eq('B10 booking refunded after holds cleared', (SELECT status FROM public.booking_attempts WHERE id = bB), 'refunded');

  -- C. Stale and out-of-order cancellation
  SELECT out_attempt_id INTO v_c1 FROM public.open_payment_attempt(bC, 'user_c');
  PERFORM public.link_payment_intent(v_c1, 'user_c', 'pi_c1', 1500, 'eur', v_t);
  PERFORM pg_temp.expect_eq('C1 stale cancel ignored', public.apply_pi_canceled('pi_c1', v_t - interval '5 seconds'), 'stale_ignored');
  PERFORM pg_temp.expect_eq('C2 still open after stale event', (SELECT status FROM public.payment_attempts WHERE id = v_c1), 'payment_intent_created');
  PERFORM pg_temp.expect_error(format($q$UPDATE public.payment_attempts SET last_stripe_event_at = %L WHERE id = %L$q$, v_t - interval '1 hour', v_c1), '%event clock%');
  PERFORM pg_temp.expect_eq('C3 fresh cancel applies', public.apply_pi_canceled('pi_c1', v_t + interval '20 seconds'), 'canceled');
  PERFORM pg_temp.expect_eq('C4 repeat cancel', public.apply_pi_canceled('pi_c1', v_t + interval '21 seconds'), 'already_applied');

  -- D. Definitive creation rejection, retry after failure, terminal attempts never take a PaymentIntent
  SELECT out_attempt_id INTO v_d1 FROM public.open_payment_attempt(bD, 'user_d');
  PERFORM pg_temp.expect_eq('D1 creation rejected', public.mark_creation_rejected(v_d1, 'user_d'), 'failed');
  PERFORM pg_temp.expect_eq('D2 booking failed', (SELECT status FROM public.booking_attempts WHERE id = bD), 'failed');
  SELECT out_attempt_id, out_attempt_number INTO v_d2, v_n FROM public.open_payment_attempt(bD, 'user_d');
  PERFORM pg_temp.expect_eq('D3 retry opens attempt 2', v_n::text, '2');
  PERFORM pg_temp.expect_eq('D4 failed attempt cannot take a PI', public.link_payment_intent(v_d1, 'user_d', 'pi_d1', 1500, 'eur', v_t), 'rejected_terminal');
  PERFORM pg_temp.expect_eq('D5 manual abandon of pending attempt without PI', public.manual_abandon_attempt(v_d2), 'abandoned');
  PERFORM pg_temp.expect_eq('D6 booking failed after abandon', (SELECT status FROM public.booking_attempts WHERE id = bD), 'failed');
  PERFORM pg_temp.expect_eq('D7 abandon refused for settled attempt', public.manual_abandon_attempt(v_a1), 'not_abandonable');

  -- E. Recovery through the webhook entry point, dedupe, retryable unknown PaymentIntent
  SELECT out_attempt_id INTO v_e1 FROM public.open_payment_attempt(bE, 'user_e');
  PERFORM pg_temp.expect_eq('E1 payment_intent.created links',
    public.process_stripe_event('evt_e1', 'payment_intent.created', v_t, 'pi_e1', NULL, v_e1, 'user_e', 1500, 'eur', NULL), 'linked');
  PERFORM pg_temp.expect_eq('E2 redelivered event deduped',
    public.process_stripe_event('evt_e1', 'payment_intent.created', v_t, 'pi_e1', NULL, v_e1, 'user_e', 1500, 'eur', NULL), 'duplicate');
  PERFORM pg_temp.expect_eq('E3 new event, same PI',
    public.process_stripe_event('evt_e1b', 'payment_intent.created', v_t, 'pi_e1', NULL, v_e1, 'user_e', 1500, 'eur', NULL), 'already_linked');
  PERFORM pg_temp.expect_error(
    $q$SELECT public.process_stripe_event('evt_e2', 'payment_intent.succeeded', now(), 'pi_unknown', 'ch_unknown', NULL, NULL, 1500, 'eur', NULL)$q$,
    '%retryable%');
  PERFORM pg_temp.expect_eq('E4 retryable event left no dedupe row',
    (SELECT count(*)::text FROM public.webhook_events WHERE stripe_event_id = 'evt_e2'), '0');
  PERFORM pg_temp.expect_eq('E5 payment_failed recorded only',
    public.process_stripe_event('evt_e3', 'payment_intent.payment_failed', v_t, 'pi_e1', NULL, NULL, NULL, 1500, 'eur', NULL), 'recorded_only');
  PERFORM pg_temp.expect_eq('E6 succeeded via webhook',
    public.process_stripe_event('evt_e4', 'payment_intent.succeeded', v_t + interval '1 second', 'pi_e1', 'ch_e1', NULL, NULL, 1500, 'eur', NULL), 'succeeded');
  PERFORM pg_temp.expect_eq('E7 dispute opened',
    public.process_stripe_event('evt_e5', 'charge.dispute.created', v_t + interval '2 seconds', 'pi_e1', 'ch_e1', NULL, NULL, NULL, NULL, NULL), 'disputed');
  PERFORM pg_temp.expect_eq('E8 dispute won',
    public.process_stripe_event('evt_e6', 'charge.dispute.closed', v_t + interval '3 seconds', 'pi_e1', 'ch_e1', NULL, NULL, NULL, NULL, 'won'), 'dispute_won');
  PERFORM pg_temp.expect_eq('E9 booking ride_created after dispute won', (SELECT status FROM public.booking_attempts WHERE id = bE), 'ride_created');
  PERFORM pg_temp.expect_eq('E10 webhook row bound to attempt',
    (SELECT count(*)::text FROM public.webhook_events WHERE stripe_event_id = 'evt_e4' AND payment_attempt_id = v_e1), '1');

  -- F. Amount mismatch is held, never auto-ridden
  SELECT out_attempt_id INTO v_f1 FROM public.open_payment_attempt(bF, 'user_f');
  PERFORM public.link_payment_intent(v_f1, 'user_f', 'pi_f1', 1500, 'eur', v_t);
  PERFORM pg_temp.expect_eq('F1 amount mismatch held', public.apply_success('pi_f1', 'ch_f1', 999, 'eur', v_t + interval '1 second'), 'amount_mismatch_held');
  PERFORM pg_temp.expect_eq('F2 booking under review', (SELECT status FROM public.booking_attempts WHERE id = bF), 'under_review');
  PERFORM pg_temp.expect_eq('F3 no ride for mismatch', (SELECT count(*)::text FROM public.rides WHERE booking_attempt_id = bF), '0');

  -- G. Whole-database invariant after all scenarios
  FOR v_status IN SELECT id::text FROM public.booking_attempts LOOP
    PERFORM public.assert_booking_consistent(v_status::uuid);
  END LOOP;
  RAISE NOTICE 'PASS G1 all bookings consistent';
END $t$;

ROLLBACK;
