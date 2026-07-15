import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { translate, notify, inviteClient, signedUrl, fmtBytes, monthLabel } from '../lib/api';
import TaskPanel from './TaskPanel';

const PROJECT_TYPES = ['AI guest agents', 'Systems and integrations', 'Consulting and operations', 'Other'];
const PROJECT_STATUS = ['planned', 'in_progress', 'live', 'paused', 'complete'];
const UPDATE_CATS = [['kb', 'Knowledge base'], ['prompt', 'Agent tuning'], ['feature', 'New feature'], ['fix', 'Fix'], ['learning', 'Learning'], ['update', 'Update'], ['other', 'Other']];
const DOC_CATS = [['contract', 'Contract'], ['dpa', 'Data processing agreement'], ['onboarding', 'Onboarding'], ['general', 'General']];
const STATUS_LABELS = { proposal_out: 'Proposal out', contract_signed: 'Contract signed', active: 'Active', paused: 'Paused', archived: 'Archived' };

const CAT_COLORS = {
  kb:      { bg: '#E8F4FD', text: '#0C2D6B', border: '#B8DDFB' },
  prompt:  { bg: '#E6FAF6', text: '#0E6E5C', border: '#A8E8D8' },
  feature: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  fix:     { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  update:  { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' },
  learning:{ bg: '#E0E7FF', text: '#3730A3', border: '#C7D2FE' },
  other:   { bg: '#F5F3FF', text: '#4C1D95', border: '#DDD6FE' },
};
const DEFAULT_COLOR = { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' };
function catColor(category) { return CAT_COLORS[category] || DEFAULT_COLOR; }

const IconPlus = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
const IconX = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
const IconEdit = () => <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M9 1.5l2.5 2.5M1.5 11.5l1-3 7-7 2.5 2.5-7 7-3 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>;

export default function ClientDetail({ profile }) {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [tab, setTab] = useState('overview');
  const [toastMsg, setToastMsg] = useState('');
  const toast = useCallback((m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 2400); }, []);

  const loadClient = async () => {
    const { data } = await supabase.from('clients').select('*').eq('id', id).single();
    setClient(data);
  };
  useEffect(() => { loadClient(); }, [id]);

  if (!client) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h">
        <Link to="/" className="link-btn">&larr; All clients</Link>
        <div className="spread mt">
          <div>
            <h1>{client.name}</h1>
            <p>{client.property_type} · {client.contact_name || 'No contact yet'}</p>
          </div>
          <div className="row">
            <span className={`chip ${client.language}`}>{client.language === 'es' ? 'Portal in Spanish' : 'Portal in English'}</span>
            <span className={`chip ${client.status}`}>{STATUS_LABELS[client.status] || client.status}</span>
          </div>
        </div>
      </div>

      <div className="tabs">
        {['overview', 'tasks', 'reports', 'updates', 'documents', 'access'].map(x => (
          <button key={x} className={'tab' + (tab === x ? ' on' : '')} onClick={() => setTab(x)}>
            {x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview client={client} onSaved={loadClient} toast={toast} />}
      {tab === 'tasks' && <TaskPanel profile={profile} fixedClientId={client.id} />}
      {tab === 'reports' && <ReportsTab client={client} toast={toast} />}
      {tab === 'updates' && <UpdatesTab client={client} toast={toast} />}
      {tab === 'documents' && <DocumentsTab client={client} toast={toast} />}
      {tab === 'access' && <AccessTab client={client} toast={toast} />}

      {toastMsg && <div className="tst">{toastMsg}</div>}
    </div>
  );
}

/* ---------- Overview ---------- */
function Overview({ client, onSaved, toast }) {
  const [form, setForm] = useState(client);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [projects, setProjects] = useState([]);
  const [pForm, setPForm] = useState({ title: '', type: PROJECT_TYPES[0], status: 'planned', description: '', notes: '' });
  const [adding, setAdding] = useState(false);

  useEffect(() => { setForm(client); }, [client]);

  const loadProjects = async () => {
    const { data } = await supabase.from('projects').select('*').eq('client_id', client.id).order('created_at');
    setProjects(data || []);
  };
  useEffect(() => { loadProjects(); }, [client.id]);

  const F = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setDirty(true); };
  const save = async () => {
    const { error } = await supabase.from('clients').update({
      name: form.name, property_type: form.property_type, contact_name: form.contact_name,
      contact_email: form.contact_email, language: form.language, status: form.status, partner_notes: form.partner_notes
    }).eq('id', client.id);
    if (error) { toast('Save failed'); return; }
    setDirty(false); setEditing(false); toast('Client saved'); onSaved();
  };
  const cancel = () => { setForm(client); setDirty(false); setEditing(false); };

  const addProject = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('projects').insert({ ...pForm, client_id: client.id });
    if (error) { toast('Could not add project'); return; }
    setPForm({ title: '', type: PROJECT_TYPES[0], status: 'planned', description: '', notes: '' });
    setAdding(false); loadProjects(); toast('Project added');
  };
  const setStatus = async (p, status) => {
    await supabase.from('projects').update({ status }).eq('id', p.id);
    loadProjects();
  };
  const removeProject = async (p) => {
    if (!confirm(`Delete project "${p.title}"?`)) return;
    await supabase.from('projects').delete().eq('id', p.id);
    loadProjects();
  };

  return (
    <>
      <div className="card">
        <div className="spread">
          <h3>Client profile</h3>
          {!editing && (
            <button className="btn sm gh icon-text-btn" onClick={() => setEditing(true)}><IconEdit /> Edit</button>
          )}
        </div>

        {!editing ? (
          <div className="cd-readonly mt">
            <div className="cd-grid">
              <CdRow label="Name" value={form.name} />
              <CdRow label="Type" value={form.property_type} />
              <CdRow label="Contact name" value={form.contact_name} />
              <CdRow label="Contact email" value={form.contact_email} />
              <CdRow label="Portal language" value={form.language === 'es' ? 'Español' : 'English'} />
              <CdRow label="Status" value={STATUS_LABELS[form.status] || form.status} />
            </div>
            <div className="cd-row-full">
              <div className="lab">Internal notes</div>
              <div className="cd-val cd-val-multiline">{form.partner_notes || '—'}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid2 mt">
              <div className="fld"><label className="lab">Name</label><input className="ti" value={form.name || ''} onChange={F('name')} /></div>
              <div className="fld"><label className="lab">Type</label><input className="ti" value={form.property_type || ''} onChange={F('property_type')} /></div>
              <div className="fld"><label className="lab">Contact name</label><input className="ti" value={form.contact_name || ''} onChange={F('contact_name')} /></div>
              <div className="fld"><label className="lab">Contact email</label><input className="ti" value={form.contact_email || ''} onChange={F('contact_email')} /></div>
              <div className="fld"><label className="lab">Portal language</label>
                <select className="sel" value={form.language} onChange={F('language')}><option value="en">English</option><option value="es">Español</option></select></div>
              <div className="fld"><label className="lab">Status</label>
                <select className="sel" value={form.status} onChange={F('status')}><option value="proposal_out">Proposal out</option><option value="contract_signed">Contract signed</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></div>
            </div>
            <div className="fld"><label className="lab">Internal notes</label><textarea className="ta" value={form.partner_notes || ''} onChange={F('partner_notes')} /></div>
            <div className="row">
              <button className="btn" onClick={save} disabled={!dirty}>Save profile</button>
              <button className="btn gh" onClick={cancel}>Cancel</button>
            </div>
          </>
        )}
      </div>

      <div className="card mt2">
        <div className="spread">
          <div><h3>Projects</h3><div className="sub">The flexible line items. Guida, bookings, automations, one-offs.</div></div>
          <button className="icon-btn icon-btn-primary" onClick={() => setAdding(a => !a)} title={adding ? 'Close' : 'Add project'} aria-label={adding ? 'Close' : 'Add project'}>
            {adding ? <IconX /> : <IconPlus />}
          </button>
        </div>

        {adding && (
          <form onSubmit={addProject} className="mt">
            <div className="grid2">
              <div className="fld"><label className="lab">Title</label>
                <input className="ti" value={pForm.title} onChange={e => setPForm(f => ({ ...f, title: e.target.value }))} required placeholder="Guida night agent" /></div>
              <div className="fld"><label className="lab">Type</label>
                <select className="sel" value={pForm.type} onChange={e => setPForm(f => ({ ...f, type: e.target.value }))}>
                  {PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select></div>
            </div>
            <div className="fld"><label className="lab">Description (visible to client)</label>
              <textarea className="ta" value={pForm.description} onChange={e => setPForm(f => ({ ...f, description: e.target.value }))} placeholder="What this project is, in plain words." /></div>
            <div className="fld"><label className="lab">Internal notes</label>
              <textarea className="ta" style={{ minHeight: 70 }} value={pForm.notes} onChange={e => setPForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <button className="btn sm">Add project</button>
          </form>
        )}

        <div className="mt">
          {projects.length === 0 && <div className="empty">No projects yet.</div>}
          {projects.map(p => (
            <div key={p.id} className="item">
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="nm">{p.title} <span className="sub">· {p.type}</span></div>
                {p.description && <div className="meta">{p.description}</div>}
              </div>
              <div className="row">
                <select
                  className={`status-pill status-pill-${p.status}`}
                  value={p.status}
                  onChange={e => setStatus(p, e.target.value)}
                  aria-label="Project status"
                >
                  {PROJECT_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <button className="icon-btn icon-btn-danger" onClick={() => removeProject(p)} title="Delete project" aria-label="Delete project">
                  <IconX />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CdRow({ label, value }) {
  return (
    <div className="cd-row">
      <div className="lab">{label}</div>
      <div className="cd-val">{value || '—'}</div>
    </div>
  );
}

/* ---------- Reports ---------- */
function ReportsTab({ client, toast }) {
  const [reports, setReports] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');

  const blank = () => ({
    client_id: client.id,
    month: new Date().toISOString().slice(0, 7),
    title_en: '', title_es: '', body_en: '', body_es: '', status: 'draft',
    attachment_path: null, attachment_name: null
  });

  const load = async () => {
    const { data } = await supabase.from('reports').select('*').eq('client_id', client.id).order('month', { ascending: false });
    setReports(data || []);
  };
  useEffect(() => { load(); }, [client.id]);

  const saveDraft = async (r) => {
    setBusy('save');
    const row = { ...r };
    let res;
    if (row.id) res = await supabase.from('reports').update(row).eq('id', row.id).select().single();
    else res = await supabase.from('reports').insert(row).select().single();
    setBusy('');
    if (res.error) { toast('Save failed'); return null; }
    toast('Draft saved'); load();
    setEditing(res.data);
    return res.data;
  };

  const doTranslate = async (r, setR) => {
    setBusy('translate');
    try {
      const [ti, bo] = await Promise.all([
        r.title_en ? translate(r.title_en, 'es') : '',
        r.body_en ? translate(r.body_en, 'es') : ''
      ]);
      setR(x => ({ ...x, title_es: ti, body_es: bo }));
      toast('Spanish version ready. Review it before publishing.');
    } catch (e) { toast('Translation failed: ' + e.message); }
    setBusy('');
  };

  const publish = async (r, setR) => {
    setBusy('publish');
    try {
      let row = { ...r };
      if (client.language === 'es' && r.body_en && !r.body_es) {
        const [ti, bo] = await Promise.all([
          r.title_en ? translate(r.title_en, 'es') : '',
          translate(r.body_en, 'es')
        ]);
        row = { ...row, title_es: ti, body_es: bo };
        setR(row);
      }
      row.status = 'published';
      row.published_at = new Date().toISOString();
      let res;
      if (row.id) res = await supabase.from('reports').update(row).eq('id', row.id).select().single();
      else res = await supabase.from('reports').insert(row).select().single();
      if (res.error) throw new Error(res.error.message);
      await notify('report_published', { client_id: client.id, month: monthLabel(row.month, client.language) });
      toast('Published. Client notified.');
      setEditing(null); load();
    } catch (e) { toast('Publish failed: ' + e.message); }
    setBusy('');
  };

  if (editing) return <ReportEditor r={editing === 'new' ? blank() : editing} busy={busy}
    onCancel={() => setEditing(null)} onSave={saveDraft} onTranslate={doTranslate} onPublish={publish}
    clientLang={client.language} clientId={client.id} toast={toast} />;

  return (
    <div className="card">
      <div className="spread">
        <div><h3>Monthly reports</h3><div className="sub">Drafts stay private. Publishing emails {client.contact_name || 'the client'}.</div></div>
        <button className="icon-btn icon-btn-primary" onClick={() => setEditing('new')} title="New report" aria-label="New report">
          <IconPlus />
        </button>
      </div>
      <div className="mt">
        {reports.length === 0 && <div className="empty">No reports yet. The first one sets the tone.</div>}
        {reports.map(r => (
          <div key={r.id} className="item">
            <div>
              <div className="nm">
                {monthLabel(r.month)} {r.title_en ? `· ${r.title_en}` : ''}
                {r.attachment_name && <span className="attach-badge" title={r.attachment_name}>PDF</span>}
              </div>
              <div className="meta">{r.published_at ? 'Published ' + new Date(r.published_at).toLocaleDateString(client.language === 'es' ? 'es-ES' : 'en-US') : 'Draft'}</div>
            </div>
            <div className="row">
              <span className={`chip ${r.status}`}>{r.status}</span>
              <button className="btn sm gh" onClick={() => setEditing(r)}>Open</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportEditor({ r: initial, busy, onCancel, onSave, onTranslate, onPublish, clientLang, clientId, toast }) {
  const [r, setR] = useState(initial);
  const [uploadingFile, setUploadingFile] = useState(false);
  const F = (k) => (e) => setR(x => ({ ...x, [k]: e.target.value }));

  const uploadAttachment = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const path = `${clientId}/reports/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('client-docs').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      setR(x => ({ ...x, attachment_path: path, attachment_name: file.name }));
      toast('File attached. Save the draft to keep it.');
    } catch (err) { toast('Upload failed: ' + err.message); }
    setUploadingFile(false);
    e.target.value = '';
  };

  const removeAttachment = async () => {
    if (!confirm('Remove this attachment?')) return;
    if (r.attachment_path) {
      try { await supabase.storage.from('client-docs').remove([r.attachment_path]); } catch {}
    }
    setR(x => ({ ...x, attachment_path: null, attachment_name: null }));
  };

  const previewAttachment = async () => {
    if (!r.attachment_path) return;
    try { window.open(await signedUrl(r.attachment_path), '_blank'); }
    catch { toast('Could not open file'); }
  };

  return (
    <div className="card spine">
      <div className="spread">
        <h3>{r.id ? 'Edit report' : 'New report'}</h3>
        <button className="link-btn" onClick={onCancel}>Close</button>
      </div>
      <div className="grid2 mt">
        <div className="fld"><label className="lab">Month</label><input className="ti" type="month" value={r.month} onChange={F('month')} /></div>
        <div className="fld"><label className="lab">Title (English)</label><input className="ti" value={r.title_en || ''} onChange={F('title_en')} placeholder="June: Guida's first full month" /></div>
      </div>
      <div className="fld"><label className="lab">Report (English)</label>
        <textarea className="ta big" value={r.body_en || ''} onChange={F('body_en')} placeholder={'What happened this month, what improved, what\u2019s next.'} /></div>

      <div className="fld">
        <label className="lab">Attached file (optional)</label>
        {r.attachment_name ? (
          <div className="attach-row">
            <button type="button" className="link-btn" onClick={previewAttachment}>{r.attachment_name}</button>
            <button type="button" className="icon-btn icon-btn-danger" onClick={removeAttachment} title="Remove attachment" aria-label="Remove attachment">
              <IconX />
            </button>
          </div>
        ) : (
          <label className="btn sm gh" style={{ cursor: 'pointer', display: 'inline-block' }}>
            {uploadingFile ? 'Uploading…' : 'Upload PDF or document'}
            <input type="file" hidden onChange={uploadAttachment} disabled={uploadingFile} accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" />
          </label>
        )}
      </div>

      <div className="row">
        <button className="btn gh sm" disabled={busy === 'translate' || !r.body_en} onClick={() => onTranslate(r, setR)}>
          {busy === 'translate' ? 'Translating…' : 'Translate to Spanish'}
        </button>
        <span className="sub">{clientLang === 'es' ? 'This client reads the portal in Spanish. Publishing auto-translates if you skip this.' : 'Optional for this client.'}</span>
      </div>

      {(r.title_es || r.body_es) && (
        <div className="mt2">
          <div className="fld"><label className="lab">Title (Spanish, editable)</label><input className="ti" value={r.title_es || ''} onChange={F('title_es')} /></div>
          <div className="fld"><label className="lab">Report (Spanish, editable)</label><textarea className="ta big" value={r.body_es || ''} onChange={F('body_es')} /></div>
        </div>
      )}

      <div className="row mt2">
        <button className="btn gh" disabled={!!busy} onClick={() => onSave(r)}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        <button className="btn" disabled={!!busy || !r.body_en} onClick={() => onPublish(r, setR)}>{busy === 'publish' ? 'Publishing…' : 'Publish & notify client'}</button>
      </div>
    </div>
  );
}

/* ---------- Updates: quick log entries with colored pills + filters ---------- */
function UpdatesTab({ client, toast }) {
  const [items, setItems] = useState([]);
  const [body, setBody] = useState('');
  const [cat, setCat] = useState('update');
  const [busy, setBusy] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');

  const load = async () => {
    const { data } = await supabase.from('updates').select('*').eq('client_id', client.id).order('date', { ascending: false }).order('created_at', { ascending: false });
    setItems(data || []);
  };
  useEffect(() => { load(); }, [client.id]);

  const categories = useMemo(() => {
    const seen = new Map();
    items.forEach(u => {
      if (!seen.has(u.category)) seen.set(u.category, 0);
      seen.set(u.category, seen.get(u.category) + 1);
    });
    return Array.from(seen.entries()).map(([c, count]) => ({ c, count }));
  }, [items]);

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return items;
    return items.filter(u => u.category === activeFilter);
  }, [items, activeFilter]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let body_es = null;
      if (client.language === 'es') body_es = await translate(body, 'es');
      const { error } = await supabase.from('updates').insert({ client_id: client.id, category: cat, body_en: body, body_es });
      if (error) throw new Error(error.message);
      setBody(''); load(); toast('Update logged');
    } catch (err) { toast('Failed: ' + err.message); }
    setBusy(false);
  };

  const remove = async (u) => {
    if (!confirm('Delete this update?')) return;
    await supabase.from('updates').delete().eq('id', u.id); load();
  };

  const catLabel = (key) => (UPDATE_CATS.find(c => c[0] === key) || [])[1] || key;

  return (
    <div className="card">
      <h3>Updates log</h3>
      <div className="sub">Log every improvement as you make it. The month-end report writes itself.</div>
      <form onSubmit={add} className="mt">
        <div className="row">
          <select className="sel" style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value)}>
            {UPDATE_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="fld mt"><textarea className="ta" style={{ minHeight: 70 }} value={body} onChange={e => setBody(e.target.value)} placeholder="Added Catalan greetings to Guida's late-night flow." required /></div>
        <button className="btn sm" disabled={busy || !body.trim()}>{busy ? 'Logging…' : 'Log update'}</button>
      </form>

      {items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '20px', marginBottom: '8px', alignItems: 'center' }}>
          <button
            onClick={() => setActiveFilter('all')}
            style={{
              padding: '5px 13px', borderRadius: '20px',
              border: activeFilter === 'all' ? '2px solid #0C2D6B' : '1px solid #CBD5E1',
              background: activeFilter === 'all' ? '#0C2D6B' : '#fff',
              color: activeFilter === 'all' ? '#fff' : '#334155',
              fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s ease',
            }}
          >All ({items.length})</button>
          {categories.map(({ c: k, count }) => {
            const co = catColor(k);
            const isActive = activeFilter === k;
            return (
              <button key={k}
                onClick={() => setActiveFilter(isActive ? 'all' : k)}
                style={{
                  padding: '5px 13px', borderRadius: '20px',
                  border: isActive ? `2px solid ${co.text}` : `1px solid ${co.border}`,
                  background: isActive ? co.text : co.bg,
                  color: isActive ? '#fff' : co.text,
                  fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all .15s ease',
                }}
              >{catLabel(k)} ({count})</button>
            );
          })}
        </div>
      )}

      <div className="mt2">
        {filtered.length === 0 && <div className="empty">Nothing logged yet.</div>}
        {filtered.map(u => {
          const co = catColor(u.category);
          return (
            <div key={u.id} className="item">
              <div style={{ flex: 1 }}>
                <div className="row">
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '12px',
                    fontSize: '.73rem', fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase',
                    background: co.bg, color: co.text, border: `1px solid ${co.border}`,
                  }}>{catLabel(u.category)}</span>
                  <span className="meta">{new Date(u.date).toLocaleDateString(client.language === 'es' ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <div className="mt" style={{ fontSize: '.92rem' }}>{u.body_en}</div>
                {u.body_es && <div className="meta mt">ES: {u.body_es}</div>}
              </div>
              <button className="icon-btn icon-btn-danger" onClick={() => remove(u)} title="Delete update" aria-label="Delete update">
                <IconX />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Documents ---------- */
function DocumentsTab({ client, toast }) {
  const [docs, setDocs] = useState([]);
  const [cat, setCat] = useState('general');
  const [notifyClient, setNotifyClient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    const { data } = await supabase.from('documents').select('*').eq('client_id', client.id).order('created_at', { ascending: false });
    setDocs(data || []);
  };
  useEffect(() => { load(); }, [client.id]);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      const path = `${client.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('client-docs').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { error: rowErr } = await supabase.from('documents').insert({
        client_id: client.id, name: file.name, category: cat, storage_path: path, size_bytes: file.size, uploaded_by: 'internal'
      });
      if (rowErr) throw new Error(rowErr.message);
      await notify('document_uploaded', { client_id: client.id, name: file.name, notifyClient });
      toast(notifyClient ? 'Uploaded. Client notified.' : 'Uploaded');
      load();
    } catch (err) { toast('Upload failed: ' + err.message); }
    setBusy(false);
    e.target.value = '';
  };

  const open = async (d) => {
    try { window.open(await signedUrl(d.storage_path), '_blank'); }
    catch { toast('Could not open file'); }
  };
  const remove = async (d) => {
    if (!confirm(`Delete "${d.name}"?`)) return;
    await supabase.storage.from('client-docs').remove([d.storage_path]);
    await supabase.from('documents').delete().eq('id', d.id);
    load();
  };

  const presentCategories = [...new Set(docs.map(d => d.category))];
  const filterOptions = [['all', 'All']];
  DOC_CATS.forEach(([v, l]) => { if (presentCategories.includes(v) || true) filterOptions.push([v, l]); });
  presentCategories.forEach(c => {
    if (!filterOptions.find(([v]) => v === c)) {
      filterOptions.push([c, c.charAt(0).toUpperCase() + c.slice(1)]);
    }
  });

  const visibleDocs = filter === 'all' ? docs : docs.filter(d => d.category === filter);

  return (
    <div className="card">
      <h3>Documents</h3>
      <div className="sub">Contracts, DPAs, onboarding. The client sees these in their portal.</div>
      <div className="row mt">
        <select className="sel" style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value)}>
          {DOC_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="btn sm" style={{ cursor: 'pointer' }}>
          {busy ? 'Uploading…' : 'Upload file'}
          <input type="file" hidden onChange={upload} disabled={busy} />
        </label>
        <label className="row" style={{ gap: 6, fontSize: '.84rem', color: 'var(--dim)' }}>
          <input type="checkbox" checked={notifyClient} onChange={e => setNotifyClient(e.target.checked)} /> Email the client
        </label>
      </div>

      {docs.length > 0 && (
        <div className="doc-filters mt2">
          {filterOptions.map(([v, l]) => (
            <button
              key={v}
              className={`filter-chip${filter === v ? ' on' : ''}`}
              onClick={() => setFilter(v)}
            >
              {l}
              {v !== 'all' && <span className="filter-count">{docs.filter(d => d.category === v).length}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt2">
        {visibleDocs.length === 0 && <div className="empty">{filter === 'all' ? 'No documents yet.' : 'No documents in this category.'}</div>}
        {visibleDocs.map(d => (
          <div key={d.id} className="item">
            <div>
              <div className="nm">{d.name}</div>
              <div className="meta">{(DOC_CATS.find(c => c[0] === d.category) || [, d.category])[1]} · {fmtBytes(d.size_bytes)} · {d.uploaded_by === 'client' ? 'Uploaded by client' : 'Uploaded by CTP'}</div>
            </div>
            <div className="row">
              <button className="btn sm gh" onClick={() => open(d)}>Open</button>
              <button className="icon-btn icon-btn-danger" onClick={() => remove(d)} title="Delete document" aria-label="Delete document">
                <IconX />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Access ---------- */
function AccessTab({ client, toast }) {
  const [links, setLinks] = useState([]);        // profile_clients rows with profile details
  const [allProfiles, setAllProfiles] = useState([]); // every client-role profile, for the add picker
  const [migrated, setMigrated] = useState(true); // false until the multi-client migration has run
  const [addId, setAddId] = useState('');
  const [email, setEmail] = useState(client.contact_email || '');
  const [name, setName] = useState(client.contact_name || '');
  const [busy, setBusy] = useState(false);
  const [manualLink, setManualLink] = useState('');

  const load = async () => {
    const { data, error } = await supabase.from('profile_clients')
      .select('profile_id, created_at, profiles(id, email, full_name, language, client_id)')
      .eq('client_id', client.id);
    if (error) {
      // Table missing means the migration has not run yet; fall back to the
      // legacy single-client view so this tab keeps working.
      setMigrated(false);
      const { data: legacy } = await supabase.from('profiles').select('*').eq('client_id', client.id);
      setLinks((legacy || []).map(p => ({ profile_id: p.id, profiles: p })));
      return;
    }
    setMigrated(true);
    setLinks(data || []);
    const { data: all } = await supabase.from('profiles')
      .select('id, email, full_name').eq('role', 'client').order('email');
    setAllProfiles(all || []);
  };
  useEffect(() => { load(); }, [client.id]);

  const addLink = async () => {
    if (!addId) return;
    setBusy(true);
    const { error } = await supabase.from('profile_clients')
      .insert({ profile_id: addId, client_id: client.id });
    if (error) toast('Could not add: ' + error.message);
    else {
      // If the profile has no selected client yet, select this one so their
      // portal opens on something.
      const prof = allProfiles.find(p => p.id === addId);
      const { data: cur } = await supabase.from('profiles').select('client_id').eq('id', addId).single();
      if (cur && !cur.client_id) {
        await supabase.from('profiles').update({ client_id: client.id }).eq('id', addId);
      }
      toast(`${prof?.email || 'Profile'} linked`);
      setAddId('');
    }
    await load();
    setBusy(false);
  };

  const removeLink = async (link) => {
    const p = link.profiles;
    if (!window.confirm(`Remove ${p?.email || 'this profile'}'s access to ${client.name}?`)) return;
    setBusy(true);
    const { error } = await supabase.from('profile_clients')
      .delete().eq('profile_id', link.profile_id).eq('client_id', client.id);
    if (error) toast('Could not remove: ' + error.message);
    else if (p?.client_id === client.id) {
      // They were looking at this client. Point them at another linked
      // client, or null if none remain.
      const { data: rest } = await supabase.from('profile_clients')
        .select('client_id').eq('profile_id', link.profile_id).limit(1);
      const next = rest && rest[0] ? rest[0].client_id : null;
      const { error: e2 } = await supabase.from('profiles')
        .update({ client_id: next }).eq('id', link.profile_id);
      if (e2) toast('Removed, but could not move their selection: ' + e2.message);
      else toast('Access removed');
    } else {
      toast('Access removed');
    }
    await load();
    setBusy(false);
  };

  const invite = async (e) => {
    e.preventDefault();
    setBusy(true); setManualLink('');
    try {
      const res = await inviteClient({ client_id: client.id, email: email.trim(), full_name: name.trim(), language: client.language });
      if (res.emailed) toast('Invite sent');
      else if (res.action_link) { setManualLink(res.action_link); toast('Invite created. Email not configured. Share the link below.'); }
      load();
    } catch (err) { toast('Invite failed: ' + err.message); }
    setBusy(false);
  };

  return (
    <div className="card">
      <h3>Portal access</h3>
      <div className="sub">Invite {client.contact_name || 'the client'}. They get a branded welcome email in {client.language === 'es' ? 'Spanish' : 'English'} with a secure setup link.</div>
      <form onSubmit={invite} className="mt">
        <div className="grid2">
          <div className="fld"><label className="lab">Full name</label><input className="ti" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld"><label className="lab">Email</label><input className="ti" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
        </div>
        <button className="btn sm" disabled={busy}>{busy ? 'Inviting…' : 'Send invite'}</button>
      </form>
      {manualLink && (
        <div className="fld mt2"><label className="lab">One-time setup link (send it yourself)</label>
          <textarea className="ta" style={{ minHeight: 60, fontSize: '.78rem' }} readOnly value={manualLink} onClick={e => e.target.select()} /></div>
      )}

      <div className="mt2">
        <div className="lab">Who can see this client's portal</div>
        {links.map(l => {
          const u = l.profiles;
          if (!u) return null;
          return (
            <div key={l.profile_id} className="item">
              <div>
                <div className="nm">
                  {u.full_name || u.email}
                  {u.client_id === client.id && <span className="chip" style={{ marginLeft: 8 }}>Viewing this client</span>}
                </div>
                <div className="meta">{u.email}</div>
              </div>
              <div className="row">
                <span className={`chip ${u.language}`}>{(u.language || 'en').toUpperCase()}</span>
                {migrated && (
                  <button className="icon-btn icon-btn-danger" title="Remove access" disabled={busy}
                    onClick={() => removeLink(l)}>×</button>
                )}
              </div>
            </div>
          );
        })}
        {links.length === 0 && <div className="empty">No portal users yet.</div>}
      </div>

      {migrated ? (
        <div className="row mt2">
          <select className="sel" style={{ maxWidth: 320 }} value={addId} onChange={e => setAddId(e.target.value)}>
            <option value="">Link an existing portal user…</option>
            {allProfiles
              .filter(p => !links.some(l => l.profile_id === p.id))
              .map(p => <option key={p.id} value={p.id}>{p.full_name ? `${p.full_name} (${p.email})` : p.email}</option>)}
          </select>
          <button className="btn sm gh" disabled={busy || !addId} onClick={addLink}>Add</button>
        </div>
      ) : (
        <div className="sub mt2">Multi-client access is not active yet. Run supabase/multi-client.sql to enable linking one login to several clients.</div>
      )}
    </div>
  );
}
