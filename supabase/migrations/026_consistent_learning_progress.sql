-- Deploy before the matching UI. Additive reporting endpoints; no attempts,
-- assignments, retake limits or existing authorization functions are changed.
begin;

-- One definition of latest completed result and changed-question status.
create or replace function public.learning_results(rid uuid, learner_id uuid)
returns table(menu_item_id uuid, item_name text, correct integer, total integer,
 created_at timestamptz, needs_review boolean)
language sql stable security definer set search_path='' as $$
 select distinct on (a.menu_item_id) a.menu_item_id,m.name,a.correct,a.total,a.created_at,
   a.questions is distinct from public.build_menu_quiz(m.id)->'questions'
 from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id
 where a.user_id=learner_id and m.restaurant_id=rid and a.total>0
 order by a.menu_item_id,a.created_at desc,a.id desc;
$$;
-- This helper is private: callers must pass through the authorization below.
revoke all on function public.learning_results(uuid,uuid) from public,anon,authenticated;

create or replace function public.get_quiz_progress(rid uuid)
returns table(menu_item_id uuid,correct integer,total integer,created_at timestamptz,needs_review boolean)
language sql stable security definer set search_path='' as $$
 select r.menu_item_id,r.correct,r.total,r.created_at,r.needs_review
 from public.learning_results(rid,auth.uid()) r
 where public.can_read_restaurant(rid);
$$;

create or replace function public.team_member_progress(rid uuid, learner_id uuid)
returns table(menu_item_id uuid,item_name text,correct integer,total integer,created_at timestamptz,needs_review boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 -- Reuse the deployed Team authorization and membership checks, including any
 -- delegated access configuration. Do not replace them with an owner-only guess.
 perform * from public.team_member_detail(rid,learner_id);
 return query select * from public.learning_results(rid,learner_id);
end;
$$;

create or replace function public.team_learning_roster(rid uuid)
returns table(user_id uuid,name text,role text,is_owner boolean,items_taken integer,
 correct_sum integer,total_sum integer,needs_review integer,last_attempt_at timestamptz)
language sql stable security definer set search_path='' as $$
 select member.user_id,member.name,member.role,member.is_owner,
   stats.items_taken,stats.correct_sum,stats.total_sum,stats.needs_review,stats.last_attempt_at
 from public.team_roster(rid) member
 cross join lateral (
   select count(*)::integer items_taken,coalesce(sum(r.correct),0)::integer correct_sum,
     coalesce(sum(r.total),0)::integer total_sum,
     count(*) filter(where r.needs_review or r.correct::numeric/r.total<0.8)::integer needs_review,
     max(r.created_at) last_attempt_at
   from public.learning_results(rid,member.user_id) r
 ) stats
 order by member.is_owner desc,member.name,member.user_id;
$$;
revoke all on function public.get_quiz_progress(uuid),public.team_member_progress(uuid,uuid),public.team_learning_roster(uuid) from public,anon,authenticated;
grant execute on function public.get_quiz_progress(uuid),public.team_member_progress(uuid,uuid),public.team_learning_roster(uuid) to authenticated;
commit;
