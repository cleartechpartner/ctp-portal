-- ============================================================
-- CTP PORTAL | TASK MANAGEMENT MODULE | MIGRATION V3
-- Run once in: Supabase Dashboard > SQL Editor
-- Requires task-management-v2.sql to have run.
-- ============================================================
-- Adds the freeform task description and the comment thread. Nothing
-- else changes shape: task_projects stays dropped, public.projects
-- stays untouched.

alter table public.tasks add column if not exists description text;

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
-- No update or delete grants: comments are append-only in this pass.
grant select, insert on public.task_comments to authenticated;

create index task_comments_task_idx on public.task_comments(task_id);

alter table public.task_comments enable row level security;

create policy "staff read task comments" on public.task_comments
  for select to authenticated
  using (public.is_staff());
create policy "staff write task comments" on public.task_comments
  for insert to authenticated
  with check (public.is_staff() and author = auth.uid());
