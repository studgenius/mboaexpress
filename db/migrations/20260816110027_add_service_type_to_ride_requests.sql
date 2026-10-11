ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'standard' CHECK (
  service_type IN ('standard', 'coride', 'moto', 'private_driver', 'airport', 'intercity', 'delivery')
);
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS flight_number text;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS scheduled_time timestamptz;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS passenger_count integer NOT NULL DEFAULT 1;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS package_description text;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS driver_service_option text CHECK (
  driver_service_option IS NULL OR driver_service_option IN ('driver_only', 'driver_and_vehicle')
);
