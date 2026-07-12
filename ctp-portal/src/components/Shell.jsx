import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { LOGO } from '../lib/logo';

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

  const nav = internal
    ? [
        { to: '/', label: 'Client Overview', end: true },
        { to: '/studio', label: 'Content Studio', end: true }
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
          <div className="who">{profile.full_name || profile.email}</div>
          <button className="btn sm gh" onClick={() => supabase.auth.signOut()}>{t('signOut')}</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="logo-row"><img src={LOGO} alt="" /><span className="wm">Clear Tech Partner</span></div>
          <div className="row">
            {!internal && <ClientSwitch profile={profile} clientLinks={clientLinks} />}
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
