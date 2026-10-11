/*
# Security SIEM, AI Scanner, Notification Preferences, Languages, Complaint Routing

1. New Tables
- `notification_preferences` — per-user toggles for each notification category (rides, promotions, safety, account, security). Users enable/disable each category.
- `siem_events` — Security Information and Event Management log. Records security events: failed logins, suspicious activity, rate-limit hits, blocked requests, AI-flagged anomalies. Admin-only read.
- `security_scans` — Agentic AI security scan results. Each scan logs inconsistencies found, actions taken (isolated user, blocked request, flagged account), and severity. Admin-only read.
- `isolated_users` — Users temporarily isolated by the agentic AI. Records user_id, reason, isolated_by (ai/admin), isolated_at, released_at.
- `complaint_routes` — AI-complaint routing records. Each complaint can be routed to a governmental board (police, transport regulator, consumer protection, etc.) with status tracking.
- `app_languages` — Database of supported languages for the app. Users pick from this list in their profile.
- `user_languages` — Per-user language preference (one per user).

2. Modified Tables
- `profiles` — add `language` text column (default 'en') and `data_encrypted` boolean (default true) to track privacy encryption status.

3. Security
- RLS enabled on all new tables.
- notification_preferences: users manage their own; admins can read all.
- siem_events: admin-only read; system inserts via service role.
- security_scans: admin-only read; system inserts via service role.
- isolated_users: admin-only read; admin/system can insert/update.
- complaint_routes: users can view their own; admins can view all and update.
- app_languages: all authenticated can read; admin can manage.
- user_languages: users manage their own; admins can read all.
*/
-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_updates boolean NOT NULL DEFAULT true,
  promotions boolean NOT NULL DEFAULT true,
  safety_alerts boolean NOT NULL DEFAULT true,
  account_updates boolean NOT NULL DEFAULT true,
  security_alerts boolean NOT NULL DEFAULT true,
  driver_requests boolean NOT NULL DEFAULT true,
  earnings_updates boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own notification prefs" ON notification_preferences;
CREATE POLICY "Users can view own notification prefs" ON notification_preferences FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Users can insert own notification prefs" ON notification_preferences;
CREATE POLICY "Users can insert own notification prefs" ON notification_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own notification prefs" ON notification_preferences;
CREATE POLICY "Users can update own notification prefs" ON notification_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SIEM events table
CREATE TABLE IF NOT EXISTS siem_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('failed_login', 'suspicious_activity', 'rate_limit_hit', 'blocked_request', 'ai_anomaly', 'data_breach_attempt', 'privilege_escalation', 'sql_injection', 'xss_attempt', 'brute_force')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  ip_address text,
  user_agent text,
  description text NOT NULL,
  metadata jsonb,
  source text NOT NULL DEFAULT 'system',
  status text NOT NULL DEFAULT 'logged' CHECK (status IN ('logged', 'investigating', 'resolved', 'escalated')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE siem_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view siem events" ON siem_events;
CREATE POLICY "Admins can view siem events" ON siem_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can insert siem events" ON siem_events;
CREATE POLICY "Admins can insert siem events" ON siem_events FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update siem events" ON siem_events;
CREATE POLICY "Admins can update siem events" ON siem_events FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_siem_events_created_at ON siem_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_siem_events_severity ON siem_events (severity);

-- Security scans table (agentic AI)
CREATE TABLE IF NOT EXISTS security_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type text NOT NULL CHECK (scan_type IN ('full_scan', 'user_scan', 'ride_scan', 'payment_scan', 'auth_scan', 'behavior_scan')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  anomalies_found integer NOT NULL DEFAULT 0,
  actions_taken integer NOT NULL DEFAULT 0,
  users_isolated integer NOT NULL DEFAULT 0,
  requests_blocked integer NOT NULL DEFAULT 0,
  severity_summary jsonb,
  findings jsonb,
  ai_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE security_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view security scans" ON security_scans;
CREATE POLICY "Admins can view security scans" ON security_scans FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can insert security scans" ON security_scans;
CREATE POLICY "Admins can insert security scans" ON security_scans FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update security scans" ON security_scans;
CREATE POLICY "Admins can update security scans" ON security_scans FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_security_scans_started_at ON security_scans (started_at DESC);

-- Isolated users table
CREATE TABLE IF NOT EXISTS isolated_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text,
  user_email text,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  isolated_by text NOT NULL DEFAULT 'ai' CHECK (isolated_by IN ('ai', 'admin')),
  isolated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  status text NOT NULL DEFAULT 'isolated' CHECK (status IN ('isolated', 'released', 'under_review'))
);
ALTER TABLE isolated_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view isolated users" ON isolated_users;
CREATE POLICY "Admins can view isolated users" ON isolated_users FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can insert isolated users" ON isolated_users;
CREATE POLICY "Admins can insert isolated users" ON isolated_users FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update isolated users" ON isolated_users;
CREATE POLICY "Admins can update isolated users" ON isolated_users FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_isolated_users_status ON isolated_users (status);

-- Complaint routes table (AI routing to governmental boards)
CREATE TABLE IF NOT EXISTS complaint_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  category text NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  routed_to text NOT NULL CHECK (routed_to IN ('police', 'transport_regulator', 'consumer_protection', 'municipal_council', 'gendarmerie', 'ministry_of_transport', 'internal_review')),
  board_name text NOT NULL,
  board_contact text,
  ai_analysis text,
  ai_confidence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'routed' CHECK (status IN ('routed', 'acknowledged', 'under_investigation', 'resolved', 'rejected')),
  board_reference text,
  routed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE complaint_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own complaint routes" ON complaint_routes;
CREATE POLICY "Users can view own complaint routes" ON complaint_routes FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Users can create complaint routes" ON complaint_routes;
CREATE POLICY "Users can create complaint routes" ON complaint_routes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can update complaint routes" ON complaint_routes;
CREATE POLICY "Admins can update complaint routes" ON complaint_routes FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_complaint_routes_status ON complaint_routes (status);

-- App languages table
CREATE TABLE IF NOT EXISTS app_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  native_name text NOT NULL,
  flag_emoji text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_languages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can view languages" ON app_languages;
CREATE POLICY "Anyone authenticated can view languages" ON app_languages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can insert languages" ON app_languages;
CREATE POLICY "Admins can insert languages" ON app_languages FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Admins can update languages" ON app_languages;
CREATE POLICY "Admins can update languages" ON app_languages FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);

-- Seed languages
INSERT INTO app_languages (code, name, native_name, flag_emoji) VALUES
  ('en', 'English', 'English', '🇬🇧'),
  ('fr', 'French', 'Français', '🇫🇷'),
  ('ar', 'Arabic', 'العربية', '🇸🇦'),
  ('fa', 'Fula', 'Fulfulde', '🇨🇲'),
  ('ee', 'Ewondo', 'Ewondo', '🇨🇲'),
  ('du', 'Duala', 'Duala', '🇨🇲'),
  ('ba', 'Bamoun', 'Shüpamom', '🇨🇲'),
  ('sw', 'Swahili', 'Kiswahili', '🇰🇪'),
  ('ha', 'Hausa', 'Hausa', '🇳🇬'),
  ('pt', 'Portuguese', 'Português', '🇵🇹'),
  ('es', 'Spanish', 'Español', '🇪🇸'),
  ('de', 'German', 'Deutsch', '🇩🇪'),
  ('zh', 'Chinese', '中文', '🇨🇳'),
  ('am', 'Amharic', 'አማርኛ', '🇪🇹')
ON CONFLICT (code) DO NOTHING;

-- User language preferences
CREATE TABLE IF NOT EXISTS user_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES app_languages(code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE user_languages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own language" ON user_languages;
CREATE POLICY "Users can view own language" ON user_languages FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Users can insert own language" ON user_languages;
CREATE POLICY "Users can insert own language" ON user_languages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own language" ON user_languages;
CREATE POLICY "Users can update own language" ON user_languages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own language" ON user_languages;
CREATE POLICY "Users can delete own language" ON user_languages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Add language and data_encrypted columns to profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'language') THEN
    ALTER TABLE profiles ADD COLUMN language text NOT NULL DEFAULT 'en';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'data_encrypted') THEN
    ALTER TABLE profiles ADD COLUMN data_encrypted boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Allow users to update their own language and data_encrypted
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);