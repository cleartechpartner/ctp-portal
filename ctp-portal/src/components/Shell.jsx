import { NavLink } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { LOGO } from '../lib/logo';

export default function Shell({ profile, internal, children }) {
  const { t } = useLang();
  const nav = internal
    ? [
        { to: '/', label: 'Clients', end: true },
        { to: '/studio', label: 'Content Studio' }
      ]
    : [
        { to: '/', label: t('navHome'), end: true },
        { to: '/reports', label: t('navReports') },
        { to: '/updates', label: t('navUpdates') },
        { to: '/documents', label: t('navDocuments') },
        { to: '/profile', label: t('navProfile') }
      ];

  const links = nav.map(n => (
    <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nv' + (isActive ? ' on' : '')}>
      {n.label}
    </NavLink>
  ));

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo-row">
          <img src={LOGO} alt="" />
          <div className="wm">Clear Tech<br/>Partner<small>{internal ? 'Internal' : t('portalName')}</small></div>
        </div>
        <nav>{links}</nav>
        <div className="foot">
          <div className="who">{profile.full_name || profile.email}</div>
          <button className="btn sm gh" onClick={() => supabase.auth.signOut()}>{t('signOut')}</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="logo-row"><img src={LOGO} alt="" /><span className="wm">Clear Tech Partner</span></div>
          <button className="btn sm gh" onClick={() => supabase.auth.signOut()}>{t('signOut')}</button>
        </div>
        <div className="mobnav">{links}</div>
        {children}
      </div>
    </div>
  );
}
