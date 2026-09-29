-- Drop the unused Publications tables (ISSUES.md "Leftovers from removing the
-- standalone Publications page"; NEWS_INTAKE_DESIGN.md §5).
--
-- ⚠️ NOT APPLIED. Run in the Supabase SQL editor only AFTER the code that stopped
-- using these tables is deployed (the 2026-09-29 cleanup: no client or function
-- reads or writes publications / feeds / articles any more).
--
-- Before running, optionally keep a copy of anything still in them:
--   select count(*) from public.publications;
--   select count(*) from public.feeds;
--   select count(*) from public.articles;
--
-- Order matters: feeds and articles reference publications. `if exists` makes
-- this safe to re-run; dropping a table also drops its policies and indexes.

drop table if exists public.articles;
drop table if exists public.feeds;
drop table if exists public.publications;
