import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
  monthKey, monthRange, dateKey, secToHM, secToDec, capState, fmtMoney,
  buildCsv, downloadCsv, safeFileName
} from '../lib/time';

function CapBar({ state, unitLabel }) {
  if (!state) return null;
  const pct = Math.min(100, Math.round(state.ratio * 100));
  return (
    <div className="tt-capbar-wrap">
      <div className="tt-capbar">
        <div className={'tt-capbar-fill ' + state.level} style={{ width: pct + '%' }} />
      </div>
      <div className={'tt-capbar-text ' + state.level}>
        {unitLabel(state.used)} of {unitLabel(state.cap)} ({Math.round(state.ratio * 100)}%)
        {state.level === 'over' ? ' | over cap' : state.level === 'near' ? ' | approaching cap' : ''}
      </div>
    </div>
  );
}

// Inline editor for the standalone time categories (add, rename, archive).
function CategoryManager({ categories, onChanged }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true); setErr('');
    const pos = categories.reduce((m, c) => Math.max(m, c.position || 0), 0) + 1;
    const { error } = await supabase.from('time_categories').insert({ name: n, position: pos });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setName(''); onChanged && onChanged();
  };

  const rename = async (c, next) => {
    if (next.trim() === c.name || !next.trim()) return;
    const { error } = await supabase.from('time_categories').update({ name: next.trim() }).eq('id', c.id);
    if (error) { setErr(error.message); return; }
    onChanged && onChanged();
  };

  const toggleArchive = async (c) => {
    const { error } = await supabase.from('time_categories').update({ archived: !c.archived }).eq('id', c.id);
    if (error) { setErr(error.message); return; }
    onChanged && onChanged();
  };

  return (
    <div className="card">
      <h3>Time categories</h3>
      <div className="sub" style={{ marginBottom: 12 }}>The list of categories offered when logging time. Independent of Task Manager tasks.</div>
      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="cat-list">
        {categories.map(c => (
          <div key={c.id} className={'cat-row' + (c.archived ? ' archived' : '')}>
            <input className="ti" defaultValue={c.name}
              onBlur={e => rename(c, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
            <button className="btn sm gh" onClick={() => toggleArchive(c)}>{c.archived ? 'Restore' : 'Archive'}</button>
          </div>
        ))}
      </div>
      <div className="ts-addrow" style={{ marginTop: 12 }}>
        <input className="ti" placeholder="New category name" value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        <button className="btn sm" disabled={busy || !name.trim()} onClick={add}>Add category</button>
      </div>
    </div>
  );
}

export default function TimeClients({ projects, clients, categories = [], onChanged, onCategoriesChanged }) {
  const [month, setMonth] = useState(monthKey(new Date()));
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [capEdits, setCapEdits] = useState({});   // clientId -> {time_cap_type, time_cap_value, hourly_rate, currency}

  const load = async () => {
    setErr('');
    const { from, to } = monthRange(month);
    const { data, error } = await supabase.from('time_entries').select('*')
      .gte('started_at', from.toISOString())
      .lt('started_at', to.toISOString());
    if (error) { setErr(error.message); return; }
    setEntries(data || []);
  };
  useEffect(() => { setEntries(null); load(); }, [month]);

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  // New entries carry client_id directly; legacy ones resolve it via project.
  const clientEntries = (cid) => entries.filter(e => (e.client_id || byId[e.project_id]?.client_id) === cid);

  const hoursLabel = (v) => `${Math.round(v * 100) / 100} h`;

  const saveClientCaps = async (c) => {
    const e = capEdits[c.id] || {};
    setErr(''); setOk('');
    const patch = {
      time_cap_type: (e.time_cap_type !== undefined ? e.time_cap_type : c.time_cap_type) || null,
      time_cap_value: e.time_cap_value !== undefined ? (e.time_cap_value === '' ? null : +e.time_cap_value) : c.time_cap_value,
      hourly_rate: e.hourly_rate !== undefined ? (e.hourly_rate === '' ? null : +e.hourly_rate) : c.hourly_rate,
      currency: e.currency !== undefined ? e.currency : (c.currency || 'EUR')
    };
    if (patch.time_cap_type === '') patch.time_cap_type = null;
    const { error } = await supabase.from('clients').update(patch).eq('id', c.id);
    if (error) { setErr(error.message); return; }
    setCapEdits(ed => { const n = { ...ed }; delete n[c.id]; return n; });
    setOk(`Settings saved for ${c.name}.`);
    onChanged && onChanged();
  };

  const exportMonth = (c) => {
    const es = clientEntries(c.id).sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    const rows = [
      ['Client', c.name],
      ['Month', month],
      ['Exported', new Date().toISOString()],
      [],
      ['Date', 'Category', 'Notes', 'Billable', 'Hours', `Rate (${c.currency || 'EUR'})`, `Amount (${c.currency || 'EUR'})`]
    ];
    const catById = Object.fromEntries((categories || []).map(x => [x.id, x]));
    let totalSec = 0;
    let totalAmount = 0;
    for (const e of es) {
      const p = byId[e.project_id];
      const cat = e.category_id ? (catById[e.category_id]?.name || '') : (p ? `${p.type} | ${p.title}` : '');
      const rate = e.rate != null ? +e.rate : (c.hourly_rate != null ? +c.hourly_rate : '');
      const amount = e.billable && rate !== '' ? Math.round((e.duration_seconds / 3600) * rate * 100) / 100 : '';
      totalSec += e.duration_seconds;
      if (amount !== '') totalAmount += amount;
      rows.push([
        dateKey(e.started_at), cat, e.notes || '',
        e.billable ? 'yes' : 'no', secToDec(e.duration_seconds),
        rate === '' ? '' : rate, amount
      ]);
    }
    rows.push([]);
    rows.push(['Total hours', secToDec(totalSec)]);
    rows.push([`Total billable amount (${c.currency || 'EUR'})`, Math.round(totalAmount * 100) / 100]);
    downloadCsv(buildCsv(rows), `${safeFileName(c.name)}_${month}_time.csv`);
  };

  const CE = (cid, k, cur) => (capEdits[cid]?.[k] !== undefined ? capEdits[cid][k] : (cur == null ? '' : cur));

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div className="auth-ok" style={{ marginBottom: 14 }}>{ok}</div>}

      <div className="tt-week-nav">
        <label className="lab" style={{ margin: 0 }}>Month</label>
        <input className="ti" type="month" style={{ maxWidth: 180 }} value={month} onChange={e => setMonth(e.target.value)} />
        <span className="sub">Caps are measured per calendar month. They warn, they never block.</span>
      </div>

      <CategoryManager categories={categories} onChanged={onCategoriesChanged} />

      {clients.filter(c => c.status !== 'archived').map(c => {
        const ces = clientEntries(c.id);
        const capType = CE(c.id, 'time_cap_type', c.time_cap_type);
        const currency = CE(c.id, 'currency', c.currency) || 'EUR';
        const moneyLabel = (v) => fmtMoney(v, c.currency || 'EUR');
        const state = capState(ces, c, c.time_cap_type, c.time_cap_value);
        const totalSec = ces.reduce((a, e) => a + e.duration_seconds, 0);
        return (
          <div key={c.id} className="card" style={{ marginTop: 14 }}>
            <div className="spread">
              <div>
                <h3>{c.name}</h3>
                <div className="sub">{secToHM(totalSec)} tracked in {month}</div>
              </div>
              <button className="btn sm" onClick={() => exportMonth(c)} disabled={ces.length === 0}>
                Export this month (CSV)
              </button>
            </div>

            <CapBar state={state} unitLabel={c.time_cap_type === 'budget' ? moneyLabel : hoursLabel} />

            <div className="tt-caps-row">
              <div className="fld">
                <label className="lab">Cap type</label>
                <select className="sel" value={capType || ''} onChange={e => setCapEdits(ed => ({ ...ed, [c.id]: { ...ed[c.id], time_cap_type: e.target.value } }))}>
                  <option value="">No cap</option>
                  <option value="hours">Hours per month</option>
                  <option value="budget">Budget per month</option>
                </select>
              </div>
              <div className="fld">
                <label className="lab">{capType === 'budget' ? `Monthly budget (${currency})` : 'Max hours'}</label>
                <input className="ti" type="number" min="0" step="0.5" value={CE(c.id, 'time_cap_value', c.time_cap_value)}
                  onChange={e => setCapEdits(ed => ({ ...ed, [c.id]: { ...ed[c.id], time_cap_value: e.target.value } }))} />
              </div>
              <div className="fld">
                <label className="lab">Hourly rate</label>
                <input className="ti" type="number" min="0" step="1" value={CE(c.id, 'hourly_rate', c.hourly_rate)}
                  onChange={e => setCapEdits(ed => ({ ...ed, [c.id]: { ...ed[c.id], hourly_rate: e.target.value } }))} />
              </div>
              <div className="fld">
                <label className="lab">Currency</label>
                <select className="sel" value={currency} onChange={e => setCapEdits(ed => ({ ...ed, [c.id]: { ...ed[c.id], currency: e.target.value } }))}>
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
              <button className="btn sm" style={{ alignSelf: 'end', marginBottom: 18 }} onClick={() => saveClientCaps(c)}
                disabled={!capEdits[c.id]}>Save</button>
            </div>
          </div>
        );
      })}
    </>
  );
}
