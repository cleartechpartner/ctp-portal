-- ============================================================
-- CLEAR TECH PARTNER — PORTAL SCHEMA
-- Run this entire file in: Supabase Dashboard > SQL Editor > New query
-- Safe to run once on a fresh project.
-- ============================================================

-- ---------- TABLES ----------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  property_type text,
  contact_name text,
  contact_email text,
  language text not null default 'en' check (language in ('en','es')),
  status text not null default 'active' check (status in ('active','paused','archived')),
  partner_notes text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'client' check (role in ('internal','client')),
  client_id uuid references public.clients(id) on delete set null,
  language text not null default 'en' check (language in ('en','es')),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  type text not null,
  status text not null default 'planned' check (status in ('planned','in_progress','live','paused','complete')),
  description text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  month text not null, -- e.g. '2026-06'
  title_en text,
  title_es text,
  body_en text,
  body_es text,
  status text not null default 'draft' check (status in ('draft','published')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.updates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null default current_date,
  category text not null default 'update' check (category in ('kb','prompt','feature','fix','learning','update')),
  body_en text not null,
  body_es text,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  category text not null default 'general' check (category in ('contract','dpa','onboarding','invoice','general')),
  storage_path text not null,
  size_bytes bigint,
  uploaded_by text not null default 'internal' check (uploaded_by in ('internal','client')),
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_email text,
  action text not null,
  client_id uuid,
  details text,
  created_at timestamptz not null default now()
);

-- Internal Content Studio persistence (settings + library)
create table public.studio_store (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ---------- HELPERS ----------

create or replace function public.is_internal() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'internal');
$$;

create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from profiles where id = auth.uid();
$$;

-- Auto-create profile on signup. @cleartechpartner.com => internal, else client.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, client_id, language)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    case when new.email ilike '%@cleartechpartner.com' then 'internal' else 'client' end,
    nullif(new.raw_user_meta_data->>'client_id','')::uuid,
    coalesce(nullif(new.raw_user_meta_data->>'language',''),'en')
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- ROW LEVEL SECURITY ----------

alter table public.clients enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.reports enable row level security;
alter table public.updates enable row level security;
alter table public.documents enable row level security;
alter table public.activity_log enable row level security;
alter table public.studio_store enable row level security;

-- profiles
create policy "own profile read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_internal());
create policy "own language update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "internal manage profiles" on public.profiles for all to authenticated
  using (public.is_internal()) with check (public.is_internal());

-- clients
create policy "internal all clients" on public.clients for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "client read own client" on public.clients for select to authenticated
  using (id = public.my_client_id());

-- projects
create policy "internal all projects" on public.projects for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "client read own projects" on public.projects for select to authenticated
  using (client_id = public.my_client_id());

-- reports (clients only see published)
create policy "internal all reports" on public.reports for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "client read published reports" on public.reports for select to authenticated
  using (client_id = public.my_client_id() and status = 'published');

-- updates
create policy "internal all updates" on public.updates for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "client read own updates" on public.updates for select to authenticated
  using (client_id = public.my_client_id());

-- documents
create policy "internal all documents" on public.documents for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "client read own documents" on public.documents for select to authenticated
  using (client_id = public.my_client_id());
create policy "client upload own documents" on public.documents for insert to authenticated
  with check (client_id = public.my_client_id() and uploaded_by = 'client');

-- activity log
create policy "internal read activity" on public.activity_log for select to authenticated
  using (public.is_internal());
create policy "authenticated write own activity" on public.activity_log for insert to authenticated
  with check (actor_email = auth.email());

-- studio store (internal only)
create policy "internal studio store" on public.studio_store for all to authenticated
  using (public.is_internal()) with check (public.is_internal());

-- ---------- STORAGE ----------

insert into storage.buckets (id, name, public)
values ('client-docs','client-docs', false)
on conflict (id) do nothing;

create policy "internal all client docs" on storage.objects for all to authenticated
  using (bucket_id = 'client-docs' and public.is_internal())
  with check (bucket_id = 'client-docs' and public.is_internal());

create policy "client read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'client-docs' and (storage.foldername(name))[1] = public.my_client_id()::text);

create policy "client upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'client-docs' and (storage.foldername(name))[1] = public.my_client_id()::text);
