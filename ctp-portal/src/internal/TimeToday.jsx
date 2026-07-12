import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { secToHM, secToHMS, parseDuration, entrySeconds, projectLabel, dateKey } from '../lib/time';

function resolveRate(project) {
  const r = project?.clients?.hourly_rate;
  return r == null ? null : +r;
}

export default function TimeToday({ projects }) {
  const [timer, setTimer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Timer draft (before start) and quick-add form state.
  const [form, setForm] = useState({ project_id: '', notes: '', billable: true });
  const [quick, setQuick] = useState({ project_id: '', duration: '', notes: '', billable: true });
  const [edits, setEdits] = useState({});
  const tick = useRef(null);

  const activeProjects = projects.filter(p => p.status !== 'complete');
  const byId = Object.fromEntries(projects.map(p => [p.id, p]));

  const load = async () => {
    setErr('');
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    const [{ data: tm, error: e1 }, { data: es, error: e2 }] = await Promise.all([
      supabase.from('time_timers').select('*').eq('person_id', uid).maybeSingle(),
      supabase.from('time_entries').select('*')
        .gte('started_at', from.toISOString()).lt('started_at', to.toISOString())
        .order('started_at', { ascending: false })
    ]);
    // On error, still clear the loading state: an empty list plus the error
    // banner beats an infinite spinner that hides the message.
    if (e1 || e2) { setErr((e1 || e2).message); setEntries(es || []); return; }
    setTimer(tm || null);
    setEntries(es || []);
    if (tm) setForm({ project_id: tm.project_id, notes: tm.notes || '', billable: tm.billable });
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (timer) {
      const upd = () => setElapsed(Math.floor((Date.now() - new Date(timer.running_since).getTime()) / 1000));
      upd();
      tick.current = setInterval(upd, 1000);
      return () => clearInterval(tick.current);
    }
    setElapsed(0);
  }, [timer?.id, timer?.running_since]);

  const start = async () => {
    if (!form.project_id) { setErr('Pick a client and work type first.'); return; }
    setBusy(true); setErr('');
    const { data, error } = await supabase.from('time_timers')
      .insert({ project_id: form.project_id, notes: form.notes.trim() || null, billable: form.billable })
      .select().single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setTimer(data);
  };

  const stop = async () => {
    if (!timer) return;
    setBusy(true); setErr('');
    try {
      const startedAt = new Date(timer.running_since);
      const now = new Date();
      const dur = Math.max(1, Math.floor((now - startedAt) / 1000));
      const project = byId[timer.project_id];
      const { error: insErr } = await supabase.from('time_entries').insert({
        project_id: timer.project_id,
        started_at: startedAt.toISOString(),
        ended_at: now.toISOString(),
        duration_seconds: dur,
        notes: (form.notes || timer.notes || '').trim() || null,
        billable: form.billable,
        rate: resolveRate(project)
      });
      if (insErr) throw new Error(insErr.message);
      const { error: delErr } = await supabase.from('time_timers').delete().eq('id', timer.id);
      if (delErr) throw new Error(delErr.message);
      setTimer(null);
      setForm(f => ({ ...f, notes: '' }));
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const quickAdd = async (e) => {
    e.preventDefault();
    const dur = parseDuration(quick.duration);
    if (!quick.project_id || !dur) { setErr('Quick add needs a work type and a duration like 1:30 or 1.5.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('time_entries').insert({
      project_id: quick.project_id,
      started_at: new Date().toISOString(),
      duration_seconds: dur,
      notes: quick.notes.trim() || null,
      billable: quick.billable,
      rate: resolveRate(byId[quick.project_id])
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setQuick({ project_id: '', duration: '', notes: '', billable: true });
    await load();
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

  if (!entries) return <div className="center"><div className="sp" /></div>;

  const total = entrySeconds(entries);
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const Q = (k) => (e) => setQuick(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      {/* Timer card */}
      <div className={'card spine tt-timer' + (timer ? ' running' : '')}>
        <div className="tt-timer-row">
          <div className="tt-timer-fields">
            <select className="sel" value={form.project_id} onChange={F('project_id')} disabled={!!timer}>
              <option value="">Client | work type…</option>
              {activeProjects.map(p => (
                <option key={p.id} value={p.id}>{p.clients?.name} | {projectLabel(p)}</option>
              ))}
            </select>
            <input className="ti" placeholder="What are you working on?" value={form.notes} onChange={F('notes')} />
            <label className="tt-check">
              <input type="checkbox" checked={form.billable} onChange={F('billable')} disabled={!!timer} /> Billable
            </label>
          </div>
          <div className="tt-timer-clock">{timer ? secToHMS(elapsed) : '0:00:00'}</div>
          {timer
            ? <button className="btn tt-stop" disabled={busy} onClick={stop}>{busy ? '…' : 'Stop'}</button>
            : <button className="btn" disabled={busy || !form.project_id} onClick={start}>{busy ? '…' : 'Start'}</button>}
        </div>
        {timer && (
          <div className="sub" style={{ marginTop: 8 }}>
            Running on {byId[timer.project_id]?.clients?.name} | {projectLabel(byId[timer.project_id])} since {new Date(timer.running_since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. The timer lives on the server, so it survives refresh and other devices.
          </div>
        )}
      </div>

      {/* Quick add */}
      <form className="card" onSubmit={quickAdd} style={{ marginTop: 14 }}>
        <div className="tt-quick-row">
          <select className="sel" value={quick.project_id} onChange={Q('project_id')}>
            <option value="">Add a block without the timer…</option>
            {activeProjects.map(p => (
              <option key={p.id} value={p.id}>{p.clients?.name} | {projectLabel(p)}</option>
            ))}
          </select>
          <input className="ti tt-dur-input" placeholder="1:30" value={quick.duration} onChange={Q('duration')} />
          <input className="ti" placeholder="Notes" value={quick.notes} onChange={Q('notes')} />
          <label className="tt-check">
            <input type="checkbox" checked={quick.billable} onChange={Q('billable')} /> Billable
          </label>
          <button className="btn sm" disabled={busy || !quick.project_id || !quick.duration}>Add</button>
        </div>
      </form>

      {/* Today's entries */}
      <div className="co-section-label" style={{ marginTop: 22 }}>
        Today · {dateKey(new Date())} · total {secToHM(total)}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {entries.length === 0 && <div className="empty">Nothing tracked today yet. Start the timer or add a block.</div>}
        {entries.map(en => {
          const p = byId[en.project_id];
          return (
            <div key={en.id} className="tt-entry">
              <div className="tt-entry-main">
                <div className="nm">{p?.clients?.name} | {projectLabel(p)}</div>
                <input
                  className="tt-entry-notes"
                  defaultValue={en.notes || ''}
                  placeholder="Notes"
                  onBlur={(e) => { if (e.target.value !== (en.notes || '')) updateEntry(en.id, { notes: e.target.value.trim() || null }); }}
                />
              </div>
              <button
                className={'tt-billable' + (en.billable ? ' on' : '')}
                title={en.billable ? 'Billable. Click to make non-billable.' : 'Non-billable. Click to make billable.'}
                onClick={() => updateEntry(en.id, { billable: !en.billable })}
              >€</button>
              <input
                className="ti tt-dur-input"
                value={edits[en.id] != null ? edits[en.id] : secToHM(en.duration_seconds)}
                onChange={(e) => setEdits(ed => ({ ...ed, [en.id]: e.target.value }))}
                onBlur={() => commitDuration(en)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              />
              <button className="icon-btn icon-btn-danger" title="Delete entry" onClick={() => deleteEntry(en.id)}>×</button>
            </div>
          );
        })}
      </div>
    </>
  );
}
