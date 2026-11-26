-- Update for version 1.9 (trial zones and passages). Run once in the Supabase SQL editor.
-- Safe to run again.
alter table public.sessions add column if not exists trial jsonb;
alter table public.events add column if not exists data jsonb;
alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check check (type in ('start','split','lap','finish','void','trial'));
