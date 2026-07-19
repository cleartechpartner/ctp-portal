import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const PROPERTY_TYPES = ['Hotel & Spa', 'Boutique hotel', 'Villa / vacation rental', 'Spa', 'Restaurant', 'Independent owner', 'Other'];

const STATUS_CFG = {
  proposal_out:    { label: 'Proposal out',    dot: '#EF9F27', cls: 'st-proposal'  },
  contract_signed: { label: 'Contract signed', dot: '#2196F3', cls: 'st-contract'  },
  active:          { label: 'Active',          dot: '#1D9E75', cls: 'st-active'    },
  paused:          { label: 'Paused',          dot: '#9ca3af', cls: 'st-paused'    },
  archived:        { label: 'Archived',        dot: '#6b7280', cls: 'st-archived'  },
};

// Prospects show this instead of the engagement status pill: they have no
// engagement yet, only a proposal pipeline.
const PROSPECT_CFG = { label: 'Prospect', dot: '#7C3AED', cls: 'st-prospect' };
const clientStatusCfg = (c) =>
  c.client_status === 'prospect' ? PROSPECT_CFG : (STATUS_CFG[c.status] || STATUS_CFG.active);

const PROJECT_STATUS_PILLS = {
  planned:     { cls: 'wp-neutral' },
  in_progress: { cls: 'wp-progress' },
  live:        { cls: 'wp-live' },
  paused:      { cls: 'wp-paused' },
  complete:    { cls: 'wp-complete' },
};

const CHILD_TABLES = ['projects', 'reports', 'updates', 'documents'];
const ACTIVITY_PREVIEW_COUNT = 5;

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function fmtDate(dateStr, lang = 'en') {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
}

function initialsOf(name) {
  if (!name) return 'RP';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'RP';
}

function Avatar({ profile, size = 28 }) {
  const style = { width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' };
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt={profile.full_name || 'Avatar'} style={style} />;
  }
  return <div className="co-avatar">{initialsOf(profile?.full_name)}</div>;
}

export default function InternalHome() {
  const nav = useNavigate();
  const [clients, setClients] = useState(null);
  const [activity, setActivity] = useState([]);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [myProfile, setMyProfile] = useState(null);
  const [creating, setCreating] = useState(false);
  const blankForm = { name: '', client_status: 'active', property_type: PROPERTY_TYPES[0], contact_name: '', contact_email: '', location: '', tax_id: '', language: 'en', partner_notes: '' };
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | prospect
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('ctp-client-view') || 'grid'; } catch { return 'grid'; }
  });

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('ctp-client-view', v); } catch {}
  };

  const load = async () => {
    const { data: cs } = await supabase
      .from('clients')
      .select('*, projects(id, title, type, status)')
      .order('name', { ascending: true });
    setClients(cs || []);

    const { data: act } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(50);
    setActivity(act || []);

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (uid) {
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', uid).single();
      if (prof) setMyProfile(prof);
    }
  };
  useEffect(() => { load(); }, []);

  const createClient = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    // client_status, location and tax_id need supabase/proposals.sql to
    // have run; the error message will say so if it has not.
    const row = { ...form, location: form.location.trim() || null, tax_id: form.tax_id.trim() || null };
    const { data, error } = await supabase.from('clients').insert(row).select().single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav(`/clients/${data.id}`);
  };

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const openDelete = (e, client) => {
    e.stopPropagation();
    setDeleteErr('');
    setConfirmText('');
    setDeleteTarget(client);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setConfirmText('');
    setDeleteErr('');
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteErr('');
    try {
      for (const table of CHILD_TABLES) {
        const { error } = await supabase.from(table).delete().eq('client_id', deleteTarget.id);
        if (error) throw new Error(`${table}: ${error.message}`);
      }
      const { error: clientErr } = await supabase.from('clients').delete().eq('id', deleteTarget.id);
      if (clientErr) throw new Error(clientErr.message);

      setClients(cs => cs.filter(c => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (ex) {
      setDeleteErr(ex.message || 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const deleteActivity = async (id) => {
    const prev = activity;
    setActivity(a => a.filter(x => x.id !== id)); // optimistic
    const { error } = await supabase.from('activity_log').delete().eq('id', id);
    if (error) setActivity(prev); // revert on failure
  };

  if (!clients) return <div className="center"><div className="sp" /></div>;

  const visibleActivity = activityExpanded ? activity : activity.slice(0, ACTIVITY_PREVIEW_COUNT);

  const prospectCount = clients.filter(c => c.client_status === 'prospect').length;
  const filteredClients = clients.filter(c =>
    statusFilter === 'all' ? true :
    statusFilter === 'prospect' ? c.client_status === 'prospect' :
    c.client_status !== 'prospect'
  );

  return (
    <div className="page">
      {/* Header */}
      <div className="co-header">
        <div>
          <h1>Clients</h1>
          <p className="sub">All engagements and their status.</p>
        </div>
        <div className="co-actions">
          <div className="co-toggle">
            <button
              className={`co-toggle-btn${view === 'grid' ? ' on' : ''}`}
              onClick={() => switchView('grid')}
              title="Grid view"
              aria-label="Grid view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
            <button
              className={`co-toggle-btn${view === 'list' ? ' on' : ''}`}
              onClick={() => switchView('list')}
              title="List view"
              aria-label="List view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="6.75" width="14" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="11.5" width="14" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg>
            </button>
          </div>
          <button
            className="co-toggle-btn"
            onClick={() => nav('/settings')}
            title="Settings"
            aria-label="Settings"
            style={{ width: 34, height: 34, borderRadius: '50%', overflow: 'hidden', padding: 0 }}
          >
            <Avatar profile={myProfile} size={34} />
          </button>
          <button className="btn" onClick={() => setCreating(c => !c)}>
            {creating ? 'Close' : '+ New client'}
          </button>
        </div>
      </div>

      {/* New client form */}
      {creating && (
        <form className="card spine" onSubmit={createClient} style={{ marginBottom: 22 }}>
          <h3>New client</h3>
          <div className="sub" style={{ marginBottom: 16 }}>
            {form.client_status === 'prospect'
              ? 'Prospects get proposals, not portal access. Convert them once a proposal is signed.'
              : 'Create the record first — projects, reports and portal access come next.'}
          </div>
          {err && <div className="auth-err">{err}</div>}
          <div className="grid2">
            <div className="fld"><label className="lab">Client / property name</label>
              <input className="ti" value={form.name} onChange={F('name')} required placeholder="Hotel Ses Bruixes & Spa" /></div>
            <div className="fld"><label className="lab">Status</label>
              <select className="sel" value={form.client_status} onChange={F('client_status')}>
                <option value="active">Active client</option>
                <option value="prospect">Prospect</option>
              </select></div>
            <div className="fld"><label className="lab">Type</label>
              <select className="sel" value={form.property_type} onChange={F('property_type')}>
                {PROPERTY_TYPES.map(p => <option key={p}>{p}</option>)}
              </select></div>
            <div className="fld"><label className="lab">Contact name</label>
              <input className="ti" value={form.contact_name} onChange={F('contact_name')} placeholder="Anya" /></div>
            <div className="fld"><label className="lab">Contact email</label>
              <input className="ti" type="email" value={form.contact_email} onChange={F('contact_email')} /></div>
            <div className="fld"><label className="lab">Location</label>
              <input className="ti" value={form.location} onChange={F('location')} placeholder="Mahón, Menorca, Spain" /></div>
            <div className="fld"><label className="lab">Tax ID (optional)</label>
              <input className="ti" value={form.tax_id} onChange={F('tax_id')} placeholder="B57798290" /></div>
            <div className="fld"><label className="lab">Portal language</label>
              <select className="sel" value={form.language} onChange={F('language')}>
                <option value="en">English</option><option value="es">Español</option>
              </select></div>
          </div>
          <div className="fld"><label className="lab">Internal notes (never visible to the client)</label>
            <textarea className="ta" value={form.partner_notes} onChange={F('partner_notes')} placeholder="Partner discount, context, anything useful." /></div>
          <button className="btn" disabled={busy || !form.name.trim()}>Create client</button>
        </form>
      )}

      {/* All / Active / Prospects filter */}
      {clients.length > 0 && (
        <div className="doc-filters" style={{ marginBottom: 16 }}>
          {[['all', 'All', clients.length], ['active', 'Active', clients.length - prospectCount], ['prospect', 'Prospects', prospectCount]].map(([v, l, count]) => (
            <button key={v} className={`filter-chip${statusFilter === v ? ' on' : ''}`} onClick={() => setStatusFilter(v)}>
              {l}<span className="filter-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {clients.length === 0 && !creating && (
        <div className="card"><div className="empty">No clients yet. Create the first one.</div></div>
      )}
      {clients.length > 0 && filteredClients.length === 0 && (
        <div className="card"><div className="empty">{statusFilter === 'prospect' ? 'No prospects yet.' : 'No active clients yet.'}</div></div>
      )}

      {/* Grid view */}
      {view === 'grid' && filteredClients.length > 0 && (
        <div className="co-grid">
          {filteredClients.map(c => {
            const sc = clientStatusCfg(c);
            const projects = c.projects || [];
            const activeProjects = projects.filter(p => p.status === 'live' || p.status === 'in_progress');
            const days = daysSince(c.created_at);
            return (
              <div key={c.id} className={`co-card ${sc.cls}`} style={{ position: 'relative' }}>
                <button
                  className="co-delete-btn"
                  onClick={(e) => openDelete(e, c)}
                  title="Delete client"
                  aria-label="Delete client"
                  style={{
                    position: 'absolute', top: 10, right: 10, zIndex: 2,
                    width: 26, height: 26, borderRadius: 6, border: 'none',
                    background: 'rgba(0,0,0,0.06)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4h12M6 4V2.5A1 1 0 0 1 7 1.5h2a1 1 0 0 1 1 1V4M6.5 7.5v4M9.5 7.5v4M3.5 4l.6 8.4a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4L12.5 4" stroke="#B33A3A" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button className="co-card-click" onClick={() => nav(`/clients/${c.id}`)} style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer' }}>
                  <div className="co-card-top">
                    <div>
                      <div className="co-card-name">{c.name}</div>
                      <div className="co-card-type">{c.property_type || '—'}</div>
                    </div>
                    <span className={`co-pill ${sc.cls}`}>{sc.label}</span>
                  </div>
                  {projects.length > 0 && (
                    <div className="co-tags">
                      {[...new Set(projects.map(p => p.type))].map(t => (
                        <span key={t} className="co-tag">{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="co-kpis">
                    <div className="co-kpi">
                      <div className="co-kpi-label">Projects</div>
                      <div className="co-kpi-value">{projects.length}</div>
                    </div>
                    <div className="co-kpi">
                      <div className="co-kpi-label">Active</div>
                      <div className="co-kpi-value">{activeProjects.length}</div>
                    </div>
                    <div className="co-kpi">
                      <div className="co-kpi-label">Days</div>
                      <div className="co-kpi-value">{days}</div>
                    </div>
                  </div>
                  <div className="co-card-foot">
                    <Avatar profile={myProfile} />
                    <span className="co-updated">Updated {fmtDate(c.created_at)}</span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {view === 'list' && filteredClients.length > 0 && (
        <div className="co-table">
          <div className="co-table-head">
            <div className="co-th co-th-client">Client</div>
            <div className="co-th co-th-status">Status</div>
            <div className="co-th co-th-work">Active work</div>
            <div className="co-th co-th-team">Team</div>
            <div className="co-th co-th-actions"></div>
          </div>
          {filteredClients.map(c => {
            const sc = clientStatusCfg(c);
            const projects = c.projects || [];
            const visibleProjects = projects.filter(p => p.status !== 'complete').slice(0, 3);
            return (
              <div key={c.id} className="co-table-row-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
                <button className="co-table-row" onClick={() => nav(`/clients/${c.id}`)} style={{ flex: 1 }}>
                  <div className="co-row-client">
                    <span className="co-dot" style={{ background: sc.dot }} title={sc.label} />
                    <div>
                      <div className="co-row-name">{c.name}</div>
                      <div className="co-row-meta">{c.property_type || '—'}</div>
                    </div>
                  </div>
                  <div className="co-row-status">
                    <span className={`co-pill ${sc.cls}`}>{sc.label}</span>
                  </div>
                  <div className="co-row-work">
                    {visibleProjects.length === 0 && <span className="co-row-meta">—</span>}
                    {visibleProjects.map(p => {
                      const ps = PROJECT_STATUS_PILLS[p.status] || PROJECT_STATUS_PILLS.planned;
                      return <span key={p.id} className={`co-wp ${ps.cls}`}>{p.title} · {p.status.replace('_', ' ')}</span>;
                    })}
                  </div>
                  <div className="co-row-team">
                    <Avatar profile={myProfile} />
                  </div>
                </button>
                <button
                  className="co-delete-btn"
                  onClick={(e) => openDelete(e, c)}
                  title="Delete client"
                  aria-label="Delete client"
                  style={{
                    width: 40, border: 'none', background: 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M2 4h12M6 4V2.5A1 1 0 0 1 7 1.5h2a1 1 0 0 1 1 1V4M6.5 7.5v4M9.5 7.5v4M3.5 4l.6 8.4a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4L12.5 4" stroke="#B33A3A" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity */}
      <div className="mt3">
        <div className="co-section-label">Recent activity</div>
        <div className="card">
          {activity.length === 0 && <div className="empty">Activity will appear here — publishes, uploads, invites.</div>}
          {visibleActivity.map(a => (
            <div key={a.id} className="item" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="nm">{a.action.replace(/_/g, ' ')}</div>
                <div className="meta">{a.details || ''}</div>
              </div>
              <div className="meta" style={{ whiteSpace: 'nowrap' }}>
                {new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
              <button
                onClick={() => deleteActivity(a.id)}
                title="Dismiss"
                aria-label="Dismiss activity"
                style={{
                  width: 22, height: 22, border: 'none', background: 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#9ca3af', flexShrink: 0
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ))}
          {activity.length > ACTIVITY_PREVIEW_COUNT && (
            <button
              className="link-btn"
              onClick={() => setActivityExpanded(v => !v)}
              style={{ marginTop: 10 }}
            >
              {activityExpanded ? 'Show less' : `Show all (${activity.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
          }}
          onClick={closeDelete}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: '90%', background: '#fff' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Delete {deleteTarget.name}?</h3>
            <p className="sub" style={{ marginTop: 8 }}>
              This permanently removes the client and all associated projects, reports, updates, and documents. This cannot be undone.
            </p>
            <div className="fld" style={{ marginTop: 16 }}>
              <label className="lab">Type the client name to confirm</label>
              <input
                className="ti"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={deleteTarget.name}
                autoFocus
              />
            </div>
            {deleteErr && <div className="auth-err" style={{ marginTop: 10 }}>{deleteErr}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={closeDelete} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: '#B33A3A' }}
                onClick={confirmDelete}
                disabled={deleting || confirmText.trim() !== deleteTarget.name.trim()}
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
