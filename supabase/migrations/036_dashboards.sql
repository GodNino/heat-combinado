-- Run once, after 035. Read-only numbers for the dashboards: nothing is written, and no table,
-- policy or existing function changes. Every figure follows the rules in 026_learning_notes.md:
-- a person's latest result per current menu item, accuracy weighted by answered questions,
-- "needs review" below 80% or an updated quiz. Learners are the restaurant's members.
begin;

-- Per library (food, cocktails, wine): how much of the menu the team has covered, and how well.
-- Private: only the wrappers below may call it, after checking who is asking.
create or replace function public.location_stats(rid uuid)
returns table(content_type text, items integer, learners integer, taken integer,
  correct integer, total integer, needs_review integer, active_7d integer)
language sql stable security definer set search_path = '' as $$
  with learners as (
    select m.user_id from public.restaurant_members m where m.restaurant_id = rid
  ), results as (
    select i.content_type, r.correct, r.total, r.needs_review
    from learners l
    cross join lateral public.learning_results(rid, l.user_id) r
    join public.menu_items i on i.id = r.menu_item_id
  ), active as (
    select count(distinct a.user_id)::integer n
    from public.quiz_attempts a
    join public.menu_items i on i.id = a.menu_item_id
    join learners l on l.user_id = a.user_id
    where i.restaurant_id = rid and a.total > 0 and a.created_at > now() - interval '7 days'
  )
  select t.kind,
    (select count(*) from public.menu_items i where i.restaurant_id = rid and i.content_type = t.kind)::integer,
    (select count(*) from learners)::integer,
    (select count(*) from results r where r.content_type = t.kind)::integer,
    (select coalesce(sum(r.correct), 0) from results r where r.content_type = t.kind)::integer,
    (select coalesce(sum(r.total), 0) from results r where r.content_type = t.kind)::integer,
    (select count(*) from results r where r.content_type = t.kind
       and (r.needs_review or r.correct::numeric / r.total < 0.8))::integer,
    (select n from active)
  from unnest(array['food', 'cocktails', 'wine']) as t(kind);
$$;

-- Completed quizzes per week, oldest first, including empty weeks. learner_id null means the whole team.
create or replace function public.activity_by_week(rid uuid, learner_id uuid, weeks integer)
returns table(week_start date, quizzes integer, learners integer)
language sql stable security definer set search_path = '' as $$
  with span as (
    select generate_series(
      date_trunc('week', now()) - make_interval(weeks => greatest(1, least(weeks, 26)) - 1),
      date_trunc('week', now()), interval '1 week')::date as week_start
  ), done as (
    select date_trunc('week', a.created_at)::date as week_start, a.user_id
    from public.quiz_attempts a
    join public.menu_items i on i.id = a.menu_item_id
    where i.restaurant_id = rid and a.total > 0
      and a.created_at >= (select min(s.week_start) from span s)
      and (learner_id is null and exists (select 1 from public.restaurant_members m where m.restaurant_id = rid and m.user_id = a.user_id)
           or a.user_id = learner_id)
  )
  select s.week_start, count(d.user_id)::integer, count(distinct d.user_id)::integer
  from span s left join done d on d.week_start = s.week_start
  group by s.week_start order by s.week_start;
$$;
revoke all on function public.location_stats(uuid), public.activity_by_week(uuid, uuid, integer) from public, anon, authenticated;

-- Manager dashboard: the people who run the team at this location.
create or replace function public.location_summary(rid uuid)
returns table(content_type text, items integer, learners integer, taken integer,
  correct integer, total integer, needs_review integer, active_7d integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'team') then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  return query select * from public.location_stats(rid);
end $$;

create or replace function public.location_activity(rid uuid, weeks integer default 8)
returns table(week_start date, quizzes integer, learners integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'team') then
    raise exception 'Manager access required' using errcode = '42501';
  end if;
  return query select * from public.activity_by_week(rid, null, weeks);
end $$;

-- Employee dashboard: only ever the signed-in person's own quizzes.
create or replace function public.my_activity(rid uuid, weeks integer default 8)
returns table(week_start date, quizzes integer, learners integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_restaurant(rid) then
    raise exception 'Not a member of this restaurant' using errcode = '42501';
  end if;
  return query select * from public.activity_by_week(rid, (select auth.uid()), weeks);
end $$;

-- Brand dashboard: one row per location, for the brand's owner only.
create or replace function public.brand_summary(oid uuid)
returns table(restaurant_id uuid, name text, items integer, learners integer, taken integer,
  correct integer, total integer, needs_review integer, active_7d integer, quizzes_28d integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations o where o.id = oid and o.owner_id = (select auth.uid())) then
    raise exception 'Only the owner of the brand can compare its locations.' using errcode = '42501';
  end if;
  return query
  select r.id, r.name,
    sum(s.items)::integer, max(s.learners)::integer, sum(s.taken)::integer,
    sum(s.correct)::integer, sum(s.total)::integer, sum(s.needs_review)::integer, max(s.active_7d)::integer,
    (select coalesce(sum(w.quizzes), 0) from public.activity_by_week(r.id, null, 4) w)::integer
  from public.restaurants r
  cross join lateral public.location_stats(r.id) s
  where r.organization_id = oid
  group by r.id, r.name, r.created_at
  order by r.created_at;
end $$;

revoke all on function public.location_summary(uuid), public.location_activity(uuid, integer),
  public.my_activity(uuid, integer), public.brand_summary(uuid) from public, anon;
grant execute on function public.location_summary(uuid), public.location_activity(uuid, integer),
  public.my_activity(uuid, integer), public.brand_summary(uuid) to authenticated;

commit;
