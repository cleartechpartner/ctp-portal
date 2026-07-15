-- ============================================================
-- CTP PORTAL | TASK MANAGEMENT MODULE | MIGRATION (PHASE 2)
-- Run once in: Supabase Dashboard > SQL Editor
-- Requires task-management.sql (phase 1) and time-tracking.sql.
-- ============================================================
-- Links tasks to the existing time tracking so time can be logged
-- against a task. Reuses time_entries as is: one nullable column, no
-- rebuild. Grants and RLS on time_entries already exist and cover the
-- new column.

alter table public.time_entries
  add column task_id uuid references public.tasks(id) on delete set null;

create index time_entries_task_idx on public.time_entries(task_id);
