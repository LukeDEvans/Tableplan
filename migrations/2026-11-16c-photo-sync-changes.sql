-- Photo sync: changes and deletions from the phone (PHOTOS_DESIGN.md §18; Luke, 2026-11-16).
--
-- The first two migrations let a phone ADD its photos. This lets it keep them matched
-- afterwards, so Liv shows what the phone's library shows:
--   • photo_sync_update — a photo the phone changed (favourited, edited, date or place
--     fixed): its details as the phone has them now. It also clears the source's
--     missing_at, since the phone has the photo (put back from Recently Deleted).
--   • photo_sync_gone — photos deleted on the phone (in the Photos app, or from Liv,
--     which asks iOS): the phone's source is marked missing, and the photo goes to
--     Liv's Recently deleted unless another source still has it.
-- Like the others, only the server may call them, and a device only reaches photos it
-- added itself (its source row) in its owner's library. Neither changes a photo's
-- scope, author, or deleted_at of a photo another source still holds; neither
-- un-deletes a photo (putting one back is the person's own choice, in Liv).
--
-- Additive: two functions.

create or replace function public.photo_sync_update(p_device uuid, p_secret_hash text, p_items jsonb)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare d record; n integer;
begin
  select * into d from public.photo_sync_device(p_device, p_secret_hash);
  if d.user_id is null then raise exception 'unknown device' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'bad batch' using errcode = '22023';
  end if;

  update public.photo_items i set
    favorite = coalesce(r.favorite, i.favorite),
    is_screenshot = coalesce(r.is_screenshot, i.is_screenshot),
    is_live = coalesce(r.is_live, i.is_live),
    burst_id = r.burst_id,
    taken_at = coalesce(r.taken_at, i.taken_at),
    width = coalesce(r.width, i.width),
    height = coalesce(r.height, i.height),
    duration = case when i.kind = 'video' then coalesce(r.duration, i.duration) else i.duration end,
    bytes = coalesce(r.bytes, i.bytes),
    lat = r.lat,
    lng = r.lng
  from jsonb_to_recordset(p_items) as r(id uuid, favorite boolean, is_screenshot boolean, is_live boolean, burst_id text,
       taken_at timestamptz, width integer, height integer, duration real, bytes bigint, lat double precision, lng double precision)
  where i.id = r.id and i.added_by = d.user_id
    and exists (select 1 from public.photo_sources s where s.photo_id = i.id and s.kind = 'iphone' and s.device_key = d.device_key);
  get diagnostics n = row_count;

  update public.photo_sources s set missing_at = null
  from jsonb_to_recordset(p_items) as r(id uuid)
  where s.photo_id = r.id and s.kind = 'iphone' and s.device_key = d.device_key and s.missing_at is not null;

  return n;
end $$;
revoke all on function public.photo_sync_update(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.photo_sync_gone(p_device uuid, p_secret_hash text, p_ids uuid[])
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare d record; n integer;
begin
  select * into d from public.photo_sync_device(p_device, p_secret_hash);
  if d.user_id is null then raise exception 'unknown device' using errcode = '42501'; end if;
  if cardinality(p_ids) > 200 then raise exception 'bad batch' using errcode = '22023'; end if;

  update public.photo_sources s set missing_at = coalesce(s.missing_at, now())
  from public.photo_items i
  where s.photo_id = any (p_ids) and s.kind = 'iphone' and s.device_key = d.device_key
    and i.id = s.photo_id and i.added_by = d.user_id;

  update public.photo_items i set deleted_at = now()
  where i.id = any (p_ids) and i.added_by = d.user_id and i.deleted_at is null
    and exists (select 1 from public.photo_sources s where s.photo_id = i.id and s.kind = 'iphone' and s.device_key = d.device_key)
    and not exists (select 1 from public.photo_sources s where s.photo_id = i.id and s.missing_at is null);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.photo_sync_gone(uuid, text, uuid[]) from public, anon, authenticated;

grant execute on function public.photo_sync_update(uuid, text, jsonb), public.photo_sync_gone(uuid, text, uuid[]) to service_role;
