-- Run once, after 053. Side work and the floor plan get a third service, Brunch, next to Lunch and Dinner
-- (normally Saturday and Sunday; the manager decides when to use it). Brunch has the same people as Lunch
-- but its own floor plan. Additive: only the list of allowed service names grows, no plan is touched.
begin;
alter table public.floor_plans drop constraint floor_plans_service_check;
alter table public.floor_plans add constraint floor_plans_service_check check (service in ('Brunch', 'Lunch', 'Dinner'));
commit;
