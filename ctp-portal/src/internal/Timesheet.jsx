import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  startOfWeek, addDays, weekDays, dateKey, secToHM, secToHMS, secToDec,
  parseDuration
} from '../lib/time';
import { quoteForDate } from '../lib/quotes';

function rateOf(client) {
  return client?.hourly_rate == null ? null : +client.hourly_rate;
}

// ---- lightweight "new time entry" modal: timer OR manual ----
function NewEntryModal({ clients, categories, tasks, anchor, timerRunning, onStart, onManual, onClose }) {
  const [tab, setTab] = useState(timerRunning ? 'manual' : 'timer');
  const [form, setForm] = useState({
    client_id: '', category_id: '', task_id: '', notes: '',
    duration: '', date: dateKey(anchor), billable: true
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const clientTasks = tasks.filter(t => t.status !== 'done' && (!form.client_id || t.client_id === form.client_id));

  const submit = async () => {
    setErr('');
    if (!form.client_id) { setErr('Pick a client.'); return; }
    if (!form.category_id) { setErr('Pick a category.'); return; }
    setBusy(true);
    try {
      if (tab === 'timer') {
        await onStart(form);
      } else {
        const dur = parseDuration(form.duration);
        if (!dur) { setErr('Enter a duration like 1:30 or 1.5.'); setBusy(false); return; }
        await onManual({ ...form, duration_seconds: dur });
      }
      onClose();
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New time entry</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="seg" style={{ marginBottom: 16 }}>
          <button className={'seg-btn' + (tab === 'timer' ? ' on' : '')} disabled={timerRunning}
            onClick={() => setTab('timer')}>Timer</button>
          <button className={'seg-btn' + (tab === 'manual' ? ' on' : '')} onClick={() => setTab('manual')}>Manual</button>
        </div>

        {timerRunning && tab === 'timer' && (
          <div className="sub" style={{ marginBottom: 12 }}>A timer is already running. Stop it first, or log time manually.</div>
        )}

        <div className="ne-grid">
          <div className="fld">
            <label className="lab">Client</label>
            <select className="sel" value={form.client_id} onChange={set('client_id')}>
              <option value="">Choose a client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="fld">
            <label className="lab">Category</label>
            <select className="sel" value={form.category_id} onChange={set('category_id')}>
              <option value="">Choose a category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {tab === 'manual' && (
          <div className="ne-grid">
            <div className="fld">
              <label className="lab">Date</label>
              <input className="ti" type="date" value={form.date} onChange={set('date')} />
            </div>
            <div className="fld">
              <label className="lab">Hours</label>
              <input className="ti" placeholder="1:30 or 1.5" value={form.duration} onChange={set('duration')} />
            </div>
          </div>
        )}

        <div className="fld">
          <label className="lab">Note <span className="opt">(optional)</span></label>
          <input className="ti" placeholder="What was this time for?" value={form.notes} onChange={set('notes')} />
        </div>

        <div className="fld">
          <label className="lab">Link to a task <span className="opt">(optional)</span></label>
          <select className="sel" value={form.task_id} onChange={set('task_id')}>
            <option value="">Not linked to a task</option>
            {clientTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>

        <label className="tt-check" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={form.billable} onChange={set('billable')} /> Billable
        </label>

        {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}

        <div className="modal-foot">
          <button className="btn gh" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || (tab === 'timer' && timerRunning)} onClick={submit}>
            {busy ? '…' : tab === 'timer' ? 'Start timer' : 'Log time'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Timesheet({ clients, categories, tasks }) {
  const [mode, setMode] = useState('day');
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [entries, setEntries] = useState(null);
  const [timer, setTimer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [modal, setModal] = useState(false);
  const [edits, setEdits] = useState({});
  const [gridEdits, setGridEdits] = useState({});
  const [extraRows, setExtraRows] = useState([]);
  const [addRow, setAddRow] = useState(null); // {client_id, category_id} draft
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tick = useRef(null);

  const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));

  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 7);
  const days = weekDays(weekStart);

  const load = async () => {
    setErr('');
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    const [{ data: es, error: e1 }, { data: tm, error: e2 }] = await Promise.all([
      supabase.from('time_entries').select('*')
        .gte('started_at', weekStart.toISOString())
        .lt('started_at', weekEnd.toISOString())
        .order('started_at', { ascending: false }),
      supabase.from('time_timers').select('*').eq('person_id', uid).maybeSingle()
    ]);
    if (e1 || e2) { setErr((e1 || e2).message); setEntries(es || []); return; }
    setEntries(es || []);
    setTimer(tm || null);
  };
  useEffect(() => { setEntries(null); load(); /* eslint-disable-next-line */ }, [weekStart.getTime()]);

  useEffect(() => {
    if (timer) {
      const upd = () => setElapsed(Math.floor((Date.now() - new Date(timer.running_since).getTime()) / 1000));
      upd();
      tick.current = setInterval(upd, 1000);
      return () => clearInterval(tick.current);
    }
    setElapsed(0);
  }, [timer?.id, timer?.running_since]);

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const dayEntries = (d) => entries.filter(e => dateKey(e.started_at) === dateKey(d));
  const daySec = (d) => dayEntries(d).reduce((a, e) => a + e.duration_seconds, 0);
  const weekSec = entries.reduce((a, e) => a + e.duration_seconds, 0);

  // ---- entry mutations ----
  const startTimer = async (f) => {
    const { error } = await supabase.from('time_timers').insert({
      client_id: f.client_id, category_id: f.category_id,
      task_id: f.task_id || null, notes: f.notes.trim() || null, billable: f.billable
    });
    if (error) throw new Error(error.message);
    await load();
  };

  const addManual = async (f) => {
    const at = new Date(f.date + 'T09:00:00');
    const { error } = await supabase.from('time_entries').insert({
      client_id: f.client_id, category_id: f.category_id, task_id: f.task_id || null,
      started_at: at.toISOString(), duration_seconds: f.duration_seconds,
      notes: f.notes.trim() || null, billable: f.billable, rate: rateOf(clientById[f.client_id])
    });
    if (error) throw new Error(error.message);
    await load();
  };

  const stopTimer = async () => {
    if (!timer) return;
    setBusy(true); setErr('');
    try {
      const startedAt = new Date(timer.running_since);
      const now = new Date();
      const dur = Math.max(1, Math.floor((now - startedAt) / 1000));
      const { error: insErr } = await supabase.from('time_entries').insert({
        client_id: timer.client_id, category_id: timer.category_id, task_id: timer.task_id || null,
        started_at: startedAt.toISOString(), ended_at: now.toISOString(), duration_seconds: dur,
        notes: (timer.notes || '').trim() || null, billable: timer.billable,
        rate: rateOf(clientById[timer.client_id])
      });
      if (insErr) throw new Error(insErr.message);
      const { error: delErr } = await supabase.from('time_timers').delete().eq('id', timer.id);
      if (delErr) throw new Error(delErr.message);
      setTimer(null);
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const updateEntry = async (id, patch) => {
    const { error } = await supabase.from('time_entries').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    setEntries(es => es.map(x => x.id === id ? { ...x, ...patch } : x));
  };

  const deleteEntry = async (id) => {
    const prev = entries;
    setEntries(es => es.filter(x => x.id !== id));
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) { setEntries(prev); setErr(error.message); }
  };

  const commitDuration = (entry) => {
    const raw = edits[entry.id];
    if (raw == null) return;
    const dur = parseDuration(raw);
    setEdits(ed => { const n = { ...ed }; delete n[entry.id]; return n; });
    if (dur == null || dur === entry.duration_seconds) return;
    updateEntry(entry.id, { duration_seconds: dur });
  };

  const entryLabel = (e) => {
    const cName = clientById[e.client_id]?.name || 'No client';
    const catName = e.category_id ? catById[e.category_id]?.name : (e.project_id ? 'Legacy work type' : 'Uncategorised');
    return { cName, catName };
  };

  // ---- week grid (rows = client|category) ----
  const rowKey = (cid, catid) => `${cid}|${catid || ''}`;
  const gridRows = [...new Set([
    ...entries.filter(e => e.client_id).map(e => rowKey(e.client_id, e.category_id)),
    ...extraRows
  ])].sort((a, b) => {
    const [ca, ka] = a.split('|'), [cb, kb] = b.split('|');
    const la = `${clientById[ca]?.name || ''} ${catById[ka]?.name || ''}`;
    const lb = `${clientById[cb]?.name || ''} ${catById[kb]?.name || ''}`;
    return la.localeCompare(lb);
  });

  const cellEntries = (key, d) => {
    const [cid, catid] = key.split('|');
    return entries.filter(e => e.client_id === cid && (e.category_id || '') === catid && dateKey(e.started_at) === dateKey(d));
  };
  const cellSec = (key, d) => cellEntries(key, d).reduce((a, e) => a + e.duration_seconds, 0);
  const rowSec = (key) => days.reduce((a, d) => a + cellSec(key, d), 0);

  const commitCell = async (key, d) => {
    const ek = `${key}|${dateKey(d)}`;
    const raw = gridEdits[ek];
    if (raw == null) return;
    setGridEdits(ed => { const n = { ...ed }; delete n[ek]; return n; });
    const target = raw.trim() === '' ? 0 : parseDuration(raw);
    if (target == null) return;
    const existing = cellEntries(key, d);
    const current = existing.reduce((a, e) => a + e.duration_seconds, 0);
    if (target === current) return;
    const [cid, catid] = key.split('|');
    setErr('');
    try {
      if (existing.length === 0) {
        if (target <= 0) return;
        const at = new Date(d); at.setHours(9, 0, 0, 0);
        const { error } = await supabase.from('time_entries').insert({
          client_id: cid, category_id: catid || null, started_at: at.toISOString(),
          duration_seconds: target, billable: true, rate: rateOf(clientById[cid])
        });
        if (error) throw new Error(error.message);
      } else if (target === 0) {
        const { error } = await supabase.from('time_entries').delete().in('id', existing.map(e => e.id));
        if (error) throw new Error(error.message);
      } else {
        const last = existing[existing.length - 1];
        const newDur = Math.max(0, last.duration_seconds + (target - current));
        const { error } = await supabase.from('time_entries').update({ duration_seconds: newDur }).eq('id', last.id);
        if (error) throw new Error(error.message);
      }
      await load();
    } catch (ex) { setErr(ex.message); }
  };

  const weekLabel = `${days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const selectedLabel = anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      {/* Controls */}
      <div className="ts-bar">
        <div className="seg">
          <button className={'seg-btn' + (mode === 'day' ? ' on' : '')} onClick={() => setMode('day')}>Day</button>
          <button className={'seg-btn' + (mode === 'week' ? ' on' : '')} onClick={() => setMode('week')}>Week</button>
        </div>
        <div className="ts-nav">
          <button className="btn sm gh" onClick={() => setAnchor(a => addDays(a, mode === 'week' ? -7 : -1))}>‹</button>
          <button className="btn sm gh" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d); }}>Today</button>
          <button className="btn sm gh" onClick={() => setAnchor(a => addDays(a, mode === 'week' ? 7 : 1))}>›</button>
          <span className="ts-range">{mode === 'week' ? weekLabel : selectedLabel}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setModal(true)}>+ New time entry</button>
      </div>

      {/* Week strip */}
      <div className="ts-strip">
        {days.map(d => {
          const on = dateKey(d) === dateKey(anchor);
          const today = dateKey(d) === dateKey(new Date());
          return (
            <button key={dateKey(d)}
              className={'ts-day' + (on && mode === 'day' ? ' on' : '') + (today ? ' today' : '')}
              onClick={() => { setAnchor(d); setMode('day'); }}>
              <span className="ts-day-name">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <span className="ts-day-num">{d.getDate()}</span>
              <span className="ts-day-total">{daySec(d) ? secToHM(daySec(d)) : '—'}</span>
            </button>
          );
        })}
        <div className="ts-week-total">
          <span className="ts-day-name">Week</span>
          <span className="ts-day-total strong">{secToHM(weekSec)}</span>
        </div>
      </div>

      {/* Running timer */}
      {timer && (
        <div className="card tt-timer running" style={{ marginTop: 14 }}>
          <div className="tt-timer-row">
            <div className="tt-timer-fields">
              <div>
                <div className="nm">{clientById[timer.client_id]?.name || 'Client'} · {catById[timer.category_id]?.name || 'Category'}</div>
                <div className="sub">{timer.notes || 'Timer running'} · since {new Date(timer.running_since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
            <div className="tt-timer-clock">{secToHMS(elapsed)}</div>
            <button className="btn tt-stop" disabled={busy} onClick={stopTimer}>{busy ? '…' : 'Stop'}</button>
          </div>
        </div>
      )}

      {/* Day view */}
      {mode === 'day' && (
        <>
          <div className="co-section-label" style={{ marginTop: 22 }}>
            {selectedLabel} · total {secToHM(daySec(anchor))}
          </div>
          <div className="card" style={{ padding: 0 }}>
            {dayEntries(anchor).length === 0 && (() => {
              const q = quoteForDate(dateKey(anchor));
              return (
                <div className="ts-empty-quote">
                  <p className="ts-quote-text">“{q.text}”</p>
                  <p className="ts-quote-author">— {q.author}</p>
                  <p className="ts-quote-hint">Nothing tracked this day. Start a timer or log time.</p>
                </div>
              );
            })()}
            {dayEntries(anchor).map(en => {
              const { cName, catName } = entryLabel(en);
              const task = en.task_id ? taskById[en.task_id] : null;
              return (
                <div key={en.id} className="tt-entry">
                  <div className="tt-entry-main">
                    <div className="nm">{cName} <span className="ts-cat">{catName}</span></div>
                    <input className="tt-entry-notes" defaultValue={en.notes || ''} placeholder="Add a note"
                      onBlur={(e) => { if (e.target.value !== (en.notes || '')) updateEntry(en.id, { notes: e.target.value.trim() || null }); }} />
                    {task && <span className="ts-task-chip" title="Linked task">🔗 {task.title}</span>}
                  </div>
                  <button className={'tt-billable' + (en.billable ? ' on' : '')}
                    title={en.billable ? 'Billable' : 'Non-billable'}
                    onClick={() => updateEntry(en.id, { billable: !en.billable })}>€</button>
                  <input className="ti tt-dur-input"
                    value={edits[en.id] != null ? edits[en.id] : secToHM(en.duration_seconds)}
                    onChange={(e) => setEdits(ed => ({ ...ed, [en.id]: e.target.value }))}
                    onBlur={() => commitDuration(en)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                  <button className="icon-btn icon-btn-danger" title="Delete entry" onClick={() => deleteEntry(en.id)}>×</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Week grid */}
      {mode === 'week' && (
        <>
          <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
            <table className="tt-grid">
              <thead>
                <tr>
                  <th className="tt-grid-row-head">Client · category</th>
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
                {gridRows.length === 0 && (
                  <tr><td colSpan={9} className="empty">No time this week. Add a row or log an entry.</td></tr>
                )}
                {gridRows.map(key => {
                  const [cid, catid] = key.split('|');
                  return (
                    <tr key={key}>
                      <td className="tt-grid-row-head">
                        <div className="nm">{clientById[cid]?.name || 'No client'}</div>
                        <div className="meta">{catById[catid]?.name || 'Uncategorised'}</div>
                      </td>
                      {days.map(d => {
                        const ek = `${key}|${dateKey(d)}`;
                        const sec = cellSec(key, d);
                        return (
                          <td key={ek} className={dateKey(d) === dateKey(new Date()) ? 'today' : ''}>
                            <input className="tt-cell"
                              value={gridEdits[ek] != null ? gridEdits[ek] : (sec ? String(secToDec(sec)) : '')}
                              placeholder="0"
                              onChange={(e) => setGridEdits(ed => ({ ...ed, [ek]: e.target.value }))}
                              onBlur={() => commitCell(key, d)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                          </td>
                        );
                      })}
                      <td className="tt-grid-total">{secToHM(rowSec(key))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="tt-grid-row-head">Daily total</td>
                  {days.map(d => <td key={dateKey(d)} className="tt-grid-total">{daySec(d) ? secToHM(daySec(d)) : ''}</td>)}
                  <td className="tt-grid-total">{secToHM(weekSec)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 12 }}>
            {addRow == null
              ? <button className="link-btn" onClick={() => setAddRow({ client_id: '', category_id: '' })}>+ Add row</button>
              : (
                <div className="ts-addrow">
                  <select className="sel" value={addRow.client_id} onChange={e => setAddRow(r => ({ ...r, client_id: e.target.value }))}>
                    <option value="">Client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select className="sel" value={addRow.category_id} onChange={e => setAddRow(r => ({ ...r, category_id: e.target.value }))}>
                    <option value="">Category…</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="btn sm" disabled={!addRow.client_id || !addRow.category_id}
                    onClick={() => { setExtraRows(rs => [...new Set([...rs, rowKey(addRow.client_id, addRow.category_id)])]); setAddRow(null); }}>Add</button>
                  <button className="btn sm gh" onClick={() => setAddRow(null)}>Cancel</button>
                </div>
              )}
            <div className="sub" style={{ marginTop: 6 }}>Cells are hours (1.5 or 1:30). Clearing a cell removes that day's time for the row.</div>
          </div>
        </>
      )}

      {modal && (
        <NewEntryModal
          clients={clients} categories={categories} tasks={tasks} anchor={anchor}
          timerRunning={!!timer}
          onStart={startTimer} onManual={addManual} onClose={() => setModal(false)}
        />
      )}
    </>
  );
}
