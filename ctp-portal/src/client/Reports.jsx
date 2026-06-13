import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { monthLabel } from '../lib/api';

export default function Reports({ profile }) {
  const { t, lang } = useLang();
  const [reports, setReports] = useState(null);
  const [view, setView] = useState({}); // per-report language override

  useEffect(() => {
    supabase.from('reports').select('*').eq('client_id', profile.client_id).eq('status', 'published')
      .order('month', { ascending: false }).then(({ data }) => setReports(data || []));
  }, [profile.client_id]);

  if (!reports) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h">
        <span className="eyebrow">Clear Tech Partner</span>
        <h1>{t('reportsTitle')}</h1>
        <p>{t('reportsSub')}</p>
      </div>
      {reports.length === 0 && <div className="card"><div className="empty">{t('noReportsYet')}</div></div>}
      {reports.map(r => {
        const v = view[r.id] || lang;
        const hasBoth = r.body_en && r.body_es;
        const title = v === 'es' ? (r.title_es || r.title_en) : (r.title_en || r.title_es);
        const body = v === 'es' ? (r.body_es || r.body_en) : (r.body_en || r.body_es);
        return (
          <div key={r.id} className="card spine mt">
            <div className="spread">
              <div>
                <span className="eyebrow">{monthLabel(r.month, v)}</span>
                <h3 className="mt" style={{ fontSize: '1.15rem' }}>{title}</h3>
              </div>
              {hasBoth && (
                <div className="lang-toggle">
                  <button className={v === 'en' ? 'on' : ''} onClick={() => setView(x => ({ ...x, [r.id]: 'en' }))}>EN</button>
                  <button className={v === 'es' ? 'on' : ''} onClick={() => setView(x => ({ ...x, [r.id]: 'es' }))}>ES</button>
                </div>
              )}
            </div>
            <div className="prose mt">{body}</div>
          </div>
        );
      })}
    </div>
  );
}
