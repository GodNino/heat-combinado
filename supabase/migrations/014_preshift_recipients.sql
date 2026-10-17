-- Run before deploying app/page.tsx. Empty recipients means the whole team.
begin;
create table public.shift_note_recipients (
  shift_note_id uuid not null references public.shift_notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shift_note_id, user_id)
);
create index on public.shift_note_recipients(user_id);
alter table public.shift_note_recipients enable row level security;
revoke all on public.shift_note_recipients from public, anon, authenticated;

create function public.can_read_shift_note(note_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shift_notes n where n.id = note_id and (
      public.is_restaurant_owner(n.restaurant_id) or (
        public.can_read_restaurant(n.restaurant_id) and (
          not exists (select 1 from public.shift_note_recipients r where r.shift_note_id = n.id)
          or exists (select 1 from public.shift_note_recipients r where r.shift_note_id = n.id and r.user_id = (select auth.uid()))
        )
      )
    )
  );
$$;
revoke all on function public.can_read_shift_note(uuid) from public, anon;
grant execute on function public.can_read_shift_note(uuid) to authenticated;

drop policy if exists "Members read shift notes" on public.shift_notes;
create policy "Members read shift notes" on public.shift_notes for select to authenticated
using (public.is_restaurant_owner(restaurant_id) or public.can_read_shift_note(id));
drop policy if exists "Members read shift entries" on public.shift_board_entries;
create policy "Members read shift entries" on public.shift_board_entries for select to authenticated
using (public.can_read_shift_note(shift_note_id));

create function public.set_shift_recipients(note_id uuid, learner_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if not exists (select 1 from public.shift_notes n where n.id = note_id and public.is_restaurant_owner(n.restaurant_id)) then
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

create function public.shift_team_options(rid uuid) returns table(user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
  return query
  select u.id, coalesce(u.raw_user_meta_data->>'display_name', u.email::text)
  from auth.users u join (
    select m.user_id from public.restaurant_members m where m.restaurant_id = rid
    union select r.owner_id from public.restaurants r where r.id = rid
  ) team on team.user_id = u.id
  order by 2, 1;
end;
$$;

create function public.shift_recipients(note_id uuid) returns table(user_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.shift_notes n where n.id = note_id and public.is_restaurant_owner(n.restaurant_id)) then
    raise exception 'Manager access required';
  end if;
  return query
  select u.id, coalesce(u.raw_user_meta_data->>'display_name', u.email::text)
  from public.shift_note_recipients r join auth.users u on u.id = r.user_id
  where r.shift_note_id = note_id order by 2, 1;
end;
$$;
revoke all on function public.set_shift_recipients(uuid,uuid[]), public.shift_team_options(uuid), public.shift_recipients(uuid) from public, anon, authenticated;
grant execute on function public.set_shift_recipients(uuid,uuid[]), public.shift_team_options(uuid), public.shift_recipients(uuid) to authenticated;
commit;
