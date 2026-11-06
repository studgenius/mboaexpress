-- Phase 2N.3: Booking attempts and webhook event idempotency
--
-- Creates two new tables:
--   1. booking_attempts — durable pre-payment record that associates a
--      PaymentIntent with all data needed to recover a booking after
--      3DS redirects, page reloads, or webhook delivery.
--   2. webhook_events — idempotency log for Stripe webhook processing,
--      preventing duplicate processing of retried events.
--
-- Both tables are additive. No existing table is altered. No data is
-- deleted or rewritten. Rollback: DROP TABLE booking_attempts;
-- DROP TABLE webhook_events;

CREATE TABLE IF NOT EXISTS booking_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) NOT NULL,
  payment_intent_id VARCHAR(255) UNIQUE,
  origin_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  origin_latitude DOUBLE PRECISION NOT NULL,
  origin_longitude DOUBLE PRECISION NOT NULL,
  destination_latitude DOUBLE PRECISION NOT NULL,
  destination_longitude DOUBLE PRECISION NOT NULL,
  ride_time INTEGER NOT NULL,
  driver_id INTEGER NOT NULL,
  expected_amount INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'eur',
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'payment_intent_created', 'succeeded', 'failed', 'canceled', 'refunded', 'disputed', 'ride_created')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_attempts_user
  ON booking_attempts (clerk_user_id);

CREATE INDEX IF NOT EXISTS idx_booking_attempts_pi
  ON booking_attempts (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_attempts_status
  ON booking_attempts (status);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  payment_intent_id VARCHAR(255),
  processed BOOLEAN NOT NULL DEFAULT false,
  result_status VARCHAR(50),
  result_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id
  ON webhook_events (stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_pi
  ON webhook_events (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
