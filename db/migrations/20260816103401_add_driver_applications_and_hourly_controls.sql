CREATE TABLE IF NOT EXISTS driver_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('Moto', 'Taxi', 'Car')),
  vehicle_model text NOT NULL,
  license_plate text NOT NULL,
  license_number text NOT NULL,
  license_expiry date,
  insurance_provider text NOT NULL,
  background_check_consent boolean NOT NULL DEFAULT false,
  safety_quiz_confirmed boolean NOT NULL DEFAULT false,
  terms_accepted boolean NOT NULL DEFAULT false,
  subscription_plan text NOT NULL DEFAULT 'basic' CHECK (subscription_plan IN ('basic', 'pro', 'fleet')),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'under_review', 'approved', 'rejected')),
  ai_photo_status text NOT NULL DEFAULT 'not_started' CHECK (ai_photo_status IN ('not_started', 'queued', 'passed', 'needs_review')),
  government_verification_status text NOT NULL DEFAULT 'not_started' CHECK (government_verification_status IN ('not_started', 'queued', 'verified', 'needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE driver_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers can view own applications" ON driver_applications;
CREATE POLICY "Drivers can view own applications" ON driver_applications FOR SELECT TO authenticated USING (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can create own applications" ON driver_applications;
CREATE POLICY "Drivers can create own applications" ON driver_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can update own applications" ON driver_applications;
CREATE POLICY "Drivers can update own applications" ON driver_applications FOR UPDATE TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can delete own applications" ON driver_applications;
CREATE POLICY "Drivers can delete own applications" ON driver_applications FOR DELETE TO authenticated USING (auth.uid() = driver_id);

CREATE TABLE IF NOT EXISTS driver_vehicle_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES driver_applications(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_type text NOT NULL CHECK (photo_type IN ('inside', 'outside_front', 'outside_back', 'outside_side', 'license_document', 'insurance_document')),
  storage_path text NOT NULL,
  review_status text NOT NULL DEFAULT 'queued' CHECK (review_status IN ('queued', 'passed', 'needs_review')),
  ai_notes text NOT NULL DEFAULT 'AI photo review queued',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE driver_vehicle_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Drivers can view own vehicle photos" ON driver_vehicle_photos;
CREATE POLICY "Drivers can view own vehicle photos" ON driver_vehicle_photos FOR SELECT TO authenticated USING (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can create own vehicle photos" ON driver_vehicle_photos;
CREATE POLICY "Drivers can create own vehicle photos" ON driver_vehicle_photos FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can update own vehicle photos" ON driver_vehicle_photos;
CREATE POLICY "Drivers can update own vehicle photos" ON driver_vehicle_photos FOR UPDATE TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can delete own vehicle photos" ON driver_vehicle_photos;
CREATE POLICY "Drivers can delete own vehicle photos" ON driver_vehicle_photos FOR DELETE TO authenticated USING (auth.uid() = driver_id);

ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS booking_mode text NOT NULL DEFAULT 'single' CHECK (booking_mode IN ('single', 'hourly'));
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS requested_hours integer NOT NULL DEFAULT 1 CHECK (requested_hours BETWEEN 1 AND 12);
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS approved_hours integer NOT NULL DEFAULT 1 CHECK (approved_hours BETWEEN 1 AND 12);
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS hourly_rate integer;
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS extension_requested_hours integer CHECK (extension_requested_hours BETWEEN 1 AND 12);
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS extension_status text NOT NULL DEFAULT 'none' CHECK (extension_status IN ('none', 'pending', 'accepted', 'declined'));
ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS extension_requested_at timestamptz;

CREATE TABLE IF NOT EXISTS hourly_booking_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_hours integer NOT NULL CHECK (requested_hours BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
ALTER TABLE hourly_booking_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Customers and drivers can view extensions" ON hourly_booking_extensions;
CREATE POLICY "Customers and drivers can view extensions" ON hourly_booking_extensions FOR SELECT TO authenticated USING (auth.uid() = customer_id OR auth.uid() = driver_id);
DROP POLICY IF EXISTS "Customers can request extensions" ON hourly_booking_extensions;
CREATE POLICY "Customers can request extensions" ON hourly_booking_extensions FOR INSERT TO authenticated WITH CHECK (auth.uid() = customer_id AND requested_hours BETWEEN 1 AND 12);
DROP POLICY IF EXISTS "Drivers can respond to extensions" ON hourly_booking_extensions;
CREATE POLICY "Drivers can respond to extensions" ON hourly_booking_extensions FOR UPDATE TO authenticated USING (auth.uid() = driver_id) WITH CHECK (auth.uid() = driver_id AND status IN ('accepted', 'declined'));
DROP POLICY IF EXISTS "Customers can cancel extensions" ON hourly_booking_extensions;
CREATE POLICY "Customers can cancel extensions" ON hourly_booking_extensions FOR DELETE TO authenticated USING (auth.uid() = customer_id AND status = 'pending');

INSERT INTO storage.buckets (id, name, public) VALUES ('driver-documents', 'driver-documents', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Drivers can upload own documents" ON storage.objects;
CREATE POLICY "Drivers can upload own documents" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Drivers can view own documents" ON storage.objects;
CREATE POLICY "Drivers can view own documents" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Drivers can update own documents" ON storage.objects;
CREATE POLICY "Drivers can update own documents" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "Drivers can delete own documents" ON storage.objects;
CREATE POLICY "Drivers can delete own documents" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
