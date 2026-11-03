-- Removes the made-up team that osaka-demo-team.sql added to Osaka - Miami: every account whose
-- email ends in @demo.heat.invalid, and everything tied to it (memberships, profiles, shifts,
-- requests, quiz results, tutor practice, assignments, side work and the shift reports Ricardo wrote).
-- Real people and everything they made are left alone. Safe to run when there is nothing to remove.
begin;

delete from public.shift_reports where submitted_by in (select id from auth.users where email like '%@demo.heat.invalid');
delete from public.shift_changes where requested_by in (select id from auth.users where email like '%@demo.heat.invalid')
  or taker_id in (select id from auth.users where email like '%@demo.heat.invalid');
delete from public.quiz_attempts where user_id in (select id from auth.users where email like '%@demo.heat.invalid');
-- The account goes last; memberships, profiles, shifts and the rest follow it.
delete from auth.users where email like '%@demo.heat.invalid';

commit;
