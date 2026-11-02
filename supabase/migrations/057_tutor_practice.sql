-- Run once, after 056. What the study Tutor remembers (app/api/tutor, lib/tutor.ts).
--
--   * tutor_practice: one row each time someone answers the tutor about a card -- how it went
--     ('correct', 'partly' or 'wrong') and, when it wasn't all right, what they missed in a few words.
--     The tutor reads a person's own rows to start with what they know least, and My progress shows
--     them. Nothing here is a quiz score: quizzes and their results are untouched.
--   * The row is written by the tutor's route acting as the person (their sign-in token, no service
--     key), so each person can only add rows for themselves, for a card of a restaurant they belong to.
--   * Each person reads their own rows; managers with Team access read their restaurant's, for a later
--     team view. Nobody edits rows; deleting a card or an account removes its rows.
-- Additive only: one new table, nothing existing is changed.
begin;

create table if not exists public.tutor_practice (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  result text not null check (result in ('correct', 'partly', 'wrong')),
  missed text not null default '' check (char_length(missed) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists tutor_practice_by_person on public.tutor_practice (restaurant_id, user_id, created_at desc);
alter table public.tutor_practice enable row level security;

drop policy if exists "People record their own practice" on public.tutor_practice;
create policy "People record their own practice" on public.tutor_practice for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_read_restaurant(restaurant_id)
    and exists (select 1 from public.menu_items m where m.id = menu_item_id and m.restaurant_id = tutor_practice.restaurant_id)
  );
drop policy if exists "People read their practice, managers their team's" on public.tutor_practice;
create policy "People read their practice, managers their team's" on public.tutor_practice for select to authenticated
  using ((user_id = (select auth.uid()) and public.can_read_restaurant(restaurant_id)) or public.can_manage(restaurant_id, 'team'));

-- Supabase gives new tables every privilege by default; people may only read and add here.
revoke all on public.tutor_practice from anon, authenticated;
grant select, insert on public.tutor_practice to authenticated;

commit;
