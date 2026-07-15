import { supabase } from './supabase';

// Task helpers for the flat v2 model: a task belongs to a client or to
// no client at all (internal work). Status is open or done.

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Marking done stamps completed_at; reopening clears it.
export function statusPatch(status) {
  return { status, completed_at: status === 'done' ? new Date().toISOString() : null };
}

// Staff per the module rule: profile email ends in @cleartechpartner.com.
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_admin')
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
  return new Date(task.due_date + 'T23:59:59') < new Date();
}

export function fmtDue(dateStr) {
  if (!dateStr) return 'No due date';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function fetchTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, clients(id, name), task_assignees(profile_id), task_attachments(id, file_name, file_path)')
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

export function safeFileName(name) {
  return (name || 'file').replace(/[^a-z0-9 _.\-()]/gi, '').trim().slice(0, 80) || 'file';
}
