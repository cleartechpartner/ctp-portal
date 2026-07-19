import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Every figure on this page is computed from live rows the signed-in user can
// already read under RLS. No money is rendered here: counts and hours only.
// A source that fails to load drops its cards instead of showing zeros.

const fmtH = (h) => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const monthStart = (d, offset = 0) => new Date(d.getFullYear(), d.getMonth() + offset, 1);

export default function Overview() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const now = new Date();
      const thisMonth = monthStart(now);
      const prevMonth = monthStart(now, -1);
      const d30 = new Date(now.getTime() - 30 * 86400000);
      // One window covers hours-this-month, the last-month delta and the
      // 30-day per-client chart, so time entries are fetched once.
      const entriesSince = new Date(Math.min(prevMonth.getTime(), d30.getTime()));

      const wrap = (q) => ({ ok: !q.error, rows: q.data || [] });
      const [clientsQ, proposalsQ, envelopesQ, tasksQ, entriesQ] = await Promise.all([
        supabase.from('clients').select('id, name, client_status, pipeline_stage'),
        supabase.from('proposals').select('id, status'),
        supabase.from('envelopes').select('id, status, sent_at, completed_at'),
        supabase.from('tasks').select('id, status, client_id'),
        supabase.from('time_entries').select('client_id, started_at, duration_seconds').gte('started_at', entriesSince.toISOString())
      ]);
      if (dead) return;
      setData({
        clients: wrap(clientsQ), proposals: wrap(proposalsQ), envelopes: wrap(envelopesQ),
        tasks: wrap(tasksQ), entries: wrap(entriesQ),
        thisMonth, prevMonth, d30
      });
    })();
    return () => { dead = true; };
  }, []);

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Overview</h1>
          <p className="sub">The whole business at a glance.</p>
        </div>
      </div>

      {!data ? <StatsSkeleton /> : <Stats data={data} />}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="ov-stats" aria-hidden="true">
      {[...Array(6)].map((_, i) => (
        <div className="ov-stat" key={i}>
          <div className="ov-skel" style={{ height: 30, width: 54 }} />
          <div className="ov-skel" style={{ height: 11, width: '82%', marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

function Stats({ data }) {
  const { clients, proposals, envelopes, tasks, entries, thisMonth, prevMonth } = data;

  const cards = [];
  if (clients.ok) {
    const prospects = clients.rows.filter(c => c.client_status === 'prospect');
    cards.push({ label: 'Active clients', value: clients.rows.length - prospects.length });
    cards.push({
      label: 'Prospects in pipeline',
      value: prospects.filter(c => !['Won', 'Lost'].includes(c.pipeline_stage)).length
    });
  }
  if (proposals.ok) {
    cards.push({
      label: 'Proposals awaiting signature',
      value: proposals.rows.filter(p => p.status === 'sent' || p.status === 'viewed').length
    });
  }
  if (envelopes.ok) {
    cards.push({
      label: 'Documents out for signature',
      value: envelopes.rows.filter(e => e.status === 'sent' || e.status === 'viewed').length
    });
  }
  if (tasks.ok) {
    cards.push({ label: 'Open tasks', value: tasks.rows.filter(t => t.status === 'open').length });
  }
  if (entries.ok) {
    const hoursIn = (from, to) => entries.rows.reduce((s, e) => {
      const at = new Date(e.started_at);
      return at >= from && (!to || at < to) ? s + e.duration_seconds / 3600 : s;
    }, 0);
    const cur = hoursIn(thisMonth);
    const diff = cur - hoursIn(prevMonth, thisMonth);
    cards.push({
      label: 'Hours this month',
      value: fmtH(cur),
      delta: `${diff >= 0 ? '+' : '-'}${fmtH(Math.abs(diff))}h vs last month`
    });
  }

  return (
    <div className="ov-stats">
      {cards.map(c => (
        <div className="ov-stat" key={c.label}>
          <div className="ov-num">{c.value}</div>
          <div className="ov-lbl">{c.label}</div>
          {c.delta && <div className="ov-delta">{c.delta}</div>}
        </div>
      ))}
    </div>
  );
}
