-- Run once, after 060. Edit map can show a photo of the restaurant's own printed floor plan behind the
-- tables, for tracing. The photo lives with the other private photos (menu-photos), in the restaurant's
-- folder under floor/: <restaurant id>/floor/<file>. Until now only Library and Words managers could
-- upload there; whoever edits the floor map (Pre-shift access, like Side work) may now add and delete
-- photos in that floor/ folder only. Reading is unchanged: the restaurant's members (001).
begin;

create policy "Floor map managers upload the plan photo" on storage.objects for insert to authenticated
with check (bucket_id = 'menu-photos' and (storage.foldername(name))[2] = 'floor' and exists (
  select 1 from public.restaurants r
  where r.id::text = (storage.foldername(name))[1] and public.can_manage(r.id, 'preshift')
));

create policy "Floor map managers delete the plan photo" on storage.objects for delete to authenticated
using (bucket_id = 'menu-photos' and (storage.foldername(name))[2] = 'floor' and exists (
  select 1 from public.restaurants r
  where r.id::text = (storage.foldername(name))[1] and public.can_manage(r.id, 'preshift')
));

commit;
