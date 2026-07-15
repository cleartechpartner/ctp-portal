-- ============================================================
-- CTP PORTAL | TASK MANAGEMENT MODULE | MIGRATION (PHASE 1)
-- Run this entire file once in: Supabase Dashboard > SQL Editor
-- Requires the base portal schema (schema.sql) to be in place.
-- ============================================================
-- One adaptation from the build brief, flagged for review: the portal
-- already has public.projects (client work types used by the client
-- portal screens and time tracking). Creating the brief's projects table
-- under that name would fail and break existing features, so this
-- module's project entity is named task_projects. Columns, checks and
-- grants are otherwise exactly as the brief specifies.

-- ---------- STAFF RULE ----------
-- Internal staff: the profile email ends in @cleartechpartner.com.
-- Used by every policy in this module. Clients never see these tables.

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from profiles
    where id = auth.uid()
      and email ilike '%@cleartechpartner.com'
  );
$$;

-- ---------- TASK PROJECTS: a client can have one or more. Each is a Gantt bar.

create table public.task_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  start_date date not null,
  target_duration_weeks numeric not null default 1,
  payment_status text not null default 'paid'
    check (payment_status in ('paid','unpaid')),
  status text not null default 'active'
    check (status in ('active','complete','on_hold')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.task_projects to authenticated;

-- ---------- TASK TEMPLATES: reusable groups (onboarding, offboarding, monthly, other)

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_duration_weeks numeric not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.task_templates to authenticated;

-- ---------- TASK TEMPLATE ITEMS: the tasks inside a template, with relative timing

create table public.task_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low','medium','high')),
  offset_days integer not null default 0,   -- days after project start
  duration_days integer not null default 1,
  sort_order integer not null default 0
);
grant select, insert, update, delete on public.task_template_items to authenticated;

-- ---------- TASKS: live task instances

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  project_id uuid references public.task_projects(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo'
    check (status in ('todo','in_progress','done','blocked')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high')),
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
grant select, insert, update, delete on public.tasks to authenticated;

-- ---------- TASK ASSIGNEES: multi and joint assignment

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, profile_id)
);
grant select, insert, delete on public.task_assignees to authenticated;

-- ---------- TASK ATTACHMENTS: files per task (Supabase Storage)

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);
grant select, insert, delete on public.task_attachments to authenticated;

-- ---------- ROW LEVEL SECURITY: staff only, on all six tables ----------

alter table public.task_projects enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_template_items enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_attachments enable row level security;

create policy "staff all task projects" on public.task_projects
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task templates" on public.task_templates
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task template items" on public.task_template_items
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all tasks" on public.tasks
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task assignees" on public.task_assignees
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task attachments" on public.task_attachments
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- STORAGE: private bucket for task attachments, staff only ----------

insert into storage.buckets (id, name, public)
values ('task-files','task-files', false)
on conflict (id) do nothing;

create policy "staff all task files" on storage.objects
  for all to authenticated
  using (bucket_id = 'task-files' and public.is_staff())
  with check (bucket_id = 'task-files' and public.is_staff());
