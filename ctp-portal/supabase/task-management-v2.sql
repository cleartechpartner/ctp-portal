-- ============================================================
-- CTP PORTAL | TASK MANAGEMENT MODULE | MIGRATION V2
-- Replaces the v1 project-based model with flat client-or-internal tasks.
-- ============================================================
-- STEP 0 | AUDIT FIRST. Run these two selects on their own and check the
-- output BEFORE running the rest of this file. If task_projects holds real
-- rows you want to keep, stop and export them first; this migration drops
-- the table.
--
--   select count(*) from public.task_projects;
--   select id, name, client_id, start_date, payment_status, status from public.task_projects;
--
-- Note for the reviewer: the v2 brief says to drop "the projects table".
-- The v1 module table is task_projects (renamed at build time because
-- public.projects is the portal's original work-types table, which time
-- tracking and the client screens depend on). This migration drops
-- task_projects only and does not touch public.projects.

-- ---------- 1 | REMOVE THE V1 MODULE TABLES ----------
-- Dropping a table removes its policies, grants and inbound FK constraints.
-- Order respects the FK chain. is_staff() and the task-files bucket with
-- its storage policy are kept: v2 reuses both.

-- time_entries.task_id only exists if the unmerged v1 phase 2 migration
-- was run; remove it either way so the tasks drop is clean, re-added below.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'time_entries' and column_name = 'task_id'
  ) then
    alter table public.time_entries drop column task_id;
  end if;
end $$;

drop table if exists public.task_attachments;
drop table if exists public.task_assignees;
drop table if exists public.tasks;
drop table if exists public.task_template_items;
drop table if exists public.task_templates;
drop table if exists public.task_projects;

-- ---------- 2 | ADMIN FLAG ----------
-- Boolean on profiles, default false. Gates the Team view in the UI.
-- profiles already carries grants from the base schema; a new column
-- inherits them.

alter table public.profiles add column if not exists is_admin boolean not null default false;
update public.profiles set is_admin = true where email = 'rainy@cleartechpartner.com';

-- ---------- 3 | FLAT TASKS ----------
-- client_id null means internal work.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  title text not null,
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
grant select, insert, update, delete on public.tasks to authenticated;

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (task_id, profile_id)
);
grant select, insert, delete on public.task_assignees to authenticated;

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now()
);
grant select, insert, delete on public.task_attachments to authenticated;

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.task_templates to authenticated;

create table public.task_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates(id) on delete cascade,
  title text not null,
  offset_days integer not null default 0
);
grant select, insert, update, delete on public.task_template_items to authenticated;

-- Re-link time tracking to tasks (carried over from v1 phase 2).
alter table public.time_entries
  add column task_id uuid references public.tasks(id) on delete set null;
create index time_entries_task_idx on public.time_entries(task_id);

-- ---------- 4 | ROW LEVEL SECURITY: staff only ----------
-- is_staff() exists from v1; recreated here so the file stands alone.

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from profiles
    where id = auth.uid()
      and email ilike '%@cleartechpartner.com'
  );
$$;

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_template_items enable row level security;

create policy "staff all tasks" on public.tasks
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task assignees" on public.task_assignees
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task attachments" on public.task_attachments
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task templates" on public.task_templates
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all task template items" on public.task_template_items
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- 5 | STORAGE ----------
-- The private task-files bucket and its "staff all task files" policy were
-- created by the v1 migration and survive the drops above unchanged. The
-- bucket insert below is a no-op on an existing database and covers a
-- fresh one.

insert into storage.buckets (id, name, public)
values ('task-files','task-files', false)
on conflict (id) do nothing;
