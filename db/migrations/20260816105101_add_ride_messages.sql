CREATE TABLE IF NOT EXISTS ride_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES ride_requests(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'driver')),
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ride_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Participants can view ride messages" ON ride_messages;
CREATE POLICY "Participants can view ride messages" ON ride_messages FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM ride_requests
    WHERE ride_requests.id = ride_messages.ride_id
    AND (ride_requests.user_id = auth.uid() OR ride_requests.driver_id = auth.uid())
  )
);
DROP POLICY IF EXISTS "Participants can send ride messages" ON ride_messages;
CREATE POLICY "Participants can send ride messages" ON ride_messages FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM ride_requests
    WHERE ride_requests.id = ride_messages.ride_id
    AND (ride_requests.user_id = auth.uid() OR ride_requests.driver_id = auth.uid())
  )
  AND sender_id = auth.uid()
);
DROP POLICY IF EXISTS "Participants can mark messages read" ON ride_messages;
CREATE POLICY "Participants can mark messages read" ON ride_messages FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM ride_requests
    WHERE ride_requests.id = ride_messages.ride_id
    AND (ride_requests.user_id = auth.uid() OR ride_requests.driver_id = auth.uid())
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM ride_requests
    WHERE ride_requests.id = ride_messages.ride_id
    AND (ride_requests.user_id = auth.uid() OR ride_requests.driver_id = auth.uid())
  )
);
CREATE INDEX IF NOT EXISTS ride_messages_ride_id_idx ON ride_messages (ride_id, created_at);
