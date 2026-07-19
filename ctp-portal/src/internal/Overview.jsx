import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList,
  PieChart, Pie
} from 'recharts';
import html2canvas from 'html2canvas-pro';
import { supabase } from '../lib/supabase';
import { PROPOSAL_STATUS } from '../lib/proposals';
import { BOARD_STAGES, stageOf, timeAgoShort } from '../lib/prospects';
import { LOGO } from '../lib/logo';
import Avatar from '../components/Avatar';

// Every figure on this page is computed from live rows the signed-in user can
// already read under RLS. No money is rendered here: counts and hours only.
// A source that fails to load drops its cards instead of showing zeros.

const fmtH = (h) => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

const monthStart = (d, offset = 0) => new Date(d.getFullYear(), d.getMonth() + offset, 1);

// Local midnight of the Monday of that week, same convention as the Time page.
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function lastWeeks(now, n = 8) {
  const cur = mondayOf(now);
  return [...Array(n)].map((_, i) => {
    const s = new Date(cur);
    s.setDate(s.getDate() - 7 * (n - 1 - i));
    return { start: s, label: s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
  });
}

function weeklyCounts(weeks, dates) {
  const counts = weeks.map(() => 0);
  const index = new Map(weeks.map((w, i) => [w.start.getTime(), i]));
  for (const iso of dates) {
    if (!iso) continue;
    const i = index.get(mondayOf(new Date(iso)).getTime());
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

// Chart colors come from the existing design tokens (the same blue/teal
// family as the Time page), read from the stylesheet so they never drift.
let _tk;
function tk() {
  if (_tk) return _tk;
  const get = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
  _tk = {
    blue: get('--blue', '#0052FF'), cyan: get('--cyan', '#00B8E6'), teal: get('--teal', '#2ED6A6'),
    dim: get('--dim', '#5d6b7e'), line: get('--line', '#dfe5ec'),
    ink: get('--ink', '#101826'), panel: get('--panel', '#ffffff')
  };
  return _tk;
}

const tooltipProps = (C) => ({
  cursor: { fill: C.line, fillOpacity: 0.35 },
  contentStyle: { background: C.panel, border: '1px solid ' + C.line, borderRadius: 10, fontSize: 13, boxShadow: '0 4px 14px rgba(16,24,38,.08)' },
  labelStyle: { color: C.ink, fontWeight: 600 },
  itemStyle: { color: C.dim }
});

const axisTick = (C) => ({ fill: C.dim, fontSize: 12 });

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
      const [clientsQ, proposalsQ, envelopesQ, tasksQ, entriesQ, interactionsQ, studioQ] = await Promise.all([
        supabase.from('clients').select('id, name, client_status, pipeline_stage'),
        supabase.from('proposals').select('id, status'),
        supabase.from('envelopes').select('id, status, sent_at, completed_at'),
        supabase.from('tasks').select('id, status, client_id'),
        supabase.from('time_entries').select('client_id, started_at, duration_seconds').gte('started_at', entriesSince.toISOString()),
        supabase.from('interactions').select('id, client_id, kind, title, occurred_at, clients(name), creator:profiles!created_by(full_name, email, avatar_url)').order('occurred_at', { ascending: false }).limit(10),
        supabase.from('studio_store').select('value').eq('key', 'ctp-lib').maybeSingle()
      ]);
      if (dead) return;

      // Library items carry their creation time as a millisecond id.
      let studio = { ok: !studioQ.error, items: [] };
      if (studio.ok && studioQ.data?.value) {
        try { studio.items = JSON.parse(studioQ.data.value).filter(x => Number(x?.id) > 0); } catch { studio.items = []; }
      }

      setData({
        clients: wrap(clientsQ), proposals: wrap(proposalsQ), envelopes: wrap(envelopesQ),
        tasks: wrap(tasksQ), entries: wrap(entriesQ), interactions: wrap(interactionsQ), studio,
        thisMonth, prevMonth, d30, weeks: lastWeeks(now)
      });
    })();
    return () => { dead = true; };
  }, []);

  // Print-to-PDF snapshot: html2canvas captures the whole dashboard, the
  // capture goes into a print-only container, and the print stylesheet shows
  // only the branded header plus that image. The page is pinned to the
  // 1200px desktop layout for the capture (the ov-capture class also outranks
  // the responsive stacking rules, since those key on viewport width), so
  // the PDF always shows the full-width desktop grid no matter the screen.
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    const page = document.querySelector('.page');
    if (!page || exporting) return;
    setExporting(true);
    let shot = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      page.classList.remove('ov-capture');
      document.body.classList.remove('ov-capture-print');
      if (shot) shot.remove();
      window.removeEventListener('afterprint', cleanup);
      setExporting(false);
    };
    try {
      page.classList.add('ov-capture');
      // ResponsiveContainer needs a beat to re-render every chart at the
      // forced 1200px width before the snapshot is taken.
      await new Promise(res => setTimeout(res, 500));
      const canvas = await html2canvas(page, {
        scale: 2,
        useCORS: true,
        windowWidth: 1240,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        ignoreElements: (el) => !!el.classList && (el.classList.contains('co-actions') || el.classList.contains('ov-print-shot'))
      });
      page.classList.remove('ov-capture');
      const img = new Image();
      img.src = canvas.toDataURL('image/png');
      shot = document.createElement('div');
      shot.className = 'ov-print-shot';
      shot.appendChild(img);
      page.appendChild(shot);
      await new Promise(res => { img.onload = res; img.onerror = res; });
      document.body.classList.add('ov-capture-print');
      window.addEventListener('afterprint', cleanup);
      window.print();
      setTimeout(cleanup, 2000);
    } catch {
      cleanup();
    }
  };

  return (
    <div className="page">
      <div className="ov-print-head" aria-hidden="true">
        <img src={LOGO} alt="" />
        <div>
          <b>Clear Tech Partner</b>
          <span>Overview | {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>
      <div className="co-header">
        <div>
          <h1>Overview</h1>
          <p className="sub">The whole business at a glance.</p>
        </div>
        <div className="co-actions">
          <button className="btn sm gh" onClick={exportPdf} disabled={!data || exporting}>
            {exporting ? 'Preparing…' : 'Export PDF'}
          </button>
        </div>
      </div>

      {!data ? <PageSkeleton /> : (
        <>
          <Stats data={data} />
          {(data.clients.ok || data.proposals.ok) && (
            <div className="ov-row r2">
              {data.clients.ok && <FunnelCard clients={data.clients.rows} />}
              {data.proposals.ok && <DonutCard proposals={data.proposals.rows} />}
            </div>
          )}
          {data.clients.ok && (data.tasks.ok || data.entries.ok) && (
            <div className="ov-row r3">
              {data.tasks.ok && <TasksByClientCard tasks={data.tasks.rows} clients={data.clients.rows} />}
              {data.entries.ok && <HoursByClientCard entries={data.entries.rows} clients={data.clients.rows} d30={data.d30} />}
            </div>
          )}
          {(data.studio.ok || data.envelopes.ok) && (
            <div className="ov-row r4">
              {data.studio.ok && <ContentWeeklyCard items={data.studio.items} weeks={data.weeks} />}
              {data.envelopes.ok && <SignatureWeeklyCard envelopes={data.envelopes.rows} weeks={data.weeks} />}
            </div>
          )}
          {data.interactions.ok && <FeedCard interactions={data.interactions.rows} />}
        </>
      )}
    </div>
  );
}

/* ---------- Loading ---------- */

function PageSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="ov-stats">
        {[...Array(6)].map((_, i) => (
          <div className="ov-stat" key={i}>
            <div className="ov-skel" style={{ height: 30, width: 54 }} />
            <div className="ov-skel" style={{ height: 11, width: '82%', marginTop: 10 }} />
          </div>
        ))}
      </div>
      {['r2', 'r3', 'r4'].map(r => (
        <div className={'ov-row ' + r} key={r}>
          {[0, 1].map(i => (
            <div className="card" key={i}>
              <div className="ov-skel" style={{ height: 15, width: 150 }} />
              <div className="ov-skel" style={{ height: 160, marginTop: 16 }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- Row 1: headline numbers ---------- */

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

/* ---------- Row 2: pipeline ---------- */

function FunnelCard({ clients }) {
  const nav = useNavigate();
  const C = tk();
  const prospects = clients.filter(c => c.client_status === 'prospect');
  const rows = BOARD_STAGES.map(stage => ({
    stage, count: prospects.filter(p => stageOf(p) === stage).length
  }));

  const toStage = (entry) => {
    const stage = entry?.stage || entry?.payload?.stage;
    if (stage) nav(`/crm?stage=${encodeURIComponent(stage)}`);
  };

  return (
    <div className="card">
      <h3>Prospect funnel</h3>
      <div className="sub">Every prospect by stage. Click a stage to open it in the CRM.</div>
      {prospects.length === 0 ? (
        <div className="ov-empty">No prospects in the pipeline yet.</div>
      ) : (
        <div className="ov-chart" style={{ height: 205 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 34, bottom: 0, left: 0 }}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="stage" width={104} tick={axisTick(C)} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipProps(C)} formatter={(v) => [v, 'Prospects']} />
              <Bar dataKey="count" isAnimationActive={false} barSize={18} radius={[0, 6, 6, 0]} cursor="pointer" onClick={toStage}>
                {rows.map(r => <Cell key={r.stage} fill={r.stage === 'Won' ? C.teal : C.blue} />)}
                <LabelList dataKey="count" position="right" fill={C.dim} fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function DonutCard({ proposals }) {
  const C = tk();
  // Same colors the Proposals page uses for these status pills.
  const rows = Object.entries(PROPOSAL_STATUS).map(([key, cfg]) => ({
    key, name: cfg.label, color: cfg.dot,
    value: proposals.filter(p => p.status === key).length
  }));
  const shown = rows.filter(r => r.value > 0);

  return (
    <div className="card">
      <h3>Proposals by status</h3>
      <div className="sub">{proposals.length} proposal{proposals.length === 1 ? '' : 's'} total.</div>
      {proposals.length === 0 ? (
        <div className="ov-empty">No proposals yet.</div>
      ) : (
        <>
          <div className="ov-chart" style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip {...tooltipProps(C)} cursor={false} formatter={(v, n) => [v, n]} />
                <Pie data={shown} isAnimationActive={false} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke={C.panel}>
                  {shown.map(r => <Cell key={r.key} fill={r.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="ov-legend">
            {rows.map(r => (
              <span key={r.key}><span className="dot" style={{ background: r.color }} />{r.name} {r.value}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Row 3: per-client load ---------- */

function byClientRows(clients, sums) {
  const nameOf = new Map(clients.map(c => [c.id, c.name]));
  return [...sums.entries()]
    .map(([id, value]) => ({ name: id ? (nameOf.get(id) || 'Unknown client') : 'Internal', value }))
    .sort((a, b) => b.value - a.value);
}

function HBars({ rows, color, unit }) {
  const C = tk();
  return (
    <div className="ov-chart" style={{ height: Math.max(120, rows.length * 32 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="name" width={128} tick={axisTick(C)} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipProps(C)} formatter={(v) => [unit === 'h' ? fmtH(v) + 'h' : v, unit === 'h' ? 'Hours' : 'Open tasks']} />
          <Bar dataKey="value" isAnimationActive={false} barSize={16} radius={[0, 6, 6, 0]} fill={color}>
            <LabelList dataKey="value" position="right" fill={C.dim} fontSize={12}
              formatter={(v) => unit === 'h' ? fmtH(v) : v} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TasksByClientCard({ tasks, clients }) {
  const C = tk();
  const sums = new Map();
  for (const t of tasks) {
    if (t.status !== 'open') continue;
    const key = t.client_id || null;
    sums.set(key, (sums.get(key) || 0) + 1);
  }
  const rows = byClientRows(clients, sums);

  return (
    <div className="card">
      <h3>Open tasks per client</h3>
      <div className="sub">Everything not yet done, including the Internal bucket.</div>
      {rows.length === 0
        ? <div className="ov-empty">No open tasks.</div>
        : <HBars rows={rows} color={C.blue} unit="n" />}
    </div>
  );
}

function HoursByClientCard({ entries, clients, d30 }) {
  const C = tk();
  const sums = new Map();
  for (const e of entries) {
    if (new Date(e.started_at) < d30) continue;
    const key = e.client_id || null;
    sums.set(key, (sums.get(key) || 0) + e.duration_seconds / 3600);
  }
  const rows = byClientRows(clients, sums).map(r => ({ ...r, name: r.name === 'Internal' ? 'No client' : r.name }));

  return (
    <div className="card">
      <h3>Hours per client, last 30 days</h3>
      <div className="sub">Tracked time only. Pricing lives in proposals, not here.</div>
      {rows.length === 0
        ? <div className="ov-empty">No hours logged in the last 30 days.</div>
        : <HBars rows={rows} color={C.cyan} unit="h" />}
    </div>
  );
}

/* ---------- Row 4: activity ---------- */

function WeeklyBars({ weeks, series, colors }) {
  const C = tk();
  const rows = weeks.map((w, i) => {
    const r = { label: w.label };
    for (const s of series) r[s.name] = s.counts[i];
    return r;
  });
  return (
    <>
      <div className="ov-chart" style={{ height: 170 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={{ fill: C.dim, fontSize: 10.5 }} axisLine={{ stroke: C.line }} tickLine={false} interval={0} />
            <YAxis hide allowDecimals={false} domain={[0, 'dataMax']} />
            <Tooltip {...tooltipProps(C)} />
            {series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} isAnimationActive={false} fill={colors[i]} barSize={series.length > 1 ? 8 : 16} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="ov-legend">
          {series.map((s, i) => (
            <span key={s.name}><span className="dot" style={{ background: colors[i] }} />{s.name}</span>
          ))}
        </div>
      )}
    </>
  );
}

function ContentWeeklyCard({ items, weeks }) {
  const C = tk();
  const counts = weeklyCounts(weeks, items.map(x => new Date(Number(x.id)).toISOString()));

  return (
    <div className="card">
      <h3>Content Studio output</h3>
      <div className="sub">Pieces saved to the library per week, last 8 weeks.</div>
      {items.length === 0
        ? <div className="ov-empty">Nothing saved to the library yet.</div>
        : <WeeklyBars weeks={weeks} series={[{ name: 'Pieces', counts }]} colors={[C.blue]} />}
    </div>
  );
}

function SignatureWeeklyCard({ envelopes, weeks }) {
  const C = tk();
  const sent = weeklyCounts(weeks, envelopes.map(e => e.sent_at));
  const completed = weeklyCounts(weeks, envelopes.map(e => e.completed_at));

  return (
    <div className="card">
      <h3>Signature activity</h3>
      <div className="sub">Envelopes sent vs completed per week, last 8 weeks.</div>
      {envelopes.length === 0
        ? <div className="ov-empty">No envelopes yet.</div>
        : (
          <WeeklyBars
            weeks={weeks}
            series={[{ name: 'Sent', counts: sent }, { name: 'Completed', counts: completed }]}
            colors={[C.cyan, C.teal]}
          />
        )}
    </div>
  );
}

const KIND_LABEL = {
  note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting',
  proposal: 'Proposal', task: 'Task', import: 'Import', stage_change: 'Stage'
};

function FeedCard({ interactions }) {
  return (
    <div className="card">
      <h3>Recent activity</h3>
      <div className="sub">The last 10 interactions across all clients.</div>
      {interactions.length === 0 ? (
        <div className="ov-empty">No interactions logged yet.</div>
      ) : (
        <ul className="ov-feed">
          {interactions.map(i => (
            <li key={i.id}>
              <Link to={`/clients/${i.client_id}`}>
                <Avatar profile={i.creator} size={26} />
                <b className="ov-fc-client">{i.clients?.name || 'Client'}</b>
                <span className="chip ov-fc-kind">{KIND_LABEL[i.kind] || i.kind}</span>
                <span className="ov-fc-desc">{i.title}</span>
                <span className="when">{timeAgoShort(i.occurred_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
