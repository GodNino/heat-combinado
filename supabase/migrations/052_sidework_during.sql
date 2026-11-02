-- Run once, after 051. A side work task can be 'during' as well as opening or closing: the running
-- side work a server keeps an eye on in service (trays, coffee station, wine glasses). It hands itself
-- out like the others -- one server each, rotating -- so the separate running side work lists (050)
-- are no longer needed on screen; the table stays for any lists already saved.
begin;
alter table public.checklist_jobs drop constraint checklist_jobs_phase_check;
alter table public.checklist_jobs add constraint checklist_jobs_phase_check check (phase in ('opening', 'during', 'closing'));
alter table public.checklist_assignments drop constraint checklist_assignments_phase_check;
alter table public.checklist_assignments add constraint checklist_assignments_phase_check check (phase in ('opening', 'during', 'closing'));
commit;
