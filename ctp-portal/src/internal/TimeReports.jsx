import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { staffName } from '../lib/tasks';
import {
  dateKey, secToHM, secToDec, entryAmount, fmtMoney,
  buildCsv, downloadCsv, safeFileName
} from '../lib/time';

function monthStart() {
  const d = new Date(); d.setDate(1);
  return dateKey(d);
}

export default function TimeReports({ clients, categories, staff, tasks }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(dateKey(new Date()));
  const [clientId, setClientId] = useState('');
  const [personId, setPersonId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [billable, setBillable] = useState('all');
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState('');

  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const staffById = Object.fromEntries(staff.map(s => [s.id, s]));
  const showPerson = staff.length > 1;

  const load = async () => {
    setErr('');
    const fromD = new Date(from + 'T00:00:00');
    const toD = new Date(to + 'T00:00:00'); toD.setDate(toD.getDate() + 1);
    const { data, error } = await supabase.from('time_entries').select('*')
      .gte('started_at', fromD.toISOString())
      .lt('started_at', toD.toISOString())
      .order('started_at', { ascending: true });
    if (error) { setErr(error.message); return; }
    setEntries(data || []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const filtered = entries.filter(e => {
    if (clientId && e.client_id !== clientId) return false;
    if (categoryId && e.category_id !== categoryId) return false;
    if (personId && e.person_id !== personId) return false;
    if (billable === 'billable' && !e.billable) return false;
    if (billable === 'nonbillable' && e.billable) return false;
    return true;
  });

  const totalSec = filtered.reduce((a, e) => a + e.duration_seconds, 0);
  const amount = filtered.reduce((a, e) => a + (e.billable ? entryAmount(e, clientById[e.client_id]) : 0), 0);

  const catName = (e) => e.category_id ? (catById[e.category_id]?.name || '—') : '—';
  const clientName = (e) => clientById[e.client_id]?.name || '—';
  const taskTitle = (e) => e.task_id ? (taskById[e.task_id]?.title || '—') : '';

  const clientLabel = clientId ? (clientById[clientId]?.name || 'client') : 'all-clients';
  const rangeLabel = `${from}_to_${to}`;

  const exportCsv = () => {
    const head = ['Date', 'Client', 'Category', ...(showPerson ? ['Person'] : []), 'Task', 'Note', 'Billable', 'Hours', 'Amount (EUR)'];
    const rows = [head];
    for (const e of filtered) {
      const amt = e.billable ? Math.round(entryAmount(e, clientById[e.client_id]) * 100) / 100 : '';
      rows.push([
        dateKey(e.started_at), clientName(e), catName(e),
        ...(showPerson ? [staffName(staffById[e.person_id])] : []),
        taskTitle(e), e.notes || '', e.billable ? 'yes' : 'no',
        secToDec(e.duration_seconds), amt
      ]);
    }
    rows.push([]);
    rows.push(['Total hours', secToDec(totalSec)]);
    rows.push(['Billable amount (EUR)', Math.round(amount * 100) / 100]);
    downloadCsv(buildCsv(rows), `${safeFileName(clientLabel)}_${rangeLabel}_time.csv`);
  };

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="card no-print">
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
          <div className="fld"><label className="lab">Category</label>
            <select className="sel" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          {showPerson && (
            <div className="fld"><label className="lab">Person</label>
              <select className="sel" value={personId} onChange={e => setPersonId(e.target.value)}>
                <option value="">Everyone</option>
                {staff.map(s => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
              </select></div>
          )}
          <div className="fld"><label className="lab">Billable</label>
            <select className="sel" value={billable} onChange={e => setBillable(e.target.value)}>
              <option value="all">All</option>
              <option value="billable">Billable only</option>
              <option value="nonbillable">Non-billable only</option>
            </select></div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button className="btn sm" onClick={() => window.print()}>Print / Save as PDF</button>
          <button className="btn sm gh" onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>
        </div>
      </div>

      {/* Printable area */}
      <div className="print-area">
        <div className="print-head">
          <h2>Time report</h2>
          <div className="print-meta">
            {from} to {to}
            {clientId ? ` · ${clientById[clientId]?.name}` : ' · all clients'}
            {personId && showPerson ? ` · ${staffName(staffById[personId])}` : ''}
          </div>
        </div>

        <div className="tt-kpis no-print" style={{ marginBottom: 16 }}>
          <div className="card tt-kpi"><div className="tt-kpi-label">Entries</div><div className="tt-kpi-value">{filtered.length}</div></div>
          <div className="card tt-kpi"><div className="tt-kpi-label">Total</div><div className="tt-kpi-value">{secToHM(totalSec)}</div><div className="meta">{secToDec(totalSec)} h</div></div>
          <div className="card tt-kpi"><div className="tt-kpi-label">Billable amount</div><div className="tt-kpi-value">{fmtMoney(amount)}</div></div>
        </div>

        <div className="card report-card" style={{ padding: 0 }}>
          <table className="report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Category</th>
                {showPerson && <th>Person</th>}
                <th>Task</th>
                <th>Note</th>
                <th className="num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={showPerson ? 7 : 6} className="empty">No entries match these filters.</td></tr>
              )}
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="nowrap">{dateKey(e.started_at)}</td>
                  <td>{clientName(e)}</td>
                  <td>{catName(e)}{!e.billable && <span className="report-nb"> · non-billable</span>}</td>
                  {showPerson && <td>{staffName(staffById[e.person_id])}</td>}
                  <td>{taskTitle(e) || <span className="dim">—</span>}</td>
                  <td>{e.notes || <span className="dim">—</span>}</td>
                  <td className="num">{secToHM(e.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={showPerson ? 6 : 5} className="num strong">Total</td>
                <td className="num strong">{secToHM(totalSec)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
