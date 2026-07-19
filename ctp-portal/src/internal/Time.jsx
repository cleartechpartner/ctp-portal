import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchStaff } from '../lib/tasks';
import Timesheet from './Timesheet';
import TimeReports from './TimeReports';
import TimeSummary from './TimeSummary';
import TimeClients from './TimeClients';

export default function Time() {
  const location = useLocation();
  const tab = location.hash === '#reports' ? 'reports'
    : location.hash === '#summary' ? 'summary'
    : location.hash === '#clients' ? 'clients'
    : 'timesheet';

  const [projects, setProjects] = useState(null);
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tasks, setTasks] = useState([]);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase.from('time_categories').select('*').order('position');
    setCategories(data || []);
  }, []);

  const load = useCallback(async () => {
    const [{ data: ps }, { data: cs }, { data: ts }] = await Promise.all([
      supabase.from('projects')
        .select('id, title, type, status, client_id, time_cap_hours, time_cap_budget, clients(id, name, status, hourly_rate, time_cap_type, time_cap_value)')
        .order('title'),
      supabase.from('clients')
        .select('id, name, status, client_status, hourly_rate, currency, time_cap_type, time_cap_value')
        .order('name'),
      supabase.from('tasks').select('id, title, client_id, status').order('created_at', { ascending: false })
    ]);
    setProjects(ps || []);
    setClients(cs || []);
    setTasks(ts || []);
    let st = [];
    try { st = await fetchStaff(); } catch { st = []; }
    setStaff(st);
    await loadCategories();
  }, [loadCategories]);
  useEffect(() => { load(); }, [load]);

  if (!projects) return <div className="center"><div className="sp" /></div>;

  const activeClients = clients.filter(c => c.status !== 'archived');
  const activeCategories = categories.filter(c => !c.archived);

  const tabs = [
    { id: 'timesheet', href: '/time', label: 'Timesheet' },
    { id: 'reports', href: '/time#reports', label: 'Detailed report' },
    { id: 'summary', href: '/time#summary', label: 'Summary' },
    { id: 'clients', href: '/time#clients', label: 'Settings & budget' }
  ];

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Time</h1>
          <p className="sub">Track your hours against a client and a category.</p>
        </div>
      </div>

      <div className="tt-tabs no-print">
        {tabs.map(x => (
          <a key={x.id} href={x.href} className={'tt-tab' + (tab === x.id ? ' on' : '')}>{x.label}</a>
        ))}
      </div>

      {tab === 'timesheet' && <Timesheet clients={activeClients} categories={activeCategories} tasks={tasks} />}
      {tab === 'reports' && <TimeReports clients={clients} categories={categories} staff={staff} tasks={tasks} />}
      {tab === 'summary' && <TimeSummary clients={clients} categories={categories} staff={staff} />}
      {tab === 'clients' && (
        <TimeClients
          projects={projects}
          clients={clients.filter(c => c.client_status !== 'prospect')}
          categories={categories}
          onChanged={load} onCategoriesChanged={loadCategories}
        />
      )}
    </div>
  );
}
