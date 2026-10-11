/*
# Add driver hourly rates and SOS alerts

## New Tables

### driver_hourly_rates
Drivers set their hourly rate and discounts for longer bookings.
- id (uuid, PK)
- driver_id (uuid, defaults to auth.uid())
- vehicle_type (text: Moto | Taxi | Car)
- base_hourly_rate (integer, XAF per hour)
- discount_2h (integer, % discount for 2h booking)
- discount_4h (integer, % discount for 4h booking)
- discount_8h (integer, % discount for 8h / half-day booking)
- created_at, updated_at (timestamptz)

### sos_alerts
AI-powered SOS alerts sent to nearby police stations based on user geolocation.
- id (uuid, PK)
- user_id (uuid, defaults to auth.uid())
- user_name (text)
- latitude (numeric), longitude (numeric)
- location_name (text)
- status (text: active | resolved | dispatched)
- ai_analysis (text — AI risk assessment)
- notified_stations (text — comma-separated police station names)
- created_at (timestamptz)

## Security
- RLS enabled on both tables
- driver_hourly_rates: driver owns their rows (CRUD)
- sos_alerts: user owns their rows (CRUD), all authenticated can read (for safety visibility)

## Seed Data
- Sample hourly rates for 4 drivers
- 2 sample police stations reference data (stored as sos_alerts with resolved status for demo)
*/
CREATE TABLE IF NOT EXISTS driver_hourly_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL DEFAULT auth.uid(),
  vehicle_type text NOT NULL DEFAULT 'Moto',
  base_hourly_rate integer NOT NULL DEFAULT 3000,
  discount_2h integer NOT NULL DEFAULT 5,
  discount_4h integer NOT NULL DEFAULT 10,
  discount_8h integer NOT NULL DEFAULT 15,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE driver_hourly_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers can view own rates" ON driver_hourly_rates;
CREATE POLICY "Drivers can view own rates" ON driver_hourly_rates FOR SELECT TO authenticated USING (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can insert own rates" ON driver_hourly_rates;
CREATE POLICY "Drivers can insert own rates" ON driver_hourly_rates FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can update own rates" ON driver_hourly_rates;
CREATE POLICY "Drivers can update own rates" ON driver_hourly_rates FOR UPDATE TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can delete own rates" ON driver_hourly_rates;
CREATE POLICY "Drivers can delete own rates" ON driver_hourly_rates FOR DELETE TO authenticated USING (auth.uid() = driver_id);

CREATE TABLE IF NOT EXISTS sos_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_name text NOT NULL DEFAULT '',
  latitude numeric NOT NULL DEFAULT 3.8480,
  longitude numeric NOT NULL DEFAULT 11.5021,
  location_name text NOT NULL DEFAULT 'Yaoundé, Cameroon',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'dispatched')),
  ai_analysis text NOT NULL DEFAULT '',
  notified_stations text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sos_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view SOS alerts" ON sos_alerts;
CREATE POLICY "Authenticated can view SOS alerts" ON sos_alerts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can create SOS alerts" ON sos_alerts;
CREATE POLICY "Users can create SOS alerts" ON sos_alerts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own SOS alerts" ON sos_alerts;
CREATE POLICY "Users can update own SOS alerts" ON sos_alerts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own SOS alerts" ON sos_alerts;
CREATE POLICY "Users can delete own SOS alerts" ON sos_alerts FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_user ON sos_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_sos_alerts_status ON sos_alerts(status);

INSERT INTO driver_hourly_rates (driver_id, vehicle_type, base_hourly_rate, discount_2h, discount_4h, discount_8h)
SELECT '00000000-0000-0000-0000-000000000001', 'Moto', 2500, 5, 10, 15
WHERE NOT EXISTS (SELECT 1 FROM driver_hourly_rates WHERE driver_id = '00000000-0000-0000-0000-000000000001');
INSERT INTO driver_hourly_rates (driver_id, vehicle_type, base_hourly_rate, discount_2h, discount_4h, discount_8h)
SELECT '00000000-0000-0000-0000-000000000002', 'Taxi', 5000, 8, 12, 20
WHERE NOT EXISTS (SELECT 1 FROM driver_hourly_rates WHERE driver_id = '00000000-0000-0000-0000-000000000002');
INSERT INTO driver_hourly_rates (driver_id, vehicle_type, base_hourly_rate, discount_2h, discount_4h, discount_8h)
SELECT '00000000-0000-0000-0000-000000000003', 'Car', 7000, 10, 15, 25
WHERE NOT EXISTS (SELECT 1 FROM driver_hourly_rates WHERE driver_id = '00000000-0000-0000-0000-000000000003');
INSERT INTO driver_hourly_rates (driver_id, vehicle_type, base_hourly_rate, discount_2h, discount_4h, discount_8h)
SELECT '00000000-0000-0000-0000-000000000004', 'Moto', 2200, 5, 8, 12
WHERE NOT EXISTS (SELECT 1 FROM driver_hourly_rates WHERE driver_id = '00000000-0000-0000-0000-000000000004');
