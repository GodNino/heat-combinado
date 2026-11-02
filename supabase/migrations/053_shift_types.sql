-- Run once, after 052. A shift can be tagged Opener, Mid or Closer, and the schedule settings remember
-- the usual hours of each, so tapping a tag in the shift pop-up fills in the times.
--
--   * schedule_shifts.shift_kind: 'opener', 'mid', 'closer', or empty for a shift with no tag.
--   * schedule_settings.shift_kind_hours: {"opener": {"start": "11:00", "end": "17:00"}, ...}. Optional:
--     a tag with no hours here only tags the shift.
-- Additive. No shift or setting is changed; every existing shift stays untagged.
begin;
alter table public.schedule_shifts add column shift_kind text check (shift_kind in ('opener', 'mid', 'closer'));
alter table public.schedule_settings add column shift_kind_hours jsonb not null default '{}' check (jsonb_typeof(shift_kind_hours) = 'object');
commit;
