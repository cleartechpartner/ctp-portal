-- ============================================================
-- CLEAR TECH PARTNER — TIME TRACKING SCHEMA (CTP-SPEC-0001)
-- Run this entire file in: Supabase Dashboard > SQL Editor > New query
-- Requires the base portal schema (schema.sql) to be in place.
-- Safe to run once on a project that already has the base schema.
-- ============================================================

-- ---------- CAP COLUMNS ON EXISTING TABLES ----------

-- Client-level cap: hours or budget (currency), applied per calendar month.
alter table public.clients
  add column time_cap_type text check (time_cap_type in ('hours','budget')),
  add column time_cap_value numeric check (time_cap_value >= 0),
  add column hourly_rate numeric check (hourly_rate >= 0);

-- Optional per-work-type cap (a work type is a project row).
alter table public.projects
  add column time_cap_hours numeric check (time_cap_hours >= 0),
  add column time_cap_budget numeric check (time_cap_budget >= 0);

-- ---------- NEW TABLES ----------

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer not null check (duration_seconds >= 0),
  notes text,
  billable boolean not null default true,
  rate numeric, -- resolved at entry time and frozen, so history does not shift
  created_at timestamptz not null default now()
);

create index time_entries_started_idx on public.time_entries(started_at);
create index time_entries_project_idx on public.time_entries(project_id);

-- One running timer per person, server-backed so it survives refresh and
-- works across devices. Holds the draft entry; the entry row is created
-- when the timer stops.
create table public.time_timers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  notes text,
  billable boolean not null default true,
  running_since timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------- ROW LEVEL SECURITY ----------
-- Internal-only, same pattern as the rest of the portal. Clients never see
-- these tables.

alter table public.time_entries enable row level security;
alter table public.time_timers enable row level security;

create policy "internal all time entries" on public.time_entries for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "internal all time timers" on public.time_timers for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
