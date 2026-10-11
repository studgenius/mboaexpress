/*
# Multi-service platform: admin, promotions, complaints, commissions

1. New Tables
- `promotions` — discount codes and referral rewards for passengers
- `complaints` — user-submitted complaints about trips, drivers, or service
- `commissions` — per-ride platform commission records
- `service_config` — centralized pricing and rules per service type

2. Modified Tables
- `profiles` — add `admin` to role check constraint

3. Security
- RLS enabled on all new tables
- Promotions: readable by all authenticated, managed by admin only
- Complaints: users manage their own, admins read all
- Commissions: admins read all, drivers read their own
- Service config: all authenticated can read, only admins can write
*/

-- Extend role constraint to include admin
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'profiles_role_check') THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
  END IF;
END $$;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('customer', 'driver', 'owner', 'admin'));

-- Promotions table
CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value integer NOT NULL DEFAULT 0,
  service_type text,
  max_redemptions integer NOT NULL DEFAULT 100,
  redemptions_count integer NOT NULL DEFAULT 0,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can view promotions" ON promotions;
CREATE POLICY "Anyone authenticated can view promotions" ON promotions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert promotions" ON promotions;
CREATE POLICY "Admins can insert promotions" ON promotions FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update promotions" ON promotions;
CREATE POLICY "Admins can update promotions" ON promotions FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can delete promotions" ON promotions;
CREATE POLICY "Admins can delete promotions" ON promotions FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Complaints table
CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  ride_id uuid REFERENCES ride_requests(id) ON DELETE SET NULL,
  subject text NOT NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'driver', 'trip', 'payment', 'safety', 'vehicle')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
  admin_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own complaints" ON complaints;
CREATE POLICY "Users can view own complaints" ON complaints FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Users can create complaints" ON complaints;
CREATE POLICY "Users can create complaints" ON complaints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can update complaints" ON complaints;
CREATE POLICY "Admins can update complaints" ON complaints FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Commissions table
CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid REFERENCES ride_requests(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  fare integer NOT NULL DEFAULT 0,
  commission_rate integer NOT NULL DEFAULT 15,
  commission_amount integer NOT NULL DEFAULT 0,
  driver_payout integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers can view own commissions" ON commissions;
CREATE POLICY "Drivers can view own commissions" ON commissions FOR SELECT TO authenticated USING (
  auth.uid() = driver_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can insert commissions" ON commissions;
CREATE POLICY "Admins can insert commissions" ON commissions FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Service config table
CREATE TABLE IF NOT EXISTS service_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL UNIQUE,
  label text NOT NULL,
  base_fare integer NOT NULL DEFAULT 0,
  per_km_rate integer NOT NULL DEFAULT 0,
  per_minute_rate integer NOT NULL DEFAULT 0,
  min_fare integer NOT NULL DEFAULT 0,
  max_passengers integer NOT NULL DEFAULT 4,
  allows_scheduling boolean NOT NULL DEFAULT false,
  allows_hourly boolean NOT NULL DEFAULT false,
  max_hours integer NOT NULL DEFAULT 12,
  commission_rate integer NOT NULL DEFAULT 15,
  is_active boolean NOT NULL DEFAULT true,
  icon_name text NOT NULL DEFAULT 'CarFront',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE service_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can view service config" ON service_config;
CREATE POLICY "Anyone authenticated can view service config" ON service_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert service config" ON service_config;
CREATE POLICY "Admins can insert service config" ON service_config FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update service config" ON service_config;
CREATE POLICY "Admins can update service config" ON service_config FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Seed default service configs
INSERT INTO service_config (service_type, label, base_fare, per_km_rate, min_fare, max_passengers, allows_scheduling, allows_hourly, max_hours, commission_rate, icon_name) VALUES
  ('standard', 'Standard Ride', 4000, 350, 1500, 4, false, false, 0, 15, 'CarFront'),
  ('coride', 'Co-Ride', 2800, 250, 1000, 4, false, false, 0, 10, 'Users'),
  ('moto', 'Moto Ride', 2400, 200, 1000, 1, false, false, 0, 15, 'Bike'),
  ('private_driver', 'Private Driver', 7000, 500, 5000, 4, true, true, 12, 20, 'Briefcase'),
  ('airport', 'Airport Transfer', 8000, 400, 5000, 4, true, false, 0, 18, 'Plane'),
  ('intercity', 'Intercity', 15000, 300, 10000, 4, true, false, 0, 15, 'Route'),
  ('delivery', 'Delivery', 2000, 150, 1000, 1, false, false, 0, 15, 'Package')
ON CONFLICT (service_type) DO NOTHING;
