-- Run once, after 055. The pre-shift board belongs to the restaurant's own day.
--
-- The board's day was the database's current_date, which is UTC. In Miami that turns over at 8pm
-- (7pm in winter), so in the middle of dinner service the board jumped to tomorrow: the team's
-- phones showed an empty pre-shift and the manager's next post went to the wrong day.
--
--   * restaurant_today(rid): today's date where the restaurant is (schedule_settings.time_zone;
--     Miami's until it's saved, and Miami's if the saved zone isn't a real one).
--   * get_preshift_board and save_preshift_board use it instead of current_date. Nothing else in
--     them changes. Boards already posted keep the date they were posted under.
begin;

create or replace function public.restaurant_today(rid uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare tz text;
begin
  select coalesce(s.time_zone, 'America/New_York') into tz
  from (select 1) one left join public.schedule_settings s on s.restaurant_id = rid;
  begin
    return (now() at time zone tz)::date;
  exception when others then
    return (now() at time zone 'America/New_York')::date;
  end;
end $$;
revoke all on function public.restaurant_today(uuid) from public, anon;
grant execute on function public.restaurant_today(uuid) to authenticated;

create or replace function public.get_preshift_board(rid uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'service_date', public.restaurant_today(rid),
    'board', (select to_jsonb(n) || jsonb_build_object(
      'focus_item_ids', (
        select coalesce(jsonb_agg(f.menu_item_id order by f.sort_order, f.menu_item_id), '[]'::jsonb)
        from public.shift_focus_items f where f.shift_note_id = n.id
      ),
      'entries', (
        select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
        from public.shift_board_entries e where e.shift_note_id = n.id
      )
    ) from public.shift_notes n where n.restaurant_id = rid and n.service_date = public.restaurant_today(rid))
  );
$$;

create or replace function public.save_preshift_board(
  rid uuid, board_date date, board_note text, focus_ids uuid[], board_entries jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare board_id uuid; today date := public.restaurant_today(rid);
begin
  if not public.can_manage(rid, 'preshift') then
    raise exception 'You do not have access to the pre-shift board.' using errcode = '42501';
  end if;
  if board_date is distinct from today then
    raise exception 'The service day has changed. Reload today''s board before posting.';
  end if;
  if board_entries is null or jsonb_typeof(board_entries) <> 'array' then
    raise exception 'Board entries must be a list.' using errcode = '23514';
  end if;
  if coalesce(array_length(focus_ids, 1), 0) > 10 then
    raise exception 'A board can hold up to 10 focus items.' using errcode = '23514';
  end if;

  insert into public.shift_notes(restaurant_id, service_date, note, focus_item_id, posted_by)
  values(rid, today, board_note, focus_ids[1], auth.uid())
  on conflict (restaurant_id, service_date) do update
  set note = excluded.note, focus_item_id = excluded.focus_item_id, posted_by = excluded.posted_by
  returning id into board_id;

  delete from public.shift_focus_items where shift_note_id = board_id;
  insert into public.shift_focus_items(shift_note_id, menu_item_id, sort_order)
  select board_id, f.id, min(f.ord)::smallint
  from unnest(focus_ids) with ordinality as f(id, ord)
  where f.id is not null
  group by f.id;

  delete from public.shift_board_entries where shift_note_id = board_id;
  insert into public.shift_board_entries(shift_note_id, menu_item_id, status, detail)
  select board_id, e.menu_item_id, e.status, coalesce(e.detail, '')
  from jsonb_to_recordset(board_entries) as e(menu_item_id uuid, status text, detail text);
  return board_id;
end;
$$;

commit;
