-- ============================================================
-- CTP PORTAL | PROSPECT CRM MODULE
-- Run this entire file in: Supabase Dashboard > SQL Editor > New query
-- Requires the base schema (schema.sql), task management v2+ (is_staff()),
-- proposals.sql (client_status, proposals) and time-tracking-v2.sql.
-- Every statement is idempotent; the whole file is safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 1 | PIPELINE COLUMNS ON CLIENTS ----------
-- pipeline_stage and friends are only meaningful while client_status =
-- 'prospect'; converted clients keep the columns as dormant history.
-- location stays the formal proposal address; locality is the short
-- filterable town tag (e.g. 'Es Castell').
-- website and phone are not in the spec's column list but the detail
-- facts strip and the CSV import mapping both need them, so they live
-- here with the rest.

alter table public.clients add column if not exists pipeline_stage text default 'New'
  check (pipeline_stage in ('New','Contacted','Meeting','Proposal Sent','Won','Lost'));
alter table public.clients add column if not exists priority text default 'Medium'
  check (priority in ('High','Medium','Low'));
alter table public.clients add column if not exists logo_url text;
alter table public.clients add column if not exists locality text;
alter table public.clients add column if not exists segment text;
alter table public.clients add column if not exists ownership text;
alter table public.clients add column if not exists next_step text;
alter table public.clients add column if not exists next_step_date date;
alter table public.clients add column if not exists source text;
alter table public.clients add column if not exists website text;
alter table public.clients add column if not exists phone text;
-- Staff members working this prospect. Array of profiles ids; a plain
-- column (not a join table) because assignment is display and filter
-- state, never a security boundary.
alter table public.clients add column if not exists assigned_to uuid[] default '{}';

-- ---------- 2 | CONTACTS ----------

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  full_name text not null,
  role text,
  email text,
  phone text,
  linkedin_url text,
  is_primary boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Contact photos live in the existing avatars bucket (public read,
-- per-uid folder write), so no new storage policies are needed.
alter table public.contacts add column if not exists avatar_url text;

create index if not exists contacts_client_idx on public.contacts(client_id);

-- Keep updated_at honest on every edit.
create or replace function public.contacts_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists contacts_touch_updated on public.contacts;
create trigger contacts_touch_updated
  before update on public.contacts
  for each row execute function public.contacts_touch();

-- ---------- 3 | INTERACTIONS ----------
-- The prospect activity feed. metadata carries proposal ids, resend
-- message ids, open counts and similar cross-module references.

create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  kind text not null check (kind in ('note','call','email','meeting','proposal','task','import','stage_change')),
  title text not null,
  body text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  metadata jsonb default '{}'::jsonb
);

create index if not exists interactions_client_idx on public.interactions(client_id);
create index if not exists interactions_occurred_idx on public.interactions(client_id, occurred_at desc);

-- ---------- 4 | ROW LEVEL SECURITY: staff only ----------
-- Same pattern as the tasks module. There is deliberately NO client-role
-- policy path here: neither table has a policy referencing my_client_id(),
-- my_client_ids() or profile_clients, so client logins (including
-- multi-client users routed through profile_clients) reach zero rows.
-- Prospects never have portal logins at all.

alter table public.contacts enable row level security;
alter table public.interactions enable row level security;

do $$ begin
  create policy "staff all contacts" on public.contacts
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff all interactions" on public.interactions
    for all to authenticated
    using (public.is_staff()) with check (public.is_staff());
exception when duplicate_object then null; end $$;

-- ---------- 5 | TABLE PRIVILEGES ----------
-- Explicit grants; RLS alone is not sufficient in this project. anon gets
-- nothing on either table.

grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.interactions to authenticated;

-- ---------- 6 | STORAGE: logos bucket ----------
-- Public read (logo URLs render straight into the UI), staff-only write.
-- Same guarded-policy pattern as the avatars bucket from the time
-- tracking rework.

insert into storage.buckets (id, name, public)
values ('logos','logos', true)
on conflict (id) do nothing;

do $$ begin
  create policy "logos public read" on storage.objects
    for select to public
    using (bucket_id = 'logos');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "logos staff insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'logos' and public.is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "logos staff update" on storage.objects
    for update to authenticated
    using (bucket_id = 'logos' and public.is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "logos staff delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'logos' and public.is_staff());
exception when duplicate_object then null; end $$;

-- ---------- 7 | PROPOSAL WIRING ----------
-- One machine principle: proposals report into the pipeline on their own.
-- A trigger on proposals covers every send path (staff JWT via the send
-- function) and the public token-signing path (security definer, no
-- portal auth), so no caller has to remember to log the interaction.
-- Sends are detected by sent_at changing so resends are logged too.
-- Manual stage changes in the UI write their own 'stage_change'
-- interactions; this trigger only writes 'proposal' ones.

create or replace function public.proposals_crm_sync() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_number text;
  v_is_prospect boolean;
begin
  v_number := 'CTP-PROP-' || lpad(new.proposal_number::text, 4, '0');
  select client_status = 'prospect' into v_is_prospect
  from clients where id = new.client_id;

  if new.sent_at is not null and new.sent_at is distinct from old.sent_at then
    insert into interactions (client_id, kind, title, body, occurred_at, created_by, metadata)
    values (new.client_id, 'proposal',
            'Proposal sent | ' || v_number,
            new.project_title,
            new.sent_at,
            auth.uid(),
            jsonb_build_object('proposal_id', new.id, 'event', 'sent'));
    if coalesce(v_is_prospect, false) then
      update clients set pipeline_stage = 'Proposal Sent' where id = new.client_id;
    end if;
  end if;

  if new.status = 'signed' and old.status is distinct from 'signed' then
    insert into interactions (client_id, kind, title, body, occurred_at, created_by, metadata)
    values (new.client_id, 'proposal',
            'Proposal signed | ' || v_number,
            new.project_title,
            coalesce(new.signed_at, now()),
            auth.uid(),
            jsonb_build_object('proposal_id', new.id, 'event', 'signed'));
    if coalesce(v_is_prospect, false) then
      update clients set pipeline_stage = 'Won' where id = new.client_id;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists proposals_crm_sync on public.proposals;
create trigger proposals_crm_sync
  after update on public.proposals
  for each row execute function public.proposals_crm_sync();

-- ---------- 8 | FUNCTION EXECUTE HYGIENE ----------
-- Trigger functions are never callable over the API.

revoke all on function public.contacts_touch() from public, anon, authenticated;
revoke all on function public.proposals_crm_sync() from public, anon, authenticated;
