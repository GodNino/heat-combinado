begin;
create table public.menu_quiz_edits(menu_item_id uuid primary key references public.menu_items on delete cascade, questions jsonb not null);
create table public.quiz_sessions(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, menu_item_id uuid not null references public.menu_items on delete cascade, version text not null, menu_updated_at timestamptz not null, questions jsonb not null, answers integer[] not null, completed boolean not null default false, created_at timestamptz not null default clock_timestamp());
create index on public.quiz_sessions(user_id,menu_item_id);
create table public.quiz_permissions(user_id uuid references auth.users on delete cascade, menu_item_id uuid references public.menu_items on delete cascade, extra integer not null default 0, requested boolean not null default false, primary key(user_id,menu_item_id));
alter table public.menu_quiz_edits enable row level security;
alter table public.quiz_sessions enable row level security;
alter table public.quiz_permissions enable row level security;
revoke all on public.menu_quiz_edits,public.quiz_sessions,public.quiz_permissions from anon,authenticated;
alter table public.quiz_attempts drop constraint quiz_attempts_answers_check, drop constraint quiz_attempts_correct_check;
alter table public.quiz_attempts add column total integer not null default 6 check(total between 1 and 30), add column session_id uuid unique references public.quiz_sessions on delete cascade;
alter table public.quiz_attempts add check(cardinality(answers)=total), add check(correct between 0 and total);
alter function public.build_menu_quiz(uuid) rename to build_auto_menu_quiz;
create function public.build_menu_quiz(mid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q jsonb; stamp timestamptz;
begin
 if not exists(select 1 from public.menu_items where id=mid and public.can_read_restaurant(restaurant_id)) then raise exception 'Menu item unavailable'; end if;
 select questions into q from public.menu_quiz_edits where menu_item_id=mid;
 if not found then return public.build_auto_menu_quiz(mid); end if;
 select updated_at into stamp from public.menu_items where id=mid;
 return jsonb_build_object('version',md5(stamp::text||q::text),'updated_at',stamp,'questions',q);
end $$;
create function public.manage_menu_quiz(mid uuid, questions jsonb default null, expected_version text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb; opt jsonb; current_quiz jsonb;
begin
 perform 1 from public.menu_items m join public.restaurants r on r.id=m.restaurant_id where m.id=mid and r.owner_id=auth.uid() for update of m;
 if not found then raise exception 'Only the restaurant manager can edit quizzes'; end if;
 current_quiz:=public.build_menu_quiz(mid);
 if questions is null then return current_quiz; end if;
 if current_quiz->>'version' is distinct from expected_version then raise exception 'This quiz changed. Reload before editing.'; end if;
 if jsonb_typeof(questions)<>'array' or jsonb_array_length(questions) not between 1 and 30 then raise exception 'Use 1–30 questions'; end if;
 for q in select value from jsonb_array_elements(questions) loop
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
-- Serialize starts, requests and approvals for the same learner and item.
create function public.quiz_lock(mid uuid, learner uuid) returns void language sql security definer set search_path='' as $$ select pg_advisory_xact_lock(hashtextextended(mid::text||learner::text,0)); $$;
create function public.quiz_session_view(s public.quiz_sessions) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'answers',s.answers,'completed',s.completed,'correct',(select count(*) from jsonb_array_elements(s.questions) with ordinality t(q,n) where (q->>'correct')::integer=s.answers[n]),'questions',(select jsonb_agg(case when s.answers[n]>=0 then q else q-'correct' end order by n) from jsonb_array_elements(s.questions) with ordinality t(q,n)));
$$;
create function public.start_menu_quiz(mid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare quiz jsonb; s public.quiz_sessions; used integer; extra integer; owner boolean; pending boolean;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform public.quiz_lock(mid,auth.uid());
 perform 1 from public.menu_items where id=mid for share;
 quiz:=public.build_menu_quiz(mid);
 select * into s from public.quiz_sessions where menu_item_id=mid and user_id=auth.uid() and not completed and version=quiz->>'version' order by created_at desc limit 1;
 if found then return public.quiz_session_view(s); end if;
 select r.owner_id=auth.uid() into owner from public.menu_items m join public.restaurants r on r.id=m.restaurant_id where m.id=mid;
 select coalesce(p.extra,0),p.requested into extra,pending from public.quiz_permissions p where p.menu_item_id=mid and p.user_id=auth.uid();
 select (select count(*) from public.quiz_sessions where menu_item_id=mid and user_id=auth.uid())+(select count(*) from public.quiz_attempts where menu_item_id=mid and user_id=auth.uid() and session_id is null) into used;
 if not owner and used>=3+coalesce(extra,0) then return jsonb_build_object('blocked',true,'requested',coalesce(pending,false),'used',used); end if;
 insert into public.quiz_sessions(user_id,menu_item_id,version,menu_updated_at,questions,answers) values(auth.uid(),mid,quiz->>'version',(quiz->>'updated_at')::timestamptz,quiz->'questions',array_fill(-1,array[jsonb_array_length(quiz->'questions')])) returning * into s;
 return public.quiz_session_view(s);
end $$;
create function public.answer_menu_quiz(sid uuid, question_index integer, selected_answer integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.quiz_sessions; quiz jsonb; score integer;
begin
 select * into s from public.quiz_sessions where id=sid and user_id=auth.uid() for update;
 if not found then raise exception 'Quiz session unavailable'; end if;
 perform 1 from public.menu_items where id=s.menu_item_id for share;
 quiz:=public.build_menu_quiz(s.menu_item_id);
 if quiz->>'version' is distinct from s.version then raise exception 'The quiz changed. Reopen it to use the latest questions.'; end if;
 if question_index is null or question_index not between 0 and cardinality(s.answers)-1 or selected_answer is null or selected_answer not between 0 and jsonb_array_length(s.questions->question_index->'options')-1 then raise exception 'Choose an available answer'; end if;
 if s.answers[question_index+1]>=0 then
  if s.answers[question_index+1]<>selected_answer then raise exception 'An answer cannot change after checking it'; end if;
  return public.quiz_session_view(s);
 end if;
 if question_index<>array_position(s.answers,-1)-1 then raise exception 'Answer questions in order'; end if;
 s.answers[question_index+1]:=selected_answer;
 s.completed:=array_position(s.answers,-1) is null;
 update public.quiz_sessions set answers=s.answers,completed=s.completed where id=s.id;
 if s.completed then
  select count(*) into score from jsonb_array_elements(s.questions) with ordinality t(q,n) where (q->>'correct')::integer=s.answers[n];
  insert into public.quiz_attempts(user_id,menu_item_id,menu_updated_at,answers,correct,questions,total,session_id) values(auth.uid(),s.menu_item_id,s.menu_updated_at,s.answers,score,s.questions,cardinality(s.answers),s.id);
 end if;
 return public.quiz_session_view(s);
end $$;
create function public.request_quiz_retake(mid uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.menu_items where id=mid and public.can_read_restaurant(restaurant_id)) then raise exception 'Menu item unavailable'; end if;
 perform public.quiz_lock(mid,auth.uid());
 insert into public.quiz_permissions(user_id,menu_item_id,requested) values(auth.uid(),mid,true) on conflict(user_id,menu_item_id) do update set requested=true;
end $$;
create function public.quiz_retake_requests(rid uuid) returns table(user_id uuid,menu_item_id uuid,learner text,item_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.restaurants where id=rid and owner_id=auth.uid()) then raise exception 'Manager access required'; end if;
 return query select p.user_id,p.menu_item_id,coalesce(u.email::text,p.user_id::text),m.name from public.quiz_permissions p join public.menu_items m on m.id=p.menu_item_id join auth.users u on u.id=p.user_id where m.restaurant_id=rid and p.requested;
end $$;
create function public.approve_quiz_retake(mid uuid,learner_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.menu_items m join public.restaurants r on r.id=m.restaurant_id where m.id=mid and r.owner_id=auth.uid()) then raise exception 'Manager access required'; end if;
 perform public.quiz_lock(mid,learner_id);
 update public.quiz_permissions set extra=extra+1,requested=false where menu_item_id=mid and user_id=learner_id and requested;
 if not found then raise exception 'This request has already been handled'; end if;
end $$;
drop function public.get_quiz_progress(uuid);
create function public.get_quiz_progress(rid uuid) returns table(menu_item_id uuid,correct integer,total integer,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select distinct on (a.menu_item_id) a.menu_item_id,a.correct,a.total,a.created_at from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id where a.user_id=auth.uid() and m.restaurant_id=rid and public.can_read_restaurant(rid) and a.menu_updated_at=m.updated_at order by a.menu_item_id,a.created_at desc,a.id desc;
$$;
revoke all on function public.submit_menu_quiz(uuid,text,integer[]) from public,anon,authenticated;
revoke all on function public.build_menu_quiz(uuid),public.manage_menu_quiz(uuid,jsonb,text),public.quiz_lock(uuid,uuid),public.quiz_session_view(public.quiz_sessions),public.start_menu_quiz(uuid),public.answer_menu_quiz(uuid,integer,integer),public.request_quiz_retake(uuid),public.quiz_retake_requests(uuid),public.approve_quiz_retake(uuid,uuid),public.get_quiz_progress(uuid) from public,anon,authenticated;
grant execute on function public.manage_menu_quiz(uuid,jsonb,text),public.start_menu_quiz(uuid),public.answer_menu_quiz(uuid,integer,integer),public.request_quiz_retake(uuid),public.quiz_retake_requests(uuid),public.approve_quiz_retake(uuid,uuid),public.get_quiz_progress(uuid) to authenticated;
commit;
