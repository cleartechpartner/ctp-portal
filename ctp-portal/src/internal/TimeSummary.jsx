import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { staffName } from '../lib/tasks';
import { dateKey, secToHM, secToDec, entryAmount, fmtMoney } from '../lib/time';

function monthStart() {
  const d = new Date(); d.setDate(1);
  return dateKey(d);
}

function BarBlock({ title, rows, total }) {
  const max = Math.max(1, ...rows.map(r => r.billSec + r.nonBillSec));
  return (
    <div className="card">
      <div className="spread">
        <h3>{title}</h3>
        {total != null && <span className="tt-kpi-value" style={{ fontSize: '1.1rem' }}>{secToHM(total)}</span>}
      </div>
      {rows.length === 0 && <div className="empty">No time in this range.</div>}
      <div className="tt-bars">
        {rows.map(r => {
          const sec = r.billSec + r.nonBillSec;
          return (
            <div key={r.label} className="tt-bar-row">
              <div className="tt-bar-label" title={r.label}>{r.label}</div>
              <div className="tt-bar-track">
                <div className="tt-bar-fill bill" style={{ width: (r.billSec / max * 100) + '%' }} />
                <div className="tt-bar-fill nonbill" style={{ width: (r.nonBillSec / max * 100) + '%' }} />
              </div>
              <div className="tt-bar-value">{secToHM(sec)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TimeSummary({ clients, categories, staff }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(dateKey(new Date()));
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState('');

  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const staffById = Object.fromEntries(staff.map(s => [s.id, s]));
  const showPerson = staff.length > 1;

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
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const totalSec = entries.reduce((a, e) => a + e.duration_seconds, 0);
  const amount = entries.reduce((a, e) => a + (e.billable ? entryAmount(e, clientById[e.client_id]) : 0), 0);

  const group = (keyFn, labelFn) => {
    const m = {};
    for (const e of entries) {
      const k = keyFn(e) || '__none';
      if (!m[k]) m[k] = { label: labelFn(k), billSec: 0, nonBillSec: 0 };
      m[k][e.billable ? 'billSec' : 'nonBillSec'] += e.duration_seconds;
    }
    return Object.values(m).sort((a, b) => (b.billSec + b.nonBillSec) - (a.billSec + a.nonBillSec));
  };

  const byClient = group(e => e.client_id, k => k === '__none' ? 'No client' : (clientById[k]?.name || 'Unknown client'));
  const byCategory = group(e => e.category_id, k => k === '__none' ? 'Uncategorised' : (catById[k]?.name || 'Unknown'));
  const byPerson = group(e => e.person_id, k => k === '__none' ? 'Unknown' : staffName(staffById[k]));

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="card">
        <div className="tt-filters" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <div className="fld" style={{ marginBottom: 0 }}><label className="lab">From</label>
            <input className="ti" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="fld" style={{ marginBottom: 0 }}><label className="lab">To</label>
            <input className="ti" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
      </div>

      <div className="tt-kpis">
        <div className="card tt-kpi"><div className="tt-kpi-label">Total tracked</div><div className="tt-kpi-value">{secToHM(totalSec)}</div><div className="meta">{secToDec(totalSec)} h</div></div>
        <div className="card tt-kpi"><div className="tt-kpi-label">Clients</div><div className="tt-kpi-value">{byClient.length}</div></div>
        <div className="card tt-kpi"><div className="tt-kpi-label">Billable amount</div><div className="tt-kpi-value">{fmtMoney(amount)}</div></div>
      </div>

      <div style={{ marginTop: 14 }}>
        <BarBlock title="Hours by client" rows={byClient} total={totalSec} />
      </div>
      <div className="grid2" style={{ marginTop: 14, alignItems: 'start' }}>
        <BarBlock title="Hours by category" rows={byCategory} />
        {showPerson
          ? <BarBlock title="Hours by person" rows={byPerson} />
          : <div className="card"><h3>Hours by person</h3><div className="empty">A per-person breakdown appears here once there's more than one staff member.</div></div>}
      </div>
      <div className="sub" style={{ marginTop: 10 }}>
        <span className="tt-legend bill" /> billable&nbsp;&nbsp;<span className="tt-legend nonbill" /> non-billable
      </div>
    </>
  );
}
