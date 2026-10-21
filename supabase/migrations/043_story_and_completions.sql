-- Run once, after 042. What the original HEAT database (the "heat-app" Supabase project) had and this
-- folder never recorded: it was applied there by hand. Written down here from that database so a new
-- project can be built from this folder, and so Osaka - Miami's data can be copied over intact.
--
--   * story_topics: "Our story" (app/story.tsx), managed with Words access, read by the team.
--   * assignment_seen + team_completions + mark_member_completions_seen: the manager's list of assigned
--     study that people finished, and which of those the manager has already seen (Home and Team).
--   * poster_name: the name shown beside a pre-shift post.
--   * shift_notes.created_at: when a pre-shift note was first written.
-- Additive only: nothing is dropped or changed.
begin;

-- ── Our story ──
create table if not exists public.story_topics (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 8000),
  photo_path text not null default '' check (char_length(photo_path) <= 300),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  section text not null default '' check (char_length(section) <= 60)
);
create unique index if not exists story_topics_one_per_title on public.story_topics (restaurant_id, lower(btrim(title)));
alter table public.story_topics enable row level security;
drop policy if exists "Members read story" on public.story_topics;
create policy "Members read story" on public.story_topics for select to authenticated
  using (public.can_read_restaurant(restaurant_id));
drop policy if exists "Managers add story" on public.story_topics;
create policy "Managers add story" on public.story_topics for insert to authenticated
  with check (public.can_manage(restaurant_id, 'words') and created_by = (select auth.uid()));
drop policy if exists "Managers edit story" on public.story_topics;
create policy "Managers edit story" on public.story_topics for update to authenticated
  using (public.can_manage(restaurant_id, 'words')) with check (public.can_manage(restaurant_id, 'words'));
drop policy if exists "Managers delete story" on public.story_topics;
create policy "Managers delete story" on public.story_topics for delete to authenticated
  using (public.can_manage(restaurant_id, 'words'));
revoke all on public.story_topics from anon;
grant select, insert, update, delete on public.story_topics to authenticated;

-- ── Finished study the manager has seen ──
create table if not exists public.assignment_seen (
  viewer_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  seen_completion_at timestamptz not null,
  primary key (viewer_id, assignment_id)
);
alter table public.assignment_seen enable row level security;
revoke all on public.assignment_seen from anon, authenticated;

create or replace function public.team_completions(rid uuid)
returns table(assignment_id uuid, learner_id uuid, learner_name text, menu_item_id uuid, item_name text,
  correct integer, total integer, passed boolean, completed_at timestamptz, seen boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'team') then raise exception 'You do not have access to the team.'; end if;
  return query
  select asg.id, asg.user_id,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(u.raw_user_meta_data->>'display_name'), ''), u.email::text, u.id::text),
    asg.menu_item_id, m.name, att.correct, att.total,
    att.correct::numeric / att.total >= 0.8, att.created_at,
    coalesce(sn.seen_completion_at >= att.created_at, false)
  from public.assignments asg
  join public.menu_items m on m.id = asg.menu_item_id and m.restaurant_id = rid
  join auth.users u on u.id = asg.user_id
  left join public.member_profiles p on p.restaurant_id = rid and p.user_id = asg.user_id
  cross join lateral (
    select a.correct, a.total, a.created_at
    from public.quiz_attempts a
    where a.user_id = asg.user_id and a.menu_item_id = asg.menu_item_id
      and a.menu_updated_at = m.updated_at and a.created_at > asg.created_at
    order by a.created_at desc, a.id desc limit 1
  ) att
  left join public.assignment_seen sn on sn.viewer_id = auth.uid() and sn.assignment_id = asg.id
  where asg.restaurant_id = rid and att.total > 0
  order by att.created_at desc;
end $$;

create or replace function public.mark_member_completions_seen(rid uuid, learner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'team') then raise exception 'You do not have access to the team.'; end if;
  insert into public.assignment_seen(viewer_id, assignment_id, seen_completion_at)
  select auth.uid(), asg.id, att.created_at
  from public.assignments asg
  join public.menu_items m on m.id = asg.menu_item_id and m.restaurant_id = rid
  cross join lateral (
    select a.created_at from public.quiz_attempts a
    where a.user_id = asg.user_id and a.menu_item_id = asg.menu_item_id
      and a.menu_updated_at = m.updated_at and a.created_at > asg.created_at
    order by a.created_at desc, a.id desc limit 1
  ) att
  where asg.restaurant_id = rid and asg.user_id = learner
  on conflict (viewer_id, assignment_id)
  do update set seen_completion_at = excluded.seen_completion_at;
end $$;

-- ── Pre-shift ──
create or replace function public.poster_name(rid uuid, uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when public.can_read_restaurant(rid) then
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
      u.email::text)
  end
  from auth.users u
  left join public.member_profiles p on p.restaurant_id = rid and p.user_id = u.id
  where u.id = uid;
$$;

alter table public.shift_notes add column if not exists created_at timestamptz not null default now();

revoke all on function public.team_completions(uuid), public.mark_member_completions_seen(uuid, uuid), public.poster_name(uuid, uuid) from public, anon;
grant execute on function public.team_completions(uuid), public.mark_member_completions_seen(uuid, uuid), public.poster_name(uuid, uuid) to authenticated;

commit;
