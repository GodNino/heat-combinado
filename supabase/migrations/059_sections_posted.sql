-- Run once, after 058. Sections can be sent to the team (Side work > Tonight > Sections > Send to the team):
--   * floor_plans.posted_at: when the manager sent them. My shift shows a section only once it's sent; until
--     then the manager can draw and change them without anyone seeing half a plan.
--   * push_audience learns 'sections_posted': the servers and S.A.s named in that night's sections get a
--     phone notification. The rest of the function is 048's, unchanged.
begin;

alter table public.floor_plans add column if not exists posted_at timestamptz;

create or replace function public.push_audience(event text, ref uuid, target uuid default null)
returns table(restaurant_name text, user_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  rid uuid;
  people uuid[];
  c public.shift_changes;
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
    select s.restaurant_id into rid from public.shift_reports s where s.id = ref and s.urgent and (s.submitted_by = me or s.updated_by = me);
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
  elsif event = 'schedule_published' then
    select p.restaurant_id, p.user_ids into rid, people from public.schedule_publications p where p.id = ref and p.published_by = me;
    if rid is null then raise exception 'Not a schedule you published' using errcode = '42501'; end if;
  elsif event = 'time_off_requested' then
    select t.restaurant_id into rid from public.time_off_requests t where t.id = ref and t.user_id = me and t.status = 'pending';
    if rid is null then raise exception 'No request to announce' using errcode = '42501'; end if;
    -- The owner, Team access, and whoever schedules this person's side.
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid
        and ('team' = any(m.access)
             or (case when public.is_kitchen_position(rid, public.person_area(rid, me)) then 'schedule_boh' else 'schedule_foh' end) = any(m.access))
    ) found;
  elsif event = 'time_off_decided' then
    select t.restaurant_id, array[t.user_id] into rid, people from public.time_off_requests t where t.id = ref and t.decided_by = me;
    if rid is null then raise exception 'Not a request you decided' using errcode = '42501'; end if;
  elsif event in ('shift_released', 'shift_offered', 'shift_change_pending', 'shift_change_declined', 'shift_change_decided') then
    select * into c from public.shift_changes where id = ref;
    if c.id is null then raise exception 'No shift change to announce' using errcode = '42501'; end if;
    rid := c.restaurant_id;
    if event = 'shift_released' and c.requested_by = me and c.status = 'open' then
      -- Everyone in the shift's position who'd stay under overtime with it.
      select coalesce(array_agg(t.user_id), '{}') into people from public.schedule_team(rid) t
      join public.schedule_shifts s on s.id = c.shift_id
      where public.same_area(t.role, s.position) and t.user_id <> c.requested_by
        and not public.would_overtime(rid, t.user_id, s.starts_at, s.ends_at, '{}');
    elsif event = 'shift_offered' and c.requested_by = me and c.status = 'asked' then
      people := array[c.taker_id];
    elsif event = 'shift_change_pending' and c.taker_id = me and c.status = 'pending' then
      -- The owner, Team access, whoever schedules the shift's side, and the person who asked.
      select array_agg(distinct who) into people from (
        select r.owner_id as who from public.restaurants r where r.id = rid
        union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid
          and ('team' = any(m.access)
               or (case when public.is_kitchen_position(rid, (select s.position from public.schedule_shifts s where s.id = c.shift_id)) then 'schedule_boh' else 'schedule_foh' end) = any(m.access))
        union all select c.requested_by
      ) found;
    elsif event = 'shift_change_declined' and c.taker_id = me and c.status = 'declined' then
      people := array[c.requested_by];
    elsif event = 'shift_change_decided' and c.decided_by = me and c.status in ('approved', 'denied') then
      people := array_remove(array[c.requested_by, c.taker_id], null);
    else
      raise exception 'Not a shift change you can announce' using errcode = '42501';
    end if;
  elsif event = 'sections_posted' then
    -- Tonight's sections were sent from Side work > Tonight > Sections: everyone named in them hears it.
    select f.restaurant_id into rid from public.floor_plans f where f.id = ref and f.posted_at is not null;
    if rid is null or not public.can_manage(rid, 'preshift') then raise exception 'Not your sections' using errcode = '42501'; end if;
    select coalesce(array_agg(distinct u), '{}') into people from (
      select (r->>'server_id')::uuid as u from public.floor_plans f, jsonb_array_elements(f.rows) r
      where f.id = ref and coalesce(r->>'server_id', '') ~ '^[0-9a-f-]{36}$'
      union all
      select (h->>'id')::uuid from public.floor_plans f, jsonb_array_elements(f.rows) r, jsonb_array_elements(coalesce(r->'sa', '[]'::jsonb)) h
      where f.id = ref and coalesce(h->>'id', '') ~ '^[0-9a-f-]{36}$'
    ) named
    where u in (select m.user_id from public.restaurant_members m where m.restaurant_id = rid);
  else
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  return query select (select r.name from public.restaurants r where r.id = rid), coalesce(array_remove(people, me), '{}');
end $$;


commit;
