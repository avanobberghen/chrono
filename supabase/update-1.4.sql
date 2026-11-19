-- Chrono 1.4: rider categories (age classes).
-- For a database created with an earlier version: paste into Supabase > SQL Editor > New query, then Run.
-- Safe to run more than once. New installations do not need it (schema.sql already includes it).
alter table public.riders add column if not exists category text not null default '';
