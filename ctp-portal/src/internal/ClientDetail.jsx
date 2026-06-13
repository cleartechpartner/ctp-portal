import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { translate, notify, inviteClient, signedUrl, fmtBytes, monthLabel } from '../lib/api';

const PROJECT_TYPES = ['Guida deployment', 'Verification layer', 'Website / booking', 'Automation', 'Add-on', 'One-off', 'Consulting', 'Other'];
const PROJECT_STATUS = ['planned', 'in_progress', 'live', 'paused', 'complete'];
const UPDATE_CATS = [['kb', 'Knowledge base'], ['prompt', 'Agent tuning'], ['feature', 'New feature'], ['fix', 'Fix'], ['learning', 'Learning'], ['update', 'Update']];
const DOC_CATS = [['contract', 'Contract'], ['dpa', 'Data processing agreement'], ['onboarding', 'Onboarding'], ['invoice', 'Invoice'], ['general', 'General']];

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
            <span className={`chip ${client.status}`}>{client.status}</span>
          </div>
        </div>
      </div>

      <div className="tabs">
        {['overview', 'reports', 'updates', 'documents', 'access'].map(x => (
          <button key={x} className={'tab' + (tab === x ? ' on' : '')} onClick={() => setTab(x)}>
            {x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview client={client} onSaved={loadClient} toast={toast} />}
      {tab === 'reports' && <ReportsTab client={client} toast={toast} />}
      {tab === 'updates' && <UpdatesTab client={client} toast={toast} />}
      {tab === 'documents' && <DocumentsTab client={client} toast={toast} />}
      {tab === 'access' && <AccessTab client={client} toast={toast} />}

      {toastMsg && <div className="tst">{toastMsg}</div>}
    </div>
  );
}

/* ---------- Overview: profile + flexible project line items ---------- */
function Overview({ client, onSaved, toast }) {
  const [form, setForm] = useState(client);
  const [projects, setProjects] = useState([]);
  const [pForm, setPForm] = useState({ title: '', type: PROJECT_TYPES[0], status: 'planned', description: '', notes: '' });
  const [adding, setAdding] = useState(false);

  const loadProjects = async () => {
    const { data } = await supabase.from('projects').select('*').eq('client_id', client.id).order('created_at');
    setProjects(data || []);
  };
  useEffect(() => { loadProjects(); }, [client.id]);

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const { error } = await supabase.from('clients').update({
      name: form.name, property_type: form.property_type, contact_name: form.contact_name,
      contact_email: form.contact_email, language: form.language, status: form.status, partner_notes: form.partner_notes
    }).eq('id', client.id);
    if (error) { toast('Save failed'); return; }
    toast('Client saved'); onSaved();
  };

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
        <h3>Client profile</h3>
        <div className="grid2 mt">
          <div className="fld"><label className="lab">Name</label><input className="ti" value={form.name || ''} onChange={F('name')} /></div>
          <div className="fld"><label className="lab">Type</label><input className="ti" value={form.property_type || ''} onChange={F('property_type')} /></div>
          <div className="fld"><label className="lab">Contact name</label><input className="ti" value={form.contact_name || ''} onChange={F('contact_name')} /></div>
          <div className="fld"><label className="lab">Contact email</label><input className="ti" value={form.contact_email || ''} onChange={F('contact_email')} /></div>
          <div className="fld"><label className="lab">Portal language</label>
            <select className="sel" value={form.language} onChange={F('language')}><option value="en">English</option><option value="es">Español</option></select></div>
          <div className="fld"><label className="lab">Status</label>
            <select className="sel" value={form.status} onChange={F('status')}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></div>
        </div>
        <div className="fld"><label className="lab">Internal notes</label><textarea className="ta" value={form.partner_notes || ''} onChange={F('partner_notes')} /></div>
        <button className="btn" onClick={save}>Save profile</button>
      </div>

      <div className="card mt2">
        <div className="spread">
          <div><h3>Projects</h3><div className="sub">The flexible line items — Guida, bookings, automations, one-offs.</div></div>
          <button className="btn sm gh" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : 'Add project'}</button>
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
                <select className="sel" style={{ width: 'auto', padding: '6px 10px', fontSize: '.8rem' }} value={p.status} onChange={e => setStatus(p, e.target.value)}>
                  {PROJECT_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <button className="btn sm dgr" onClick={() => removeProject(p)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- Reports: compose EN, translate, publish bilingual ---------- */
function ReportsTab({ client, toast }) {
  const [reports, setReports] = useState([]);
  const [editing, setEditing] = useState(null); // report object or 'new'
  const [busy, setBusy] = useState('');

  const blank = () => ({
    client_id: client.id,
    month: new Date().toISOString().slice(0, 7),
    title_en: '', title_es: '', body_en: '', body_es: '', status: 'draft'
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
      toast('Spanish version ready — review it before publishing');
    } catch (e) { toast('Translation failed: ' + e.message); }
    setBusy('');
  };

  const publish = async (r, setR) => {
    setBusy('publish');
    try {
      let row = { ...r };
      // Spanish-language clients always get a reviewed or auto Spanish version.
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
      toast('Published — client notified');
      setEditing(null); load();
    } catch (e) { toast('Publish failed: ' + e.message); }
    setBusy('');
  };

  if (editing) return <ReportEditor r={editing === 'new' ? blank() : editing} busy={busy}
    onCancel={() => setEditing(null)} onSave={saveDraft} onTranslate={doTranslate} onPublish={publish} clientLang={client.language} />;

  return (
    <div className="card">
      <div className="spread">
        <div><h3>Monthly reports</h3><div className="sub">Drafts stay private. Publishing emails {client.contact_name || 'the client'}.</div></div>
        <button className="btn sm" onClick={() => setEditing('new')}>New report</button>
      </div>
      <div className="mt">
        {reports.length === 0 && <div className="empty">No reports yet. The first one sets the tone.</div>}
        {reports.map(r => (
          <div key={r.id} className="item">
            <div>
              <div className="nm">{monthLabel(r.month)} {r.title_en ? `— ${r.title_en}` : ''}</div>
              <div className="meta">{r.published_at ? 'Published ' + new Date(r.published_at).toLocaleDateString('en-GB') : 'Draft'}</div>
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

function ReportEditor({ r: initial, busy, onCancel, onSave, onTranslate, onPublish, clientLang }) {
  const [r, setR] = useState(initial);
  const F = (k) => (e) => setR(x => ({ ...x, [k]: e.target.value }));
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

      <div className="row">
        <button className="btn gh sm" disabled={busy === 'translate' || !r.body_en} onClick={() => onTranslate(r, setR)}>
          {busy === 'translate' ? 'Translating…' : 'Translate to Spanish'}
        </button>
        <span className="sub">{clientLang === 'es' ? 'This client reads the portal in Spanish — publishing auto-translates if you skip this.' : 'Optional for this client.'}</span>
      </div>

      {(r.title_es || r.body_es) && (
        <div className="mt2">
          <div className="fld"><label className="lab">Title (Spanish — editable)</label><input className="ti" value={r.title_es || ''} onChange={F('title_es')} /></div>
          <div className="fld"><label className="lab">Report (Spanish — editable)</label><textarea className="ta big" value={r.body_es || ''} onChange={F('body_es')} /></div>
        </div>
      )}

      <div className="row mt2">
        <button className="btn gh" disabled={!!busy} onClick={() => onSave(r)}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        <button className="btn" disabled={!!busy || !r.body_en} onClick={() => onPublish(r, setR)}>{busy === 'publish' ? 'Publishing…' : 'Publish & notify client'}</button>
      </div>
    </div>
  );
}

/* ---------- Updates: quick log entries, auto-translated for ES clients ---------- */
function UpdatesTab({ client, toast }) {
  const [items, setItems] = useState([]);
  const [body, setBody] = useState('');
  const [cat, setCat] = useState('update');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('updates').select('*').eq('client_id', client.id).order('date', { ascending: false }).order('created_at', { ascending: false });
    setItems(data || []);
  };
  useEffect(() => { load(); }, [client.id]);

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

  return (
    <div className="card">
      <h3>Updates log</h3>
      <div className="sub">Log every improvement as you make it — the month-end report writes itself.</div>
      <form onSubmit={add} className="mt">
        <div className="row">
          <select className="sel" style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value)}>
            {UPDATE_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="fld mt"><textarea className="ta" style={{ minHeight: 70 }} value={body} onChange={e => setBody(e.target.value)} placeholder="Added Catalan greetings to Guida's late-night flow." required /></div>
        <button className="btn sm" disabled={busy || !body.trim()}>{busy ? 'Logging…' : 'Log update'}</button>
      </form>
      <div className="mt2">
        {items.length === 0 && <div className="empty">Nothing logged yet.</div>}
        {items.map(u => (
          <div key={u.id} className="item">
            <div style={{ flex: 1 }}>
              <div className="row"><span className="chip">{(UPDATE_CATS.find(c => c[0] === u.category) || [])[1] || u.category}</span>
                <span className="meta">{new Date(u.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
              <div className="mt" style={{ fontSize: '.92rem' }}>{u.body_en}</div>
              {u.body_es && <div className="meta mt">ES: {u.body_es}</div>}
            </div>
            <button className="btn sm dgr" onClick={() => remove(u)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Documents: upload to client folder, optional notify ---------- */
function DocumentsTab({ client, toast }) {
  const [docs, setDocs] = useState([]);
  const [cat, setCat] = useState('general');
  const [notifyClient, setNotifyClient] = useState(true);
  const [busy, setBusy] = useState(false);

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
      toast(notifyClient ? 'Uploaded — client notified' : 'Uploaded');
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

  return (
    <div className="card">
      <h3>Documents</h3>
      <div className="sub">Contracts, DPAs, onboarding — the client sees these in their portal.</div>
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
      <div className="mt2">
        {docs.length === 0 && <div className="empty">No documents yet.</div>}
        {docs.map(d => (
          <div key={d.id} className="item">
            <div>
              <div className="nm">{d.name}</div>
              <div className="meta">{(DOC_CATS.find(c => c[0] === d.category) || [])[1]} · {fmtBytes(d.size_bytes)} · {d.uploaded_by === 'client' ? 'Uploaded by client' : 'Uploaded by CTP'}</div>
            </div>
            <div className="row">
              <button className="btn sm gh" onClick={() => open(d)}>Open</button>
              <button className="btn sm dgr" onClick={() => remove(d)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Access: invite client users ---------- */
function AccessTab({ client, toast }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState(client.contact_email || '');
  const [name, setName] = useState(client.contact_name || '');
  const [busy, setBusy] = useState(false);
  const [manualLink, setManualLink] = useState('');

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('client_id', client.id);
    setUsers(data || []);
  };
  useEffect(() => { load(); }, [client.id]);

  const invite = async (e) => {
    e.preventDefault();
    setBusy(true); setManualLink('');
    try {
      const res = await inviteClient({ client_id: client.id, email: email.trim(), full_name: name.trim(), language: client.language });
      if (res.emailed) toast('Invite sent');
      else if (res.action_link) { setManualLink(res.action_link); toast('Invite created — email not configured, share the link below'); }
      load();
    } catch (err) { toast('Invite failed: ' + err.message); }
    setBusy(false);
  };

  return (
    <div className="card">
      <h3>Portal access</h3>
      <div className="sub">Invite {client.contact_name || 'the client'} — they get a branded welcome email in {client.language === 'es' ? 'Spanish' : 'English'} with a secure setup link.</div>
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
        {users.map(u => (
          <div key={u.id} className="item">
            <div><div className="nm">{u.full_name || u.email}</div><div className="meta">{u.email}</div></div>
            <span className={`chip ${u.language}`}>{u.language.toUpperCase()}</span>
          </div>
        ))}
        {users.length === 0 && <div className="empty">No portal users yet.</div>}
      </div>
    </div>
  );
}
