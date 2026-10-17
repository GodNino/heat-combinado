-- Run once in the Supabase SQL editor BEFORE the app files that add the Guides switch.
-- Additive only: two new columns on a table you already have. Nothing is renamed,
-- nothing is removed, and every word you have today keeps working exactly as it does.
--
-- What the two columns are for:
--   story       the long write-up — where it comes from, how it compares to what sits
--               next to it on the menu. A word with a story is what HEAT calls a guide.
--   photo_path  where the photo lives in Supabase Storage, in the same private
--               menu-photos bucket and under the same restaurant-id folder the menu
--               photos already use, so no new bucket and no new storage policy.
--
-- Both default to an empty string, so existing words simply have no story and no photo.
-- They stay in Words. None of them becomes a guide until somebody writes one.

begin;

alter table public.glossary_terms
  add column if not exists story text not null default '',
  add column if not exists photo_path text not null default '';

alter table public.glossary_terms
  add constraint glossary_terms_story_length check (char_length(story) <= 4000);

alter table public.glossary_terms
  add constraint glossary_terms_photo_path_length check (char_length(photo_path) <= 300);

commit;
