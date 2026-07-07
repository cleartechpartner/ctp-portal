import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { startOfWeek, addDays, weekDays, dateKey, secToHM, secToDec, parseDuration, projectLabel } from '../lib/time';

function resolveRate(project) {
  const r = project?.clients?.hourly_rate;
  return r == null ? null : +r;
}

export default function TimeWeek({ projects }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [entries, setEntries] = useState(null);
  const [extraRows, setExtraRows] = useState([]); // project ids added without entries yet
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [edits, setEdits] = useState({}); // `${projectId}|${dateKey}` -> raw input

  const byId = Object.fromEntries(projects.map(p => [p.id, p]));
  const days = weekDays(weekStart);
  const weekEnd = addDays(weekStart, 7);

  const load = async () => {
    setErr('');
    const { data, error } = await supabase.from('time_entries').select('*')
      .gte('started_at', weekStart.toISOString())
      .lt('started_at', weekEnd.toISOString())
      .order('started_at');
    if (error) { setErr(error.message); return; }
    setEntries(data || []);
  };
  useEffect(() => { setEntries(null); setExtraRows([]); load(); }, [weekStart.getTime()]);

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const cellEntries = (pid, day) => entries.filter(e => e.project_id === pid && dateKey(e.started_at) === dateKey(day));
  const cellSec = (pid, day) => cellEntries(pid, day).reduce((a, e) => a + e.duration_seconds, 0);

  const rowIds = [...new Set([...entries.map(e => e.project_id), ...extraRows])]
    .sort((a, b) => {
      const pa = byId[a], pb = byId[b];
      return `${pa?.clients?.name} ${projectLabel(pa)}`.localeCompare(`${pb?.clients?.name} ${projectLabel(pb)}`);
    });

  const rowSec = (pid) => days.reduce((a, d) => a + cellSec(pid, d), 0);
  const daySec = (day) => entries.filter(e => dateKey(e.started_at) === dateKey(day)).reduce((a, e) => a + e.duration_seconds, 0);
  const grand = entries.reduce((a, e) => a + e.duration_seconds, 0);

  const commitCell = async (pid, day) => {
    const key = `${pid}|${dateKey(day)}`;
    const raw = edits[key];
    if (raw == null) return;
    setEdits(ed => { const n = { ...ed }; delete n[key]; return n; });

    const target = raw.trim() === '' ? 0 : parseDuration(raw);
    if (target == null) return;
    const existing = cellEntries(pid, day);
    const current = existing.reduce((a, e) => a + e.duration_seconds, 0);
    if (target === current) return;

    setErr('');
    try {
      if (existing.length === 0) {
        if (target <= 0) return;
        const at = new Date(day); at.setHours(9, 0, 0, 0);
        const { error } = await supabase.from('time_entries').insert({
          project_id: pid,
          started_at: at.toISOString(),
          duration_seconds: target,
          billable: true,
          rate: resolveRate(byId[pid])
        });
        if (error) throw new Error(error.message);
      } else if (target === 0) {
        // Explicit zero clears the day for this row.
        const { error } = await supabase.from('time_entries').delete()
          .in('id', existing.map(e => e.id));
        if (error) throw new Error(error.message);
      } else {
        // Apply the difference to the latest entry so notes and the other
        // entries stay intact.
        const last = existing[existing.length - 1];
        const newDur = Math.max(0, last.duration_seconds + (target - current));
        const { error } = await supabase.from('time_entries').update({ duration_seconds: newDur }).eq('id', last.id);
        if (error) throw new Error(error.message);
      }
      await load();
    } catch (ex) { setErr(ex.message); }
  };

  const copyLastWeek = async () => {
    setErr('');
    const prevStart = addDays(weekStart, -7);
    const { data, error } = await supabase.from('time_entries').select('project_id')
      .gte('started_at', prevStart.toISOString())
      .lt('started_at', weekStart.toISOString());
    if (error) { setErr(error.message); return; }
    const ids = [...new Set((data || []).map(e => e.project_id))].filter(id => byId[id]);
    if (!ids.length) { setErr('Nothing tracked last week to copy.'); return; }
    setExtraRows(rs => [...new Set([...rs, ...ids])]);
  };

  const weekLabel = `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const availableToAdd = projects.filter(p => p.status !== 'complete' && !rowIds.includes(p.id));

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="tt-week-nav">
        <button className="btn sm gh" onClick={() => setWeekStart(addDays(weekStart, -7))}>&lt;</button>
        <button className="btn sm gh" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</button>
        <button className="btn sm gh" onClick={() => setWeekStart(addDays(weekStart, 7))}>&gt;</button>
        <span className="tt-week-label">{weekLabel}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm gh" onClick={copyLastWeek}>Copy last week's rows</button>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tt-grid">
          <thead>
            <tr>
              <th className="tt-grid-row-head">Client | work type</th>
              {days.map(d => (
                <th key={dateKey(d)} className={dateKey(d) === dateKey(new Date()) ? 'today' : ''}>
                  {d.toLocaleDateString('en-GB', { weekday: 'short' })}<br />
                  <span className="tt-grid-date">{d.getDate()}</span>
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rowIds.length === 0 && (
              <tr><td colSpan={9} className="empty">No rows this week. Add a row or copy last week.</td></tr>
            )}
            {rowIds.map(pid => {
              const p = byId[pid];
              return (
                <tr key={pid}>
                  <td className="tt-grid-row-head">
                    <div className="nm">{p?.clients?.name}</div>
                    <div className="meta">{projectLabel(p)}</div>
                  </td>
                  {days.map(d => {
                    const key = `${pid}|${dateKey(d)}`;
                    const sec = cellSec(pid, d);
                    return (
                      <td key={key} className={dateKey(d) === dateKey(new Date()) ? 'today' : ''}>
                        <input
                          className="tt-cell"
                          value={edits[key] != null ? edits[key] : (sec ? String(secToDec(sec)) : '')}
                          placeholder="0"
                          onChange={(e) => setEdits(ed => ({ ...ed, [key]: e.target.value }))}
                          onBlur={() => commitCell(pid, d)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        />
                      </td>
                    );
                  })}
                  <td className="tt-grid-total">{secToHM(rowSec(pid))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="tt-grid-row-head">Daily total</td>
              {days.map(d => <td key={dateKey(d)} className="tt-grid-total">{daySec(d) ? secToHM(daySec(d)) : ''}</td>)}
              <td className="tt-grid-total">{secToHM(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        {!adding && availableToAdd.length > 0 && (
          <button className="link-btn" onClick={() => setAdding(true)}>+ Add row</button>
        )}
        {adding && (
          <select
            className="sel" style={{ maxWidth: 420 }} autoFocus defaultValue=""
            onChange={(e) => { if (e.target.value) setExtraRows(rs => [...rs, e.target.value]); setAdding(false); }}
            onBlur={() => setAdding(false)}
          >
            <option value="">Pick a client | work type…</option>
            {availableToAdd.map(p => (
              <option key={p.id} value={p.id}>{p.clients?.name} | {projectLabel(p)}</option>
            ))}
          </select>
        )}
        <div className="sub" style={{ marginTop: 6 }}>Cells are hours (1.5 or 1:30). Editing a day with several entries adjusts the latest one; clearing a cell deletes the day's entries for that row.</div>
      </div>
    </>
  );
}
