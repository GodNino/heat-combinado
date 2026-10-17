-- Reporting only. Preserve existing Team permissions and all recorded results.
begin;
create or replace function public.team_member_print_progress(rid uuid, learner_id uuid)
returns table(menu_item_id uuid,item_name text,correct integer,total integer,created_at timestamptz,needs_review boolean,attempt_count integer)
language plpgsql stable security definer set search_path='' as $$
begin
 -- The existing endpoint checks both manager access and learner membership.
 return query
 select r.menu_item_id,r.item_name,r.correct,r.total,r.created_at,r.needs_review,
   (select count(*)::integer from public.quiz_attempts a
    where a.user_id=learner_id and a.menu_item_id=r.menu_item_id and a.total>0)
 from public.team_member_progress(rid,learner_id) r;
end;
$$;
revoke all on function public.team_member_print_progress(uuid,uuid) from public,anon,authenticated;
grant execute on function public.team_member_print_progress(uuid,uuid) to authenticated;
commit;
