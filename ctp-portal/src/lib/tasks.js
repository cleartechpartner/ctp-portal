import { supabase } from './supabase';

export const TASK_STATUS = [
  ['todo', 'To do'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
  ['blocked', 'Blocked']
];

export const TASK_PRIORITY = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High']
];

export const statusLabel = (v) => (TASK_STATUS.find(([k]) => k === v) || [v, v])[1];
export const priorityLabel = (v) => (TASK_PRIORITY.find(([k]) => k === v) || [v, v])[1];

// Setting status to done stamps completed_at; leaving done clears it.
export function statusPatch(status) {
  return { status, completed_at: status === 'done' ? new Date().toISOString() : null };
}

// Staff per the module rule: profile email ends in @cleartechpartner.com.
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .ilike('email', '%@cleartechpartner.com')
    .order('email');
  if (error) throw new Error(error.message);
  return data || [];
}

export function initials(p) {
  const src = (p?.full_name || p?.email || '?').trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function staffName(p) {
  return p?.full_name || (p?.email ? p.email.split('@')[0] : 'Unknown');
}

export function isOverdue(task) {
  if (!task.due_date || task.status === 'done') return false;
  const d = new Date(task.due_date + 'T23:59:59');
  return d < new Date();
}

export function fmtDue(dateStr) {
  if (!dateStr) return 'No due date';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Full task list with everything the queue needs, filtered client side.
export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, clients(id, name), task_projects(id, name), task_assignees(profile_id)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

// Replace the whole assignee set for a task.
export async function setAssignees(taskId, profileIds) {
  const { error: delErr } = await supabase.from('task_assignees').delete().eq('task_id', taskId);
  if (delErr) throw new Error(delErr.message);
  if (profileIds.length) {
    const { error: insErr } = await supabase.from('task_assignees')
      .insert(profileIds.map(pid => ({ task_id: taskId, profile_id: pid })));
    if (insErr) throw new Error(insErr.message);
  }
}
