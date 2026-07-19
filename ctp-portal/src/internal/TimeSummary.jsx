import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { staffName } from '../lib/tasks';
import { dateKey, secToHM, secToDec, entryAmount, fmtAmountLines } from '../lib/time';

function monthStart() {
  const d = new Date(); d.setDate(1);
  return dateKey(d);
}

const PIE_COLORS = ['#0052FF', '#00B8E6', '#2ED6A6', '#EF9F27', '#B36AE2', '#F26D6D', '#2196F3', '#8ACB4F', '#E85D9B', '#6b7280'];

function slicePath(cx, cy, r, a0, a1) {
  const pt = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

function PieChart({ title, rows, total }) {
  const sum = rows.reduce((a, r) => a + r.sec, 0);
  return (
    <div className="card">
      <div className="spread">
        <h3>{title}</h3>
        {total != null && <span className="tt-kpi-value" style={{ fontSize: '1.1rem' }}>{secToHM(total)}</span>}
      </div>
      {sum === 0 ? (
        <div className="empty">No time in this range.</div>
      ) : (
        <div className="pie-wrap">
          <svg className="pie-svg" viewBox="0 0 100 100" role="img" aria-label={title}>
            {rows.length === 1 ? (
              <circle cx="50" cy="50" r="46" fill={PIE_COLORS[0]} />
            ) : (() => {
              let a = -Math.PI / 2;
              return rows.map((r, i) => {
                const frac = r.sec / sum;
                const a1 = a + frac * Math.PI * 2;
                const d = slicePath(50, 50, 46, a, a1);
                a = a1;
                return <path key={r.label} d={d} fill={PIE_COLORS[i % PIE_COLORS.length]} />;
              });
            })()}
          </svg>
          <div className="pie-legend">
            {rows.map((r, i) => (
              <div key={r.label} className="pie-legend-row">
                <span className="pie-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                <span className="pie-legend-label" title={r.label}>{r.label}</span>
                <span className="pie-legend-val">{secToHM(r.sec)}</span>
                <span className="pie-legend-pct">{Math.round(r.sec / sum * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const amountByCurrency = entries.reduce((m, e) => {
    if (!e.billable) return m;
    const cur = clientById[e.client_id]?.currency || 'EUR';
    m[cur] = (m[cur] || 0) + entryAmount(e, clientById[e.client_id]);
    return m;
  }, {});

  const group = (keyFn, labelFn) => {
    const m = {};
    for (const e of entries) {
      const k = keyFn(e) || '__none';
      if (!m[k]) m[k] = { label: labelFn(k), sec: 0 };
      m[k].sec += e.duration_seconds;
    }
    return Object.values(m).sort((a, b) => b.sec - a.sec);
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
        <div className="card tt-kpi"><div className="tt-kpi-label">Billable amount</div>
          <div className="tt-kpi-value tt-kpi-stack">{fmtAmountLines(amountByCurrency).map(l => <div key={l}>{l}</div>)}</div></div>
      </div>

      <div className="grid2" style={{ marginTop: 14, alignItems: 'start' }}>
        <PieChart title="Hours by client" rows={byClient} total={totalSec} />
        <PieChart title="Hours by category" rows={byCategory} total={totalSec} />
      </div>

      {showPerson && (
        <div style={{ marginTop: 14 }}>
          <PieChart title="Hours by person" rows={byPerson} total={totalSec} />
        </div>
      )}
    </>
  );
}
