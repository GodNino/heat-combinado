-- Run once, after 036. The demo kitchen becomes a copy per visitor.
--
-- Before: every demo visitor joined the one demo restaurant as a read-only team member, so the
-- guided tour could only point at things. Now each anonymous visitor gets a private copy of it,
-- as its owner: they can add a dish, post a pre-shift, make an invite link, and nobody else sees
-- it. Copies are marked with demo_expires_at and removed by purge_expired_demos() after 7 days.
--
-- The demo restaurant itself (is_demo, from supabase/demo-seed.sql) becomes the template. Nobody
-- joins it any more; its owner still edits it like any restaurant. join_demo() stays, unused.
-- Nothing is dropped, and no restaurant other than expired demo copies is ever deleted.
begin;

alter table public.restaurants add column if not exists demo_expires_at timestamptz;
create index if not exists restaurants_demo_expiry on public.restaurants (demo_expires_at) where demo_expires_at is not null;

-- Opens (or reopens) the visitor's own copy of the demo kitchen. Anonymous accounts only:
-- a real account never gets a throwaway restaurant in its list.
create or replace function public.start_demo()
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  template public.restaurants%rowtype;
  rid uuid;
  item public.menu_items%rowtype;
  copy_id uuid;
begin
  if me is null or not public.is_anonymous() then
    raise exception 'The demo kitchen is for visitors without an account.' using errcode = '42501';
  end if;
  select id into rid from public.restaurants where owner_id = me and demo_expires_at is not null;
  if rid is not null then
    return rid;
  end if;
  select * into template from public.restaurants where is_demo;
  if template.id is null then
    raise exception 'The demo kitchen is not set up.' using errcode = 'P0002';
  end if;

  insert into public.restaurants(owner_id, name, demo_expires_at)
  values (me, template.name, now() + interval '7 days')
  returning id into rid;

  insert into public.menu_sections(restaurant_id, content_type, name, heading, about, item_one, item_many)
  select rid, s.content_type, s.name, s.heading, s.about, s.item_one, s.item_many
  from public.menu_sections s where s.restaurant_id = template.id;

  insert into public.menu_categories(restaurant_id, content_type, name, sort_order, archived)
  select rid, c.content_type, c.name, c.sort_order, c.archived
  from public.menu_categories c where c.restaurant_id = template.id;

  -- Every column a dish has, as in import_menu_items. The template has no photos, and any it
  -- gains later stay the template's: a copy starts without them.
  for item in select * from public.menu_items m where m.restaurant_id = template.id order by m.created_at loop
    copy_id := gen_random_uuid();
    insert into public.menu_items
    select * from jsonb_populate_record(null::public.menu_items, to_jsonb(item) || jsonb_build_object(
      'id', copy_id, 'restaurant_id', rid, 'photo_path', null, 'created_at', now(), 'updated_at', now()));
    insert into public.menu_quiz_edits(menu_item_id, questions)
    select copy_id, q.questions from public.menu_quiz_edits q where q.menu_item_id = item.id;
  end loop;

  insert into public.glossary_terms(restaurant_id, term, say, means, note, also, hidden, created_by)
  select rid, g.term, g.say, g.means, g.note, g.also, g.hidden, me
  from public.glossary_terms g where g.restaurant_id = template.id and not g.hidden;

  insert into public.sops(restaurant_id, name, section, why, steps, sort_order, created_by)
  select rid, s.name, s.section, s.why, s.steps, s.sort_order, me
  from public.sops s where s.restaurant_id = template.id;

  return rid;
end $$;
revoke all on function public.start_demo() from public, anon;
grant execute on function public.start_demo() to authenticated;

-- Housekeeping, run on a schedule (see supabase/schedule-demo-cleanup.sql), never from the app.
-- Removes demo copies past their date (their menu, quizzes and members go with them), then the
-- anonymous accounts that no longer own anything. Returns how many copies were removed.
create or replace function public.purge_expired_demos()
returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  delete from public.restaurants where demo_expires_at is not null and demo_expires_at < now();
  get diagnostics removed = row_count;
  delete from auth.users u
  where u.is_anonymous and u.created_at < now() - interval '8 days'
    and not exists (select 1 from public.restaurants r where r.owner_id = u.id);
  return removed;
end $$;
revoke all on function public.purge_expired_demos() from public, anon, authenticated;

commit;
