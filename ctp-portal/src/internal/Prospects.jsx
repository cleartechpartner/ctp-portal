import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fx } from '../lib/api';
import { fetchStaff } from '../lib/tasks';
import ProspectImport from './ProspectImport';
import {
  STAGES, BOARD_STAGES, PRIORITIES, STAGE_CLS, PRIORITY_CLS, PRIORITY_SHORT, LOG_KINDS,
  stageOf, priorityOf, companyInitials, townOf, timeAgoShort,
  lastContact, lastActivityPhrase, latestInteraction, fetchProspects, changeStage,
} from '../lib/prospects';

const fmtDate = (d) => d
  ? new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  : '';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Prospects() {
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
  const [independentOnly, setIndependentOnly] = useState(false);
  const [showLost, setShowLost] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try { setProspects(await fetchProspects()); }
    catch (e) { setErr(e.message); setProspects([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

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
  }, [prospects, search, townSel, prioFilter, stageFilter, independentOnly]);

  if (!prospects) return <div className="pr-fill"><div className="center"><div className="sp" /></div></div>;

  const toggleTown = (t) => setTownSel(sel => sel.includes(t) ? sel.filter(x => x !== t) : [...sel, t]);
  const lostCount = prospects.filter(p => stageOf(p) === 'Lost').length;
  const highUntouched = prospects.filter(p => priorityOf(p) === 'High' && !lastContact(p.interactions)).length;

  return (
    <div className="pr-fill">
      <div className="page pr-page">
        <div className="pr-head">
          <div>
            <h1>Prospects</h1>
            <div className="pr-sub">
              <b>{prospects.length} prospect{prospects.length === 1 ? '' : 's'}</b>
              {highUntouched > 0 && <> &nbsp;·&nbsp; {highUntouched} high priority need a first touch</>}
            </div>
          </div>
          <div className="pr-head-actions">
            <button className="pr-btn" onClick={() => setImportOpen(true)}>Import CSV</button>
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
          </div>
        </div>

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
            </div>
          </div>
        )}

        {prospects.length === 0 && (
          <div className="pr-empty-card">No prospects yet. Create one in Client Overview with status Prospect, or import a CSV.</div>
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
          <TableView prospects={filtered} staff={staff} onOpen={openDetail} />
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
      </div>
    </div>
  );
}

/* ---------- Shared bits ---------- */

function PriorityPill({ value }) {
  const p = PRIORITIES.includes(value) ? value : 'Medium';
  return (
    <span className={`pr-pri ${PRIORITY_CLS[p]}`}>
      <span className="pr-dot" />{PRIORITY_SHORT[p]}
    </span>
  );
}

function StagePill({ value }) {
  const s = STAGES.includes(value) ? value : 'New';
  return <span className={`pr-stage ${STAGE_CLS[s]}`}>{s}</span>;
}

function CompanyLogo({ prospect, size = 52, onPick, uploading }) {
  const inner = prospect.logo_url
    ? <img src={prospect.logo_url} alt="" />
    : companyInitials(prospect.name);
  const style = size !== 52 ? { width: size, height: size, fontSize: Math.round(size * 0.37), borderRadius: Math.round(size / 4) } : undefined;
  if (!onPick) return <span className="pr-logo" style={style}>{inner}</span>;
  return (
    <label className="pr-logo pr-logo-btn" style={style} title="Upload logo">
      {uploading ? <span className="sp" style={{ width: 18, height: 18, borderWidth: 2 }} /> : inner}
      <input type="file" hidden accept="image/*" onChange={onPick} disabled={uploading} />
    </label>
  );
}

function ContactAvatars({ contacts }) {
  const list = (contacts || []).slice(0, 3);
  if (!list.length) return <span className="pr-none">-</span>;
  return (
    <div className="pr-avs">
      {list.map(c => <span key={c.id} className="pr-av" title={c.full_name}>{companyInitials(c.full_name)}</span>)}
      {(contacts || []).length > 3 && <span className="pr-av">+{contacts.length - 3}</span>}
    </div>
  );
}

// The staff member behind the latest interaction; the card / row owner.
function ownerOf(prospect, staff) {
  const latest = latestInteraction(prospect.interactions);
  if (!latest?.created_by) return null;
  return staff.find(s => s.id === latest.created_by) || null;
}

function OwnerAvatar({ profile, size = 22 }) {
  if (!profile) return null;
  const name = profile.full_name || profile.email?.split('@')[0] || '';
  if (profile.avatar_url) {
    return <img className="pr-av-img" src={profile.avatar_url} alt={name} title={name} style={{ width: size, height: size }} />;
  }
  return (
    <span className="pr-av" title={name} style={size !== 22 ? { width: size, height: size } : undefined}>
      {companyInitials(name)}
    </span>
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
                  owner={ownerOf(p, staff)}
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

function BoardCard({ prospect, owner, dragging, onDragStart, onDragEnd, onOpen, onMove }) {
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
        <div className="pr-avs">{owner && <OwnerAvatar profile={owner} />}</div>
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

function TableView({ prospects, staff, onOpen }) {
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
        ? <ProspectDetail key={sel.id} prospect={sel} myProfile={myProfile} staff={staff} onChanged={onChanged} toast={toast} nav={nav} />
        : <div className="pr-detail"><div className="empty">Select a prospect.</div></div>}
    </div>
  );
}

/* ---------- Detail card ---------- */

function ProspectDetail({ prospect, myProfile, staff, onChanged, toast, nav }) {
  const [contacts, setContacts] = useState(null);
  const [interactions, setInteractions] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const loadDetail = useCallback(async () => {
    const [cRes, iRes, tRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('client_id', prospect.id)
        .order('is_primary', { ascending: false }).order('created_at'),
      supabase.from('interactions').select('*').eq('client_id', prospect.id)
        .order('occurred_at', { ascending: false }),
      supabase.from('tasks').select('id, title, due_date, status').eq('client_id', prospect.id)
        .eq('status', 'open').order('due_date', { ascending: true, nullsFirst: false }),
    ]);
    setContacts(cRes.data || []);
    setInteractions(iRes.data || []);
    setTasks(tRes.error ? [] : (tRes.data || []));
  }, [prospect.id]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const refreshAll = () => { loadDetail(); onChanged(); };

  const setStage = async (stage) => {
    try {
      await changeStage(prospect, stage, myProfile?.id);
      toast('Moved to ' + stage);
      refreshAll();
    } catch (e) { toast('Stage change failed: ' + e.message); }
  };

  const setPriority = async (priority) => {
    const { error } = await supabase.from('clients').update({ priority }).eq('id', prospect.id);
    if (error) { toast('Update failed: ' + error.message); return; }
    toast('Priority set to ' + priority.toLowerCase());
    onChanged();
  };

  const uploadLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const path = `${prospect.id}/logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('logos').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('logos').getPublicUrl(path);
      const { error } = await supabase.from('clients').update({ logo_url: pub.publicUrl }).eq('id', prospect.id);
      if (error) throw new Error(error.message);
      toast('Logo updated');
      onChanged();
    } catch (ex) { toast('Logo upload failed: ' + ex.message); }
    setUploadingLogo(false);
    e.target.value = '';
  };

  const owner = ownerOf(prospect, staff) || myProfile;
  const contacted = lastContact(interactions || prospect.interactions);
  const website = (prospect.website || '').trim();
  const websiteHref = website && !/^https?:\/\//i.test(website) ? 'https://' + website : website;

  return (
    <div className="pr-detail">
      <div className="pr-dtop">
        <div style={{ display: 'flex', gap: 15, alignItems: 'center', minWidth: 0 }}>
          <CompanyLogo prospect={prospect} onPick={uploadLogo} uploading={uploadingLogo} />
          <div style={{ minWidth: 0 }}>
            <h2>{prospect.name}</h2>
            <div className="pr-dloc">
              {[townOf(prospect.locality), prospect.segment].filter(Boolean).join(' · ')}
              <select
                className={`pr-pill-sel ${STAGE_CLS[stageOf(prospect)]}`}
                value={stageOf(prospect)}
                onChange={e => setStage(e.target.value)}
                aria-label="Pipeline stage"
              >
                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
        <select
          className={`pr-pill-sel pr-pri-sel ${PRIORITY_CLS[priorityOf(prospect)]}`}
          value={priorityOf(prospect)}
          onChange={e => setPriority(e.target.value)}
          aria-label="Priority"
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
        </select>
      </div>

      <div className="pr-facts">
        <div className="pr-fact">
          <div className="k">Owner</div>
          <div className="v">
            {owner ? <><OwnerAvatar profile={owner} size={20} /> {owner.full_name || owner.email?.split('@')[0]}</> : '-'}
          </div>
        </div>
        <div className="pr-fact">
          <div className="k">Last contacted</div>
          <div className="v">{contacted ? timeAgoShort(contacted.occurred_at) : 'not yet'}</div>
        </div>
        <div className="pr-fact">
          <div className="k">Next step</div>
          <div className="v">
            {prospect.next_step
              ? <>{prospect.next_step}{prospect.next_step_date ? ' · ' + fmtDate(prospect.next_step_date) : ''}</>
              : 'none set'}
            <button className="pr-fact-edit" onClick={() => setFactsOpen(true)} title="Edit next step and website" aria-label="Edit next step and website">&#9998;</button>
          </div>
        </div>
        <div className="pr-fact">
          <div className="k">Website</div>
          <div className="v">
            {website
              ? <a href={websiteHref} target="_blank" rel="noreferrer">{website.replace(/^https?:\/\//i, '')}</a>
              : '-'}
          </div>
        </div>
      </div>

      <div className="pr-dactions">
        <button className="pr-btn primary" onClick={() => setLogOpen(true)}>Log activity</button>
        <button className="pr-btn" onClick={() => setEmailOpen(true)}>Send email</button>
        <button className="pr-btn" onClick={() => nav(`/proposals/new?client=${prospect.id}`)}>Generate Proposal</button>
      </div>

      <div className="pr-dgrid">
        <ContactsSection prospect={prospect} contacts={contacts} reload={refreshAll} toast={toast} />
        <div className="pr-dsec">
          <h3>Activity</h3>
          <Timeline interactions={interactions} tasks={tasks} contacts={contacts || []} />
        </div>
      </div>

      {logOpen && (
        <LogActivityModal
          prospect={prospect}
          contacts={contacts || []}
          myProfile={myProfile}
          onClose={() => setLogOpen(false)}
          onLogged={() => { setLogOpen(false); toast('Activity logged'); refreshAll(); }}
          toast={toast}
        />
      )}

      {emailOpen && (
        <SendEmailModal
          prospect={prospect}
          contacts={contacts || []}
          onClose={() => setEmailOpen(false)}
          onSent={() => { setEmailOpen(false); toast('Email sent and logged'); refreshAll(); }}
        />
      )}

      {factsOpen && (
        <FactsModal
          prospect={prospect}
          onClose={() => setFactsOpen(false)}
          onSaved={() => { setFactsOpen(false); toast('Saved'); onChanged(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

/* ---------- Send email (Resend via prospect-email function) ---------- */

function SendEmailModal({ prospect, contacts, onClose, onSent }) {
  const primary = contacts.find(c => c.is_primary && c.email) || contacts.find(c => c.email);
  const [form, setForm] = useState({
    contact_id: primary?.id || '',
    to: primary?.email || prospect.contact_email || '',
    subject: '',
    message: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const pickContact = (e) => {
    const c = contacts.find(x => x.id === e.target.value);
    setForm(f => ({ ...f, contact_id: e.target.value, to: c?.email || f.to }));
  };

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await fx('/api/prospect-email', {
        client_id: prospect.id,
        contact_id: form.contact_id || null,
        to: form.to.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });
      onSent();
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={send}>
        <div className="modal-head"><h3>Send email</h3><button type="button" className="link-btn" onClick={onClose}>Close</button></div>
        {err && <div className="auth-err">{err}</div>}
        <div className="grid2">
          <div className="fld"><label className="lab">Contact</label>
            <select className="sel" value={form.contact_id} onChange={pickContact}>
              <option value="">No linked contact</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.email ? ` (${c.email})` : ''}</option>)}
            </select></div>
          <div className="fld"><label className="lab">To</label>
            <input className="ti" type="email" value={form.to} onChange={F('to')} required placeholder="gm@hotel-example.com" /></div>
        </div>
        <div className="fld"><label className="lab">Subject</label>
          <input className="ti" value={form.subject} onChange={F('subject')} required placeholder="Guida for after-hours guest calls" /></div>
        <div className="fld"><label className="lab">Message</label>
          <textarea className="ta big" value={form.message} onChange={F('message')} required /></div>
        <div className="sub" style={{ marginBottom: 12 }}>
          Sends from the portal address with reply-to set to you, and logs on the activity timeline.
        </div>
        <div className="modal-foot">
          <button type="button" className="btn gh sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !form.to.trim() || !form.subject.trim() || !form.message.trim()}>
            {busy ? 'Sending...' : 'Send email'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Facts edit (next step + website) ---------- */

function FactsModal({ prospect, onClose, onSaved, toast }) {
  const [form, setForm] = useState({
    next_step: prospect.next_step || '',
    next_step_date: prospect.next_step_date || '',
    website: prospect.website || '',
  });
  const [busy, setBusy] = useState(false);
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('clients').update({
      next_step: form.next_step.trim() || null,
      next_step_date: form.next_step_date || null,
      website: form.website.trim() || null,
    }).eq('id', prospect.id);
    setBusy(false);
    if (error) { toast('Save failed: ' + error.message); return; }
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head"><h3>Next step</h3><button type="button" className="link-btn" onClick={onClose}>Close</button></div>
        <div className="fld"><label className="lab">Next step</label>
          <input className="ti" value={form.next_step} onChange={F('next_step')} placeholder="Call the GM" /></div>
        <div className="grid2">
          <div className="fld"><label className="lab">Date</label>
            <input className="ti" type="date" value={form.next_step_date} onChange={F('next_step_date')} /></div>
          <div className="fld"><label className="lab">Website</label>
            <input className="ti" value={form.website} onChange={F('website')} placeholder="hotel-example.com" /></div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn gh sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Contacts ---------- */

const BLANK_CONTACT = { full_name: '', role: '', email: '', phone: '', linkedin_url: '', notes: '' };

function ContactsSection({ prospect, contacts, reload, toast }) {
  const [editing, setEditing] = useState(null); // 'new' or a contact row

  const save = async (form) => {
    const row = {
      full_name: form.full_name.trim(),
      role: form.role.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      notes: form.notes.trim() || null,
    };
    let error;
    if (editing === 'new') {
      ({ error } = await supabase.from('contacts').insert({
        ...row, client_id: prospect.id, is_primary: !(contacts || []).length,
      }));
    } else {
      ({ error } = await supabase.from('contacts').update(row).eq('id', editing.id));
    }
    if (error) { toast('Save failed: ' + error.message); return; }
    setEditing(null);
    toast(editing === 'new' ? 'Contact added' : 'Contact saved');
    reload();
  };

  const remove = async (c) => {
    if (!confirm(`Delete contact "${c.full_name}"?`)) return;
    const { error } = await supabase.from('contacts').delete().eq('id', c.id);
    if (error) { toast('Delete failed: ' + error.message); return; }
    reload();
  };

  const makePrimary = async (c) => {
    if (c.is_primary) return;
    const { error } = await supabase.from('contacts').update({ is_primary: false })
      .eq('client_id', prospect.id).eq('is_primary', true);
    if (error) { toast('Update failed: ' + error.message); return; }
    const { error: e2 } = await supabase.from('contacts').update({ is_primary: true }).eq('id', c.id);
    if (e2) { toast('Update failed: ' + e2.message); return; }
    reload();
  };

  return (
    <div className="pr-dsec">
      <div className="pr-dsec-head">
        <h3>Contacts</h3>
        <button className="pr-btn pr-btn-xs" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          {editing === 'new' ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {editing === 'new' && <ContactForm initial={BLANK_CONTACT} onSave={save} onCancel={() => setEditing(null)} />}

      {contacts === null && <div className="pr-none">Loading...</div>}
      {contacts?.length === 0 && editing !== 'new' && <div className="pr-none">No contacts yet.</div>}

      {(contacts || []).map(c => (
        editing && editing !== 'new' && editing.id === c.id ? (
          <ContactForm key={c.id} initial={c} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <div key={c.id} className="pr-contact">
            <span className="pr-av pr-av-lg">{companyInitials(c.full_name)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">
                {c.full_name}
                <button
                  className={'pr-star' + (c.is_primary ? ' on' : '')}
                  onClick={() => makePrimary(c)}
                  title={c.is_primary ? 'Primary contact' : 'Make primary'}
                  aria-label={c.is_primary ? 'Primary contact' : 'Make primary'}
                >&#9733;</button>
              </div>
              <div className="rl">
                {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || 'No details yet'}
                {c.linkedin_url && <> · <a href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></>}
              </div>
              {c.notes && <div className="rl">{c.notes}</div>}
            </div>
            <div className="pr-contact-actions">
              <button className="pr-icon-btn" onClick={() => setEditing(c)} title="Edit contact" aria-label="Edit contact">&#9998;</button>
              <button className="pr-icon-btn danger" onClick={() => remove(c)} title="Delete contact" aria-label="Delete contact">&times;</button>
            </div>
          </div>
        )
      ))}
    </div>
  );
}

function ContactForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...BLANK_CONTACT, ...initial });
  const [busy, setBusy] = useState(false);
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await onSave(form);
    setBusy(false);
  };

  return (
    <form className="pr-contact-form" onSubmit={submit}>
      <div className="grid2">
        <div className="fld"><label className="lab">Name</label>
          <input className="ti" value={form.full_name} onChange={F('full_name')} required placeholder="Marc Coll" /></div>
        <div className="fld"><label className="lab">Role</label>
          <input className="ti" value={form.role || ''} onChange={F('role')} placeholder="General Manager" /></div>
        <div className="fld"><label className="lab">Email</label>
          <input className="ti" type="email" value={form.email || ''} onChange={F('email')} /></div>
        <div className="fld"><label className="lab">Phone</label>
          <input className="ti" value={form.phone || ''} onChange={F('phone')} /></div>
      </div>
      <div className="fld"><label className="lab">LinkedIn</label>
        <input className="ti" value={form.linkedin_url || ''} onChange={F('linkedin_url')} placeholder="https://linkedin.com/in/..." /></div>
      <div className="fld"><label className="lab">Notes</label>
        <input className="ti" value={form.notes || ''} onChange={F('notes')} /></div>
      <div className="row">
        <button className="btn sm" disabled={busy || !form.full_name.trim()}>{busy ? 'Saving...' : 'Save contact'}</button>
        <button type="button" className="btn sm gh" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- Timeline ---------- */

function Timeline({ interactions, tasks, contacts }) {
  if (interactions === null) return <div className="pr-none">Loading...</div>;
  if (!interactions.length && !tasks.length) return <div className="pr-none">Nothing yet. Log the first touch.</div>;

  const contactName = (id) => contacts.find(c => c.id === id)?.full_name;

  return (
    <div className="pr-timeline">
      {tasks.map(t => (
        <div key={'task-' + t.id} className="pr-tl k-task">
          <div className="t">Task · {t.title}</div>
          <div className="w">
            {t.due_date ? 'due ' + fmtDate(t.due_date) + ' · ' : ''}open in your Task manager
          </div>
        </div>
      ))}
      {interactions.map(i => {
        const opens = i.metadata?.opens;
        return (
          <div key={i.id} className={`pr-tl k-${i.kind}`}>
            <div className="t">{i.title}</div>
            {i.body && <div className="b">{i.body}</div>}
            <div className="w">
              {timeAgoShort(i.occurred_at)}
              {i.contact_id && contactName(i.contact_id) ? ' · ' + contactName(i.contact_id) : ''}
              {opens ? ` · opened ${opens}x (unreliable signal)` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Log activity modal ---------- */

function LogActivityModal({ prospect, contacts, myProfile, onClose, onLogged, toast }) {
  const [form, setForm] = useState({ kind: 'note', title: '', body: '', contact_id: '', date: todayISO() });
  const [busy, setBusy] = useState(false);
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('interactions').insert({
      client_id: prospect.id,
      contact_id: form.contact_id || null,
      kind: form.kind,
      title: form.title.trim(),
      body: form.body.trim() || null,
      occurred_at: new Date(form.date + 'T12:00:00').toISOString(),
      created_by: myProfile?.id || null,
    });
    setBusy(false);
    if (error) { toast('Log failed: ' + error.message); return; }
    onLogged();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head"><h3>Log activity</h3><button type="button" className="link-btn" onClick={onClose}>Close</button></div>
        <div className="grid2">
          <div className="fld"><label className="lab">Kind</label>
            <select className="sel" value={form.kind} onChange={F('kind')}>
              {LOG_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="fld"><label className="lab">Date</label>
            <input className="ti" type="date" value={form.date} onChange={F('date')} /></div>
        </div>
        <div className="fld"><label className="lab">Title</label>
          <input className="ti" value={form.title} onChange={F('title')} required placeholder="Intro call with the GM" /></div>
        <div className="fld"><label className="lab">Notes (optional)</label>
          <textarea className="ta" style={{ minHeight: 80 }} value={form.body} onChange={F('body')} /></div>
        <div className="fld"><label className="lab">Contact (optional)</label>
          <select className="sel" value={form.contact_id} onChange={F('contact_id')}>
            <option value="">No specific contact</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select></div>
        <div className="modal-foot">
          <button type="button" className="btn gh sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !form.title.trim()}>{busy ? 'Logging...' : 'Log activity'}</button>
        </div>
      </form>
    </div>
  );
}
