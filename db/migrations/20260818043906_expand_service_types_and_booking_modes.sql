/*
# Expand service types and booking modes

1. Modified Tables
- `ride_requests` — add columns for the expanded service architecture:
  - `trip_type` text: for private driver — 'one_way', 'round_trip', 'hourly', 'full_day', 'return_later', 'multi_day'
  - `intercity_mode` text: for intercity — 'private', 'shared'
  - `delivery_vehicle` text: for delivery — 'moto', 'car'
  - `moto_pro` boolean: to distinguish Moto Pro from regular Moto
  - `private_driver_scope` text: for private driver — 'city', 'intercity'

2. Update service_type constraint to allow new values
*/
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'trip_type') THEN
    ALTER TABLE ride_requests ADD COLUMN trip_type text CHECK (trip_type IN ('one_way', 'round_trip', 'hourly', 'full_day', 'return_later', 'multi_day'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'intercity_mode') THEN
    ALTER TABLE ride_requests ADD COLUMN intercity_mode text CHECK (intercity_mode IN ('private', 'shared'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'delivery_vehicle') THEN
    ALTER TABLE ride_requests ADD COLUMN delivery_vehicle text CHECK (delivery_vehicle IN ('moto', 'car'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'moto_pro') THEN
    ALTER TABLE ride_requests ADD COLUMN moto_pro boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ride_requests' AND column_name = 'private_driver_scope') THEN
    ALTER TABLE ride_requests ADD COLUMN private_driver_scope text CHECK (private_driver_scope IN ('city', 'intercity'));
  END IF;
END $$;
