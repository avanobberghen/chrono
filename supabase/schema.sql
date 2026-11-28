-- =====================================================================
-- Chrono: Supabase database
-- Paste the whole file into Supabase > SQL Editor > New query, then Run.
-- It can be run again safely (it never deletes data).
--
-- BEFORE RUNNING: in the Supabase SQL editor (not in this file on GitHub),
-- replace the email and name at the very end with your own: you become the first admin.
-- Keep this file generic in your repository so your email is never published.
-- =====================================================================

-- ---------- Tables ----------

-- Allowed coaches (allow-list). Only these addresses can create an account.
create table if not exists public.allowed_users (
  email   text primary key,
  name    text not null,
  role    text not null default 'coach' check (role in ('admin','coach','screen','sync')),  -- screen and sync: see version 1.12 below
  user_id uuid unique references auth.users(id) on delete set null
);

-- Club riders
create table if not exists public.riders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  grp        text not null default '',
  category   text not null default '',   -- age class, e.g. U11, U13
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Added in version 1.4 (for databases created before):
alter table public.riders add column if not exists category text not null default '';

-- Timing sessions
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  date       date not null default current_date,
  archived   boolean not null default false,
  rider_ids  uuid[] not null default '{}',
  gpx        jsonb,
  kind       text,                      -- session type: 'course', 'circuit' or 'trial' (decides the posts offered)
  trial      jsonb,                     -- trial zones: gates and their points, penalties, time limit
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Log of taps (start, split, lap, finish, undo).
-- Rows are only ever added: this is what makes offline sync reliable.
create table if not exists public.events (
  id         uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  rider_id   uuid not null,
  type       text not null check (type in ('start','split','lap','finish','void','trial')),
  ts         bigint not null,           -- moment of the tap, in milliseconds (server clock)
  target     uuid,                      -- for 'void': the tap being undone; for 'trial': the passage corrected
  data       jsonb,                     -- trial passage: zone, gates, penalties, time
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists events_session_idx on public.events(session_id);

-- ---------- Functions ----------

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.allowed_users where user_id = (select auth.uid()));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.allowed_users where user_id = (select auth.uid()) and role = 'admin');
$$;

-- Server time in milliseconds: used to align the phones' clocks.
create or replace function public.server_time() returns bigint
language sql volatile set search_path = '' as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- On sign-up: refuse addresses that are not in the allow-list.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.allowed_users set user_id = new.id where email = lower(new.email);
  if not found then
    raise exception 'Email address not allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- When a coach is added: normalise the email and link an existing account.
create or replace function public.link_allowed_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(trim(new.email));
  select id into new.user_id from auth.users where lower(email) = new.email;
  return new;
end;
$$;

drop trigger if exists allowed_users_link on public.allowed_users;
create trigger allowed_users_link
  before insert on public.allowed_users
  for each row execute function public.link_allowed_user();

-- ---------- Access rules (Row Level Security) ----------

alter table public.allowed_users enable row level security;
alter table public.riders        enable row level security;
alter table public.sessions      enable row level security;
alter table public.events        enable row level security;

grant select, insert, update, delete on public.allowed_users, public.riders, public.sessions, public.events to authenticated;
revoke all on public.allowed_users, public.riders, public.sessions, public.events from anon;
grant execute on function public.is_member(), public.is_admin() to authenticated;
grant execute on function public.server_time() to anon, authenticated;

-- Coaches: each sees their own row, admins manage everything.
drop policy if exists au_select on public.allowed_users;
drop policy if exists au_insert on public.allowed_users;
drop policy if exists au_update on public.allowed_users;
drop policy if exists au_delete on public.allowed_users;
create policy au_select on public.allowed_users for select to authenticated using (public.is_admin() or user_id = (select auth.uid()));
create policy au_insert on public.allowed_users for insert to authenticated with check (public.is_admin());
create policy au_update on public.allowed_users for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy au_delete on public.allowed_users for delete to authenticated using (public.is_admin());

-- Riders: any coach reads and adds, only admins change.
drop policy if exists riders_select on public.riders;
drop policy if exists riders_insert on public.riders;
drop policy if exists riders_update on public.riders;
create policy riders_select on public.riders for select to authenticated using (public.is_member());
create policy riders_insert on public.riders for insert to authenticated with check (public.is_member());
create policy riders_update on public.riders for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Sessions: any coach reads, creates and edits; only admins delete.
drop policy if exists sessions_select on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
drop policy if exists sessions_delete on public.sessions;
create policy sessions_select on public.sessions for select to authenticated using (public.is_member());
create policy sessions_insert on public.sessions for insert to authenticated with check (public.is_member());
create policy sessions_update on public.sessions for update to authenticated using (public.is_member()) with check (public.is_member());
create policy sessions_delete on public.sessions for delete to authenticated using (public.is_admin());

-- Taps: any coach reads and adds; nobody edits or deletes.
drop policy if exists events_select on public.events;
drop policy if exists events_insert on public.events;
create policy events_select on public.events for select to authenticated using (public.is_member());
create policy events_insert on public.events for insert to authenticated with check (public.is_member());

-- ---------- Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['events','sessions','riders'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =====================================================================
-- Added in version 1.12 ("Live"): result screens, session lock,
-- Screen accounts (read-only) and a Sync account (competition PC agent).
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

-- ---------- First admin ----------
-- REPLACE the email and name below in the Supabase SQL editor before clicking Run.
insert into public.allowed_users (email, name, role)
select email, name, 'admin' from (values ('admin@example.com', 'Admin Name')) as v(email, name)
where email <> 'admin@example.com'          -- nothing is added while the example address is left unchanged
on conflict (email) do nothing;
