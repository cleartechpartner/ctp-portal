import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PROPOSAL_STATUS, proposalNumber, fmtMoney, computeTotals } from '../lib/proposals';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function Proposals() {
  const nav = useNavigate();
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const tab = location.hash === '#settings' ? 'settings' : 'pipeline';

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', uid).single();
      setIsAdmin(!!prof?.is_admin);
    })();
  }, []);

  return (
    <div className="page">
      <div className="spread" style={{ marginBottom: 14 }}>
        <h1>Proposals</h1>
        <button className="btn sm" onClick={() => nav('/proposals/new')}>+ New Proposal</button>
      </div>

      {isAdmin && (
        <div className="es-tabs">
          <a href="/proposals" className={'es-tab' + (tab === 'pipeline' ? ' on' : '')}>Pipeline</a>
          <a href="/proposals#settings" className={'es-tab' + (tab === 'settings' ? ' on' : '')}>Settings</a>
        </div>
      )}

      {tab === 'settings' && isAdmin ? <PricingSettings /> : <Pipeline nav={nav} />}
    </div>
  );
}

/* ---------- Pipeline list ---------- */

function Pipeline({ nav }) {
  const [proposals, setProposals] = useState(null);
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Removes the proposal row (tokens cascade, the signed PDF bytes live in
  // the row itself) plus the client-Documents entries that point at it.
  const doDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const { error } = await supabase.from('proposals').delete().eq('id', deleteTarget.id);
    if (error) { setErr(error.message); setDeleting(false); return; }
    const { error: docErr } = await supabase.from('documents').delete()
      .like('storage_path', `proposal/${deleteTarget.id}/%`);
    if (docErr) setErr('Proposal deleted, but its Documents entry could not be removed: ' + docErr.message);
    setProposals(list => (list || []).filter(x => x.id !== deleteTarget.id));
    setDeleteTarget(null);
    setDeleting(false);
  };

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select('id, proposal_number, project_title, language, currency, status, content_json, created_at, sent_at, signed_at, clients(id, name)')
        .order('created_at', { ascending: false });
      if (error) { setErr(error.message); setProposals([]); return; }
      setProposals(data || []);
    })();
  }, []);

  const counts = useMemo(() => {
    const c = { all: (proposals || []).length };
    Object.keys(PROPOSAL_STATUS).forEach(s => { c[s] = (proposals || []).filter(p => p.status === s).length; });
    return c;
  }, [proposals]);

  if (!proposals) return <div className="center"><div className="sp" /></div>;

  const visible = filter === 'all' ? proposals : proposals.filter(p => p.status === filter);

  return (
    <>
      {err && <div className="auth-err">{err}</div>}

      <div className="doc-filters" style={{ marginBottom: 16, borderBottom: 'none', paddingBottom: 0 }}>
        {[['all', 'All'], ...Object.entries(PROPOSAL_STATUS).map(([k, v]) => [k, v.label])].map(([v, l]) => (
          <button key={v} className={`filter-chip${filter === v ? ' on' : ''}`} onClick={() => setFilter(v)}>
            {l}<span className="filter-count">{counts[v] || 0}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {visible.length === 0 && (
          <div className="empty" style={{ padding: 24 }}>
            {filter === 'all'
              ? 'No proposals yet. Open a prospect in Client Overview and generate the first one.'
              : 'No proposals with this status.'}
          </div>
        )}
        {visible.map(p => {
          const sc = PROPOSAL_STATUS[p.status] || PROPOSAL_STATUS.draft;
          const totals = computeTotals(p.content_json || {});
          const amount = totals.missing ? '[VERIFY]' : fmtMoney(totals.total, p.currency);
          const lastDate = p.signed_at || p.sent_at || p.created_at;
          return (
            <div key={p.id} className="es-row" onClick={() => nav(`/proposals/${p.id}`)}>
              <div className="es-row-main">
                <div className="es-row-name">{proposalNumber(p.proposal_number)} | {p.project_title}</div>
                <div className="es-row-meta">{p.clients?.name || 'Unknown client'}</div>
              </div>
              <span className="chip">{amount}</span>
              <span className="chip">{p.language === 'es' ? 'ES' : 'EN'}</span>
              <span className={`co-pill ${sc.cls}`}>
                <span className="co-dot" style={{ background: sc.dot, marginRight: 6 }} />{sc.label}
              </span>
              <span className="es-row-date">{fmtDate(lastDate)}</span>
              <button
                className="icon-btn"
                title="Delete proposal"
                aria-label={'Delete ' + proposalNumber(p.proposal_number)}
                onClick={e => { e.stopPropagation(); setDeleteTarget(p); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Delete proposal</h3></div>
            <p className="sub" style={{ margin: '10px 0 4px' }}>
              {proposalNumber(deleteTarget.proposal_number)} | {deleteTarget.project_title} for {deleteTarget.clients?.name || 'this client'} will be permanently removed
              {deleteTarget.status === 'signed' ? ', including the signed PDF and its entry in the client Documents tab' : ''}.
              This cannot be undone.
            </p>
            <div className="modal-foot">
              <button className="btn sm gh" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className="btn sm" style={{ background: 'var(--danger)' }} onClick={doDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Pricing settings (admin only) ---------- */
/* Base prices live here and only here. The proposal form pulls from these
   tables; anything without a confirmed price shows [VERIFY] on the form. */

function PricingSettings() {
  const [services, setServices] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [newService, setNewService] = useState({ name: '', description: '' });

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2200); };

  const load = async () => {
    const { data: svcs, error: e1 } = await supabase
      .from('proposal_services').select('*').order('sort_order').order('name');
    if (e1) { setErr(e1.message); setServices([]); return; }
    setServices(svcs || []);
    const { data: prices } = await supabase
      .from('proposal_pricing').select('*').order('tier_label');
    setPricing(prices || []);
  };
  useEffect(() => { load(); }, []);

  const addService = async (e) => {
    e.preventDefault();
    const maxSort = Math.max(0, ...(services || []).map(s => s.sort_order));
    const { error } = await supabase.from('proposal_services').insert({
      name: newService.name.trim(), description: newService.description.trim() || null, sort_order: maxSort + 10
    });
    if (error) { setErr(error.message); return; }
    setNewService({ name: '', description: '' });
    setAdding(false);
    flash('Service added');
    load();
  };

  const updateService = async (id, patch) => {
    const { error } = await supabase.from('proposal_services').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    load();
  };

  const addTier = async (serviceId, tier) => {
    const price = Number(tier.base_price);
    if (!tier.tier_label.trim() || isNaN(price) || price < 0) return;
    const { error } = await supabase.from('proposal_pricing').insert({
      service_id: serviceId, tier_label: tier.tier_label.trim(), base_price: price, currency: tier.currency
    });
    if (error) { setErr(error.message); return; }
    flash('Price added');
    load();
  };

  const updateTier = async (id, patch) => {
    const { error } = await supabase.from('proposal_pricing').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    load();
  };

  if (!services) return <div className="center"><div className="sp" /></div>;

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="sub">Services and their base prices. The proposal form only offers what is active here; missing prices surface as [VERIFY].</div>
        <button className="btn sm" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : '+ New service'}</button>
      </div>

      {adding && (
        <form className="card spine" onSubmit={addService} style={{ marginBottom: 16 }}>
          <div className="grid2">
            <div className="fld"><label className="lab">Service name</label>
              <input className="ti" value={newService.name} onChange={e => setNewService(s => ({ ...s, name: e.target.value }))} required placeholder="Guida deployment" /></div>
            <div className="fld"><label className="lab">Short description</label>
              <input className="ti" value={newService.description} onChange={e => setNewService(s => ({ ...s, description: e.target.value }))} /></div>
          </div>
          <button className="btn sm" disabled={!newService.name.trim()}>Add service</button>
        </form>
      )}

      {services.map(s => (
        <ServiceCard
          key={s.id}
          service={s}
          tiers={pricing.filter(p => p.service_id === s.id)}
          onUpdate={(patch) => updateService(s.id, patch)}
          onAddTier={(tier) => addTier(s.id, tier)}
          onUpdateTier={updateTier}
        />
      ))}
      {services.length === 0 && <div className="card"><div className="empty">No services yet. Run supabase/proposals.sql to seed the defaults.</div></div>}

      {msg && <div className="tst">{msg}</div>}
    </>
  );
}

function ServiceCard({ service, tiers, onUpdate, onAddTier, onUpdateTier }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: service.name, description: service.description || '' });
  const [tierForm, setTierForm] = useState({ tier_label: '', base_price: '', currency: 'EUR' });
  const [addingTier, setAddingTier] = useState(false);

  const saveService = () => {
    onUpdate({ name: form.name.trim(), description: form.description.trim() || null });
    setEditing(false);
  };

  return (
    <div className="card" style={{ marginBottom: 14, opacity: service.is_active ? 1 : 0.55 }}>
      <div className="spread">
        {!editing ? (
          <div>
            <h3 style={{ display: 'inline' }}>{service.name}</h3>
            {!service.is_active && <span className="chip" style={{ marginLeft: 8 }}>Archived</span>}
            <div className="sub">{service.description || 'No description'}</div>
          </div>
        ) : (
          <div style={{ flex: 1, marginRight: 14 }}>
            <div className="grid2">
              <div className="fld"><label className="lab">Name</label>
                <input className="ti" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="fld"><label className="lab">Description</label>
                <input className="ti" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            </div>
            <div className="row">
              <button className="btn sm" onClick={saveService} disabled={!form.name.trim()}>Save</button>
              <button className="btn sm gh" onClick={() => { setForm({ name: service.name, description: service.description || '' }); setEditing(false); }}>Cancel</button>
            </div>
          </div>
        )}
        {!editing && (
          <div className="row">
            <button className="btn sm gh" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn sm gh" onClick={() => onUpdate({ is_active: !service.is_active })}>
              {service.is_active ? 'Archive' : 'Restore'}
            </button>
          </div>
        )}
      </div>

      <div className="mt">
        {tiers.length === 0 && (
          <div className="sub">No confirmed pricing. Proposals including this service show [VERIFY] until a price is set.</div>
        )}
        {tiers.map(t => (
          <TierRow key={t.id} tier={t} onUpdate={(patch) => onUpdateTier(t.id, patch)} />
        ))}
      </div>

      {addingTier ? (
        <div className="row mt" style={{ flexWrap: 'wrap' }}>
          <input className="ti" style={{ width: 150 }} placeholder="Tier label" value={tierForm.tier_label}
            onChange={e => setTierForm(f => ({ ...f, tier_label: e.target.value }))} />
          <input className="ti" style={{ width: 120 }} type="number" min="0" step="0.01" placeholder="Price" value={tierForm.base_price}
            onChange={e => setTierForm(f => ({ ...f, base_price: e.target.value }))} />
          <select className="sel" style={{ width: 90 }} value={tierForm.currency}
            onChange={e => setTierForm(f => ({ ...f, currency: e.target.value }))}>
            <option>EUR</option><option>USD</option>
          </select>
          <button className="btn sm" disabled={!tierForm.tier_label.trim() || tierForm.base_price === ''}
            onClick={() => { onAddTier(tierForm); setTierForm({ tier_label: '', base_price: '', currency: 'EUR' }); setAddingTier(false); }}>Add</button>
          <button className="btn sm gh" onClick={() => setAddingTier(false)}>Cancel</button>
        </div>
      ) : (
        <button className="link-btn mt" onClick={() => setAddingTier(true)}>+ Add price tier</button>
      )}
    </div>
  );
}

function TierRow({ tier, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ tier_label: tier.tier_label, base_price: String(tier.base_price), currency: tier.currency });

  if (!editing) {
    return (
      <div className="item">
        <div>
          <div className="nm">{tier.tier_label}{!tier.is_active && <span className="chip" style={{ marginLeft: 8 }}>Archived</span>}</div>
          <div className="meta">{fmtMoney(tier.base_price, tier.currency)}</div>
        </div>
        <div className="row">
          <button className="btn sm gh" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn sm gh" onClick={() => onUpdate({ is_active: !tier.is_active })}>
            {tier.is_active ? 'Archive' : 'Restore'}
          </button>
        </div>
      </div>
    );
  }

  const price = Number(form.base_price);
  return (
    <div className="row" style={{ padding: '10px 0', flexWrap: 'wrap' }}>
      <input className="ti" style={{ width: 150 }} value={form.tier_label}
        onChange={e => setForm(f => ({ ...f, tier_label: e.target.value }))} />
      <input className="ti" style={{ width: 120 }} type="number" min="0" step="0.01" value={form.base_price}
        onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))} />
      <select className="sel" style={{ width: 90 }} value={form.currency}
        onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
        <option>EUR</option><option>USD</option>
      </select>
      <button className="btn sm" disabled={!form.tier_label.trim() || isNaN(price) || price < 0}
        onClick={() => { onUpdate({ tier_label: form.tier_label.trim(), base_price: price, currency: form.currency }); setEditing(false); }}>Save</button>
      <button className="btn sm gh" onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );
}
