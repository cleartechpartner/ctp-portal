import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fx } from '../lib/api';
import { initials, staffName } from '../lib/tasks';
import { AssigneePicker } from './TaskPanel';
import PhoneInput from '../components/PhoneInput';
import {
  STAGES, PRIORITIES, STAGE_CLS, PRIORITY_CLS, PRIORITY_SHORT, LOG_KINDS,
  stageOf, priorityOf, companyInitials, townOf, timeAgoShort, lastContact, changeStage,
} from '../lib/prospects';

// The enriched client detail card: logo, inline-editable facts strip,
// contacts with photos, activity timeline, and the Log activity / Send
// email / Generate Proposal actions. Used by the Prospects split view and
// by the client detail page for every client regardless of status; the
// pipeline stage pill only renders for prospects.

const fmtDate = (d) => d
  ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  : '';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------- Shared display atoms ---------- */

export function PriorityPill({ value }) {
  const p = PRIORITIES.includes(value) ? value : 'Medium';
  return (
    <span className={`pr-pri ${PRIORITY_CLS[p]}`}>
      <span className="pr-dot" />{PRIORITY_SHORT[p]}
    </span>
  );
}

export function StagePill({ value }) {
  const s = STAGES.includes(value) ? value : 'New';
  return <span className={`pr-stage ${STAGE_CLS[s]}`}>{s}</span>;
}

// Company logo: circular, initials fallback, same look as contact avatars.
export function CompanyLogo({ prospect, size = 52, onPick, uploading }) {
  const inner = prospect.logo_url
    ? <img src={prospect.logo_url} alt="" />
    : companyInitials(prospect.name);
  const style = size !== 52 ? { width: size, height: size, fontSize: Math.round(size * 0.37) } : undefined;
  if (!onPick) return <span className="pr-logo" style={style}>{inner}</span>;
  return (
    <label className="pr-logo pr-logo-btn" style={style} title="Upload logo">
      {uploading ? <span className="sp" style={{ width: 18, height: 18, borderWidth: 2 }} /> : inner}
      <input type="file" hidden accept="image/*" onChange={onPick} disabled={uploading} />
    </label>
  );
}

function ContactAvatar({ contact, size = 32, onPick, uploading }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.37) };
  const inner = contact.avatar_url
    ? <img src={contact.avatar_url} alt="" />
    : companyInitials(contact.full_name);
  if (!onPick) return <span className="pr-av pr-av-lg" style={style}>{inner}</span>;
  return (
    <label className="pr-av pr-av-lg pr-logo-btn" style={style} title="Upload photo">
      {uploading ? <span className="sp" style={{ width: 14, height: 14, borderWidth: 2 }} /> : inner}
      <input type="file" hidden accept="image/*" onChange={onPick} disabled={uploading} />
    </label>
  );
}

export function ContactAvatars({ contacts }) {
  const list = (contacts || []).slice(0, 3);
  if (!list.length) return <span className="pr-none">-</span>;
  return (
    <div className="pr-avs">
      {list.map(c => (
        <span key={c.id} className="pr-av" title={c.full_name}>
          {c.avatar_url ? <img src={c.avatar_url} alt="" /> : companyInitials(c.full_name)}
        </span>
      ))}
      {(contacts || []).length > 3 && <span className="pr-av">+{contacts.length - 3}</span>}
    </div>
  );
}

// Avatar stack for the staff assigned to a prospect (board cards, rows).
export function StaffAvatars({ ids, staff }) {
  const people = (ids || []).map(id => staff.find(s => s.id === id)).filter(Boolean);
  if (!people.length) return null;
  return (
    <div className="pr-avs">
      {people.slice(0, 3).map(s => (
        <span key={s.id} className="pr-av" title={staffName(s)}>
          {s.avatar_url ? <img src={s.avatar_url} alt="" /> : initials(s)}
        </span>
      ))}
      {people.length > 3 && <span className="pr-av">+{people.length - 3}</span>}
    </div>
  );
}

/* ---------- Inline editing ---------- */

function InlineEdit({ value, display, placeholder = 'add', type = 'text', onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  useEffect(() => { if (!editing) setVal(value ?? ''); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const v = String(val).trim();
    if ((v || null) !== (value || null)) onSave(v || null);
  };

  if (!editing) {
    return (
      <button type="button" className="pr-inline" onClick={() => setEditing(true)} title="Click to edit">
        {value ? <span>{display ?? value}</span> : <span className="ph">{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      className="pr-inline-input"
      type={type}
      value={val}
      autoFocus
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); }
      }}
    />
  );
}

function InlinePhone({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');
  useEffect(() => { if (!editing) setVal(value || ''); }, [value, editing]);

  if (!editing) {
    return (
      <button type="button" className="pr-inline" onClick={() => setEditing(true)} title="Click to edit">
        {value ? <span>{value}</span> : <span className="ph">add</span>}
      </button>
    );
  }
  return (
    <span className="pr-inline-phone">
      <PhoneInput value={val} onChange={setVal} autoFocus />
      <button
        type="button" className="pr-icon-btn" title="Save" aria-label="Save phone"
        onClick={() => { setEditing(false); if ((val || null) !== (value || null)) onSave(val || null); }}
      >&#10003;</button>
      <button
        type="button" className="pr-icon-btn" title="Cancel" aria-label="Cancel"
        onClick={() => { setVal(value || ''); setEditing(false); }}
      >&times;</button>
    </span>
  );
}

/* ---------- The detail card ---------- */

export default function ProspectDetailCard({ client, myProfile, staff, onChanged, toast, nav }) {
  const isProspect = client.client_status === 'prospect';
  const [contacts, setContacts] = useState(null);
  const [interactions, setInteractions] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const loadDetail = useCallback(async () => {
    const [cRes, iRes, tRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('client_id', client.id)
        .order('is_primary', { ascending: false }).order('created_at'),
      supabase.from('interactions').select('*').eq('client_id', client.id)
        .order('occurred_at', { ascending: false }),
      supabase.from('tasks').select('id, title, due_date, status').eq('client_id', client.id)
        .eq('status', 'open').order('due_date', { ascending: true, nullsFirst: false }),
    ]);
    setContacts(cRes.data || []);
    setInteractions(iRes.data || []);
    setTasks(tRes.error ? [] : (tRes.data || []));
  }, [client.id]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const refreshAll = () => { loadDetail(); onChanged(); };

  const saveField = async (patch) => {
    const { error } = await supabase.from('clients').update(patch).eq('id', client.id);
    if (error) { toast('Save failed: ' + error.message); return; }
    toast('Saved');
    onChanged();
  };

  const setStage = async (stage) => {
    try {
      await changeStage(client, stage, myProfile?.id);
      toast('Moved to ' + stage);
      refreshAll();
    } catch (e) { toast('Stage change failed: ' + e.message); }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${client.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('logos').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('logos').getPublicUrl(path);
      const { error } = await supabase.from('clients').update({ logo_url: pub.publicUrl }).eq('id', client.id);
      if (error) throw new Error(error.message);
      toast('Logo updated');
      onChanged();
    } catch (ex) { toast('Logo upload failed: ' + ex.message); }
    setUploadingLogo(false);
    e.target.value = '';
  };

  const contacted = lastContact(interactions || client.interactions || []);
  const website = (client.website || '').trim();
  const websiteHref = website && !/^https?:\/\//i.test(website) ? 'https://' + website : website;

  return (
    <div className="pr-detail">
      <div className="pr-dtop">
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', minWidth: 0 }}>
          <CompanyLogo prospect={client} onPick={uploadLogo} uploading={uploadingLogo} />
          <div style={{ minWidth: 0 }}>
            <h2>{client.name}</h2>
            <div className="pr-dloc">
              {[townOf(client.locality), client.segment].filter(Boolean).join(' · ')}
              {isProspect && (
                <select
                  className={`pr-pill-sel ${STAGE_CLS[stageOf(client)]}`}
                  value={stageOf(client)}
                  onChange={e => setStage(e.target.value)}
                  aria-label="Pipeline stage"
                >
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>
        <select
          className={`pr-pill-sel pr-pri-sel ${PRIORITY_CLS[priorityOf(client)]}`}
          value={priorityOf(client)}
          onChange={e => saveField({ priority: e.target.value })}
          aria-label="Priority"
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
        </select>
      </div>

      <div className="pr-facts">
        <div className="pr-fact">
          <div className="k">Assigned to</div>
          <div className="v">
            <AssigneePicker
              staff={staff}
              value={client.assigned_to || []}
              onChange={(ids) => saveField({ assigned_to: ids })}
              avatarMode
            />
          </div>
        </div>
        <div className="pr-fact">
          <div className="k">Last contacted</div>
          <div className="v">{contacted ? timeAgoShort(contacted.occurred_at) : 'not yet'}</div>
        </div>
        <div className="pr-fact">
          <div className="k">Next step</div>
          <div className="v"><InlineEdit value={client.next_step} onSave={v => saveField({ next_step: v })} /></div>
        </div>
        <div className="pr-fact">
          <div className="k">Date</div>
          <div className="v">
            <InlineEdit
              value={client.next_step_date}
              display={fmtDate(client.next_step_date)}
              type="date"
              onSave={v => saveField({ next_step_date: v })}
            />
          </div>
        </div>
        <div className="pr-fact">
          <div className="k">Website</div>
          <div className="v">
            <InlineEdit
              value={client.website}
              display={website.replace(/^https?:\/\//i, '')}
              onSave={v => saveField({ website: v })}
            />
            {website && (
              <a href={websiteHref} target="_blank" rel="noreferrer" title="Open website" aria-label="Open website">&#8599;</a>
            )}
          </div>
        </div>
        <div className="pr-fact">
          <div className="k">Phone</div>
          <div className="v"><InlinePhone value={client.phone} onSave={v => saveField({ phone: v })} /></div>
        </div>
        <div className="pr-fact">
          <div className="k">Locality</div>
          <div className="v"><InlineEdit value={client.locality} onSave={v => saveField({ locality: v })} /></div>
        </div>
        <div className="pr-fact">
          <div className="k">Segment</div>
          <div className="v"><InlineEdit value={client.segment} onSave={v => saveField({ segment: v })} /></div>
        </div>
        <div className="pr-fact">
          <div className="k">Ownership</div>
          <div className="v"><InlineEdit value={client.ownership} onSave={v => saveField({ ownership: v })} /></div>
        </div>
      </div>

      <div className="pr-dactions">
        <button className="pr-btn primary" onClick={() => setLogOpen(true)}>Log activity</button>
        <button className="pr-btn" onClick={() => setEmailOpen(true)}>Send email</button>
        <button className="pr-btn" onClick={() => nav(`/proposals/new?client=${client.id}`)}>Generate Proposal</button>
      </div>

      <div className="pr-dgrid">
        <ContactsSection client={client} myProfile={myProfile} contacts={contacts} reload={refreshAll} toast={toast} />
        <div className="pr-dsec">
          <h3>Activity</h3>
          <Timeline interactions={interactions} tasks={tasks} contacts={contacts || []} />
        </div>
      </div>

      {logOpen && (
        <LogActivityModal
          client={client}
          contacts={contacts || []}
          myProfile={myProfile}
          onClose={() => setLogOpen(false)}
          onLogged={() => { setLogOpen(false); toast('Activity logged'); refreshAll(); }}
          toast={toast}
        />
      )}

      {emailOpen && (
        <SendEmailModal
          client={client}
          contacts={contacts || []}
          onClose={() => setEmailOpen(false)}
          onSent={() => { setEmailOpen(false); toast('Email sent and logged'); refreshAll(); }}
        />
      )}
    </div>
  );
}

/* ---------- Contacts ---------- */

const BLANK_CONTACT = { full_name: '', role: '', email: '', phone: '', linkedin_url: '', notes: '' };

function ContactsSection({ client, myProfile, contacts, reload, toast }) {
  const [editing, setEditing] = useState(null); // 'new' or a contact row
  const [uploadingId, setUploadingId] = useState(null);

  const save = async (form) => {
    const row = {
      full_name: form.full_name.trim(),
      role: form.role.trim() || null,
      email: form.email.trim() || null,
      phone: (form.phone || '').trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      notes: form.notes.trim() || null,
    };
    let error;
    if (editing === 'new') {
      ({ error } = await supabase.from('contacts').insert({
        ...row, client_id: client.id, is_primary: !(contacts || []).length,
      }));
    } else {
      ({ error } = await supabase.from('contacts').update(row).eq('id', editing.id));
    }
    if (error) { toast('Save failed: ' + error.message); return; }
    setEditing(null);
    toast(editing === 'new' ? 'Contact added' : 'Contact saved');
    reload();
  };

  const remove = async (c) => {
    if (!confirm(`Delete contact "${c.full_name}"?`)) return;
    const { error } = await supabase.from('contacts').delete().eq('id', c.id);
    if (error) { toast('Delete failed: ' + error.message); return; }
    reload();
  };

  const makePrimary = async (c) => {
    if (c.is_primary) return;
    const { error } = await supabase.from('contacts').update({ is_primary: false })
      .eq('client_id', client.id).eq('is_primary', true);
    if (error) { toast('Update failed: ' + error.message); return; }
    const { error: e2 } = await supabase.from('contacts').update({ is_primary: true }).eq('id', c.id);
    if (e2) { toast('Update failed: ' + e2.message); return; }
    reload();
  };

  // Contact photos reuse the avatars bucket: public read, and writes are
  // only allowed inside a folder named after the uploader's own uid.
  const uploadPhoto = async (c, e) => {
    const file = e.target.files[0];
    if (!file || !myProfile?.id) return;
    setUploadingId(c.id);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${myProfile.id}/contact-${c.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error } = await supabase.from('contacts').update({ avatar_url: pub.publicUrl }).eq('id', c.id);
      if (error) throw new Error(error.message);
      toast('Photo updated');
      reload();
    } catch (ex) { toast('Photo upload failed: ' + ex.message); }
    setUploadingId(null);
    e.target.value = '';
  };

  return (
    <div className="pr-dsec">
      <div className="pr-dsec-head">
        <h3>Contacts</h3>
        <button className="pr-btn pr-btn-xs" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          {editing === 'new' ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {editing === 'new' && <ContactForm initial={BLANK_CONTACT} onSave={save} onCancel={() => setEditing(null)} />}

      {contacts === null && <div className="pr-none">Loading...</div>}
      {contacts?.length === 0 && editing !== 'new' && <div className="pr-none">No contacts yet.</div>}

      {(contacts || []).map(c => (
        editing && editing !== 'new' && editing.id === c.id ? (
          <ContactForm key={c.id} initial={c} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <div key={c.id} className="pr-contact">
            <ContactAvatar contact={c} onPick={(e) => uploadPhoto(c, e)} uploading={uploadingId === c.id} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">
                {c.full_name}
                <button
                  className={'pr-star' + (c.is_primary ? ' on' : '')}
                  onClick={() => makePrimary(c)}
                  title={c.is_primary ? 'Primary contact' : 'Make primary'}
                  aria-label={c.is_primary ? 'Primary contact' : 'Make primary'}
                >&#9733;</button>
              </div>
              <div className="rl">
                {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || 'No details yet'}
                {c.linkedin_url && <> · <a href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></>}
              </div>
              {c.notes && <div className="rl">{c.notes}</div>}
            </div>
            <div className="pr-contact-actions">
              <button className="pr-icon-btn" onClick={() => setEditing(c)} title="Edit contact" aria-label="Edit contact">&#9998;</button>
              <button className="pr-icon-btn danger" onClick={() => remove(c)} title="Delete contact" aria-label="Delete contact">&times;</button>
            </div>
          </div>
        )
      ))}
    </div>
  );
}

function ContactForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...BLANK_CONTACT, ...initial });
  const [busy, setBusy] = useState(false);
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await onSave(form);
    setBusy(false);
  };

  return (
    <form className="pr-contact-form" onSubmit={submit}>
      <div className="grid2">
        <div className="fld"><label className="lab">Name</label>
          <input className="ti" value={form.full_name} onChange={F('full_name')} required placeholder="Marc Coll" /></div>
        <div className="fld"><label className="lab">Role</label>
          <input className="ti" value={form.role || ''} onChange={F('role')} placeholder="General Manager" /></div>
      </div>
      <div className="grid2">
        <div className="fld"><label className="lab">Email</label>
          <input className="ti" type="email" value={form.email || ''} onChange={F('email')} /></div>
        <div className="fld"><label className="lab">Phone</label>
          <PhoneInput value={form.phone || ''} onChange={v => setForm(f => ({ ...f, phone: v }))} /></div>
      </div>
      <div className="fld"><label className="lab">LinkedIn</label>
        <input className="ti" value={form.linkedin_url || ''} onChange={F('linkedin_url')} placeholder="https://linkedin.com/in/..." /></div>
      <div className="fld"><label className="lab">Notes</label>
        <input className="ti" value={form.notes || ''} onChange={F('notes')} /></div>
      <div className="row">
        <button className="btn sm" disabled={busy || !form.full_name.trim()}>{busy ? 'Saving...' : 'Save contact'}</button>
        <button type="button" className="btn sm gh" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- Timeline ---------- */

function Timeline({ interactions, tasks, contacts }) {
  if (interactions === null) return <div className="pr-none">Loading...</div>;
  if (!interactions.length && !tasks.length) return <div className="pr-none">Nothing yet. Log the first touch.</div>;

  const contactName = (id) => contacts.find(c => c.id === id)?.full_name;

  return (
    <div className="pr-timeline">
      {tasks.map(t => (
        <div key={'task-' + t.id} className="pr-tl k-task">
          <div className="t">Task · {t.title}</div>
          <div className="w">
            {t.due_date ? 'due ' + fmtDate(t.due_date) + ' · ' : ''}open in your Task manager
          </div>
        </div>
      ))}
      {interactions.map(i => {
        const opens = i.metadata?.opens;
        return (
          <div key={i.id} className={`pr-tl k-${i.kind}`}>
            <div className="t">{i.title}</div>
            {i.body && <div className="b">{i.body}</div>}
            <div className="w">
              {timeAgoShort(i.occurred_at)}
              {i.contact_id && contactName(i.contact_id) ? ' · ' + contactName(i.contact_id) : ''}
              {opens ? ` · opened ${opens}x (unreliable signal)` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Log activity modal ---------- */

function LogActivityModal({ client, contacts, myProfile, onClose, onLogged, toast }) {
  const [form, setForm] = useState({ kind: 'note', title: '', body: '', contact_id: '', date: todayISO() });
  const [busy, setBusy] = useState(false);
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('interactions').insert({
      client_id: client.id,
      contact_id: form.contact_id || null,
      kind: form.kind,
      title: form.title.trim(),
      body: form.body.trim() || null,
      occurred_at: new Date(form.date + 'T12:00:00').toISOString(),
      created_by: myProfile?.id || null,
    });
    setBusy(false);
    if (error) { toast('Log failed: ' + error.message); return; }
    onLogged();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head"><h3>Log activity</h3><button type="button" className="link-btn" onClick={onClose}>Close</button></div>
        <div className="grid2">
          <div className="fld"><label className="lab">Kind</label>
            <select className="sel" value={form.kind} onChange={F('kind')}>
              {LOG_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="fld"><label className="lab">Date</label>
            <input className="ti" type="date" value={form.date} onChange={F('date')} /></div>
        </div>
        <div className="fld"><label className="lab">Title</label>
          <input className="ti" value={form.title} onChange={F('title')} required placeholder="Intro call with the GM" /></div>
        <div className="fld"><label className="lab">Notes (optional)</label>
          <textarea className="ta" style={{ minHeight: 80 }} value={form.body} onChange={F('body')} /></div>
        <div className="fld"><label className="lab">Contact (optional)</label>
          <select className="sel" value={form.contact_id} onChange={F('contact_id')}>
            <option value="">No specific contact</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select></div>
        <div className="modal-foot">
          <button type="button" className="btn gh sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !form.title.trim()}>{busy ? 'Logging...' : 'Log activity'}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Send email (Resend via prospect-email function) ---------- */

function SendEmailModal({ client, contacts, onClose, onSent }) {
  const primary = contacts.find(c => c.is_primary && c.email) || contacts.find(c => c.email);
  const [form, setForm] = useState({
    contact_id: primary?.id || '',
    to: primary?.email || client.contact_email || '',
    subject: '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const pickContact = (e) => {
    const c = contacts.find(x => x.id === e.target.value);
    setForm(f => ({ ...f, contact_id: e.target.value, to: c?.email || f.to }));
  };

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await fx('/api/prospect-email', {
        client_id: client.id,
        contact_id: form.contact_id || null,
        to: form.to.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      onSent();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={send}>
        <div className="modal-head"><h3>Send email</h3><button type="button" className="link-btn" onClick={onClose}>Close</button></div>
        {err && <div className="auth-err">{err}</div>}
        <div className="grid2">
          <div className="fld"><label className="lab">Contact</label>
            <select className="sel" value={form.contact_id} onChange={pickContact}>
              <option value="">No linked contact</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ''}</option>)}
            </select></div>
          <div className="fld"><label className="lab">To</label>
            <input className="ti" type="email" value={form.to} onChange={F('to')} required placeholder="gm@hotel-example.com" /></div>
        </div>
        <div className="fld"><label className="lab">Subject</label>
          <input className="ti" value={form.subject} onChange={F('subject')} required placeholder="Guida for after-hours guest calls" /></div>
        <div className="fld"><label className="lab">Message</label>
          <textarea className="ta big" value={form.message} onChange={F('message')} required /></div>
        <div className="sub" style={{ marginBottom: 12 }}>
          Sends from the portal address with reply-to set to you, and logs on the activity timeline.
        </div>
        <div className="modal-foot">
          <button type="button" className="btn gh sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !form.to.trim() || !form.subject.trim() || !form.message.trim()}>
            {busy ? 'Sending...' : 'Send email'}
          </button>
        </div>
      </form>
    </div>
  );
}
