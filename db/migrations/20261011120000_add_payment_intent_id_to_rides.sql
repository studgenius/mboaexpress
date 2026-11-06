-- Phase 2N.2: Add payment_intent_id column to rides table
-- Links each ride to its Stripe PaymentIntent for server-side payment verification.
-- Nullable for backward compatibility with existing ride records.
-- UNIQUE constraint allows multiple NULLs (Postgres default behavior) but
-- prevents duplicate non-NULL PaymentIntent IDs, guarding against duplicate rides.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS payment_intent_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS rides_payment_intent_id_unique_idx
  ON rides (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
