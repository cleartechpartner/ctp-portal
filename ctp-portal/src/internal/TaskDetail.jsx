import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  TASK_STATUS, TASK_PRIORITY, statusPatch, fetchStaff, setAssignees,
  initials, staffName
} from '../lib/tasks';
import { parseDuration, secToHM } from '../lib/time';

function safeFileName(name) {
  return (name || 'file').replace(/[^a-z0-9 _.\-()]/gi, '').trim().slice(0, 80) || 'file';
}

export default function TaskDetail({ profile }) {
  const { id } = useParams();
  const nav = useNavigate();

  const [task, setTask] = useState(null);
  const [form, setForm] = useState(null);
  const [assigned, setAssigned] = useState([]);
  const [staff, setStaff] = useState([]);
  const [clients, setClients] = useState([]);
  const [taskProjects, setTaskProjects] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [timeForm, setTimeForm] = useState({ project_id: '', duration: '', notes: '', billable: true });
  const [timeOk, setTimeOk] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = async () => {
    setErr('');
    const { data: t, error } = await supabase.from('tasks')
      .select('*, task_assignees(profile_id)')
      .eq('id', id).single();
    if (error) { setErr(error.message); return; }
    setTask(t);
    setForm({
      title: t.title, description: t.description || '', status: t.status, priority: t.priority,
      due_date: t.due_date || '', client_id: t.client_id, project_id: t.project_id || ''
    });
    setAssigned((t.task_assignees || []).map(a => a.profile_id));

    const [st, { data: cs }, { data: tps }, { data: atts }] = await Promise.all([
      fetchStaff(),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('task_projects').select('id, name, client_id').order('start_date', { ascending: false }),
      supabase.from('task_attachments').select('*').eq('task_id', id).order('uploaded_at', { ascending: false })
    ]);
    setStaff(st);
    setClients(cs || []);
    setTaskProjects(tps || []);
    setAttachments(atts || []);

    // Time logged against this task, through the existing time tracking
    // tables. Fails soft until the phase 2 migration adds task_id.
    const { data: tes, error: teErr } = await supabase.from('time_entries')
      .select('id, duration_seconds, notes, billable, started_at, project_id')
      .eq('task_id', id).order('started_at', { ascending: false });
    if (teErr) { setTimeOk(false); }
    else { setTimeOk(true); setTimeEntries(tes || []); }

    const { data: wts } = await supabase.from('projects')
      .select('id, title, type, client_id').eq('client_id', t.client_id).order('title');
    setWorkTypes(wts || []);
  };
  useEffect(() => { load(); }, [id]);

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const flash = (m) => { setOk(m); setTimeout(() => setOk(''), 2200); };

  const save = async () => {
    if (!form.title.trim() || !form.client_id) { setErr('A task needs a title and a client.'); return; }
    setBusy('save'); setErr('');
    try {
      const patch = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        due_date: form.due_date || null,
        client_id: form.client_id,
        project_id: form.project_id || null,
        ...statusPatch(form.status)
      };
      if (patch.status === task.status) {
        // Status unchanged: keep the original completed_at stamp.
        patch.completed_at = task.completed_at;
      }
      const { error } = await supabase.from('tasks').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
      await setAssignees(id, assigned);
      flash('Saved');
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  const remove = async () => {
    if (!window.confirm(`Delete task "${task.title}"? Attachments are removed with it.`)) return;
    setBusy('delete'); setErr('');
    for (const a of attachments) {
      await supabase.storage.from('task-files').remove([a.file_path]);
    }
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { setErr(error.message); setBusy(''); return; }
    nav('/tasks');
  };

  const toggleAssignee = (pid) => {
    setAssigned(a => a.includes(pid) ? a.filter(x => x !== pid) : [...a, pid]);
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setErr('Keep attachments under 20 MB.'); return; }
    setBusy('upload'); setErr('');
    try {
      const path = `${id}/${crypto.randomUUID()}_${safeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from('task-files').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { error: insErr } = await supabase.from('task_attachments').insert({
        task_id: id, file_name: file.name, file_path: path, uploaded_by: profile.id
      });
      if (insErr) throw new Error(insErr.message);
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  const download = async (a) => {
    setErr('');
    const { data, error } = await supabase.storage.from('task-files').createSignedUrl(a.file_path, 300);
    if (error) { setErr(error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const removeAttachment = async (a) => {
    if (!window.confirm(`Remove "${a.file_name}"?`)) return;
    setErr('');
    await supabase.storage.from('task-files').remove([a.file_path]);
    const { error } = await supabase.from('task_attachments').delete().eq('id', a.id);
    if (error) { setErr(error.message); return; }
    setAttachments(list => list.filter(x => x.id !== a.id));
  };

  const logTime = async (e) => {
    e.preventDefault();
    const dur = parseDuration(timeForm.duration);
    if (!timeForm.project_id || !dur) { setErr('Logging time needs a work type and a duration like 1:30 or 1.5.'); return; }
    setBusy('time'); setErr('');
    try {
      const { data: cRow } = await supabase.from('clients').select('hourly_rate').eq('id', task.client_id).single();
      const { error } = await supabase.from('time_entries').insert({
        project_id: timeForm.project_id,
        task_id: id,
        started_at: new Date().toISOString(),
        duration_seconds: dur,
        notes: timeForm.notes.trim() || task.title,
        billable: timeForm.billable,
        rate: cRow?.hourly_rate ?? null
      });
      if (error) throw new Error(error.message);
      setTimeForm(f => ({ ...f, duration: '', notes: '' }));
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  if (!task || !form) return <div className="center"><div className="sp" /></div>;

  const clientProjects = taskProjects.filter(p => p.client_id === form.client_id);
  const totalSec = timeEntries.reduce((a, x) => a + (x.duration_seconds || 0), 0);
  const wtById = Object.fromEntries(workTypes.map(w => [w.id, w]));

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>{task.title}</h1>
          <p className="sub">Task detail</p>
        </div>
        <div className="co-actions">
          <button className="btn sm gh" onClick={() => nav('/tasks')}>Back to queue</button>
          <button className="btn sm dgr" disabled={!!busy} onClick={remove}>Delete</button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div className="auth-ok" style={{ marginBottom: 14 }}>{ok}</div>}

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card spine">
          <h3>Details</h3>
          <div className="fld mt">
            <label className="lab">Title</label>
            <input className="ti" value={form.title} onChange={F('title')} />
          </div>
          <div className="fld">
            <label className="lab">Description</label>
            <textarea className="ta" value={form.description} onChange={F('description')} />
          </div>
          <div className="grid2">
            <div className="fld">
              <label className="lab">Status</label>
              <select className="sel" value={form.status} onChange={F('status')}>
                {TASK_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fld">
              <label className="lab">Priority</label>
              <select className="sel" value={form.priority} onChange={F('priority')}>
                {TASK_PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fld">
              <label className="lab">Due date</label>
              <input className="ti" type="date" value={form.due_date} onChange={F('due_date')} />
            </div>
            <div className="fld">
              <label className="lab">Client</label>
              <select className="sel" value={form.client_id}
                onChange={e => setForm(f => ({ ...f, client_id: e.target.value, project_id: '' }))}>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="fld">
              <label className="lab">Project (optional)</label>
              <select className="sel" value={form.project_id} onChange={F('project_id')}>
                <option value="">No project</option>
                {clientProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="fld">
            <label className="lab">Assignees</label>
            <div className="tm-assignee-list">
              {staff.map(s => (
                <label key={s.id} className={'tm-assignee' + (assigned.includes(s.id) ? ' on' : '')}>
                  <input type="checkbox" checked={assigned.includes(s.id)} onChange={() => toggleAssignee(s.id)} />
                  <span className="tm-avatar">{initials(s)}</span>
                  {staffName(s)}
                </label>
              ))}
              {staff.length === 0 && <div className="sub">No staff profiles found.</div>}
            </div>
          </div>
          <button className="btn" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
          {task.completed_at && (
            <div className="sub" style={{ marginTop: 10 }}>
              Completed {new Date(task.completed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h3>Attachments</h3>
            {attachments.length === 0 && <div className="sub" style={{ marginTop: 8 }}>Nothing attached yet.</div>}
            <div style={{ marginTop: 8 }}>
              {attachments.map(a => (
                <div key={a.id} className="item" style={{ padding: '10px 0' }}>
                  <button className="link-btn" onClick={() => download(a)}>{a.file_name}</button>
                  <button className="icon-btn icon-btn-danger" title="Remove attachment" onClick={() => removeAttachment(a)}>×</button>
                </div>
              ))}
            </div>
            <label className="btn sm gh" style={{ display: 'inline-block', marginTop: 10, cursor: 'pointer' }}>
              {busy === 'upload' ? 'Uploading…' : 'Add file'}
              <input type="file" style={{ display: 'none' }} onChange={upload} disabled={busy === 'upload'} />
            </label>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Time on this task</h3>
            {!timeOk ? (
              <div className="sub" style={{ marginTop: 8 }}>
                Run supabase/task-management-2.sql to link time tracking to tasks.
              </div>
            ) : (
              <>
                <div className="sub" style={{ marginTop: 4 }}>{secToHM(totalSec)} logged</div>
                <form onSubmit={logTime} className="tm-time-row">
                  <select className="sel" value={timeForm.project_id}
                    onChange={e => setTimeForm(f => ({ ...f, project_id: e.target.value }))}>
                    <option value="">Work type…</option>
                    {workTypes.map(w => <option key={w.id} value={w.id}>{w.type ? `${w.type} | ${w.title}` : w.title}</option>)}
                  </select>
                  <input className="ti tm-dur" placeholder="1:30" value={timeForm.duration}
                    onChange={e => setTimeForm(f => ({ ...f, duration: e.target.value }))} />
                  <input className="ti" placeholder="Notes" value={timeForm.notes}
                    onChange={e => setTimeForm(f => ({ ...f, notes: e.target.value }))} />
                  <label className="tt-check">
                    <input type="checkbox" checked={timeForm.billable}
                      onChange={e => setTimeForm(f => ({ ...f, billable: e.target.checked }))} /> Billable
                  </label>
                  <button className="btn sm" disabled={busy === 'time' || !timeForm.project_id || !timeForm.duration}>Log time</button>
                </form>
                {workTypes.length === 0 && (
                  <div className="sub" style={{ marginTop: 8 }}>
                    This client has no work types yet. Add one on the client's page, then log time here.
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  {timeEntries.map(te => (
                    <div key={te.id} className="item" style={{ padding: '9px 0' }}>
                      <div>
                        <div className="nm">{secToHM(te.duration_seconds)}{te.billable ? '' : ' | non-billable'}</div>
                        <div className="meta">
                          {new Date(te.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          {wtById[te.project_id] ? ` | ${wtById[te.project_id].type || wtById[te.project_id].title}` : ''}
                          {te.notes ? ` | ${te.notes}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
