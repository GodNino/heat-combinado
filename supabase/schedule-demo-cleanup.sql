-- Run once in the Supabase SQL editor, after 037_demo_copies.sql, in any project with a demo kitchen.
-- Every night at 04:17 UTC it removes demo copies older than 7 days and the anonymous accounts left
-- with nothing (see purge_expired_demos in 037). It uses pg_cron, which Supabase includes.
-- Running it again replaces the schedule rather than adding a second one.
create extension if not exists pg_cron;

select cron.schedule('purge-demo-copies', '17 4 * * *', $$select public.purge_expired_demos()$$);
