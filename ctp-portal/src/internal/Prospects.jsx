import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchStaff, staffName } from '../lib/tasks';
import ProspectImport from './ProspectImport';
import ProspectDetailCard, { PriorityPill, StagePill, CompanyLogo, ContactAvatars, StaffAvatars } from './ProspectDetailCard';
import {
  STAGES, BOARD_STAGES, PRIORITIES,
  stageOf, priorityOf, townOf, lastContact, lastActivityPhrase, fetchProspects, changeStage,
} from '../lib/prospects';

// Prospect pipeline views: board (drag and drop), table, split detail.
// Standalone it is the /prospects page; embedded it renders inside the
// merged Overview page under the Prospects filter.

export default function Prospects({ embedded = false, refreshKey = 0 }) {
  const nav = useNavigate();
  const [prospects, setProspects] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('ctp-prospect-view') || 'board'; } catch { return 'board'; }
  });
  const [selectedId, setSelectedId] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [staff, setStaff] = useState([]);
  const [toastMsg, setToastMsg] = useState('');
  const toast = useCallback((m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 2400); }, []);

  // Filters, shared by every view.
  const [search, setSearch] = useState('');
  const [townSel, setTownSel] = useState([]);
  const [prioFilter, setPrioFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [assignedFilter, setAssignedFilter] = useState('all');
  const [independentOnly, setIndependentOnly] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try { setProspects(await fetchProspects()); }
    catch (e) { setErr(e.message); setProspects([]); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u?.user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', u.user.id).single();
        setMyProfile(p || null);
      }
      try { setStaff(await fetchStaff()); } catch { setStaff([]); }
    })();
  }, []);

  const switchView = (v) => {
    setView(v);
    try { localStorage.setItem('ctp-prospect-view', v); } catch {}
  };

  const openDetail = (id) => { setSelectedId(id); switchView('split'); };

  const towns = useMemo(() => {
    const set = new Set();
    (prospects || []).forEach(p => { const t = townOf(p.locality); if (t) set.add(t); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [prospects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (prospects || []).filter(p => {
      if (townSel.length && !townSel.includes(townOf(p.locality))) return false;
      if (prioFilter !== 'all' && priorityOf(p) !== prioFilter) return false;
      if (stageFilter !== 'all' && stageOf(p) !== stageFilter) return false;
      if (assignedFilter !== 'all' && !(p.assigned_to || []).includes(assignedFilter)) return false;
      if (independentOnly && (p.ownership || '').trim().toLowerCase() !== 'independent') return false;
      if (q) {
        const hay = [
          p.name, p.locality, p.segment, p.ownership, p.partner_notes, p.next_step,
          ...(p.contacts || []).flatMap(c => [c.full_name, c.email, c.role]),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [prospects, search, townSel, prioFilter, stageFilter, assignedFilter, independentOnly]);

  if (!prospects) {
    const spinner = <div className="center"><div className="sp" /></div>;
    return embedded ? spinner : <div className="pr-fill">{spinner}</div>;
  }

  const toggleTown = (t) => setTownSel(sel => sel.includes(t) ? sel.filter(x => x !== t) : [...sel, t]);
  const lostCount = prospects.filter(p => stageOf(p) === 'Lost').length;
  const highUntouched = prospects.filter(p => priorityOf(p) === 'High' && !lastContact(p.interactions)).length;

  const subLine = (
    <div className="pr-sub">
      <b>{prospects.length} prospect{prospects.length === 1 ? '' : 's'}</b>
      {highUntouched > 0 && <> &nbsp;·&nbsp; {highUntouched} high priority need a first touch</>}
    </div>
  );

  const viewControls = (
    <>
      {view === 'board' && (
        <button className={'pr-chip' + (showLost ? ' on' : '')} onClick={() => setShowLost(v => !v)}>
          Show lost{lostCount ? ` (${lostCount})` : ''}
        </button>
      )}
      <div className="pr-toggle">
        {[['board', 'Board'], ['table', 'Table'], ['split', 'Split']].map(([v, l]) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => switchView(v)}>{l}</button>
        ))}
      </div>
    </>
  );

  const body = (
    <>
      {err && <div className="auth-err">{err}</div>}

      {prospects.length > 0 && (
        <div className="pr-controls">
          <div className="pr-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              placeholder="Search prospects, contacts, notes"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search prospects"
            />
          </div>
          <div className="pr-chips">
            <button className={'pr-chip' + (townSel.length === 0 ? ' on' : '')} onClick={() => setTownSel([])}>All localities</button>
            {towns.map(t => (
              <button key={t} className={'pr-chip' + (townSel.includes(t) ? ' on' : '')} onClick={() => toggleTown(t)}>{t}</button>
            ))}
            <button className={'pr-chip' + (independentOnly ? ' on' : '')} onClick={() => setIndependentOnly(v => !v)}>Independent only</button>
            <select className="pr-fsel" value={prioFilter} onChange={e => setPrioFilter(e.target.value)} aria-label="Priority filter">
              <option value="all">All priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="pr-fsel" value={stageFilter} onChange={e => setStageFilter(e.target.value)} aria-label="Stage filter">
              <option value="all">All stages</option>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="pr-fsel" value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)} aria-label="Assigned to filter">
              <option value="all">Assigned to anyone</option>
              {staff.map(s => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
            </select>
          </div>
        </div>
      )}

      {prospects.length === 0 && (
        <div className="pr-empty-card">No prospects yet. Add one or import a CSV.</div>
      )}
      {prospects.length > 0 && filtered.length === 0 && (
        <div className="pr-empty-card">No prospects match the filters.</div>
      )}

      {filtered.length > 0 && view === 'board' && (
        <BoardView
          prospects={filtered}
          staff={staff}
          myProfile={myProfile}
          showLost={showLost}
          onOpen={openDetail}
          onChanged={load}
          toast={toast}
        />
      )}

      {filtered.length > 0 && view === 'table' && (
        <TableView prospects={filtered} onOpen={openDetail} />
      )}

      {filtered.length > 0 && view === 'split' && (
        <SplitView
          prospects={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          myProfile={myProfile}
          staff={staff}
          onChanged={load}
          toast={toast}
          nav={nav}
        />
      )}

      {importOpen && (
        <ProspectImport
          myProfile={myProfile}
          onClose={() => setImportOpen(false)}
          onImported={load}
          toast={toast}
        />
      )}

      {toastMsg && <div className="tst">{toastMsg}</div>}
    </>
  );

  if (embedded) {
    return (
      <div className="pr-page pr-embed">
        <div className="pr-embed-bar">
          {subLine}
          <div className="pr-head-actions">{viewControls}</div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="pr-fill">
      <div className="page pr-page">
        <div className="pr-head">
          <div>
            <h1>Prospects</h1>
            {subLine}
          </div>
          <div className="pr-head-actions">
            <button className="pr-btn" onClick={() => setImportOpen(true)}>Import CSV</button>
            {viewControls}
          </div>
        </div>
        {body}
      </div>
    </div>
  );
}

/* ---------- Board view ---------- */

const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
const byPriorityThenName = (a, b) =>
  (PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)]) || a.name.localeCompare(b.name);

function BoardView({ prospects, staff, myProfile, showLost, onOpen, onChanged, toast }) {
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const cols = showLost ? [...BOARD_STAGES, 'Lost'] : BOARD_STAGES;

  const moveTo = async (prospect, stage) => {
    if (stageOf(prospect) === stage) return;
    try {
      await changeStage(prospect, stage, myProfile?.id);
      toast('Moved to ' + stage);
      onChanged();
    } catch (e) { toast('Stage change failed: ' + e.message); }
  };

  const drop = (stage) => {
    const p = prospects.find(x => x.id === dragId);
    setOverCol(null);
    setDragId(null);
    if (p) moveTo(p, stage);
  };

  return (
    <div className={'pr-board' + (cols.length === 6 ? ' cols-6' : '')}>
      {cols.map(stage => {
        const cards = prospects.filter(p => stageOf(p) === stage).sort(byPriorityThenName);
        return (
          <div key={stage}>
            <div className="pr-col-head">
              <span className="name">{stage}</span>
              <span className="count">{cards.length}</span>
            </div>
            <div
              className={'pr-col-body' + (overCol === stage ? ' over' : '')}
              onDragOver={e => { e.preventDefault(); if (overCol !== stage) setOverCol(stage); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(c => c === stage ? null : c); }}
              onDrop={e => { e.preventDefault(); drop(stage); }}
            >
              {cards.map(p => (
                <BoardCard
                  key={p.id}
                  prospect={p}
                  staff={staff}
                  dragging={dragId === p.id}
                  onDragStart={() => setDragId(p.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  onOpen={() => onOpen(p.id)}
                  onMove={(s) => moveTo(p, s)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({ prospect, staff, dragging, onDragStart, onDragEnd, onOpen, onMove }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const stage = stageOf(prospect);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  return (
    <div
      className={'pr-card' + (dragging ? ' dragging' : '') + (stage === 'Won' ? ' won' : '')}
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="pr-card-menu" onClick={e => e.stopPropagation()}>
        <button
          className="pr-card-menu-btn"
          onClick={() => setMenuOpen(o => !o)}
          title="Move to stage"
          aria-label={'Move ' + prospect.name + ' to stage'}
          aria-expanded={menuOpen}
        >&#8942;</button>
        {menuOpen && (
          <div className="pr-card-pop">
            <div className="lab">Move to</div>
            {STAGES.map(s => (
              <button key={s} className={s === stage ? 'cur' : ''} onClick={() => { setMenuOpen(false); onMove(s); }}>
                {s}{s === stage ? ' ·' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 6 }}>
        <CompanyLogo prospect={prospect} size={26} />
        <div className="co" style={{ marginBottom: 0 }}>{prospect.name}</div>
      </div>
      <div className="loc">{[townOf(prospect.locality), prospect.segment].filter(Boolean).join(' · ')}</div>
      <PriorityPill value={priorityOf(prospect)} />
      <div className="foot">
        <StaffAvatars ids={prospect.assigned_to} staff={staff} />
        <span className="act">
          {stage === 'Won' ? 'signed · convert' : lastActivityPhrase(prospect.interactions)}
        </span>
      </div>
    </div>
  );
}

/* ---------- Table view ---------- */

const SORTS = {
  company: (a, b) => a.name.localeCompare(b.name),
  stage: (a, b) => STAGES.indexOf(stageOf(a)) - STAGES.indexOf(stageOf(b)),
  locality: (a, b) => townOf(a.locality).localeCompare(townOf(b.locality)),
  priority: (a, b) => PRIORITIES.indexOf(priorityOf(a)) - PRIORITIES.indexOf(priorityOf(b)),
  activity: (a, b) => (lastContact(b.interactions)?.occurred_at || '').localeCompare(lastContact(a.interactions)?.occurred_at || ''),
};

function TableView({ prospects, onOpen }) {
  const [sort, setSort] = useState({ key: 'company', dir: 1 });

  const sorted = useMemo(() => {
    const fn = SORTS[sort.key] || SORTS.company;
    return [...prospects].sort((a, b) => fn(a, b) * sort.dir);
  }, [prospects, sort]);

  const clickSort = (key) => setSort(s => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const arrow = (key) => sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '';

  return (
    <div className="pr-tbl">
      <table>
        <thead>
          <tr>
            <th onClick={() => clickSort('company')}>Company{arrow('company')}</th>
            <th onClick={() => clickSort('stage')}>Stage{arrow('stage')}</th>
            <th onClick={() => clickSort('locality')}>Locality{arrow('locality')}</th>
            <th onClick={() => clickSort('priority')}>Priority{arrow('priority')}</th>
            <th className="plain">Contacts</th>
            <th onClick={() => clickSort('activity')}>Last activity{arrow('activity')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id} onClick={() => onOpen(p.id)}>
              <td>
                <div className="co">{p.name}</div>
                {p.segment && <div className="loc">{p.segment}</div>}
              </td>
              <td><StagePill value={stageOf(p)} /></td>
              <td className="loc">{townOf(p.locality) || '-'}</td>
              <td><PriorityPill value={priorityOf(p)} /></td>
              <td><ContactAvatars contacts={p.contacts} /></td>
              <td className="loc">{lastActivityPhrase(p.interactions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Split view ---------- */

function SplitView({ prospects, selectedId, onSelect, myProfile, staff, onChanged, toast, nav }) {
  const sel = prospects.find(p => p.id === selectedId) || prospects[0];

  return (
    <div className="pr-split">
      <div className="pr-plist">
        {prospects.map(p => (
          <div
            key={p.id}
            className={'pr-prow' + (sel?.id === p.id ? ' sel' : '')}
            onClick={() => onSelect(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); } }}
          >
            <div className="co">{p.name}</div>
            <div className="meta">
              <span className="loc">{townOf(p.locality) || stageOf(p)}</span>
              <PriorityPill value={priorityOf(p)} />
            </div>
          </div>
        ))}
      </div>
      {sel
        ? <ProspectDetailCard key={sel.id} client={sel} myProfile={myProfile} staff={staff} onChanged={onChanged} toast={toast} nav={nav} />
        : <div className="pr-detail"><div className="empty">Select a prospect.</div></div>}
    </div>
  );
}
