-- liv_health reports the podcast-upcoming job (ISSUES P3 2026-11-19; Luke 2026-11-24).
--
-- The job (supabase/functions/podcast-upcoming) writes its run to the server-only row
-- `podcastupcoming_status`, but assistant_health() didn't include it, so a stuck job
-- only showed as the series hold quietly switching off. This adds a 'podcastUpcoming'
-- key: times, ok, and the job's own counts. Metadata only, like the rest.
--
-- Patched in place from the live definition (as 2026-11-17f did), so it can't undo a
-- change made to the function since 2026-11-17b. Idempotent; no DROP.

do $$
declare def text; fixed text;
begin
  def := pg_get_functiondef('public.assistant_health(uuid)'::regprocedure);
  if position('podcastUpcoming' in def) > 0 then return; end if;
  fixed := replace(def, $x$'pushSubscriptions',$x$, $x$'podcastUpcoming', (select jsonb_build_object(
        'startedAt', t.state->'startedAt', 'finishedAt', t.state->'finishedAt',
        'ok', t.state->'ok', 'lastGood', t.state->'lastGood',
        'feeds', t.state->'feeds', 'failed', t.state->'failed', 'listed', t.state->'listed',
        'unlisted', t.state->'unlisted', 'upcoming', t.state->'upcoming', 'candidates', t.state->'candidates')
      from public.tableplan_states t where t.id = 'podcastupcoming_status'),

    'pushSubscriptions',$x$);
  if fixed = def then raise exception 'assistant_health: anchor not found'; end if;
  execute fixed;
end $$;
