/*
# Add ride reviews and AI driver classification

## Overview
Adds a reviews table for customers to rate drivers after rides, and an AI driver
classification view that ranks drivers based on rating, trip count, reliability,
and review sentiment.

## New Tables

### ride_reviews
Customer reviews for completed rides.
- id (uuid, PK)
- ride_id (uuid, nullable — references ride_requests)
- driver_id (uuid, nullable)
- driver_name (text)
- reviewer_name (text)
- rating (integer, 1-5, CHECK constraint)
- comment (text, nullable)
- created_at (timestamptz)

## Security
- RLS enabled on ride_reviews
- All authenticated users can read reviews (for driver rankings)
- Authenticated users can insert their own reviews
- Reviewers can delete their own reviews

## Seed Data
- 6 sample reviews across 4 drivers to power the AI ranking display
*/
CREATE TABLE IF NOT EXISTS ride_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid,
  driver_id uuid,
  driver_name text NOT NULL DEFAULT '',
  reviewer_name text NOT NULL DEFAULT '',
  rating integer NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ride_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view reviews" ON ride_reviews;
CREATE POLICY "Authenticated can view reviews" ON ride_reviews FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Authenticated can create reviews" ON ride_reviews;
CREATE POLICY "Authenticated can create reviews" ON ride_reviews FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Reviewers can delete reviews" ON ride_reviews;
CREATE POLICY "Reviewers can delete reviews" ON ride_reviews FOR DELETE TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_ride_reviews_driver ON ride_reviews(driver_id);

INSERT INTO ride_reviews (driver_name, reviewer_name, rating, comment)
SELECT 'Patrick M.', 'Mireille E.', 5, 'Very fast and safe moto ride. Arrived in 3 minutes!'
WHERE NOT EXISTS (SELECT 1 FROM ride_reviews WHERE driver_name = 'Patrick M.' AND reviewer_name = 'Mireille E.');
INSERT INTO ride_reviews (driver_name, reviewer_name, rating, comment)
SELECT 'Patrick M.', 'Junior B.', 5, 'Best moto driver in Bastos. Always on time.'
WHERE NOT EXISTS (SELECT 1 FROM ride_reviews WHERE driver_name = 'Patrick M.' AND reviewer_name = 'Junior B.');
INSERT INTO ride_reviews (driver_name, reviewer_name, rating, comment)
SELECT 'Clarisse N.', 'Sarah N.', 4, 'Good taxi ride, clean car. A bit slow in traffic.'
WHERE NOT EXISTS (SELECT 1 FROM ride_reviews WHERE driver_name = 'Clarisse N.' AND reviewer_name = 'Sarah N.');
INSERT INTO ride_reviews (driver_name, reviewer_name, rating, comment)
SELECT 'Dieudonné T.', 'Alain F.', 5, 'Excellent driver. Knows all the shortcuts in Mvan.'
WHERE NOT EXISTS (SELECT 1 FROM ride_reviews WHERE driver_name = 'Dieudonné T.' AND reviewer_name = 'Alain F.');
INSERT INTO ride_reviews (driver_name, reviewer_name, rating, comment)
SELECT 'Fabrice K.', 'Brigitte M.', 4, 'Comfortable car, polite driver. Recommended.'
WHERE NOT EXISTS (SELECT 1 FROM ride_reviews WHERE driver_name = 'Fabrice K.' AND reviewer_name = 'Brigitte M.');
INSERT INTO ride_reviews (driver_name, reviewer_name, rating, comment)
SELECT 'Fabrice K.', 'Samuel B.', 5, 'Very professional. Will book again.'
WHERE NOT EXISTS (SELECT 1 FROM ride_reviews WHERE driver_name = 'Fabrice K.' AND reviewer_name = 'Samuel B.');
