import { useState, useEffect, useMemo, useRef } from 'react';
import confetti from 'canvas-confetti';
import { supabase } from '../lib/supabase';
import {
  fetchStaff, fetchTasks, setAssignees, statusPatch,
  initials, staffName, isOverdue, fmtDue, todayISO, safeFileName
} from '../lib/tasks';

// Flat model: a task belongs to a client or to the Internal bucket.
// No wizard, no intermediate object.

const INTERNAL = 'internal';

function celebrate(e) {
  confetti({
    particleCount: 90,
    spread: 70,
    startVelocity: 32,
    disableForReducedMotion: true,
    origin: {
      x: e?.clientX ? e.clientX / window.innerWidth : 0.5,
      y: e?.clientY ? e.clientY / window.innerHeight : 0.4
    }
  });
}

export default function Tasks({ profile }) {
  const [tasks, setTasks] = useState(null);
  const [staff, setStaff] = useState([]);
  const [clients, setClients] = useState([]);
  const [bucket, setBucket] = useState(INTERNAL);
  const [showDone, setShowDone] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [err, setErr] = useState('');

  // New task form
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayISO());
  const [newAssignees, setNewAssignees] = useState([]);
  const [newFile, setNewFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

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

  const inBucket = (t) => bucket === INTERNAL ? !t.client_id : t.client_id === bucket;
  const open = useMemo(() => (tasks || []).filter(t => inBucket(t) && t.status === 'open')
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1), [tasks, bucket]);
  const done = useMemo(() => (tasks || []).filter(t => inBucket(t) && t.status === 'done')
    .sort((a, b) => (a.completed_at || '') < (b.completed_at || '') ? 1 : -1), [tasks, bucket]);

  const openCount = (b) => (tasks || []).filter(t => (b === INTERNAL ? !t.client_id : t.client_id === b) && t.status === 'open').length;

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
    if (ok && next === 'done') celebrate(e);
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setErr('The task needs a title.'); return; }
    setBusy(true); setErr('');
    try {
      const { data, error } = await supabase.from('tasks').insert({
        client_id: bucket === INTERNAL ? null : bucket,
        title: title.trim(),
        due_date: due || null,
        created_by: profile.id
      }).select('id').single();
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
      setTitle(''); setNewFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const deleteTask = async (t) => {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    setErr('');
    const { data: atts } = await supabase.from('task_attachments').select('file_path').eq('task_id', t.id);
    if (atts?.length) await supabase.storage.from('task-files').remove(atts.map(a => a.file_path));
    const { error } = await supabase.from('tasks').delete().eq('id', t.id);
    if (error) { setErr(error.message); return; }
    if (expandedId === t.id) setExpandedId(null);
    setTasks(ts => ts.filter(x => x.id !== t.id));
  };

  const toggleNewAssignee = (pid) =>
    setNewAssignees(a => a.includes(pid) ? a.filter(x => x !== pid) : [...a, pid]);

  if (!tasks) return <div className="center"><div className="sp" /></div>;

  const staffById = Object.fromEntries(staff.map(s => [s.id, s]));

  const row = (t) => {
    const assignees = (t.task_assignees || []).map(a => staffById[a.profile_id]).filter(Boolean);
    const overdue = isOverdue(t);
    return (
      <div key={t.id}>
        <div className="tm-task-row">
          <input
            type="checkbox"
            className="tm-done-check"
            checked={t.status === 'done'}
            title={t.status === 'done' ? 'Reopen' : 'Mark done'}
            onChange={() => {}}
            onClick={(e) => toggleDone(t, e)}
          />
          <div className="tm-task-main" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
            <div className={'nm' + (t.status === 'done' ? ' tm-done-title' : '')}>{t.title}</div>
            <div className="meta">
              <span className={overdue ? 'tm-overdue' : ''}>{fmtDue(t.due_date)}{overdue ? ' (overdue)' : ''}</span>
              {t.notes ? ' | ' + t.notes.slice(0, 60) + (t.notes.length > 60 ? '…' : '') : ''}
            </div>
          </div>
          <div className="tm-avatars" title={assignees.map(staffName).join(', ') || 'Unassigned'}>
            {assignees.length === 0 && <span className="tm-avatar tm-avatar-empty">?</span>}
            {assignees.slice(0, 3).map(a => <span key={a.id} className="tm-avatar">{initials(a)}</span>)}
            {assignees.length > 3 && <span className="tm-avatar tm-avatar-empty">+{assignees.length - 3}</span>}
          </div>
          <button className="icon-btn icon-btn-danger" title="Delete task" onClick={() => deleteTask(t)}>×</button>
        </div>
        {expandedId === t.id && (
          <TaskEditor
            task={t} staff={staff} clients={clients} profile={profile}
            onChanged={load} onError={setErr} onClose={() => setExpandedId(null)}
            patchTask={patchTask}
          />
        )}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Tasks</h1>
          <p className="sub">Pick a client or Internal, add tasks directly. Clients never see this.</p>
        </div>
        <div className="co-actions">
          <select className="sel" style={{ minWidth: 220 }} value={bucket} onChange={e => { setBucket(e.target.value); setExpandedId(null); }}>
            <option value={INTERNAL}>Internal ({openCount(INTERNAL)} open)</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({openCount(c.id)} open)</option>)}
          </select>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <form className="card spine" onSubmit={addTask}>
        <div className="tm-quick-row">
          <input className="ti" placeholder={bucket === INTERNAL ? 'New internal task…' : 'New task for this client…'}
            value={title} onChange={e => setTitle(e.target.value)} />
          <input className="ti" type="date" value={due} onChange={e => setDue(e.target.value)} />
          <button className="btn sm" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Add task'}</button>
        </div>
        <div className="tm-newmeta-row">
          <div className="tm-assignee-chips">
            {staff.map(s => (
              <button type="button" key={s.id}
                className={'tm-chip-toggle' + (newAssignees.includes(s.id) ? ' on' : '')}
                title={staffName(s)}
                onClick={() => toggleNewAssignee(s.id)}>
                <span className="tm-avatar">{initials(s)}</span>{staffName(s)}
              </button>
            ))}
          </div>
          <label className="link-btn" style={{ cursor: 'pointer' }}>
            {newFile ? newFile.name : 'Attach a file (optional)'}
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setNewFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      </form>

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
    </div>
  );
}

function TaskEditor({ task, staff, clients, profile, onChanged, onError, onClose, patchTask }) {
  const [form, setForm] = useState({
    title: task.title,
    due_date: task.due_date || '',
    notes: task.notes || '',
    client_id: task.client_id || INTERNAL
  });
  const [assigned, setAssigned] = useState((task.task_assignees || []).map(a => a.profile_id));
  const [attachments, setAttachments] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    supabase.from('task_attachments').select('*').eq('task_id', task.id)
      .order('uploaded_at', { ascending: false })
      .then(({ data }) => setAttachments(data || []));
  }, [task.id]);

  const save = async () => {
    if (!form.title.trim()) { onError('The task needs a title.'); return; }
    setBusy('save');
    try {
      const ok = await patchTask(task.id, {
        title: form.title.trim(),
        due_date: form.due_date || null,
        notes: form.notes.trim() || null,
        client_id: form.client_id === INTERNAL ? null : form.client_id
      });
      if (ok) {
        await setAssignees(task.id, assigned);
        await onChanged();
        onClose();
      }
    } catch (ex) { onError(ex.message); }
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
        <div className="fld">
          <label className="lab">Belongs to</label>
          <select className="sel" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
            <option value={INTERNAL}>Internal</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="fld">
          <label className="lab">Assignees</label>
          <div className="tm-assignee-chips">
            {staff.map(s => (
              <button type="button" key={s.id}
                className={'tm-chip-toggle' + (assigned.includes(s.id) ? ' on' : '')}
                onClick={() => setAssigned(a => a.includes(s.id) ? a.filter(x => x !== s.id) : [...a, s.id])}>
                <span className="tm-avatar">{initials(s)}</span>{staffName(s)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="fld">
        <label className="lab">Notes</label>
        <textarea className="ta" style={{ minHeight: 70 }} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
      <div className="fld">
        <label className="lab">Attachments</label>
        {attachments === null && <div className="sub">Loading…</div>}
        {(attachments || []).map(a => (
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
      <div className="row">
        <button className="btn sm" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        <button className="btn sm gh" onClick={onClose}>Close</button>
        {task.completed_at && (
          <span className="sub">Completed {new Date(task.completed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
    </div>
  );
}
