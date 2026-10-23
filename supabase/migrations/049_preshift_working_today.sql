-- Run once, after 048. Pre-shift goes to everyone, or to the people working today.
--
--   * New preshift_working_today(rid): who has a published shift starting today, in the restaurant's
--     own time zone (schedule_settings.time_zone; Miami's until it's saved). Drafts don't count.
--     The board then goes to those people the same way a hand-picked list does.
--   * The audience functions from 014 (set_shift_recipients, shift_team_options, shift_recipients)
--     now take the Pre-shift access chip, like the board itself (029). Until now only the owner
--     could load or post the board with an audience. The shift_notes read policy lets them read
--     every board too (can_manage covers the owner, so nothing narrows).
-- No board, shift or person is changed by running this.
begin;

create or replace function public.preshift_working_today(rid uuid)
returns table(user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare tz text; today date;
begin
  if not public.can_manage(rid, 'preshift') then raise exception 'Manager access required' using errcode = '42501'; end if;
  select coalesce(s.time_zone, 'America/New_York') into tz
  from (select 1) one left join public.schedule_settings s on s.restaurant_id = rid;
  begin
    today := (now() at time zone tz)::date;
  exception when others then
    tz := 'America/New_York';
    today := (now() at time zone tz)::date;
  end;
  return query
  select distinct s.user_id from public.schedule_shifts s
  where s.restaurant_id = rid and s.published
    and s.starts_at >= today::timestamp at time zone tz
    and s.starts_at < (today + 1)::timestamp at time zone tz
    and (public.is_on_team(rid, s.user_id) or exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = s.user_id));
end $$;

create or replace function public.set_shift_recipients(note_id uuid, learner_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not exists (select 1 from public.shift_notes n where n.id = note_id and public.can_manage(n.restaurant_id, 'preshift')) then
    raise exception 'Manager access required';
  end if;
  -- Serialize recipient replacements for the same board.
  select n.restaurant_id into rid from public.shift_notes n where n.id = note_id for update;
  if exists (
    select 1 from unnest(learner_ids) as selected(user_id)
    where selected.user_id is null or not (
      exists (select 1 from public.restaurant_members m where m.restaurant_id = rid and m.user_id = selected.user_id)
      or exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = selected.user_id)
    )
  ) then raise exception 'That person is not on this team.'; end if;
  delete from public.shift_note_recipients r where r.shift_note_id = note_id;
  insert into public.shift_note_recipients(shift_note_id, user_id)
  select distinct note_id, selected.user_id from unnest(learner_ids) as selected(user_id);
end;
$$;

create or replace function public.shift_team_options(rid uuid) returns table(user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'preshift') then raise exception 'Manager access required'; end if;
  return query
  select u.id, coalesce(u.raw_user_meta_data->>'display_name', u.email::text)
  from auth.users u join (
    select m.user_id from public.restaurant_members m where m.restaurant_id = rid
    union select r.owner_id from public.restaurants r where r.id = rid
  ) team on team.user_id = u.id
  order by 2, 1;
end;
$$;

create or replace function public.shift_recipients(note_id uuid) returns table(user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.shift_notes n where n.id = note_id and public.can_manage(n.restaurant_id, 'preshift')) then
    raise exception 'Manager access required';
  end if;
  return query
  select u.id, coalesce(u.raw_user_meta_data->>'display_name', u.email::text)
  from public.shift_note_recipients r join auth.users u on u.id = r.user_id
  where r.shift_note_id = note_id order by 2, 1;
end;
$$;

-- Whoever runs pre-shift reads every board, sent to them or not. Without this a manager with the
-- chip (not the owner) couldn't post a new board: the insert can't read back its own row.
drop policy "Members read shift notes" on public.shift_notes;
create policy "Members read shift notes" on public.shift_notes for select to authenticated
using (public.can_manage(restaurant_id, 'preshift') or public.can_read_shift_note(id));

revoke all on function public.preshift_working_today(uuid) from public, anon;
grant execute on function public.preshift_working_today(uuid) to authenticated;
commit;
