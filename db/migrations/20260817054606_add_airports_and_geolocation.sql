/*
# Airport Database and Geolocation Support

1. New Tables
- `airports` — Database of airports in Cameroon with name, IATA code, city, region, latitude, longitude, and active status. Used for airport transfer service to let users pick from real airports.
- `user_locations` — Per-user geolocation tracking (latitude, longitude, city, region, updated_at). Used to match users and drivers within the same geolocalisation zone for airport transfers.

2. Modified Tables
- `ride_requests` — add `airport_id` (uuid, references airports) and `airport_direction` ('pickup' | 'dropoff') columns to support the new airport transfer flow.

3. Security
- RLS enabled on both new tables.
- airports: all authenticated can read; admin can manage.
- user_locations: users manage their own location; admins can read all.
*/

-- Airports table
CREATE TABLE IF NOT EXISTS airports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  iata_code text UNIQUE NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE airports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can view airports" ON airports;
CREATE POLICY "Anyone authenticated can view airports" ON airports FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert airports" ON airports;
CREATE POLICY "Admins can insert airports" ON airports FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update airports" ON airports;
CREATE POLICY "Admins can update airports" ON airports FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Seed Cameroon airports
INSERT INTO airports (name, iata_code, city, region, latitude, longitude) VALUES
  ('Douala International Airport', 'DLA', 'Douala', 'Littoral', 4.0061, 9.7193),
  ('Yaoundé Nsimalen International Airport', 'NSI', 'Yaoundé', 'Centre', 3.7226, 11.5531),
  ('Garoua International Airport', 'GOU', 'Garoua', 'North', 9.3013, 13.7744),
  ('Maroua Salak Airport', 'MVR', 'Maroua', 'Far North', 10.4729, 14.2673),
  ('Bamenda Airport', 'BPC', 'Bamenda', 'North West', 5.9597, 10.1459),
  ('Bafoussam Airport', 'BFX', 'Bafoussam', 'West', 5.4737, 10.4183),
  ('Kribi Airport', 'KBI', 'Kribi', 'South', 2.9434, 9.9140),
  ('Tiko Airport', 'TKC', 'Tiko', 'South West', 4.0736, 9.3636),
  ('Bertoua Airport', 'BTA', 'Bertoua', 'East', 4.5800, 13.6830),
  ('Ngaoundéré Airport', 'NGE', 'Ngaoundéré', 'Adamawa', 7.3528, 13.5639)
ON CONFLICT (iata_code) DO NOTHING;

-- User locations table
CREATE TABLE IF NOT EXISTS user_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  city text,
  region text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own location" ON user_locations;
CREATE POLICY "Users can view own location" ON user_locations FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Users can insert own location" ON user_locations;
CREATE POLICY "Users can insert own location" ON user_locations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own location" ON user_locations;
CREATE POLICY "Users can update own location" ON user_locations FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own location" ON user_locations;
CREATE POLICY "Users can delete own location" ON user_locations FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Add airport_id and airport_direction to ride_requests
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'airport_id') THEN
    ALTER TABLE ride_requests ADD COLUMN airport_id uuid REFERENCES airports(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'airport_direction') THEN
    ALTER TABLE ride_requests ADD COLUMN airport_direction text CHECK (airport_direction IN ('pickup', 'dropoff'));
  END IF;
END $$;

-- Add city and region to profiles for geolocation matching
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'city') THEN
    ALTER TABLE profiles ADD COLUMN city text;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'region') THEN
    ALTER TABLE profiles ADD COLUMN region text;
  END IF;
END $$;
