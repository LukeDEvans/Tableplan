-- View logos (view-logo.js, Luke 2026-11-04).
--
-- Each person can replace the sailboat on the landing page with their own logo,
-- per view. The logo is kept like the profile photo (2026-10-13-profile-avatars.sql):
-- shrunk on the device, stored in the public `avatars` bucket inside the user's
-- own folder at `<user_id>/logo-<view>.png`, versioned in auth metadata
-- (`logo_v`), and cached on each device — one small download per device per
-- change, nothing on a timer, never in tableplan_states.
--
-- The only change: the bucket also takes PNGs (a logo needs its transparent
-- background). The existing per-folder policies already limit writes to the
-- user's own folder, so no policy changes.

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png']
where id = 'avatars';
