-- ============================================================
-- CLEAR TECH PARTNER — TIME TRACKING REWORK (CTP-SPEC-0002)
-- Harvest-style rework. Run once in: Supabase Dashboard > SQL Editor.
-- Requires time-tracking.sql (v1) to already be in place.
--
-- What changes:
--   * Time now attaches to a CLIENT + a standalone CATEGORY, not a
--     project/work-type. Categories are their own editable list and are
--     independent of Task Manager tasks. An entry MAY optionally link to a
--     real task for traceability, but never has to.
--   * project_id stays on the tables (nullable) so historical entries keep
--     rendering; new entries use client_id + category_id.
--   * Adds profiles.avatar_url and the public "avatars" bucket that the
--     account area / settings panel upload to.
-- Safe to run once; every statement is guarded with IF (NOT) EXISTS.
-- ============================================================

-- ---------- CATEGORIES ----------
-- A small, editable lookup list. Seeded with the starters from the spec.
create table if not exists public.time_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.time_categories to authenticated;

alter table public.time_categories enable row level security;

do $$ begin
  create policy "internal all time categories" on public.time_categories
    for all to authenticated
    using (public.is_internal()) with check (public.is_internal());
exception when duplicate_object then null; end $$;

-- Seed the starter categories once (only when the table is still empty).
insert into public.time_categories (name, position)
select v.name, v.position
from (values
  ('1:1''s', 0),
  ('Client work', 1),
  ('Admin / ops', 2),
  ('Onboarding', 3),
  ('Other', 4)
) as v(name, position)
where not exists (select 1 from public.time_categories);

-- ---------- ENTRY / TIMER COLUMNS ----------
-- Attach entries to a client + category (+ optional task link). project_id
-- is kept but relaxed to nullable for backward compatibility.
alter table public.time_entries
  add column if not exists client_id   uuid references public.clients(id) on delete cascade,
  add column if not exists category_id uuid references public.time_categories(id) on delete set null,
  add column if not exists task_id     uuid references public.tasks(id) on delete set null;

alter table public.time_entries alter column project_id drop not null;

alter table public.time_timers
  add column if not exists client_id   uuid references public.clients(id) on delete cascade,
  add column if not exists category_id uuid references public.time_categories(id) on delete set null,
  add column if not exists task_id     uuid references public.tasks(id) on delete set null;

alter table public.time_timers alter column project_id drop not null;

-- Backfill client_id on historical rows from their project, so old entries
-- still group under the right client in the new client-first views.
update public.time_entries e
  set client_id = p.client_id
  from public.projects p
  where e.project_id = p.id and e.client_id is null;

create index if not exists time_entries_client_idx on public.time_entries(client_id);
create index if not exists time_entries_category_idx on public.time_entries(category_id);

-- ---------- PER-CLIENT CURRENCY ----------
-- Rates are billed per client; some clients (e.g. Backpocket CPA) are in USD,
-- not EUR. Reports/summary render the symbol for the client's own currency.
alter table public.clients
  add column if not exists currency text not null default 'EUR' check (currency in ('EUR','USD'));

-- ---------- AVATARS (account area + settings panel) ----------
alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars','avatars', true)
on conflict (id) do nothing;

-- Anyone may read (bucket is public); each user writes only inside a folder
-- named after their own uid, e.g. "<uid>/avatar-123.png".
do $$ begin
  create policy "avatars public read" on storage.objects
    for select to public
    using (bucket_id = 'avatars');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatars owner write" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatars owner update" on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatars owner delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
