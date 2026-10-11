/*
# Create provider onboarding, compliance, safety, and quality system

1. New Tables
- `provider_applications`: one application per account with selected services, lifecycle, compliance status, and review notes.
- `provider_services`: services a provider wants to offer, including eligibility and activation state.
- `provider_vehicles`: provider-owned vehicles and service-specific vehicle information.
- `provider_documents`: protected document metadata, expiration, verification, and rejection details.
- `provider_requirements`: configurable requirement results per provider and service.
- `safety_trainings`: safety course completion and assessment records.
- `emergency_contacts`: provider emergency contacts.
- `incident_reports`: safety incidents linked to providers and rides.
- `provider_audit_logs`: immutable-style operational history for provider decisions.
- `provider_quality_scores`: explainable score, tier, ratings, incidents, and compliance metrics.

2. Modified Tables
- `profiles`: add provider status and activation fields without changing existing passenger or driver data.

3. Security
- All new tables enable RLS.
- Providers can access only their own records.
- Admins can review and manage provider records through role-checked policies.
- Document file paths are metadata only; actual files remain in protected storage.

4. Important Notes
- Completing onboarding never grants access by itself.
- Provider acceptance must require `compliance_status = active` and a service eligibility row marked active.
- Expiration and suspension statuses are represented explicitly for future automated enforcement.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS provider_status text NOT NULL DEFAULT 'pending' CHECK (provider_status IN ('pending','documents_required','under_review','approved','active','expiring','restricted','suspended','rejected','deactivated'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS provider_activated_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS provider_quality_tier text NOT NULL DEFAULT 'pending' CHECK (provider_quality_tier IN ('pending','verified','active','trusted','restricted','suspended','deactivated'));

CREATE TABLE IF NOT EXISTS provider_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  lifecycle_stage text NOT NULL DEFAULT 'registered' CHECK (lifecycle_stage IN ('registered','application','documents_submitted','verification','safety_check','admin_approval','active','can_go_online')),
  compliance_status text NOT NULL DEFAULT 'pending' CHECK (compliance_status IN ('pending','documents_required','under_review','approved','active','expiring','restricted','suspended','rejected','deactivated')),
  selected_services text[] NOT NULL DEFAULT '{}',
  identity_verified boolean NOT NULL DEFAULT false,
  credentials_verified boolean NOT NULL DEFAULT false,
  vehicle_verified boolean NOT NULL DEFAULT false,
  insurance_verified boolean NOT NULL DEFAULT false,
  authorization_verified boolean NOT NULL DEFAULT false,
  safety_training_completed boolean NOT NULL DEFAULT false,
  eligibility_checked boolean NOT NULL DEFAULT false,
  admin_reviewed_by uuid REFERENCES auth.users(id),
  admin_reviewed_at timestamptz,
  review_notes text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  eligibility_status text NOT NULL DEFAULT 'pending' CHECK (eligibility_status IN ('pending','eligible','restricted','rejected')),
  is_active boolean NOT NULL DEFAULT false,
  operating_cities text[] NOT NULL DEFAULT '{}',
  max_trip_distance_km integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, service_type)
);

CREATE TABLE IF NOT EXISTS provider_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('Moto','Taxi','Car','Other')),
  make text NOT NULL,
  model text NOT NULL,
  year integer,
  color text,
  registration_number text NOT NULL,
  vin text,
  seat_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expiring','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES provider_vehicles(id) ON DELETE SET NULL,
  document_type text NOT NULL,
  document_number text,
  document_file_path text,
  issue_date date,
  expiry_date date,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','expiring','expired')),
  verified_by uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  requirement_code text NOT NULL,
  requirement_label text NOT NULL,
  requirement_group text NOT NULL DEFAULT 'service',
  is_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'missing' CHECK (status IN ('missing','pending','passed','failed','expired')),
  checked_at timestamptz,
  UNIQUE(provider_id, service_type, requirement_code)
);

CREATE TABLE IF NOT EXISTS safety_trainings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  training_type text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  score integer,
  completed_at timestamptz,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, training_type)
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  relationship text NOT NULL,
  phone text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ride_id uuid REFERENCES ride_requests(id) ON DELETE SET NULL,
  reporter_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('accident','driver_behaviour','harassment','unsafe_driving','wrong_vehicle','suspicious_activity','payment_dispute','lost_property','other')),
  description text NOT NULL,
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaging','investigating','resolved','closed')),
  immediate_action text,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS provider_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  action text NOT NULL,
  from_status text,
  to_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_quality_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  tier text NOT NULL DEFAULT 'pending' CHECK (tier IN ('pending','verified','active','trusted','restricted','suspended','deactivated')),
  average_rating numeric(3,2) NOT NULL DEFAULT 0,
  completed_trips integer NOT NULL DEFAULT 0,
  cancellation_rate numeric(5,2) NOT NULL DEFAULT 0,
  serious_incidents integer NOT NULL DEFAULT 0,
  document_compliance numeric(5,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_services_provider_idx ON provider_services(provider_id);
CREATE INDEX IF NOT EXISTS provider_documents_expiry_idx ON provider_documents(expiry_date);
CREATE INDEX IF NOT EXISTS provider_requirements_lookup_idx ON provider_requirements(provider_id, service_type, status);
CREATE INDEX IF NOT EXISTS incident_reports_status_idx ON incident_reports(status, risk_level);

ALTER TABLE provider_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_quality_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "providers_read_own_applications" ON provider_applications;
CREATE POLICY "providers_read_own_applications" ON provider_applications FOR SELECT TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "providers_insert_own_applications" ON provider_applications;
CREATE POLICY "providers_insert_own_applications" ON provider_applications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "providers_update_own_applications" ON provider_applications;
CREATE POLICY "providers_update_own_applications" ON provider_applications FOR UPDATE TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')) WITH CHECK (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "providers_delete_own_applications" ON provider_applications;
CREATE POLICY "providers_delete_own_applications" ON provider_applications FOR DELETE TO authenticated USING (auth.uid() = user_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_services','provider_vehicles','provider_documents','provider_requirements','safety_trainings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "owner_select_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "owner_select_%s" ON %I FOR SELECT TO authenticated USING (auth.uid() = provider_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = ''admin''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "owner_insert_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "owner_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (auth.uid() = provider_id)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "owner_update_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "owner_update_%s" ON %I FOR UPDATE TO authenticated USING (auth.uid() = provider_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = ''admin'')) WITH CHECK (auth.uid() = provider_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = ''admin''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "owner_delete_%s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "owner_delete_%s" ON %I FOR DELETE TO authenticated USING (auth.uid() = provider_id)', t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "users_manage_emergency_contacts" ON emergency_contacts;
CREATE POLICY "users_manage_emergency_contacts" ON emergency_contacts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "users_insert_emergency_contacts" ON emergency_contacts;
CREATE POLICY "users_insert_emergency_contacts" ON emergency_contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users_update_emergency_contacts" ON emergency_contacts;
CREATE POLICY "users_update_emergency_contacts" ON emergency_contacts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "users_delete_emergency_contacts" ON emergency_contacts;
CREATE POLICY "users_delete_emergency_contacts" ON emergency_contacts FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "incident_participants_read" ON incident_reports;
CREATE POLICY "incident_participants_read" ON incident_reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR auth.uid() = provider_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "users_create_incidents" ON incident_reports;
CREATE POLICY "users_create_incidents" ON incident_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
DROP POLICY IF EXISTS "incident_admin_update" ON incident_reports;
CREATE POLICY "incident_admin_update" ON incident_reports FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "provider_audit_read" ON provider_audit_logs;
CREATE POLICY "provider_audit_read" ON provider_audit_logs FOR SELECT TO authenticated USING (auth.uid() = provider_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "provider_audit_insert" ON provider_audit_logs;
CREATE POLICY "provider_audit_insert" ON provider_audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "quality_read" ON provider_quality_scores;
CREATE POLICY "quality_read" ON provider_quality_scores FOR SELECT TO authenticated USING (auth.uid() = provider_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "quality_admin_insert" ON provider_quality_scores;
CREATE POLICY "quality_admin_insert" ON provider_quality_scores FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
DROP POLICY IF EXISTS "quality_admin_update" ON provider_quality_scores;
CREATE POLICY "quality_admin_update" ON provider_quality_scores FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
