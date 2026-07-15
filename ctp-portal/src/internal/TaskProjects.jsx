import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const PROJECT_STATUS = [
  ['active', 'Active'],
  ['on_hold', 'On hold'],
  ['complete', 'Complete']
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endDate(p) {
  const d = new Date(p.start_date + 'T00:00:00');
  d.setDate(d.getDate() + Math.round((+p.target_duration_weeks || 0) * 7));
  return d;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function weeksLabel(w) {
  const n = +w;
  return Number.isInteger(n) ? `${n} wk` : `${n} wk`;
}

const EMPTY_FORM = { client_id: '', name: '', start_date: todayISO(), target_duration_weeks: 4, payment_status: 'paid' };

export default function TaskProjects({ embedded }) {
  const [clients, setClients] = useState(null);
  const [projects, setProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const flash = (m) => { setOk(m); setTimeout(() => setOk(''), 2600); };

  const load = async () => {
    setErr('');
    const [{ data: cs, error: e1 }, { data: ps, error: e2 }, { data: tpls }] = await Promise.all([
      supabase.from('clients').select('id, name, status').order('name'),
      supabase.from('task_projects').select('*').order('start_date', { ascending: false }),
      supabase.from('task_templates').select('id, name').order('name')
    ]);
    if (e1 || e2) { setErr((e1 || e2).message); setClients(cs || []); return; }
    setClients(cs || []);
    setProjects(ps || []);
    setTemplates(tpls || []);
  };
  useEffect(() => { load(); }, []);

  // The template is a stamp: generate real, independent tasks under the
  // project. due_date = project start + offset_days + duration_days.
  const applyTemplate = async (project, templateId) => {
    if (!templateId) return;
    setErr('');
    const tpl = templates.find(t => t.id === templateId);
    const { data: items, error } = await supabase.from('task_template_items')
      .select('*').eq('template_id', templateId)
      .order('sort_order').order('offset_days');
    if (error) { setErr(error.message); return; }
    if (!items || items.length === 0) { setErr(`"${tpl?.name}" has no tasks in it yet. Add some on the Templates tab.`); return; }
    if (!window.confirm(`Create ${items.length} tasks from "${tpl?.name}" for "${project.name}"?`)) return;
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const rows = items.map(it => ({
      client_id: project.client_id,
      project_id: project.id,
      title: it.title,
      description: it.description,
      priority: it.priority,
      due_date: addDaysISO(project.start_date, (it.offset_days || 0) + (it.duration_days || 1)),
      created_by: userData?.user?.id
    }));
    const { error: insErr } = await supabase.from('tasks').insert(rows);
    setBusy(false);
    if (insErr) { setErr(insErr.message); return; }
    flash(`${rows.length} tasks created for ${project.name}. They are in the queue, unassigned.`);
  };

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    if (!form.client_id || !form.name.trim() || !form.start_date) { setErr('Client, name and start date are required.'); return; }
    const weeks = +form.target_duration_weeks;
    if (!(weeks > 0)) { setErr('Duration must be more than zero weeks.'); return; }
    setBusy(true); setErr('');
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('task_projects').insert({
      client_id: form.client_id,
      name: form.name.trim(),
      start_date: form.start_date,
      target_duration_weeks: weeks,
      payment_status: form.payment_status,
      created_by: userData?.user?.id
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm(f => ({ ...EMPTY_FORM, client_id: f.client_id }));
    await load();
  };

  const update = async (id, patch) => {
    setErr('');
    const { error } = await supabase.from('task_projects').update(patch).eq('id', id);
    if (error) { setErr(error.message); return false; }
    setProjects(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
    return true;
  };

  const saveEdit = async () => {
    const weeks = +edit.target_duration_weeks;
    if (!edit.name.trim() || !edit.start_date || !(weeks > 0)) { setErr('Name, start date and a duration above zero are required.'); return; }
    setBusy(true);
    const ok = await update(editingId, {
      name: edit.name.trim(),
      start_date: edit.start_date,
      target_duration_weeks: weeks
    });
    setBusy(false);
    if (ok) setEditingId(null);
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete project "${p.name}"? Tasks under it are kept and unlinked.`)) return;
    setErr('');
    const { error } = await supabase.from('task_projects').delete().eq('id', p.id);
    if (error) { setErr(error.message); return; }
    setProjects(ps => ps.filter(x => x.id !== p.id));
  };

  if (!clients) return <div className="center"><div className="sp" /></div>;

  const grouped = clients
    .map(c => ({ client: c, rows: projects.filter(p => p.client_id === c.id) }))
    .filter(g => g.rows.length > 0);

  // Renders inside the Tasks module container (embedded) or as its own page.
  const body = (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div className="auth-ok" style={{ marginBottom: 14 }}>{ok}</div>}

      <form className="card spine" onSubmit={create}>
        <h3>New project</h3>
        <div className="tm-form-row">
          <div className="fld">
            <label className="lab">Client</label>
            <select className="sel" value={form.client_id} onChange={F('client_id')}>
              <option value="">Pick a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="fld">
            <label className="lab">Project name</label>
            <input className="ti" value={form.name} onChange={F('name')} placeholder="Onboarding | Phase 1" />
          </div>
          <div className="fld">
            <label className="lab">Start date</label>
            <input className="ti" type="date" value={form.start_date} onChange={F('start_date')} />
          </div>
          <div className="fld">
            <label className="lab">Duration (weeks)</label>
            <input className="ti" type="number" min="0.5" step="0.5" value={form.target_duration_weeks} onChange={F('target_duration_weeks')} />
          </div>
          <div className="fld">
            <label className="lab">Payment</label>
            <select className="sel" value={form.payment_status} onChange={F('payment_status')}>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>
        </div>
        <button className="btn sm" disabled={busy}>{busy ? 'Adding…' : 'Add project'}</button>
      </form>

      {grouped.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="empty">No projects yet. Add the first one above.</div>
        </div>
      )}

      {grouped.map(({ client, rows }) => (
        <div key={client.id} style={{ marginTop: 22 }}>
          <div className="co-section-label">{client.name}</div>
          <div className="card" style={{ padding: 0 }}>
            {rows.map(p => (
              <div key={p.id} className="tm-project-row">
                {editingId === p.id ? (
                  <div className="tm-edit-row">
                    <input className="ti" value={edit.name} onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} />
                    <input className="ti" type="date" value={edit.start_date} onChange={e => setEdit(x => ({ ...x, start_date: e.target.value }))} />
                    <input className="ti tm-weeks" type="number" min="0.5" step="0.5" value={edit.target_duration_weeks}
                      onChange={e => setEdit(x => ({ ...x, target_duration_weeks: e.target.value }))} />
                    <button className="btn sm" disabled={busy} onClick={saveEdit}>Save</button>
                    <button className="btn sm gh" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="tm-project-main">
                      <div className="nm">{p.name}</div>
                      <div className="meta">
                        {fmtDate(p.start_date)} to {fmtDate(endDate(p))} | {weeksLabel(p.target_duration_weeks)}
                      </div>
                    </div>
                    {templates.length > 0 && (
                      <select className="sel tm-row-sel" value="" title="Generate tasks from a template" disabled={busy}
                        onChange={e => applyTemplate(p, e.target.value)}>
                        <option value="">Apply template…</option>
                        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                    <button
                      className={'chip tm-pay ' + (p.payment_status === 'paid' ? 'tm-paid' : 'tm-unpaid')}
                      title="Click to flip between paid and unpaid"
                      onClick={() => update(p.id, { payment_status: p.payment_status === 'paid' ? 'unpaid' : 'paid' })}
                    >
                      {p.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                    </button>
                    <select
                      className={'status-pill tm-st-' + p.status}
                      value={p.status}
                      onChange={e => update(p.id, { status: e.target.value })}
                    >
                      {PROJECT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button className="icon-btn" title="Edit project"
                      onClick={() => { setEditingId(p.id); setEdit({ name: p.name, start_date: p.start_date, target_duration_weeks: p.target_duration_weeks }); }}>
                      ✎
                    </button>
                    <button className="icon-btn icon-btn-danger" title="Delete project" onClick={() => remove(p)}>×</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );

  if (embedded) return body;

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Projects</h1>
          <p className="sub">One project per engagement phase. Tasks, templates and the forecast all hang off these.</p>
        </div>
      </div>
      {body}
    </div>
  );
}
