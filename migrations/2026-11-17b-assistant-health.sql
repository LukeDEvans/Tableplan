-- Liv health for the assistant connector (DUET_CONNECTOR_DESIGN.md §6; Luke, 2026-11-17).
--
-- One read-only function that gathers how Liv's machinery is doing — background
-- jobs, sync rows, write volume, photo sync, notifications — as METADATA ONLY:
-- times, counts, sizes, statuses. No meal, event, message, money or photo content,
-- no tokens, no secrets. liv-mcp's `liv_health` tool calls it for the admin only
-- (views.js: Luke), so Duet or a chat can spot a stuck job or a sync problem
-- without anyone opening the app or the Supabase dashboard.
--
-- Additive only: one function, service role only (plus the same in-function guard
-- as the connector-key functions, for the window before the revoke runs).

create or replace function public.assistant_health(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_group uuid; v_space uuid; v_out jsonb;
begin
  if coalesce((select auth.role()), 'service_role') <> 'service_role' then
    raise exception 'server only' using errcode = '42501';
  end if;
  select m.group_id into v_group from public.live_group_members m
    where m.user_id = p_user order by m.joined_at asc, m.group_id asc limit 1;
  select s.space_id into v_space from public.live_space_members s
    where s.user_id = p_user order by s.joined_at asc limit 1;

  v_out := jsonb_build_object(
    'checkedAt', now(),

    -- Sync rows this person's views read: section, scope, size, last write.
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', split_part(t.id, ':', 2),
        'scope', case when t.id like 'u-%' then 'personal' when t.id like v_group::text || ':%' then 'household' else 'business' end,
        'bytes', pg_column_size(t.state),
        'updatedAt', t.updated_at) order by t.updated_at desc)
      from public.tableplan_states t
      where t.id like 'u-' || p_user::text || ':%'
         or (v_group is not null and t.id like v_group::text || ':%')
         or (v_space is not null and t.id like v_space::text || ':%')), '[]'::jsonb),

    -- Whole-state snapshots written (one per save burst): a write-volume gauge.
    'historyWrites', jsonb_build_object(
      'last24h', (select count(*) from public.tableplan_state_history h where h.created_at > now() - interval '24 hours'),
      'last7d', (select count(*) from public.tableplan_state_history h where h.created_at > now() - interval '7 days')),

    'financeNightly', (select jsonb_build_object(
        'startedAt', t.state->'startedAt', 'finishedAt', t.state->'finishedAt',
        'ok', t.state->'ok', 'lastGood', t.state->'lastGood', 'error', t.state->'error')
      from public.tableplan_states t where t.id = 'finnightly_status'),

    'newsFeeds', (select jsonb_build_object(
        'runAt', t.state->'runAt',
        'total', jsonb_array_length(coalesce(t.state->'feeds', '[]'::jsonb)),
        'failing', (select coalesce(jsonb_agg(jsonb_build_object('paper', f->>'paper', 'status', f->'status')), '[]'::jsonb)
                    from jsonb_array_elements(coalesce(t.state->'feeds', '[]'::jsonb)) f
                    where (f->>'ok')::boolean is not true))
      from public.tableplan_states t where t.id = 'newsfeeds_status'),

    'newsLatest', (select max(n.discovered_at) from public.news_articles n where n.user_id = p_user),

    'mailSweep', (select jsonb_build_object('enabled', s.enabled, 'lastSweepAt', s.last_sweep_at, 'lockedAt', s.locked_at)
      from public.mail_sweep_state s where s.user_id = p_user),

    'googleCalendar', coalesce((select jsonb_agg(jsonb_build_object('updatedAt', g.updated_at, 'tokenExpiresAt', g.expires_at))
      from public.gcal_accounts g where g.user_id = p_user), '[]'::jsonb),

    'photos', jsonb_build_object(
      'items', (select count(*) from public.photo_items p where p.added_by = p_user and p.deleted_at is null),
      'withThumb', (select count(*) from public.photo_items p where p.added_by = p_user and p.deleted_at is null and p.has_thumb),
      'newestAdded', (select max(p.created_at) from public.photo_items p where p.added_by = p_user),
      'devices', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'lastUsedAt', d.last_used_at))
        from public.photo_sync_devices d where d.user_id = p_user and d.revoked_at is null), '[]'::jsonb)),

    'pushSubscriptions', (select count(*) from public.live_push_subscriptions p where p.user_id = p_user),

    'assistantKeys', coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'lastUsedAt', k.last_used_at))
      from public.assistant_connector_keys k where k.user_id = p_user and k.revoked_at is null), '[]'::jsonb)
  );
  return v_out;
end $$;

revoke all on function public.assistant_health(uuid) from public, anon, authenticated;
grant execute on function public.assistant_health(uuid) to service_role;
