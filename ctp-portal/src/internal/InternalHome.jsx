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

const PROJECT_STATUS_PILLS = {
  planned:     { cls: 'wp-neutral' },
  in_progress: { cls: 'wp-progress' },
  live:        { cls: 'wp-live' },
  paused:      { cls: 'wp-paused' },
  complete:    { cls: 'wp-complete' },
};

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function fmtDate(dateStr, lang = 'en') {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' });
}

export default function InternalHome() {
  const nav = useNavigate();
  const [clients, setClients] = useState(null);
  const [activity, setActivity] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', property_type: PROPERTY_TYPES[0], contact_name: '', contact_email: '', language: 'en', partner_notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('ctp-client-view') || 'grid'; } catch { return 'grid'; }
  });

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('ctp-client-view', v); } catch {}
  };

  const load = async () => {
    const { data: cs } = await supabase
      .from('clients')
      .select('*, projects(id, title, type, status)')
      .order('created_at', { ascending: false });
    setClients(cs || []);
    const { data: act } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(6);
    setActivity(act || []);
  };
  useEffect(() => { load(); }, []);

  const createClient = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { data, error } = await supabase.from('clients').insert(form).select().single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav(`/clients/${data.id}`);
  };

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (!clients) return <div className="center"><div className="sp" /></div>;

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
          <button className="btn" onClick={() => setCreating(c => !c)}>
            {creating ? 'Close' : '+ New client'}
          </button>
        </div>
      </div>

      {/* New client form */}
      {creating && (
        <form className="card spine" onSubmit={createClient} style={{ marginBottom: 22 }}>
          <h3>New client</h3>
          <div className="sub" style={{ marginBottom: 16 }}>Create the record first — projects, reports and portal access come next.</div>
          {err && <div className="auth-err">{err}</div>}
          <div className="grid2">
            <div className="fld"><label className="lab">Client / property name</label>
              <input className="ti" value={form.name} onChange={F('name')} required placeholder="Hotel Ses Bruixes & Spa" /></div>
            <div className="fld"><label className="lab">Type</label>
              <select className="sel" value={form.property_type} onChange={F('property_type')}>
                {PROPERTY_TYPES.map(p => <option key={p}>{p}</option>)}
              </select></div>
            <div className="fld"><label className="lab">Contact name</label>
              <input className="ti" value={form.contact_name} onChange={F('contact_name')} placeholder="Anya" /></div>
            <div className="fld"><label className="lab">Contact email</label>
              <input className="ti" type="email" value={form.contact_email} onChange={F('contact_email')} /></div>
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

      {/* Empty state */}
      {clients.length === 0 && !creating && (
        <div className="card"><div className="empty">No clients yet. Create the first one.</div></div>
      )}

      {/* Grid view */}
      {view === 'grid' && clients.length > 0 && (
        <div className="co-grid">
          {clients.map(c => {
            const sc = STATUS_CFG[c.status] || STATUS_CFG.active;
            const projects = c.projects || [];
            const activeProjects = projects.filter(p => p.status === 'live' || p.status === 'in_progress');
            const days = daysSince(c.created_at);
            return (
              <button key={c.id} className={`co-card ${sc.cls}`} onClick={() => nav(`/clients/${c.id}`)}>
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
                  <div className="co-avatar">RP</div>
                  <span className="co-updated">Updated {fmtDate(c.created_at)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* List view */}
      {view === 'list' && clients.length > 0 && (
        <div className="co-table">
          <div className="co-table-head">
            <div className="co-th co-th-client">Client</div>
            <div className="co-th co-th-status">Status</div>
            <div className="co-th co-th-work">Active work</div>
            <div className="co-th co-th-team">Team</div>
          </div>
          {clients.map(c => {
            const sc = STATUS_CFG[c.status] || STATUS_CFG.active;
            const projects = c.projects || [];
            const visibleProjects = projects.filter(p => p.status !== 'complete').slice(0, 3);
            return (
              <button key={c.id} className="co-table-row" onClick={() => nav(`/clients/${c.id}`)}>
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
                  <div className="co-avatar">RP</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Activity */}
      <div className="mt3">
        <div className="co-section-label">Recent activity</div>
        <div className="card">
          {activity.length === 0 && <div className="empty">Activity will appear here — publishes, uploads, invites.</div>}
          {activity.map(a => (
            <div key={a.id} className="item">
              <div>
                <div className="nm">{a.action.replace(/_/g, ' ')}</div>
                <div className="meta">{a.details || ''}</div>
              </div>
              <div className="meta">{new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
