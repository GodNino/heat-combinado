-- Run once, after 050. Side work that hands itself out.
--
-- A saved job (checklist_jobs) can now say:
--   * phase: 'opening' or 'closing' (the running side work during service lives in the floor plan, 050).
--   * role:  'server' or 'sa'.
--   * who:   'one' (one person, rotating day by day), 'all' (everyone in that role) or 'closer'
--            (whoever comes in last for that service, from the schedule).
--   * days:  the weekdays it applies (0 = Sunday … 6 = Saturday); empty means every day.
-- A job with no phase is not handed out automatically; it can still be given by hand.
-- Assignments remember their phase, so each person's "My shift" card can show opening and closing
-- apart. Nothing existing changes meaning: every current job starts with no phase.
begin;

alter table public.checklist_jobs
  add column phase text check (phase in ('opening', 'closing')),
  add column role text check (role in ('server', 'sa')),
  add column who text not null default 'one' check (who in ('one', 'all', 'closer')),
  add column days smallint[] not null default '{}' check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

alter table public.checklist_assignments
  add column phase text check (phase in ('opening', 'closing'));

commit;
