-- Rolling cloud backup history for each household.
-- The app inserts at most once per hour and keeps the 25 most recent entries.

CREATE TABLE IF NOT EXISTS tableplan_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_history_group
  ON tableplan_state_history (group_id, created_at DESC);

ALTER TABLE tableplan_state_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read group history"
  ON tableplan_state_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM live_group_members
      WHERE live_group_members.group_id = tableplan_state_history.group_id
        AND live_group_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can insert group history"
  ON tableplan_state_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM live_group_members
      WHERE live_group_members.group_id = tableplan_state_history.group_id
        AND live_group_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can delete group history"
  ON tableplan_state_history FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM live_group_members
      WHERE live_group_members.group_id = tableplan_state_history.group_id
        AND live_group_members.user_id = auth.uid()
    )
  );

-- ── Data API grants ─────────────────────────────────────────────────────────
-- Explicit grants (from 2026-10-30 Supabase no longer auto-grants new public tables to the Data
-- API on 2026-10-30). Least-privilege: matches the RLS policies above; RLS still
-- decides which rows. No anon grant — the app never reads these signed-out.
grant select, insert, delete on tableplan_state_history to authenticated;
grant select, insert, update, delete on tableplan_state_history to service_role;
