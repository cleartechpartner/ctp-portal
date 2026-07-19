import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { LOGO } from '../lib/logo';
import Avatar from './Avatar';
import SettingsPanel from './SettingsPanel';

// Dropdown shown only when a profile can access 2+ clients. Selecting one
// updates profiles.client_id (the DB trigger validates the target), then
// reloads so every client-scoped screen refetches under the new scope.
function ClientSwitch({ profile, clientLinks }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!clientLinks || clientLinks.length < 2) return null;
  const options = clientLinks
    .map(l => ({ id: l.client_id, name: l.clients?.name || 'Client' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const switchTo = async (cid) => {
    if (!cid || cid === profile.client_id || busy) return;
    setBusy(true); setErr('');
    const { error } = await supabase.from('profiles').update({ client_id: cid }).eq('id', profile.id);
    if (error) { setErr(error.message); setBusy(false); return; }
    window.location.assign('/');
  };

  return (
    <div className="client-switch">
      <select
        className="client-switch-sel"
        value={profile.client_id || ''}
        disabled={busy}
        onChange={e => switchTo(e.target.value)}
        aria-label="Client"
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {err && <div className="client-switch-err">{err}</div>}
    </div>
  );
}

export default function Shell({ profile, internal, clientLinks, children }) {
  const { t } = useLang();
  const location = useLocation();
  const onStudio = location.pathname.startsWith('/studio');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || null);
  const accountProfile = { ...profile, avatar_url: avatarUrl };

  const nav = internal
    ? [
        { to: '/', label: 'Client Overview', end: true },
        { to: '/studio', label: 'Content Studio', end: true },
        { to: '/sign', label: 'E-Signature' },
        { to: '/proposals', label: 'Proposals' },
        { to: '/prospects', label: 'Prospects' },
        { to: '/tasks', label: 'Tasks' },
        { to: '/time', label: 'Time' }
      ]
    : [
        { to: '/', label: t('navHome'), end: true },
        { to: '/reports', label: t('navReports') },
        { to: '/updates', label: t('navUpdates') },
        { to: '/documents', label: t('navDocuments') },
        { to: '/profile', label: t('navProfile') }
      ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo-row">
          <img src={LOGO} alt="" />
          <div className="wm">Clear Tech<br/>Partner<small>{internal ? 'Internal' : t('portalName')}</small></div>
        </div>
        {!internal && <ClientSwitch profile={profile} clientLinks={clientLinks} />}
        <nav>
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nv' + (isActive ? ' on' : '')}>
              {n.label}
            </NavLink>
          ))}
          {internal && onStudio && (
            <>
              <a href="/studio#library" className={'nv sub-nv' + (location.hash === '#library' ? ' on' : '')}>Library</a>
              <a href="/studio#settings" className={'nv sub-nv' + (location.hash === '#settings' ? ' on' : '')}>Settings</a>
            </>
          )}
        </nav>
        <div className="foot">
          <div className="account-row">
            <Avatar profile={accountProfile} size={34} />
            <div className="who">{profile.full_name || profile.email}</div>
          </div>
          <div className="account-actions">
            <button className="btn sm gh" onClick={() => supabase.auth.signOut()}>{t('signOut')}</button>
            <button
              className="icon-btn gear-btn"
              title={t('settingsTitle')}
              aria-label={t('settingsTitle')}
              onClick={() => setSettingsOpen(true)}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {settingsOpen && (
        <SettingsPanel
          profile={accountProfile}
          onClose={() => setSettingsOpen(false)}
          onAvatarChange={setAvatarUrl}
        />
      )}
      <div className="main">
        <div className="topbar">
          <div className="logo-row"><img src={LOGO} alt="" /><span className="wm">Clear Tech Partner</span></div>
          <div className="row">
            {!internal && <ClientSwitch profile={profile} clientLinks={clientLinks} />}
            <button className="icon-btn" title={t('settingsTitle')} aria-label={t('settingsTitle')} onClick={() => setSettingsOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button className="btn sm gh" onClick={() => supabase.auth.signOut()}>{t('signOut')}</button>
          </div>
        </div>
        <div className="mobnav">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nv' + (isActive ? ' on' : '')}>
              {n.label}
            </NavLink>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
