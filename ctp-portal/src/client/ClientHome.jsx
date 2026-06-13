import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { monthLabel } from '../lib/api';

export default function ClientHome({ profile }) {
  const { t, lang } = useLang();
  const [client, setClient] = useState(null);
  const [report, setReport] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    if (!profile.client_id) return;
    supabase.from('clients').select('*').eq('id', profile.client_id).single().then(({ data }) => setClient(data));
    supabase.from('reports').select('*').eq('client_id', profile.client_id).eq('status', 'published')
      .order('month', { ascending: false }).limit(1).then(({ data }) => setReport(data?.[0] || null));
    supabase.from('updates').select('*').eq('client_id', profile.client_id)
      .order('date', { ascending: false }).limit(4).then(({ data }) => setUpdates(data || []));
    supabase.from('projects').select('*').eq('client_id', profile.client_id)
      .order('created_at').then(({ data }) => setProjects(data || []));
  }, [profile.client_id]);

  const h = new Date().getHours();
  const greet = h < 12 ? t('goodMorning') : h < 19 ? t('goodAfternoon') : t('goodEvening');
  const name = (profile.full_name || '').split(' ')[0];

  return (
    <div className="page">
      <div className="page-h">
        <span className="eyebrow">{client?.name || ''}</span>
        <h1>{greet}{name ? `, ${name}` : ''}</h1>
        <p>{t('homeSub')}</p>
      </div>

      <div className="card spine">
        <div className="spread">
          <h3>{t('latestReport')}</h3>
          {report && <span className="chip published">{t('published')}</span>}
        </div>
        {!report && <div className="empty">{t('noReportsYet')}</div>}
        {report && (
          <>
            <div className="sub">{monthLabel(report.month, lang)}</div>
            <div className="mt" style={{ fontWeight: 600 }}>
              {lang === 'es' ? (report.title_es || report.title_en) : (report.title_en || report.title_es)}
            </div>
            <Link to="/reports" className="btn sm" style={{ display: 'inline-block', marginTop: 14, textDecoration: 'none' }}>{t('readReport')}</Link>
          </>
        )}
      </div>

      <div className="card mt2">
        <div className="spread">
          <h3>{t('recentUpdates')}</h3>
          <Link to="/updates" className="link-btn">{t('viewAll')}</Link>
        </div>
        {updates.length === 0 && <div className="empty">{t('noUpdatesYet')}</div>}
        {updates.map(u => (
          <div key={u.id} className="item">
            <div>
              <span className="chip">{t('cat_' + u.category)}</span>
              <div className="mt" style={{ fontSize: '.92rem' }}>{lang === 'es' ? (u.body_es || u.body_en) : u.body_en}</div>
            </div>
            <div className="meta">{new Date(u.date).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' })}</div>
          </div>
        ))}
      </div>

      {projects.length > 0 && (
        <div className="mt3">
          <span className="eyebrow">{t('yourProjects')}</span>
          <div className="grid3 mt">
            {projects.map(p => (
              <div key={p.id} className="card">
                <div className="spread">
                  <h3 style={{ fontSize: '.96rem' }}>{p.title}</h3>
                  <span className={`chip ${p.status}`}>{t('proj_' + p.status)}</span>
                </div>
                {p.description && <div className="sub mt">{p.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
