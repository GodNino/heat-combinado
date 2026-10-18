-- Run once, after 038. Phone notifications (web push).
--
-- push_subscriptions holds each device a person turned notifications on for, with the language it
-- should speak. Only its owner can see or remove it; the sending route (app/api/notify) reads it
-- with the server's own key after push_audience below has said who may be told what.
--
-- Events, and who hears about them:
--   preshift_posted   the board's recipients, or the whole team when none were picked
--   study_assigned    the person whose study was assigned
--   urgent_report     everyone the shift report goes to (owner, brand owner, Pre-shift or Team access)
--   retake_requested  the owner and the brand owner, who approve retakes
-- Additive only: one new table and two functions.
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  lang text not null default 'en' check (lang in ('en', 'es')),
  created_at timestamptz not null default now()
);
create index push_subscriptions_by_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "People read their own devices" on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));
create policy "People add their own devices" on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()));
create policy "People update their own devices" on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "People remove their own devices" on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Saves this device for the signed-in person; turning it on again on the same phone just updates it.
create or replace function public.save_push_subscription(device_endpoint text, key_p256dh text, key_auth text, device_lang text default 'en')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, lang)
  values ((select auth.uid()), device_endpoint, key_p256dh, key_auth, case when device_lang = 'es' then 'es' else 'en' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang;
end $$;

-- Who should hear about an event, checked against who is asking. Returns the restaurant's name for
-- the message and the people to tell (never the person who caused it). Raises when the caller had
-- no business triggering it, so nobody can make HEAT notify a team they don't run.
create or replace function public.push_audience(event text, ref uuid, target uuid default null)
returns table(restaurant_name text, user_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  rid uuid;
  people uuid[];
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if event = 'preshift_posted' then
    select n.restaurant_id into rid from public.shift_notes n where n.id = ref;
    if rid is null or not public.can_manage(rid, 'preshift') then raise exception 'Not your board' using errcode = '42501'; end if;
    select coalesce(array_agg(r.user_id), '{}') into people from public.shift_note_recipients r where r.shift_note_id = ref;
    if cardinality(people) = 0 then
      select coalesce(array_agg(m.user_id), '{}') into people from public.restaurant_members m where m.restaurant_id = rid;
    end if;
  elsif event = 'study_assigned' then
    rid := ref;
    if not public.can_manage(rid, 'team') then raise exception 'Not your team' using errcode = '42501'; end if;
    if not exists (select 1 from public.restaurant_members m where m.restaurant_id = rid and m.user_id = target) then
      raise exception 'Team member unavailable' using errcode = '42501';
    end if;
    people := array[target];
  elsif event = 'urgent_report' then
    select s.restaurant_id into rid from public.shift_reports s where s.id = ref and s.urgent and s.submitted_by = me;
    if rid is null then raise exception 'Not an urgent report of yours' using errcode = '42501'; end if;
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select o.owner_id from public.restaurants r join public.organizations o on o.id = r.organization_id where r.id = rid
      union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid and m.access && array['preshift', 'team']::text[]
    ) found;
  elsif event = 'retake_requested' then
    select m.restaurant_id into rid from public.quiz_permissions p join public.menu_items m on m.id = p.menu_item_id
    where p.menu_item_id = ref and p.user_id = me and p.requested;
    if rid is null then raise exception 'No request to announce' using errcode = '42501'; end if;
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select o.owner_id from public.restaurants r join public.organizations o on o.id = r.organization_id where r.id = rid
    ) found;
  else
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  return query select (select r.name from public.restaurants r where r.id = rid), coalesce(array_remove(people, me), '{}');
end $$;

revoke all on function public.save_push_subscription(text, text, text, text), public.push_audience(text, uuid, uuid) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.push_audience(text, uuid, uuid) to authenticated;

commit;
