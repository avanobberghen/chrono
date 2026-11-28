-- =====================================================================
-- Update for version 1.12 ("Live"): result screens, session locking,
-- Screen accounts (read-only) and a Sync account (competition PC agent).
--
-- Run once in Supabase > SQL Editor (paste, then Run). Safe to run again.
-- Requires schema.sql and the updates up to 1.10 (session type).
-- Nothing is deleted: existing tables only gain columns.
-- =====================================================================


-- ---------- Live 1. Roles ----------
-- admin  : everything, including locking a session and driving the screens
-- coach  : timing at training (unchanged)
-- screen : account of a display (Raspberry Pi, TV); reads only what is on air
-- sync   : account of the competition PC agent; publishes Excel/OMR results

alter table public.allowed_users drop constraint if exists allowed_users_role_check;
alter table public.allowed_users add constraint allowed_users_role_check
  check (role in ('admin','coach','screen','sync'));

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.allowed_users where user_id = (select auth.uid());
$$;

-- is_member() now covers coaches and admins only: a screen or sync account
-- gets none of the web app's timing rights.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin','coach'), false);
$$;

create or replace function public.is_screen() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'screen', false);
$$;

create or replace function public.is_sync() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'sync', false);
$$;


-- ---------- Live 2. Sessions: mode and lock ----------

alter table public.sessions add column if not exists mode text not null default 'training';
alter table public.sessions drop constraint if exists sessions_mode_check;
alter table public.sessions add constraint sessions_mode_check
  check (mode in ('training','competition'));

-- Locked session: the web app can no longer add taps; only an admin can
-- edit or unlock it. Turn it on during a competition.
alter table public.sessions add column if not exists locked boolean not null default false;

create or replace function public.session_locked(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select locked from public.sessions where id = sid), false);
$$;


-- ---------- Live 3. Screens ----------
-- One row per physical display. The app's Live menu (admin) picks the session
-- and the view; the page /screen?ecran=<id> follows this row in real time.

create table if not exists public.screens (
  id         text primary key check (id ~ '^[a-z0-9-]{1,32}$'),   -- e.g. 'ecran1'
  name       text not null,                                        -- e.g. 'TV buvette'
  session_id uuid references public.sessions(id) on delete set null,
  view       text not null default 'general'
             check (view in ('general','category','last','rotation','message')),
  options    jsonb not null default '{}'::jsonb,   -- e.g. {"category":"U13","rotate_s":15,"message":"Pause"}
  live       boolean not null default false,       -- false: the display shows the club logo
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- True when the session is currently on air on at least one display.
create or replace function public.on_screen(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.screens where session_id = sid and live);
$$;

create or replace function public.touch_screen() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists screens_touch on public.screens;
create trigger screens_touch before insert or update on public.screens
  for each row execute function public.touch_screen();


-- ---------- Live 4. Published results (competition) ----------
-- At a competition Excel is the reference: the PC agent publishes here the ranking
-- Excel computed (one JSON snapshot per session), and displays show it as is.
-- seq grows with every export: an old file resent after a network cut
-- cannot overwrite a newer ranking.

create table if not exists public.published_results (
  session_id   uuid primary key references public.sessions(id) on delete cascade,
  payload      jsonb  not null,
  seq          bigint not null,
  source       text   not null default 'excel' check (source in ('excel','omr','webapp')),
  published_at timestamptz not null default now(),
  published_by uuid default auth.uid()
);

-- History of every publication: who published what, and when.
create table if not exists public.published_results_log (
  id           bigint generated always as identity primary key,
  session_id   uuid   not null,
  seq          bigint not null,
  source       text   not null,
  payload      jsonb  not null,
  published_at timestamptz not null default now(),
  published_by uuid
);

create or replace function public.guard_published_results() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.seq < old.seq then
    raise exception 'Older than the published ranking (seq % < %)', new.seq, old.seq
      using errcode = 'P0001';
  end if;
  new.published_at := now();
  new.published_by := auth.uid();
  insert into public.published_results_log (session_id, seq, source, payload, published_by)
    values (new.session_id, new.seq, new.source, new.payload, new.published_by);
  return new;
end;
$$;

drop trigger if exists published_results_guard on public.published_results;
create trigger published_results_guard before insert or update on public.published_results
  for each row execute function public.guard_published_results();


-- ---------- Live 5. Taps log: origin ----------
-- Lets other sources (OMR, Excel, sensors) join the same log later.

alter table public.events add column if not exists source text not null default 'webapp';
alter table public.events drop constraint if exists events_source_check;
alter table public.events add constraint events_source_check
  check (source in ('webapp','omr','excel','sensor'));

-- Origin reference, e.g. the sheet's QR code "FZ|<compet>|<zone>|<run>".
alter table public.events add column if not exists ext_ref text;
create index if not exists events_ext_ref_idx on public.events(ext_ref) where ext_ref is not null;


-- ---------- Live 6. Access rules (Row Level Security) ----------

alter table public.screens               enable row level security;
alter table public.published_results     enable row level security;
alter table public.published_results_log enable row level security;

grant select, insert, update, delete on public.screens, public.published_results to authenticated;
grant select on public.published_results_log to authenticated;
revoke all on public.screens, public.published_results, public.published_results_log from anon;
grant execute on function public.my_role(), public.is_screen(), public.is_sync(),
  public.session_locked(uuid), public.on_screen(uuid) to authenticated;
revoke execute on function public.my_role(), public.is_screen(), public.is_sync(),
  public.session_locked(uuid), public.on_screen(uuid) from anon, public;

-- Sessions: a screen sees only sessions on air; the sync agent sees them all.
-- A locked session can be edited (or unlocked) by an admin only,
-- and a coach cannot lock one.
drop policy if exists sessions_select on public.sessions;
drop policy if exists sessions_update on public.sessions;
create policy sessions_select on public.sessions for select to authenticated
  using (public.is_member() or public.is_sync() or (public.is_screen() and public.on_screen(id)));
create policy sessions_update on public.sessions for update to authenticated
  using      (public.is_admin() or (public.is_member() and not locked))
  with check (public.is_admin() or (public.is_member() and not locked));

-- Riders: screens read the names to display them.
drop policy if exists riders_select on public.riders;
create policy riders_select on public.riders for select to authenticated
  using (public.is_member() or public.is_screen());

-- Taps: the web app writes only into unlocked sessions and under its own source;
-- the sync agent only under omr/excel/sensor. Still nobody edits or deletes.
drop policy if exists events_select on public.events;
drop policy if exists events_insert on public.events;
create policy events_select on public.events for select to authenticated
  using (public.is_member() or public.is_sync() or (public.is_screen() and public.on_screen(session_id)));
create policy events_insert on public.events for insert to authenticated with check (
     (public.is_member() and source = 'webapp' and not public.session_locked(session_id))
  or (public.is_sync()   and source <> 'webapp'));

-- Screens: every signed-in account reads, only admins drive them.
drop policy if exists screens_select on public.screens;
drop policy if exists screens_write  on public.screens;
create policy screens_select on public.screens for select to authenticated
  using (public.is_member() or public.is_screen() or public.is_sync());
create policy screens_write on public.screens for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Published results: the sync agent and admins publish; screens read what is on air.
drop policy if exists pr_select on public.published_results;
drop policy if exists pr_insert on public.published_results;
drop policy if exists pr_update on public.published_results;
drop policy if exists pr_delete on public.published_results;
create policy pr_select on public.published_results for select to authenticated
  using (public.is_member() or public.is_sync() or (public.is_screen() and public.on_screen(session_id)));
create policy pr_insert on public.published_results for insert to authenticated
  with check (public.is_sync() or public.is_admin());
create policy pr_update on public.published_results for update to authenticated
  using (public.is_sync() or public.is_admin()) with check (public.is_sync() or public.is_admin());
create policy pr_delete on public.published_results for delete to authenticated
  using (public.is_admin());

-- History: admins read it; only the trigger writes it.
drop policy if exists prl_select on public.published_results_log;
create policy prl_select on public.published_results_log for select to authenticated
  using (public.is_admin());


-- ---------- Live 7. Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['screens','published_results'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Screen and Sync accounts (adapt) ----------
-- 1) Add the addresses to the allow-list (uncomment and adapt):
-- insert into public.allowed_users (email, name, role) values
--   ('ecran1@chouetbikeclub.fr', 'Screen 1', 'screen'),
--   ('sync@chouetbikeclub.fr',   'Competition PC', 'sync')
-- on conflict (email) do update set role = excluded.role, name = excluded.name;
--
-- 2) Then create the accounts in Supabase > Authentication > Add user
--    (tick "Auto Confirm User"), each with a long, unique password.
--
-- 3) Declare the display:
-- insert into public.screens (id, name) values ('ecran1', 'Screen 1') on conflict do nothing;
