-- Run once in the Supabase SQL editor BEFORE (or after) uploading the Words screen.
-- Additive only: creates one new table. Nothing existing is changed or removed.
-- Managers' own words for "Words to know". A row with the same word as a built-in
-- term replaces it on the cards; a row marked hidden removes that built-in word.
begin;

create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  term text not null check (char_length(btrim(term)) between 1 and 60),
  say text not null default '' check (char_length(say) <= 120),
  means text not null default '' check (char_length(means) <= 600),
  note text not null default '' check (char_length(note) <= 300),
  also text[] not null default '{}' check (cardinality(also) <= 10),
  hidden boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  check (hidden or char_length(btrim(means)) > 0)
);
create unique index glossary_terms_one_per_word on public.glossary_terms (restaurant_id, lower(btrim(term)));
alter table public.glossary_terms enable row level security;

create policy "Members read words" on public.glossary_terms for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Owner adds words" on public.glossary_terms for insert to authenticated
with check (public.is_restaurant_owner(restaurant_id) and created_by = (select auth.uid()));
create policy "Owner edits words" on public.glossary_terms for update to authenticated
using (public.is_restaurant_owner(restaurant_id))
with check (public.is_restaurant_owner(restaurant_id));
create policy "Owner deletes words" on public.glossary_terms for delete to authenticated
using (public.is_restaurant_owner(restaurant_id));

revoke all on public.glossary_terms from public, anon, authenticated;
grant select, insert, update, delete on public.glossary_terms to authenticated;

commit;
