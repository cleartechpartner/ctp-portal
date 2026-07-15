import { useState, useEffect, useMemo, useRef } from 'react';
import confetti from 'canvas-confetti';
import { supabase } from '../lib/supabase';
import {
  fetchStaff, fetchTasks, setAssignees, statusPatch,
  initials, staffName, isOverdue, fmtDue, todayISO, safeFileName
} from '../lib/tasks';

// Reusable task panel. On the Tasks page it carries the full bucket picker
// (All | Internal | each client). On a client's page it is pinned to that
// client via fixedClientId. Staff-only by placement: both hosts live inside
// the internal role gate, and every table underneath is staff-RLS'd.

const ALL = 'all';
const INTERNAL = 'internal';

// ---------- completion celebrations ----------
// Fires only on every third completion per person (their own counter,
// kept in this browser), rotating three original animations so it keeps
// its impact: confetti burst, star sparkle, streamers from the edges.

function originFrom(e) {
  return {
    x: e?.clientX ? e.clientX / window.innerWidth : 0.5,
    y: e?.clientY ? e.clientY / window.innerHeight : 0.4
  };
}

const CELEBRATIONS = [
  function burst(e) {
    confetti({
      particleCount: 110, spread: 75, startVelocity: 34,
      disableForReducedMotion: true, origin: originFrom(e)
    });
  },
  function sparkle(e) {
    const origin = originFrom(e);
    confetti({
      particleCount: 40, spread: 100, startVelocity: 22, gravity: 0.55,
      shapes: ['star'], scalar: 1.4, ticks: 220,
      colors: ['#FFD700', '#FFF3B0', '#00B8E6', '#ffffff'],
      disableForReducedMotion: true, origin
    });
    setTimeout(() => confetti({
      particleCount: 18, spread: 360, startVelocity: 8, gravity: 0.4,
      shapes: ['star'], scalar: 0.8, ticks: 160,
      colors: ['#FFD700', '#ffffff'],
      disableForReducedMotion: true, origin
    }), 180);
  },
  function streamers() {
    const common = {
      particleCount: 55, spread: 24, startVelocity: 55, gravity: 0.85,
      shapes: ['square'], scalar: 1.8, ticks: 260, drift: 0.4,
      colors: ['#0052FF', '#00B8E6', '#2ED6A6', '#7C5CFC', '#EF9F27'],
      disableForReducedMotion: true
    };
    confetti({ ...common, angle: 60, origin: { x: 0, y: 0.75 } });
    confetti({ ...common, angle: 120, drift: -0.4, origin: { x: 1, y: 0.75 } });
  }
];

// Month grid: Monday-start weeks, tasks sit on their due date's cell.
function CalendarView({ monthDate, tasks, onPrev, onNext, onToday, onOpen }) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));

  const days = [];
  const d = new Date(gridStart);
  do {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  } while (d.getMonth() === month || d.getDay() !== 1 || days.length < 7);

  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const todayKey = key(new Date());
  const byDay = {};
  for (const t of tasks) {
    if (!t.due_date) continue;
    (byDay[t.due_date] = byDay[t.due_date] || []).push(t);
  }
  const undated = tasks.filter(t => !t.due_date && t.status === 'open').length;
  const monthLabel = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="tm-cal-head">
        <div className="row">
          <button className="btn sm gh" onClick={onPrev}>&lt;</button>
          <button className="btn sm gh" onClick={onToday}>Today</button>
          <button className="btn sm gh" onClick={onNext}>&gt;</button>
        </div>
        <b>{monthLabel}</b>
        <span className="sub">{undated ? `${undated} open without a due date (list view shows them)` : ''}</span>
      </div>
      <div className="tm-cal-grid tm-cal-week">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <div key={w} className="tm-cal-wd">{w}</div>)}
      </div>
      <div className="tm-cal-grid">
        {days.map(day => {
          const k = key(day);
          const inMonth = day.getMonth() === month;
          return (
            <div key={k} className={'tm-cal-cell' + (inMonth ? '' : ' out') + (k === todayKey ? ' today' : '')}>
              <div className="tm-cal-daynum">{day.getDate()}</div>
              {(byDay[k] || []).map(t => (
                <button key={t.id} type="button"
                  className={'tm-cal-task' + (t.status === 'done' ? ' done' : '') + (isOverdue(t) ? ' late' : '')}
                  title={t.title + (t.clients?.name ? ' | ' + t.clients.name : ' | Internal')}
                  onClick={() => onOpen(t.id)}>
                  {t.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function celebrateCompletion(profileId, e) {
  let n = 1;
  try {
    const key = 'tm-completions-' + profileId;
    n = (parseInt(localStorage.getItem(key), 10) || 0) + 1;
    localStorage.setItem(key, String(n));
  } catch { /* private mode: fall back to counting this one as the first */ }
  if (n % 3 !== 0) return;
  const round = Math.floor(n / 3) - 1;
  CELEBRATIONS[round % CELEBRATIONS.length](e);
}

function previewKind(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

// Multi-select staff picker, used for assignees in the add form and the
// task panel. Works like a dropdown: button shows the selection, the
// popover lists every staff member with a checkbox.
function AssigneePicker({ staff, value, onChange, placeholder, avatarMode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const selected = staff.filter(s => value.includes(s.id));
  const label = selected.length === 0
    ? (placeholder || 'Assign to…')
    : selected.map(staffName).join(', ');

  return (
    <div className={'tm-picker' + (avatarMode ? ' tm-picker-avatar' : '')} ref={ref}>
      {avatarMode ? (
        <button type="button" className="tm-avatar-trigger" title={label} onClick={() => setOpen(o => !o)}>
          {selected.length === 0 && <span className="tm-avatar tm-avatar-add">+</span>}
          {selected.slice(0, 3).map(s => <span key={s.id} className="tm-avatar">{initials(s)}</span>)}
          {selected.length > 3 && <span className="tm-avatar tm-avatar-empty">+{selected.length - 3}</span>}
        </button>
      ) : (
        <button type="button" className="tm-picker-btn" onClick={() => setOpen(o => !o)}>
          <span className="tm-picker-label">{label}</span>
          <span className="tm-picker-caret">▾</span>
        </button>
      )}
      {open && (
        <div className="tm-picker-pop">
          {staff.map(s => (
            <label key={s.id} className="tm-picker-opt">
              <input
                type="checkbox"
                checked={value.includes(s.id)}
                onChange={() => onChange(value.includes(s.id) ? value.filter(x => x !== s.id) : [...value, s.id])}
              />
              <span className="tm-avatar">{initials(s)}</span>
              {staffName(s)}
            </label>
          ))}
          {staff.length === 0 && <div className="sub" style={{ padding: 10 }}>No staff profiles found.</div>}
        </div>
      )}
    </div>
  );
}

export default function TaskPanel({ profile, fixedClientId }) {
  const [tasks, setTasks] = useState(null);
  const [staff, setStaff] = useState([]);
  const [clients, setClients] = useState([]);
  const [bucket, setBucket] = useState(fixedClientId ? fixedClientId : ALL);
  const [person, setPerson] = useState('');
  const [view, setView] = useState('list'); // list | calendar
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const [showDone, setShowDone] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [preview, setPreview] = useState(null); // { name, url, kind } | { name, loading }
  const [err, setErr] = useState('');

  // New task form. newClient is picked explicitly in the form: the top
  // dropdown only filters the list and never decides where a task lands.
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayISO());
  const [newAssignees, setNewAssignees] = useState([]);
  const [newClient, setNewClient] = useState(fixedClientId || INTERNAL);
  const [descOpen, setDescOpen] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const [newFile, setNewFile] = useState(null);
  const [newFileUrl, setNewFileUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // Follow the filter as the default, stays editable in the form.
  useEffect(() => {
    if (!fixedClientId) setNewClient(bucket === ALL ? INTERNAL : bucket);
  }, [bucket, fixedClientId]);

  // Object URL for the attachment thumbnail, released when replaced.
  useEffect(() => {
    if (!newFile) { setNewFileUrl(null); return; }
    const url = URL.createObjectURL(newFile);
    setNewFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [newFile]);

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
    } catch (ex) { setErr(ex.message); setTasks([]); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { setNewAssignees(a => a.length ? a : (profile ? [profile.id] : [])); }, [profile?.id]);

  // Refetch whenever this surface regains attention, so a list left open in
  // another browser tab or window can never show stale data after a task
  // was created somewhere else.
  useEffect(() => {
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const effectiveBucket = fixedClientId || bucket;
  const inBucket = (t) => {
    if (effectiveBucket === ALL) return true;
    if (effectiveBucket === INTERNAL) return !t.client_id;
    return t.client_id === effectiveBucket;
  };
  const byPerson = (t) => !person || (t.task_assignees || []).some(a => a.profile_id === person);

  const open = useMemo(() => (tasks || []).filter(t => inBucket(t) && byPerson(t) && t.status === 'open')
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1), [tasks, bucket, person, fixedClientId]);
  const done = useMemo(() => (tasks || []).filter(t => inBucket(t) && byPerson(t) && t.status === 'done')
    .sort((a, b) => (a.completed_at || '') < (b.completed_at || '') ? 1 : -1), [tasks, bucket, person, fixedClientId]);

  const openCount = (b) => (tasks || []).filter(t => {
    if (t.status !== 'open') return false;
    if (b === ALL) return true;
    if (b === INTERNAL) return !t.client_id;
    return t.client_id === b;
  }).length;

  const patchTask = async (id, patch) => {
    setErr('');
    const { error } = await supabase.from('tasks').update(patch).eq('id', id);
    if (error) { setErr(error.message); return false; }
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
    return true;
  };

  const toggleDone = async (t, e) => {
    const next = t.status === 'done' ? 'open' : 'done';
    const ok = await patchTask(t.id, statusPatch(next));
    if (ok && next === 'done') celebrateCompletion(profile.id, e);
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setErr('The task needs a title.'); return; }
    setBusy(true); setErr('');
    try {
      const clientForNew = fixedClientId || (newClient === INTERNAL ? null : newClient);
      const row = {
        client_id: clientForNew,
        title: title.trim(),
        due_date: due || null,
        created_by: profile.id
      };
      if (newDesc.trim()) row.description = newDesc.trim();
      const { data, error } = await supabase.from('tasks').insert(row).select('id').single();
      if (error) throw new Error(error.message);
      if (newAssignees.length) await setAssignees(data.id, newAssignees);
      if (newFile) {
        const path = `${data.id}/${crypto.randomUUID()}_${safeFileName(newFile.name)}`;
        const { error: upErr } = await supabase.storage.from('task-files').upload(path, newFile);
        if (upErr) throw new Error('Task saved, but the file failed: ' + upErr.message);
        const { error: attErr } = await supabase.from('task_attachments').insert({
          task_id: data.id, file_name: newFile.name, file_path: path, uploaded_by: profile.id
        });
        if (attErr) throw new Error('Task saved, but the file failed: ' + attErr.message);
      }
      setTitle(''); setNewFile(null); setNewDesc(''); setDescOpen(false);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const deleteTask = async (t) => {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    setErr('');
    const paths = (t.task_attachments || []).map(a => a.file_path);
    if (paths.length) await supabase.storage.from('task-files').remove(paths);
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) { setErr(error.message); return; }
    if (expandedId === t.id) setExpandedId(null);
    setTasks(ts => ts.filter(x => x.id !== t.id));
  };

  const openPreview = async (att) => {
    setPreview({ name: att.file_name, loading: true });
    const { data, error } = await supabase.storage.from('task-files').createSignedUrl(att.file_path, 300);
    if (error) { setErr(error.message); setPreview(null); return; }
    setPreview({ name: att.file_name, url: data.signedUrl, kind: previewKind(att.file_name) });
  };

  // Escape closes whichever layer is on top: preview first, then the panel.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setPreview(p => {
        if (p) return null;
        setExpandedId(null);
        return p;
      });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!tasks) return <div className="center"><div className="sp" /></div>;

  const staffById = Object.fromEntries(staff.map(s => [s.id, s]));

  const expandedTask = expandedId ? (tasks || []).find(t => t.id === expandedId) : null;

  const row = (t) => {
    const assignees = (t.task_assignees || []).map(a => staffById[a.profile_id]).filter(Boolean);
    const overdue = isOverdue(t);
    return (
      <div key={t.id} className="tm-task-row">
        <input
          type="checkbox"
          className="tm-done-check"
          checked={t.status === 'done'}
          title={t.status === 'done' ? 'Reopen' : 'Mark done'}
          onChange={() => {}}
          onClick={(e) => toggleDone(t, e)}
        />
        <div className="tm-task-main" onClick={() => setExpandedId(t.id)}>
          <div className={'nm' + (t.status === 'done' ? ' tm-done-title' : '')}>{t.title}</div>
          <div className="tm-bubbles">
            <span className="tm-bubble tm-b-client">{t.clients?.name || 'Internal'}</span>
            <span className="tm-avatars tm-row-avatars" title={assignees.map(staffName).join(', ') || 'Unassigned'}>
              {assignees.length === 0 && <span className="tm-avatar tm-avatar-empty">?</span>}
              {assignees.slice(0, 3).map(a => <span key={a.id} className="tm-avatar">{initials(a)}</span>)}
              {assignees.length > 3 && <span className="tm-avatar tm-avatar-empty">+{assignees.length - 3}</span>}
            </span>
            <span className={'tm-bubble ' + (overdue ? 'tm-b-overdue' : 'tm-b-due')}>
              {fmtDue(t.due_date)}{overdue ? ' | overdue' : ''}
            </span>
            {(t.task_attachments || []).map(att => (
              <button key={att.id} type="button" className="tm-bubble tm-b-attach"
                title="Preview attachment"
                onClick={(e) => { e.stopPropagation(); openPreview(att); }}>
                {att.file_name.length > 24 ? att.file_name.slice(0, 21) + '…' : att.file_name}
              </button>
            ))}
          </div>
        </div>
        <button className="icon-btn icon-btn-danger" title="Delete task" onClick={() => deleteTask(t)}>×</button>
      </div>
    );
  };

  // The dropdowns only decide what the list shows. Creation is controlled
  // entirely inside the new-task form below.
  const filters = (
    <>
      <div className="lang-toggle">
        <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Calendar</button>
      </div>
      {!fixedClientId && (
        <select className="sel tm-toolbar-sel" value={bucket} onChange={e => { setBucket(e.target.value); setExpandedId(null); }}>
          <option value={ALL}>All ({openCount(ALL)} open)</option>
          <option value={INTERNAL}>Internal ({openCount(INTERNAL)} open)</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({openCount(c.id)} open)</option>)}
        </select>
      )}
      <select className="sel tm-toolbar-sel" value={person} onChange={e => setPerson(e.target.value)}>
        <option value="">Everyone</option>
        {staff.map(s => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
      </select>
    </>
  );

  return (
    <>
      {!fixedClientId ? (
        <div className="co-header">
          <div><h1>Tasks</h1></div>
          <div className="co-actions">{filters}</div>
        </div>
      ) : (
        <div className="tm-toolbar tm-toolbar-right">{filters}</div>
      )}

      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <form className="tm-newcard" onSubmit={addTask}>
        <div className="tm-quick-row">
          <input className="ti" placeholder="Task details."
            value={title} onChange={e => setTitle(e.target.value)} />
          <input className="ti" type="date" value={due} onChange={e => setDue(e.target.value)} />
          <button className="btn sm" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Add task'}</button>
        </div>
        <div className="tm-newmeta-row">
          <div className="row">
            <AssigneePicker avatarMode staff={staff} value={newAssignees} onChange={setNewAssignees} placeholder="Assign to…" />
            {!fixedClientId && (
              <select className="sel tm-newclient" title="Where this task will be created"
                value={newClient} onChange={e => setNewClient(e.target.value)}>
                <option value={INTERNAL}>Internal</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          {!newFile ? (
            <label className="link-btn" style={{ cursor: 'pointer' }}>
              Attach a file (optional)
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setNewFile(e.target.files?.[0] || null)} />
            </label>
          ) : (
            <div className="tm-file-preview">
              {previewKind(newFile.name) === 'image' && newFileUrl
                ? <img src={newFileUrl} alt="" />
                : <span className="tm-file-ext">{(newFile.name.split('.').pop() || 'file').toUpperCase().slice(0, 5)}</span>}
              <span className="tm-file-name" title={newFile.name}>{newFile.name}</span>
              <button type="button" className="icon-btn icon-btn-danger" title="Remove file"
                onClick={() => { setNewFile(null); if (fileRef.current) fileRef.current.value = ''; }}>×</button>
            </div>
          )}
        </div>
        {!descOpen ? (
          <button type="button" className="link-btn tm-desc-toggle" onClick={() => setDescOpen(true)}>+ Add description</button>
        ) : (
          <textarea className="ta tm-desc-input" placeholder="Description (optional)" autoFocus
            value={newDesc} onChange={e => setNewDesc(e.target.value)} />
        )}
      </form>

      {view === 'list' ? (
        <>
          <div className="co-section-label" style={{ marginTop: 20 }}>Open ({open.length})</div>
          <div className="card" style={{ padding: 0 }}>
            {open.length === 0 && <div className="empty">Nothing open here. Add a task above.</div>}
            {open.map(row)}
          </div>

          <div className="co-section-label" style={{ marginTop: 20 }}>
            <button className="link-btn" onClick={() => setShowDone(s => !s)}>
              {showDone ? 'Hide' : 'Show'} done ({done.length})
            </button>
          </div>
          {showDone && (
            <div className="card" style={{ padding: 0 }}>
              {done.length === 0 && <div className="empty">Nothing completed here yet.</div>}
              {done.map(row)}
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 20 }}>
          <CalendarView
            monthDate={calMonth}
            tasks={[...open, ...done]}
            onPrev={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            onNext={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            onToday={() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); setCalMonth(d); }}
            onOpen={setExpandedId}
          />
        </div>
      )}

      {expandedTask && (
        <div className="tm-slideover-backdrop" onClick={() => setExpandedId(null)}>
          <aside className="tm-slideover" onClick={e => e.stopPropagation()}>
            <div className="tm-slideover-head">
              <h3>Task</h3>
              <button className="icon-btn" title="Close" onClick={() => setExpandedId(null)}>×</button>
            </div>
            <TaskEditor
              key={expandedTask.id}
              task={expandedTask} staff={staff} clients={clients} profile={profile}
              lockedClientId={fixedClientId}
              onChanged={load} onError={setErr} onClose={() => setExpandedId(null)}
              patchTask={patchTask}
            />
          </aside>
        </div>
      )}

      {preview && (
        <div className="es-modal-backdrop" onClick={() => setPreview(null)}>
          <div className="card tm-preview" onClick={e => e.stopPropagation()}>
            <div className="tm-preview-head">
              <div className="nm" title={preview.name}>{preview.name}</div>
              <button className="icon-btn" title="Close preview" onClick={() => setPreview(null)}>×</button>
            </div>
            {preview.loading && <div className="center" style={{ minHeight: 160 }}><div className="sp" /></div>}
            {preview.url && preview.kind === 'image' && (
              <img className="tm-preview-media" src={preview.url} alt={preview.name} />
            )}
            {preview.url && preview.kind === 'pdf' && (
              <iframe className="tm-preview-frame" src={preview.url} title={preview.name} />
            )}
            {preview.url && preview.kind === 'other' && (
              <div className="empty">
                No inline preview for this file type.<br />
                <a className="link-btn" href={preview.url} target="_blank" rel="noopener noreferrer">Download {preview.name}</a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function TaskEditor({ task, staff, clients, profile, lockedClientId, onChanged, onError, onClose, patchTask }) {
  const [form, setForm] = useState({
    title: task.title,
    due_date: task.due_date || '',
    description: task.description || '',
    notes: task.notes || '',
    client_id: task.client_id || INTERNAL
  });
  const [assigned, setAssigned] = useState((task.task_assignees || []).map(a => a.profile_id));
  const [attachments, setAttachments] = useState(task.task_attachments || []);
  const [comments, setComments] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [busy, setBusy] = useState('');

  const loadComments = async () => {
    const { data, error } = await supabase.from('task_comments')
      .select('id, body, created_at, author, profiles(full_name, email)')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true });
    if (error) { setComments([]); onError(error.message); return; }
    setComments(data || []);
  };
  useEffect(() => { loadComments(); }, [task.id]);

  const save = async () => {
    if (!form.title.trim()) { onError('The task needs a title.'); return; }
    setBusy('save');
    try {
      const ok = await patchTask(task.id, {
        title: form.title.trim(),
        due_date: form.due_date || null,
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        client_id: lockedClientId ? lockedClientId : (form.client_id === INTERNAL ? null : form.client_id)
      });
      if (ok) {
        await setAssignees(task.id, assigned);
        await onChanged();
        onClose();
      }
    } catch (ex) { onError(ex.message); }
    setBusy('');
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setBusy('comment');
    const { error } = await supabase.from('task_comments').insert({
      task_id: task.id, author: profile.id, body: newComment.trim()
    });
    if (error) onError(error.message);
    else { setNewComment(''); await loadComments(); }
    setBusy('');
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { onError('Keep attachments under 20 MB.'); return; }
    setBusy('upload');
    try {
      const path = `${task.id}/${crypto.randomUUID()}_${safeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from('task-files').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { error: insErr } = await supabase.from('task_attachments').insert({
        task_id: task.id, file_name: file.name, file_path: path, uploaded_by: profile.id
      });
      if (insErr) throw new Error(insErr.message);
      const { data } = await supabase.from('task_attachments').select('*').eq('task_id', task.id)
        .order('uploaded_at', { ascending: false });
      setAttachments(data || []);
    } catch (ex) { onError(ex.message); }
    setBusy('');
  };

  const download = async (a) => {
    const { data, error } = await supabase.storage.from('task-files').createSignedUrl(a.file_path, 300);
    if (error) { onError(error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const removeAttachment = async (a) => {
    if (!window.confirm(`Remove "${a.file_name}"?`)) return;
    await supabase.storage.from('task-files').remove([a.file_path]);
    const { error } = await supabase.from('task_attachments').delete().eq('id', a.id);
    if (error) { onError(error.message); return; }
    setAttachments(list => list.filter(x => x.id !== a.id));
  };

  const fmtStamp = (ts) => new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className="tm-editor">
      <div className="grid2">
        <div className="fld">
          <label className="lab">Title</label>
          <input className="ti" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="fld">
          <label className="lab">Due date</label>
          <input className="ti" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
        </div>
        {!lockedClientId && (
          <div className="fld">
            <label className="lab">Belongs to</label>
            <select className="sel" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
              <option value={INTERNAL}>Internal</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="fld">
          <label className="lab">Assignees</label>
          <AssigneePicker staff={staff} value={assigned} onChange={setAssigned} placeholder="Assign to…" />
        </div>
      </div>
      <div className="fld">
        <label className="lab">Description</label>
        <textarea className="ta" style={{ minHeight: 80 }} value={form.description}
          placeholder="What this task is about, links, context."
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      {form.notes !== '' && (
        <div className="fld">
          <label className="lab">Notes (older field, kept until emptied)</label>
          <textarea className="ta" style={{ minHeight: 60 }} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      )}
      <div className="fld">
        <label className="lab">Attachments</label>
        {attachments.map(a => (
          <div key={a.id} className="item" style={{ padding: '8px 0' }}>
            <button className="link-btn" onClick={() => download(a)}>{a.file_name}</button>
            <button className="icon-btn icon-btn-danger" title="Remove attachment" onClick={() => removeAttachment(a)}>×</button>
          </div>
        ))}
        <label className="btn sm gh" style={{ display: 'inline-block', cursor: 'pointer', marginTop: 6 }}>
          {busy === 'upload' ? 'Uploading…' : 'Add file'}
          <input type="file" style={{ display: 'none' }} onChange={upload} disabled={busy === 'upload'} />
        </label>
      </div>

      <div className="fld">
        <label className="lab">Comments</label>
        {comments === null && <div className="sub">Loading…</div>}
        {comments && comments.length === 0 && <div className="sub">No comments yet.</div>}
        {(comments || []).map(c => (
          <div key={c.id} className="tm-comment">
            <div className="tm-comment-head">
              <span className="tm-avatar">{initials(c.profiles)}</span>
              <b>{staffName(c.profiles)}</b>
              <span className="meta">{fmtStamp(c.created_at)}</span>
            </div>
            <div className="tm-comment-body">{c.body}</div>
          </div>
        ))}
        <form className="tm-comment-form" onSubmit={postComment}>
          <input className="ti" placeholder="Write a comment…" value={newComment}
            onChange={e => setNewComment(e.target.value)} />
          <button className="btn sm" disabled={busy === 'comment' || !newComment.trim()}>Post</button>
        </form>
      </div>

      <div className="row">
        <button className="btn sm" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button className="btn sm gh" onClick={onClose}>Close</button>
        {task.completed_at && (
          <span className="sub">Completed {fmtStamp(task.completed_at)}. Still editable.</span>
        )}
      </div>
    </div>
  );
}
