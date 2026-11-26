-- Update for version 1.10 (session type: course, circuit or trial). Run once in the Supabase SQL editor.
-- Safe to run again.
alter table public.sessions add column if not exists kind text;
