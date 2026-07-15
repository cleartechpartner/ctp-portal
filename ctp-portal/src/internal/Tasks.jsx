import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  TASK_STATUS, TASK_PRIORITY, statusPatch, fetchStaff, fetchTasks,
  setAssignees, initials, staffName, isOverdue, fmtDue
} from '../lib/tasks';
import TaskProjects from './TaskProjects';

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export default function Tasks({ profile }) {
  const location = useLocation();
  const tab = location.hash === '#projects' ? 'projects' : 'queue';

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Tasks</h1>
          <p className="sub">The team queue. Clients never see this.</p>
        </div>
      </div>
      <div className="tt-tabs">
        <a href="/tasks" className={'tt-tab' + (tab === 'queue' ? ' on' : '')}>Tasks</a>
        <a href="/tasks#projects" className={'tt-tab' + (tab === 'projects' ? ' on' : '')}>Projects</a>
      </div>
      {tab === 'queue' ? <TaskQueue profile={profile} /> : <TaskProjects embedded />}
    </div>
  );
}

function TaskQueue({ profile }) {
  const nav = useNavigate();
  const [tasks, setTasks] = useState(null);
  const [staff, setStaff] = useState([]);
  const [clients, setClients] = useState([]);
  const [err, setErr] = useState('');

  const [scope, setScope] = useState('mine'); // mine | all
  const [fAssignee, setFAssignee] = useState('');
  const [fClient, setFClient] = useState('');
  const [fStatus, setFStatus] = useState('open'); // open | all | one of TASK_STATUS
  const [fPriority, setFPriority] = useState('');
  const [sortBy, setSortBy] = useState('due'); // due | priority | client | created

  const [quick, setQuick] = useState({ title: '', client_id: '', due_date: todayISO() });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr('');
    try {
      const [ts, st, { data: cs }] = await Promise.all([
        fetchTasks(),
        fetchStaff(),
        supabase.from('clients').select('id, name').order('name')
      ]);
      setTasks(ts);
      setStaff(st);
      setClients(cs || []);
    } catch (ex) {
      setErr(ex.message);
      setTasks([]);
    }
  };
  useEffect(() => { load(); }, []);

  const staffById = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff]);

  const visible = useMemo(() => {
    if (!tasks) return [];
    let list = tasks;
    if (scope === 'mine') list = list.filter(t => (t.task_assignees || []).some(a => a.profile_id === profile.id));
    if (fAssignee) list = list.filter(t => (t.task_assignees || []).some(a => a.profile_id === fAssignee));
    if (fClient) list = list.filter(t => t.client_id === fClient);
    if (fStatus === 'open') list = list.filter(t => t.status !== 'done');
    else if (fStatus !== 'all') list = list.filter(t => t.status === fStatus);
    if (fPriority) list = list.filter(t => t.priority === fPriority);

    const key = {
      due: (t) => t.due_date || '9999-12-31',
      priority: (t) => PRIORITY_RANK[t.priority] ?? 9,
      client: (t) => t.clients?.name || '￿',
      created: (t) => t.created_at
    }[sortBy];
    return [...list].sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka < kb) return sortBy === 'created' ? 1 : -1;
      if (ka > kb) return sortBy === 'created' ? -1 : 1;
      return 0;
    });
  }, [tasks, scope, fAssignee, fClient, fStatus, fPriority, sortBy, profile.id]);

  const patchTask = async (id, patch) => {
    setErr('');
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
  };

  const toggleDone = (t) => patchTask(t.id, statusPatch(t.status === 'done' ? 'todo' : 'done'));

  const reassign = async (t, profileId) => {
    if (!profileId) return;
    setErr('');
    try {
      await setAssignees(t.id, [profileId]);
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, task_assignees: [{ profile_id: profileId }] } : x));
    } catch (ex) { setErr(ex.message); }
  };

  const quickAdd = async (e) => {
    e.preventDefault();
    if (!quick.title.trim() || !quick.client_id) { setErr('A task needs a title and a client.'); return; }
    setBusy(true); setErr('');
    try {
      const { data, error } = await supabase.from('tasks').insert({
        client_id: quick.client_id,
        title: quick.title.trim(),
        due_date: quick.due_date || null,
        created_by: profile.id
      }).select('id').single();
      if (error) throw new Error(error.message);
      await setAssignees(data.id, [profile.id]);
      setQuick(q => ({ ...q, title: '' }));
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  if (!tasks) return <div className="center"><div className="sp" /></div>;

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <form className="card" onSubmit={quickAdd}>
        <div className="tm-quick-row">
          <input className="ti" placeholder="Add a task…" value={quick.title}
            onChange={e => setQuick(q => ({ ...q, title: e.target.value }))} />
          <select className="sel" value={quick.client_id} onChange={e => setQuick(q => ({ ...q, client_id: e.target.value }))}>
            <option value="">Client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="ti" type="date" value={quick.due_date} onChange={e => setQuick(q => ({ ...q, due_date: e.target.value }))} />
          <button className="btn sm" disabled={busy || !quick.title.trim() || !quick.client_id}>Add task</button>
        </div>
      </form>

      <div className="tm-filters">
        <div className="lang-toggle">
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>My tasks</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All tasks</button>
        </div>
        <select className="sel tm-filter" value={fAssignee} onChange={e => setFAssignee(e.target.value)}>
          <option value="">Any assignee</option>
          {staff.map(s => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
        </select>
        <select className="sel tm-filter" value={fClient} onChange={e => setFClient(e.target.value)}>
          <option value="">Any client</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="sel tm-filter" value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="open">Open (not done)</option>
          <option value="all">Any status</option>
          {TASK_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="sel tm-filter" value={fPriority} onChange={e => setFPriority(e.target.value)}>
          <option value="">Any priority</option>
          {TASK_PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="sel tm-filter" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="due">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="client">Sort: client</option>
          <option value="created">Sort: newest</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 14 }}>
        {visible.length === 0 && (
          <div className="empty">
            {scope === 'mine' ? 'Nothing assigned to you here. Flip to All tasks or add one above.' : 'No tasks match these filters.'}
          </div>
        )}
        {visible.map(t => {
          const assignees = (t.task_assignees || []).map(a => staffById[a.profile_id]).filter(Boolean);
          const overdue = isOverdue(t);
          return (
            <div key={t.id} className={'tm-task-row tm-pri-' + t.priority}>
              <input
                type="checkbox"
                className="tm-done-check"
                checked={t.status === 'done'}
                title={t.status === 'done' ? 'Reopen' : 'Mark done'}
                onChange={() => toggleDone(t)}
              />
              <div className="tm-task-main" onClick={() => nav(`/tasks/${t.id}`)}>
                <div className={'nm' + (t.status === 'done' ? ' tm-done-title' : '')}>{t.title}</div>
                <div className="meta">
                  {t.clients?.name || 'No client'}
                  {t.task_projects?.name ? ` | ${t.task_projects.name}` : ''}
                  {' | '}
                  <span className={overdue ? 'tm-overdue' : ''}>{fmtDue(t.due_date)}{overdue ? ' (overdue)' : ''}</span>
                </div>
              </div>
              <div className="tm-avatars" title={assignees.map(staffName).join(', ') || 'Unassigned'}>
                {assignees.length === 0 && <span className="tm-avatar tm-avatar-empty">?</span>}
                {assignees.slice(0, 3).map(a => <span key={a.id} className="tm-avatar">{initials(a)}</span>)}
                {assignees.length > 3 && <span className="tm-avatar tm-avatar-empty">+{assignees.length - 3}</span>}
              </div>
              <select className="sel tm-row-sel" value="" title="Reassign"
                onChange={e => reassign(t, e.target.value)}>
                <option value="">Reassign…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
              </select>
              <select
                className={'status-pill tm-ts-' + t.status}
                value={t.status}
                onChange={e => patchTask(t.id, statusPatch(e.target.value))}
              >
                {TASK_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    </>
  );
}
