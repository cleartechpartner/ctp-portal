import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { monthLabel, signedUrl } from '../lib/api';

export default function Reports({ profile }) {
  const { t, lang } = useLang();
  const [reports, setReports] = useState(null);
  const [view, setView] = useState({}); // per-report language override

  useEffect(() => {
    supabase.from('reports').select('*').eq('client_id', profile.client_id).eq('status', 'published')
      .order('month', { ascending: false }).then(({ data }) => setReports(data || []));
  }, [profile.client_id]);

  const openAttachment = async (path) => {
    try { window.open(await signedUrl(path), '_blank'); }
    catch (e) { alert('Could not open file: ' + e.message); }
  };

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
            {r.attachment_path && r.attachment_name && (
              <div className="report-attach mt2" onClick={() => openAttachment(r.attachment_path)}>
                <div className="report-attach-icon">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M12 2H5a1 1 0 00-1 1v14a1 1 0 001 1h10a1 1 0 001-1V6l-4-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                    <path d="M12 2v4h4M7 11h6M7 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="report-attach-body">
                  <div className="report-attach-name">{r.attachment_name}</div>
                  <div className="report-attach-meta">{v === 'es' ? 'Pulsa para abrir o descargar' : 'Click to open or download'}</div>
                </div>
                <div className="report-attach-action">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1v10m0 0L4 7m4 4l4-4M2 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
