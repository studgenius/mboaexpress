/*
# Create ride requests for the Nyuon dispatch demo

1. New Tables
- `ride_requests`
- `id` (uuid, primary key)
- `pickup` (text, pickup location)
- `destination` (text, destination location)
- `vehicle_type` (text, car/taxi/moto selection)
- `payment_method` (text, cash or mobile money selection)
- `fare` (integer, quoted fare in XAF)
- `status` (text, current request status)
- `created_at` (timestamp, request creation time)

2. Security
- Enable RLS on `ride_requests`.
- Allow anonymous and authenticated users to create and view shared demo ride requests.
- Allow anonymous and authenticated users to update or delete demo ride requests.

3. Important Notes
- This is intentionally a single-tenant demo data model because no sign-in flow was requested.
- Monetary values are stored as whole XAF amounts.
*/

CREATE TABLE IF NOT EXISTS ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup text NOT NULL,
  destination text NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'Moto',
  payment_method text NOT NULL DEFAULT 'Cash',
  fare integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'searching',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ride_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view ride requests" ON ride_requests;
CREATE POLICY "Public can view ride requests" ON ride_requests FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can create ride requests" ON ride_requests;
CREATE POLICY "Public can create ride requests" ON ride_requests FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Public can update ride requests" ON ride_requests;
CREATE POLICY "Public can update ride requests" ON ride_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public can delete ride requests" ON ride_requests;
CREATE POLICY "Public can delete ride requests" ON ride_requests FOR DELETE TO anon, authenticated USING (true);
