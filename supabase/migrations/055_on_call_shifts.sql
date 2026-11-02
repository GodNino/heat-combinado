-- Run once, after 054. On-call shifts: someone is scheduled "on call" and checks in with the manager
-- to find out whether they're needed. Until the manager answers, the shift doesn't count toward the
-- hours on the schedule.
--
--   * schedule_shifts.on_call: true for an on-call shift.
--   * schedule_shifts.on_call_status: the manager's answer -- 'needed' (come in) or 'released' (not
--     needed); empty while nobody has answered.
-- Additive. Every existing shift stays a normal shift.
begin;
alter table public.schedule_shifts
  add column on_call boolean not null default false,
  add column on_call_status text check (on_call_status in ('needed', 'released'));
commit;
