-- Run once, after 062. When dinner starts, per restaurant. Side work and Sections split a day's shifts into
-- Lunch (and Brunch) and Dinner by start time; it was always 4pm. schedule_settings.dinner_starts is the hour
-- (0-23) set in Schedule > Settings; left empty (null) it stays 4pm, as before.
begin;

alter table public.schedule_settings add column if not exists dinner_starts smallint check (dinner_starts between 0 and 23);

commit;
