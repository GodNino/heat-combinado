-- Run once, after 059. Which positions count as servers and as S.A.s on Side work (Tonight) and Sections,
-- so every restaurant can use its own words ("Mesero", "Back waiter", "Food runner"...).
--   * schedule_settings.server_positions / sa_positions: set in Schedule > Settings, next to Kitchen
--     positions (048). Left empty (null), HEAT uses the usual names: "Server" for servers, and anything
--     with assistant, S.A., runner or busser for S.A.s, exactly as before.
-- Who can change them is the same as the rest of the schedule settings (Team access).
begin;

alter table public.schedule_settings add column if not exists server_positions text[];
alter table public.schedule_settings add column if not exists sa_positions text[];

commit;
