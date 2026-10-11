/*
# Add authentication, profiles, co-riding services, and driver earnings

## Overview
Transforms the app into an authenticated platform with three user roles:
- Customers: book rides (moto/taxi/car) and find co-rides (shared private vehicles)
- Drivers: go online/offline, accept ride requests, track earnings and wallet
- Private owners: offer co-riding/carpooling services with scheduled departures

## New Tables

### profiles
User profile and role assignment. Auto-created via trigger on signup.
- id (uuid, PK, references auth.users ON DELETE CASCADE)
- full_name (text), phone (text)
- role (text: customer | driver | owner) with CHECK constraint
- vehicle_type, vehicle_plate (nullable, for drivers/owners)
- is_online (boolean, default false — driver availability toggle)
- rating (numeric, default 5.0), total_trips (integer, default 0)
- created_at (timestamptz)

### corides
Co-riding offers from private owners (shared rides with scheduled departures).
- id (uuid, PK), owner_id (uuid, defaults to auth.uid()), owner_name (text)
- pickup, destination (text), departure_time (timestamptz)
- total_seats, available_seats (integer), price_per_seat (integer, XAF)
- vehicle_info (text), status (text: open | full | departed | cancelled)
- created_at (timestamptz)

### coride_bookings
Passenger seat reservations on co-rides.
- id (uuid, PK), coride_id (uuid), passenger_id (uuid, defaults to auth.uid())
- passenger_name (text), seats_booked (integer)
- status (text: confirmed | cancelled), payment_method (text)
- created_at (timestamptz)

### driver_earnings
Individual earning entries for drivers, categorized by payment method.
- id (uuid, PK), driver_id (uuid, defaults to auth.uid())
- amount (integer, XAF), payment_method (text), description (text)
- created_at (timestamptz)

## Modified Tables

### ride_requests
- Added user_id (uuid, defaults to auth.uid()) — the customer who requested
- Added driver_id (uuid, nullable) — the driver who accepted
- Added driver_name (text, nullable)
- RLS policies updated from public-anon to authenticated-ownership

## Security Changes
- RLS enabled on all new and modified tables
- Auto profile creation trigger (SECURITY DEFINER, search_path=public)
  reads full_name, phone, role from raw_user_meta_data on signup
- profiles: all authenticated can read (for names); users can insert/update own
- ride_requests: all authenticated can view (for dispatch); owner can insert/delete;
  owner + assigned driver can update
- corides: all authenticated can view; owner can insert/update/delete
- coride_bookings: all authenticated can view; passenger can insert/update/delete own
- driver_earnings: driver can view/insert/update/delete own

## Demo Data
- 4 sample co-rides seeded for the browsing experience
- 3 sample ride requests seeded for the dispatch view
*/
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'driver', 'owner')),
  vehicle_type text,
  vehicle_plate text,
  is_online boolean NOT NULL DEFAULT false,
  rating numeric NOT NULL DEFAULT 5.0,
  total_trips integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view profiles" ON profiles;
CREATE POLICY "Authenticated can view profiles" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'customer')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS driver_id uuid;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS driver_name text;
DROP POLICY IF EXISTS "Public can view ride requests" ON ride_requests;
DROP POLICY IF EXISTS "Public can create ride requests" ON ride_requests;
DROP POLICY IF EXISTS "Public can update ride requests" ON ride_requests;
DROP POLICY IF EXISTS "Public can delete ride requests" ON ride_requests;
DROP POLICY IF EXISTS "Authenticated can view ride requests" ON ride_requests;
CREATE POLICY "Authenticated can view ride requests" ON ride_requests FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can create own ride requests" ON ride_requests;
CREATE POLICY "Users can create own ride requests" ON ride_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own ride requests" ON ride_requests;
CREATE POLICY "Users can update own ride requests" ON ride_requests FOR UPDATE TO authenticated USING (auth.uid() = user_id OR auth.uid() = driver_id) WITH CHECK (auth.uid() = user_id OR auth.uid() = driver_id);
DROP POLICY IF EXISTS "Users can delete own ride requests" ON ride_requests;
CREATE POLICY "Users can delete own ride requests" ON ride_requests FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS corides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid DEFAULT auth.uid(),
  owner_name text NOT NULL DEFAULT '',
  pickup text NOT NULL,
  destination text NOT NULL,
  departure_time timestamptz NOT NULL,
  total_seats integer NOT NULL DEFAULT 4,
  available_seats integer NOT NULL DEFAULT 4,
  price_per_seat integer NOT NULL DEFAULT 0,
  vehicle_info text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'departed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE corides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view corides" ON corides;
CREATE POLICY "Authenticated can view corides" ON corides FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Owners can create corides" ON corides;
CREATE POLICY "Owners can create corides" ON corides FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Owners can update corides" ON corides;
CREATE POLICY "Owners can update corides" ON corides FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Owners can delete corides" ON corides;
CREATE POLICY "Owners can delete corides" ON corides FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS idx_corides_status ON corides(status);
CREATE INDEX IF NOT EXISTS idx_corides_owner ON corides(owner_id);

CREATE TABLE IF NOT EXISTS coride_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coride_id uuid NOT NULL,
  passenger_id uuid DEFAULT auth.uid(),
  passenger_name text NOT NULL DEFAULT '',
  seats_booked integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  payment_method text NOT NULL DEFAULT 'Cash',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coride_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can view coride bookings" ON coride_bookings;
CREATE POLICY "Authenticated can view coride bookings" ON coride_bookings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Passengers can create bookings" ON coride_bookings;
CREATE POLICY "Passengers can create bookings" ON coride_bookings FOR INSERT TO authenticated WITH CHECK (auth.uid() = passenger_id);
DROP POLICY IF EXISTS "Passengers can update bookings" ON coride_bookings;
CREATE POLICY "Passengers can update bookings" ON coride_bookings FOR UPDATE TO authenticated USING (auth.uid() = passenger_id) WITH CHECK (auth.uid() = passenger_id);
DROP POLICY IF EXISTS "Passengers can delete bookings" ON coride_bookings;
CREATE POLICY "Passengers can delete bookings" ON coride_bookings FOR DELETE TO authenticated USING (auth.uid() = passenger_id);
CREATE INDEX IF NOT EXISTS idx_coride_bookings_coride ON coride_bookings(coride_id);
CREATE INDEX IF NOT EXISTS idx_coride_bookings_passenger ON coride_bookings(passenger_id);

CREATE TABLE IF NOT EXISTS driver_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL DEFAULT auth.uid(),
  amount integer NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'Cash',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE driver_earnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers can view own earnings" ON driver_earnings;
CREATE POLICY "Drivers can view own earnings" ON driver_earnings FOR SELECT TO authenticated USING (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can insert own earnings" ON driver_earnings;
CREATE POLICY "Drivers can insert own earnings" ON driver_earnings FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can update own earnings" ON driver_earnings;
CREATE POLICY "Drivers can update own earnings" ON driver_earnings FOR UPDATE TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can delete own earnings" ON driver_earnings;
CREATE POLICY "Drivers can delete own earnings" ON driver_earnings FOR DELETE TO authenticated USING (auth.uid() = driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_earnings_driver ON driver_earnings(driver_id);

INSERT INTO corides (owner_name, pickup, destination, departure_time, total_seats, available_seats, price_per_seat, vehicle_info, status)
SELECT 'Samuel B.', 'Bastos', 'Douala (Akwa)', now() + interval '2 hours', 4, 2, 3500, 'Toyota Corolla, grey', 'open'
WHERE NOT EXISTS (SELECT 1 FROM corides WHERE owner_name = 'Samuel B.' AND pickup = 'Bastos' AND destination = 'Douala (Akwa)');
INSERT INTO corides (owner_name, pickup, destination, departure_time, total_seats, available_seats, price_per_seat, vehicle_info, status)
SELECT 'Rita K.', 'Mvan', 'Yaounde CBD', now() + interval '1 hour', 3, 1, 1500, 'Hyundai i10, white', 'open'
WHERE NOT EXISTS (SELECT 1 FROM corides WHERE owner_name = 'Rita K.' AND pickup = 'Mvan' AND destination = 'Yaounde CBD');
INSERT INTO corides (owner_name, pickup, destination, departure_time, total_seats, available_seats, price_per_seat, vehicle_info, status)
SELECT 'Jean-Paul O.', 'Bonapriso', 'Nkongsamba', now() + interval '4 hours', 4, 3, 5000, 'Toyota Hilux, blue', 'open'
WHERE NOT EXISTS (SELECT 1 FROM corides WHERE owner_name = 'Jean-Paul O.' AND pickup = 'Bonapriso' AND destination = 'Nkongsamba');
INSERT INTO corides (owner_name, pickup, destination, departure_time, total_seats, available_seats, price_per_seat, vehicle_info, status)
SELECT 'Brigitte M.', 'Mokolo', 'Yaounde (Mvan)', now() + interval '45 minutes', 2, 2, 1200, 'Suzuki Alto, red', 'open'
WHERE NOT EXISTS (SELECT 1 FROM corides WHERE owner_name = 'Brigitte M.' AND pickup = 'Mokolo' AND destination = 'Yaounde (Mvan)');
INSERT INTO ride_requests (pickup, destination, vehicle_type, payment_method, fare, status, driver_name)
SELECT 'Carrefour Bastos', 'Hôtel La Falaise, Akwa', 'Moto', 'MTN MoMo', 2400, 'completed', 'Patrick M.'
WHERE NOT EXISTS (SELECT 1 FROM ride_requests WHERE pickup = 'Carrefour Bastos' AND driver_name = 'Patrick M.');
INSERT INTO ride_requests (pickup, destination, vehicle_type, payment_method, fare, status, driver_name)
SELECT 'Bonapriso', 'Mvan Market', 'Taxi', 'Orange Money', 4800, 'completed', 'Clarisse N.'
WHERE NOT EXISTS (SELECT 1 FROM ride_requests WHERE pickup = 'Bonapriso' AND driver_name = 'Clarisse N.');
INSERT INTO ride_requests (pickup, destination, vehicle_type, payment_method, fare, status)
SELECT 'Omnisport', 'Essos', 'Moto', 'Cash', 1800, 'searching'
WHERE NOT EXISTS (SELECT 1 FROM ride_requests WHERE pickup = 'Omnisport' AND destination = 'Essos' AND status = 'searching');
