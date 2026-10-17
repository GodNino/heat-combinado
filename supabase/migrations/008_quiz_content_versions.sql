-- Preserve scores and resumable attempts when service details change.
-- Match the saved question snapshot; never rewrite historical scores or answers.
begin;
create or replace function public.build_menu_quiz(mid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q jsonb; stamp timestamptz; auto_quiz jsonb;
begin
 if not exists(select 1 from public.menu_items where id=mid and public.can_read_restaurant(restaurant_id)) then raise exception 'Menu item unavailable'; end if;
 select questions into q from public.menu_quiz_edits where menu_item_id=mid;
 if not found then auto_quiz:=public.build_auto_menu_quiz(mid);return jsonb_set(auto_quiz,'{version}',to_jsonb(md5((auto_quiz->'questions')::text))); end if;
 select updated_at into stamp from public.menu_items where id=mid;
 return jsonb_build_object('version',md5(q::text),'updated_at',stamp,'questions',q);
end $$;
create or replace function public.start_menu_quiz(mid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare quiz jsonb; s public.quiz_sessions; used integer; extra integer; owner boolean; pending boolean;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 perform public.quiz_lock(mid,auth.uid());
 perform 1 from public.menu_items where id=mid for share;
 quiz:=public.build_menu_quiz(mid);
 select * into s from public.quiz_sessions where menu_item_id=mid and user_id=auth.uid() and not completed and questions=quiz->'questions' order by created_at desc limit 1;
 if found then return public.quiz_session_view(s); end if;
 select r.owner_id=auth.uid() into owner from public.menu_items m join public.restaurants r on r.id=m.restaurant_id where m.id=mid;
 select coalesce(p.extra,0),p.requested into extra,pending from public.quiz_permissions p where p.menu_item_id=mid and p.user_id=auth.uid();
 select (select count(*) from public.quiz_sessions where menu_item_id=mid and user_id=auth.uid())+(select count(*) from public.quiz_attempts where menu_item_id=mid and user_id=auth.uid() and session_id is null) into used;
 if not owner and used>=3+coalesce(extra,0) then return jsonb_build_object('blocked',true,'requested',coalesce(pending,false),'used',used); end if;
 insert into public.quiz_sessions(user_id,menu_item_id,version,menu_updated_at,questions,answers) values(auth.uid(),mid,quiz->>'version',(quiz->>'updated_at')::timestamptz,quiz->'questions',array_fill(-1,array[jsonb_array_length(quiz->'questions')])) returning * into s;
 return public.quiz_session_view(s);
end $$;
create or replace function public.answer_menu_quiz(sid uuid, question_index integer, selected_answer integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.quiz_sessions; quiz jsonb; score integer;
begin
 select * into s from public.quiz_sessions where id=sid and user_id=auth.uid() for update;
 if not found then raise exception 'Quiz session unavailable'; end if;
 perform 1 from public.menu_items where id=s.menu_item_id for share;
 quiz:=public.build_menu_quiz(s.menu_item_id);
 if quiz->'questions' is distinct from s.questions then raise exception 'The quiz changed. Reopen it to use the latest questions.'; end if;
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
create or replace function public.get_quiz_progress(rid uuid) returns table(menu_item_id uuid,correct integer,total integer,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select distinct on (a.menu_item_id) a.menu_item_id,a.correct,a.total,a.created_at from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id where a.user_id=auth.uid() and m.restaurant_id=rid and public.can_read_restaurant(rid) and a.questions=public.build_menu_quiz(m.id)->'questions' order by a.menu_item_id,a.created_at desc,a.id desc;
$$;
commit;
