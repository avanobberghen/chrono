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
  role    text not null default 'coach' check (role in ('admin','coach')),
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

-- ---------- First admin ----------
-- REPLACE the email and name below in the Supabase SQL editor before clicking Run.
insert into public.allowed_users (email, name, role)
select email, name, 'admin' from (values ('admin@example.com', 'Admin Name')) as v(email, name)
where email <> 'admin@example.com'          -- nothing is added while the example address is left unchanged
on conflict (email) do nothing;
