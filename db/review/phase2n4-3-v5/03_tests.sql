-- Phase 2N.4.3 v5 behaviour tests. REVIEW DRAFT. NOT EXECUTED.
-- Run only on a disposable database with 01_forward.sql applied. Each DO block
-- raises on failure. Fixtures are committed, so discard the database afterwards.
-- Concurrency scenarios are in 04_concurrency.test.mjs.

-- T1 cash: confirm, wrong driver, wrong amount, collect once, duplicate, rider dispute.
DO $t$
DECLARE
  drv INTEGER; bk UUID; c TEXT := 'test_cash_' || replace(gen_random_uuid()::text, '-', '');
  r TEXT; cls TEXT; pi TEXT;
BEGIN
  SELECT min(id) INTO drv FROM drivers;
  IF drv IS NULL THEN RAISE EXCEPTION 'TEST PRECONDITION: no driver row'; END IF;
  INSERT INTO booking_attempts (clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status, payment_method_code)
  VALUES (c, 'A', 'B', 0, 0, 1, 1, 10, drv, 1500, 'XAF', 'pending', 'cash') RETURNING id INTO bk;

  r := confirm_cash_booking(bk, c);
  IF r <> 'confirmed' THEN RAISE EXCEPTION 'T1 confirm: %', r; END IF;
  r := record_cash_collection(bk, -1, 'wrong_driver', 1500, 'XAF');
  IF r <> 'driver_mismatch' THEN RAISE EXCEPTION 'T1 driver check: %', r; END IF;
  r := record_cash_collection(bk, drv, 'driver', 1499, 'XAF');
  IF r <> 'amount_mismatch' THEN RAISE EXCEPTION 'T1 amount check: %', r; END IF;
  r := record_cash_collection(bk, drv, 'driver', 1500, 'XAF');
  IF r <> 'collected' THEN RAISE EXCEPTION 'T1 collect: %', r; END IF;
  r := record_cash_collection(bk, drv, 'driver', 1500, 'XAF');
  IF r <> 'already_collected' THEN RAISE EXCEPTION 'T1 duplicate: %', r; END IF;

  BEGIN
    PERFORM respond_cash_collection(bk, 'someone_else', 'disputed');
    RAISE EXCEPTION 'T1 unreachable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'REJECTED%' THEN RAISE; END IF;
  END;

  r := respond_cash_collection(bk, c, 'disputed');
  IF r <> 'disputed' THEN RAISE EXCEPTION 'T1 dispute: %', r; END IF;
  SELECT payment_classification, payment_intent_id INTO cls, pi FROM rides WHERE booking_attempt_id = bk;
  IF cls <> 'native' OR pi IS NOT NULL THEN RAISE EXCEPTION 'T1 ride shape: % %', cls, pi; END IF;
  RAISE NOTICE 'T1 cash: PASS';
END $t$;

-- T2 card: authorize, succeed, duplicate delivery, one ride.
DO $t$
DECLARE
  drv INTEGER; bk UUID; c TEXT := 'test_card_' || replace(gen_random_uuid()::text, '-', '');
  pi TEXT := 'pi_t2_' || replace(gen_random_uuid()::text, '-', ''); evt TEXT := 'evt_t2_' || replace(gen_random_uuid()::text, '-', '');
  n INTEGER; r TEXT;
BEGIN
  SELECT min(id) INTO drv FROM drivers;
  INSERT INTO booking_attempts (clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status, payment_method_code)
  VALUES (c, 'A', 'B', 0, 0, 1, 1, 10, drv, 1500, 'XAF', 'pending', 'card_stripe') RETURNING id INTO bk;

  IF link_payment_intent(bk, c, pi, 1499, 'XAF') <> 'amount_mismatch' THEN RAISE EXCEPTION 'T2 link amount'; END IF;
  IF link_payment_intent(bk, c, pi, 1500, 'XAF') <> 'linked' THEN RAISE EXCEPTION 'T2 link'; END IF;

  r := process_stripe_event(evt || '_a', 'payment_intent.amount_capturable_updated', now(), pi, NULL, NULL, NULL, 1500, 'XAF', 'h1');
  IF r <> 'authorized' THEN RAISE EXCEPTION 'T2 authorize: %', r; END IF;
  r := process_stripe_event(evt || '_b', 'payment_intent.succeeded', now(), pi, 'ch_' || pi, NULL, NULL, 1500, 'XAF', 'h2');
  IF r <> 'succeeded' THEN RAISE EXCEPTION 'T2 succeed: %', r; END IF;
  r := process_stripe_event(evt || '_b', 'payment_intent.succeeded', now(), pi, 'ch_' || pi, NULL, NULL, 1500, 'XAF', 'h2');
  IF r <> 'duplicate' THEN RAISE EXCEPTION 'T2 duplicate: %', r; END IF;
  r := process_stripe_event(evt || '_c', 'payment_intent.succeeded', now(), pi, 'ch_' || pi, NULL, NULL, 1500, 'XAF', 'h3');
  IF r <> 'already_applied' THEN RAISE EXCEPTION 'T2 replay: %', r; END IF;

  SELECT count(*) INTO n FROM rides WHERE booking_attempt_id = bk;
  IF n <> 1 THEN RAISE EXCEPTION 'T2 ride count: %', n; END IF;
  RAISE NOTICE 'T2 card success and duplicate webhook: PASS';
END $t$;

-- T3 failed then late success is held, not applied.
DO $t$
DECLARE
  drv INTEGER; bk UUID; c TEXT := 'test_fail_' || replace(gen_random_uuid()::text, '-', '');
  pi TEXT := 'pi_t3_' || replace(gen_random_uuid()::text, '-', ''); r TEXT; st TEXT;
BEGIN
  SELECT min(id) INTO drv FROM drivers;
  INSERT INTO booking_attempts (clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status, payment_method_code)
  VALUES (c, 'A', 'B', 0, 0, 1, 1, 10, drv, 900, 'XAF', 'pending', 'card_stripe') RETURNING id INTO bk;
  PERFORM link_payment_intent(bk, c, pi, 900, 'XAF');
  r := process_stripe_event('evt_t3_a_' || pi, 'payment_intent.payment_failed', now(), pi, NULL, NULL, NULL, 900, 'XAF', 'h');
  IF r <> 'failed' THEN RAISE EXCEPTION 'T3 failed: %', r; END IF;
  r := process_stripe_event('evt_t3_b_' || pi, 'payment_intent.succeeded', now(), pi, 'ch_t3', NULL, NULL, 900, 'XAF', 'h');
  IF r <> 'held_late_success' THEN RAISE EXCEPTION 'T3 late success: %', r; END IF;
  SELECT status INTO st FROM booking_attempts WHERE id = bk;
  IF st <> 'held_for_review' THEN RAISE EXCEPTION 'T3 status: %', st; END IF;
  RAISE NOTICE 'T3 failed and late success: PASS';
END $t$;

-- T4 authorization release: cancel an uncaptured authorization, no refund.
DO $t$
DECLARE
  drv INTEGER; bk UUID; c TEXT := 'test_rel_' || replace(gen_random_uuid()::text, '-', '');
  pi TEXT := 'pi_t4_' || replace(gen_random_uuid()::text, '-', ''); r TEXT; kinds TEXT;
BEGIN
  SELECT min(id) INTO drv FROM drivers;
  INSERT INTO booking_attempts (clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status, payment_method_code)
  VALUES (c, 'A', 'B', 0, 0, 1, 1, 10, drv, 800, 'XAF', 'pending', 'card_stripe') RETURNING id INTO bk;
  PERFORM link_payment_intent(bk, c, pi, 800, 'XAF');
  PERFORM process_stripe_event('evt_t4_a_' || pi, 'payment_intent.amount_capturable_updated', now(), pi, NULL, NULL, NULL, 800, 'XAF', 'h');
  r := process_stripe_event('evt_t4_b_' || pi, 'payment_intent.canceled', now(), pi, NULL, NULL, NULL, 800, 'XAF', 'h');
  IF r <> 'released' THEN RAISE EXCEPTION 'T4 release: %', r; END IF;
  SELECT string_agg(kind, ',' ORDER BY kind) INTO kinds FROM payment_transactions WHERE booking_attempt_id = bk;
  IF kinds <> 'authorization,release' THEN RAISE EXCEPTION 'T4 ledger: %', kinds; END IF;
  RAISE NOTICE 'T4 authorization release: PASS';
END $t$;

-- T5 refunds: rider request, support approval, processing, webhook success, rule checks.
DO $t$
DECLARE
  drv INTEGER; bk UUID; c TEXT := 'test_ref_' || replace(gen_random_uuid()::text, '-', '');
  pi TEXT := 'pi_t5_' || replace(gen_random_uuid()::text, '-', ''); rid UUID; r TEXT; ok BOOLEAN;
  rf TEXT := 're_t5_' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  SELECT min(id) INTO drv FROM drivers;
  INSERT INTO booking_attempts (clerk_user_id, origin_address, destination_address, origin_latitude, origin_longitude,
    destination_latitude, destination_longitude, ride_time, driver_id, expected_amount, currency, status, payment_method_code)
  VALUES (c, 'A', 'B', 0, 0, 1, 1, 10, drv, 1500, 'XAF', 'pending', 'card_stripe') RETURNING id INTO bk;
  PERFORM link_payment_intent(bk, c, pi, 1500, 'XAF');
  PERFORM process_stripe_event('evt_t5_a_' || pi, 'payment_intent.succeeded', now(), pi, 'ch_t5', NULL, NULL, 1500, 'XAF', 'h');

  ok := false;
  BEGIN PERFORM request_refund(bk, c, 'driver', 500, 'XAF', 'x'); EXCEPTION WHEN raise_exception THEN ok := SQLERRM LIKE 'REJECTED%'; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 driver may not request refund'; END IF;

  ok := false;
  BEGIN PERFORM request_refund(bk, c, 'rider', 1600, 'XAF', 'too much'); EXCEPTION WHEN raise_exception THEN ok := SQLERRM LIKE '%exceeds%'; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 over-refund not blocked'; END IF;

  rid := request_refund(bk, c, 'rider', 500, 'XAF', 'duplicate charge');
  r := decide_refund(rid, 'support_1', 'support', true);
  IF r <> 'approved' THEN RAISE EXCEPTION 'T5 approve: %', r; END IF;
  r := set_refund_processing(rid, rf);
  IF r <> 'processing' THEN RAISE EXCEPTION 'T5 processing: %', r; END IF;
  r := process_stripe_event('evt_t5_r_' || rf, 'refund.updated', now(), NULL, NULL, rf, 'succeeded', 500, 'XAF', 'h');
  IF r <> 'refund_succeeded' THEN RAISE EXCEPTION 'T5 refund: %', r; END IF;
  r := process_stripe_event('evt_t5_r2_' || rf, 'refund.updated', now(), NULL, NULL, rf, 'succeeded', 500, 'XAF', 'h');
  IF r <> 'already_applied' THEN RAISE EXCEPTION 'T5 replay: %', r; END IF;
  RAISE NOTICE 'T5 refunds: PASS';
END $t$;

-- T6 webhook for a PaymentIntent we do not know is retried, not silently recorded.
DO $t$
DECLARE evt TEXT := 'evt_t6_' || replace(gen_random_uuid()::text, '-', ''); ok BOOLEAN := false; n INTEGER;
BEGIN
  BEGIN
    PERFORM process_stripe_event(evt, 'payment_intent.succeeded', now(), 'pi_unknown_t6', 'ch_t6', NULL, NULL, 100, 'XAF', 'h');
  EXCEPTION WHEN raise_exception THEN ok := SQLERRM LIKE 'RETRYABLE%';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 unknown PI must be retryable'; END IF;
  SELECT count(*) INTO n FROM webhook_events WHERE stripe_event_id = evt;
  IF n <> 0 THEN RAISE EXCEPTION 'T6 dedupe row must roll back'; END IF;
  RAISE NOTICE 'T6 retryable unknown PaymentIntent: PASS';
END $t$;

-- T7 legacy rides are immutable on payment fields.
DO $t$
DECLARE ok BOOLEAN := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rides WHERE payment_classification = 'legacy_unknown') THEN
    RAISE NOTICE 'T7 skipped: no legacy rides present';
    RETURN;
  END IF;
  BEGIN
    UPDATE rides SET payment_method_code = 'cash' WHERE payment_classification = 'legacy_unknown';
  EXCEPTION WHEN raise_exception THEN ok := SQLERRM LIKE '%immutable%';
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T7 legacy payment fields changed'; END IF;
  RAISE NOTICE 'T7 legacy immutability: PASS';
END $t$;
