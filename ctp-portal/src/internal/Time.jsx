import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import TimeToday from './TimeToday';
import TimeWeek from './TimeWeek';
import TimeReports from './TimeReports';
import TimeClients from './TimeClients';

export default function Time() {
  const location = useLocation();
  const tab = location.hash === '#week' ? 'week'
    : location.hash === '#reports' ? 'reports'
    : location.hash === '#clients' ? 'clients'
    : 'today';

  const [projects, setProjects] = useState(null);
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    const [{ data: ps }, { data: cs }] = await Promise.all([
      supabase.from('projects')
        .select('id, title, type, status, client_id, time_cap_hours, time_cap_budget, clients(id, name, status, hourly_rate, time_cap_type, time_cap_value)')
        .order('title'),
      supabase.from('clients')
        .select('id, name, status, hourly_rate, time_cap_type, time_cap_value')
        .order('name')
    ]);
    setProjects(ps || []);
    setClients(cs || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!projects) return <div className="center"><div className="sp" /></div>;

  const tabs = [
    { id: 'today', href: '/time', label: 'Today' },
    { id: 'week', href: '/time#week', label: 'Timesheet' },
    { id: 'reports', href: '/time#reports', label: 'Reports' },
    { id: 'clients', href: '/time#clients', label: 'Clients & caps' }
  ];

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Time</h1>
          <p className="sub">Track hours where the clients already live. Caps warn, they never block.</p>
        </div>
      </div>

      <div className="tt-tabs">
        {tabs.map(x => (
          <a key={x.id} href={x.href} className={'tt-tab' + (tab === x.id ? ' on' : '')}>{x.label}</a>
        ))}
      </div>

      {tab === 'today' && <TimeToday projects={projects} />}
      {tab === 'week' && <TimeWeek projects={projects} />}
      {tab === 'reports' && <TimeReports projects={projects} clients={clients} />}
      {tab === 'clients' && <TimeClients projects={projects} clients={clients} onChanged={load} />}
    </div>
  );
}
