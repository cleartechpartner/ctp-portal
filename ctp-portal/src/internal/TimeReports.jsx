import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { dateKey, secToHM, secToDec, entriesAmount, fmtMoney } from '../lib/time';

function monthStart() {
  const d = new Date(); d.setDate(1);
  return dateKey(d);
}

function BarBlock({ title, rows }) {
  // rows: [{ label, billableSec, nonBillableSec }]
  const max = Math.max(1, ...rows.map(r => r.billableSec + r.nonBillableSec));
  return (
    <div className="card">
      <h3>{title}</h3>
      {rows.length === 0 && <div className="empty">No time in this range.</div>}
      <div className="tt-bars">
        {rows.map(r => {
          const total = r.billableSec + r.nonBillableSec;
          return (
            <div key={r.label} className="tt-bar-row">
              <div className="tt-bar-label" title={r.label}>{r.label}</div>
              <div className="tt-bar-track">
                <div className="tt-bar-fill bill" style={{ width: (r.billableSec / max * 100) + '%' }} />
                <div className="tt-bar-fill nonbill" style={{ width: (r.nonBillableSec / max * 100) + '%' }} />
              </div>
              <div className="tt-bar-value">{secToHM(total)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TimeReports({ projects, clients }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(dateKey(new Date()));
  const [clientId, setClientId] = useState('');
  const [workType, setWorkType] = useState('');
  const [billable, setBillable] = useState('all');
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState('');

  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
  const types = [...new Set(projects.map(p => p.type).filter(Boolean))].sort();

  const load = async () => {
    setErr('');
    const fromD = new Date(from + 'T00:00:00');
    const toD = new Date(to + 'T00:00:00'); toD.setDate(toD.getDate() + 1);
    const { data, error } = await supabase.from('time_entries').select('*')
      .gte('started_at', fromD.toISOString())
      .lt('started_at', toD.toISOString());
    if (error) { setErr(error.message); return; }
    setEntries(data || []);
  };
  useEffect(() => { load(); }, [from, to]);

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const filtered = entries.filter(e => {
    const p = byId[e.project_id];
    if (!p) return false;
    if (clientId && p.client_id !== clientId) return false;
    if (workType && p.type !== workType) return false;
    if (billable === 'billable' && !e.billable) return false;
    if (billable === 'nonbillable' && e.billable) return false;
    return true;
  });

  const totalSec = filtered.reduce((a, e) => a + e.duration_seconds, 0);
  const billSec = filtered.filter(e => e.billable).reduce((a, e) => a + e.duration_seconds, 0);
  const nonBillSec = totalSec - billSec;
  const amount = filtered.reduce((a, e) => {
    if (!e.billable) return a;
    const p = byId[e.project_id];
    return a + entriesAmount([e], clientById[p?.client_id]);
  }, 0);

  const group = (keyFn, labelFn) => {
    const m = {};
    for (const e of filtered) {
      const k = keyFn(e);
      if (!k) continue;
      if (!m[k]) m[k] = { label: labelFn(k), billableSec: 0, nonBillableSec: 0 };
      m[k][e.billable ? 'billableSec' : 'nonBillableSec'] += e.duration_seconds;
    }
    return Object.values(m).sort((a, b) => (b.billableSec + b.nonBillableSec) - (a.billableSec + a.nonBillableSec));
  };

  const byClient = group(
    e => byId[e.project_id]?.client_id,
    k => clientById[k]?.name || 'Unknown client'
  );
  const byType = group(
    e => byId[e.project_id]?.type || 'Untyped',
    k => k
  );

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="card">
        <div className="tt-filters">
          <div className="fld"><label className="lab">From</label>
            <input className="ti" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="fld"><label className="lab">To</label>
            <input className="ti" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="fld"><label className="lab">Client</label>
            <select className="sel" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="fld"><label className="lab">Work type</label>
            <select className="sel" value={workType} onChange={e => setWorkType(e.target.value)}>
              <option value="">All types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div className="fld"><label className="lab">Billable</label>
            <select className="sel" value={billable} onChange={e => setBillable(e.target.value)}>
              <option value="all">All</option>
              <option value="billable">Billable only</option>
              <option value="nonbillable">Non-billable only</option>
            </select></div>
        </div>
      </div>

      <div className="tt-kpis">
        <div className="card tt-kpi"><div className="tt-kpi-label">Total</div><div className="tt-kpi-value">{secToHM(totalSec)}</div><div className="meta">{secToDec(totalSec)} h</div></div>
        <div className="card tt-kpi"><div className="tt-kpi-label">Billable</div><div className="tt-kpi-value">{secToHM(billSec)}</div><div className="meta">{totalSec ? Math.round(billSec / totalSec * 100) : 0}%</div></div>
        <div className="card tt-kpi"><div className="tt-kpi-label">Non-billable</div><div className="tt-kpi-value">{secToHM(nonBillSec)}</div><div className="meta">{totalSec ? Math.round(nonBillSec / totalSec * 100) : 0}%</div></div>
        <div className="card tt-kpi"><div className="tt-kpi-label">Billable amount</div><div className="tt-kpi-value">{fmtMoney(amount)}</div><div className="meta">frozen entry rates</div></div>
      </div>

      <div className="grid2" style={{ marginTop: 14, alignItems: 'start' }}>
        <BarBlock title="Time by client" rows={byClient} />
        <BarBlock title="Time by work type" rows={byType} />
      </div>
      <div className="sub" style={{ marginTop: 10 }}>
        <span className="tt-legend bill" /> billable&nbsp;&nbsp;<span className="tt-legend nonbill" /> non-billable
      </div>
    </>
  );
}
