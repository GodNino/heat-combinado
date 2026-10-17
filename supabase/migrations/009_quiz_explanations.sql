begin;
create table public.quiz_bank_revisions(id bigint generated always as identity primary key,menu_item_id uuid not null references public.menu_items on delete cascade,questions jsonb not null,saved_at timestamptz not null default clock_timestamp());
alter table public.quiz_bank_revisions enable row level security;
revoke all on public.quiz_bank_revisions from anon,authenticated;
create or replace function public.manage_menu_quiz(mid uuid, questions jsonb default null, expected_version text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb; opt jsonb; current_quiz jsonb;
begin
 perform 1 from public.menu_items m join public.restaurants r on r.id=m.restaurant_id where m.id=mid and r.owner_id=auth.uid() for update of m;
 if not found then raise exception 'Only the restaurant manager can edit quizzes'; end if;
 current_quiz:=public.build_menu_quiz(mid);
 if questions is null then return current_quiz; end if;
 if current_quiz->>'version' is distinct from expected_version then raise exception 'This quiz changed. Reload before editing.'; end if;
 if jsonb_typeof(questions)<>'array' or jsonb_array_length(questions) not between 1 and 30 then raise exception 'Use 1–30 questions'; end if;
 for q in select value from jsonb_array_elements(questions) loop
  if q ? 'explanation' and (jsonb_typeof(q->'explanation') is distinct from 'string' or length(q->>'explanation')>2000) then raise exception 'Keep explanations under 2000 characters'; end if;
  if jsonb_typeof(q->'prompt') is distinct from 'string' or length(trim(q->>'prompt')) not between 1 and 2000 or jsonb_typeof(q->'topic') is distinct from 'string' or length(trim(q->>'topic')) not between 1 and 100 or jsonb_typeof(q->'options') is distinct from 'array' then raise exception 'Each question needs a question, topic, and answer choices'; end if;
  if jsonb_array_length(q->'options') not between 2 and 6 or jsonb_typeof(q->'correct') is distinct from 'number' or (q->>'correct') !~ '^[0-9]+$' then raise exception 'Use 2–6 answers and select the correct answer'; end if;
  if (q->>'correct')::integer not between 0 and jsonb_array_length(q->'options')-1 then raise exception 'Select a correct answer'; end if;
  for opt in select value from jsonb_array_elements(q->'options') loop
   if jsonb_typeof(opt)<>'string' or length(trim(opt#>>'{}')) not between 1 and 4000 then raise exception 'Answer choices cannot be empty'; end if;
  end loop;
  if (select count(distinct lower(trim(value))) from jsonb_array_elements_text(q->'options'))<>jsonb_array_length(q->'options') then raise exception 'Answer choices must be different'; end if;
 end loop;
 insert into public.menu_quiz_edits values(mid,questions) on conflict(menu_item_id) do update set questions=excluded.questions;
 update public.menu_items set updated_at=clock_timestamp() where id=mid;
 return public.build_menu_quiz(mid);
end $$;
create or replace function public.quiz_session_view(s public.quiz_sessions) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'answers',s.answers,'completed',s.completed,'correct',(select count(*) from jsonb_array_elements(s.questions) with ordinality t(q,n) where (q->>'correct')::integer=s.answers[n]),'questions',(select jsonb_agg(case when s.answers[n]>=0 then q else q-'correct'-'explanation' end order by n) from jsonb_array_elements(s.questions) with ordinality t(q,n)));
$$;
create or replace function public.get_menu_quiz(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quiz jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 quiz:=public.build_menu_quiz(mid);
 return jsonb_build_object('version',quiz->>'version','questions',(select jsonb_agg(value-'correct'-'explanation' order by n) from jsonb_array_elements(quiz->'questions') with ordinality t(value,n)));
end;
$$;

drop function public.get_quiz_progress(uuid);
create function public.get_quiz_progress(rid uuid) returns table(menu_item_id uuid,correct integer,total integer,created_at timestamptz,needs_review boolean) language sql stable security definer set search_path='' as $$
 select distinct on(a.menu_item_id) a.menu_item_id,a.correct,a.total,a.created_at,a.questions is distinct from public.build_menu_quiz(m.id)->'questions'
 from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id
 where a.user_id=auth.uid() and m.restaurant_id=rid and public.can_read_restaurant(rid)
 order by a.menu_item_id,a.created_at desc,a.id desc;
$$;
revoke all on function public.get_quiz_progress(uuid) from public,anon,authenticated;
grant execute on function public.get_quiz_progress(uuid) to authenticated;
commit;
