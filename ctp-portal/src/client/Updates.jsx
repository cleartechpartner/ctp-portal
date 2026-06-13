import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';

export default function Updates({ profile }) {
  const { t, lang } = useLang();
  const [items, setItems] = useState(null);

  useEffect(() => {
    supabase.from('updates').select('*').eq('client_id', profile.client_id)
      .order('date', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data }) => setItems(data || []));
  }, [profile.client_id]);

  if (!items) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h">
        <span className="eyebrow">Clear Tech Partner</span>
        <h1>{t('updatesTitle')}</h1>
        <p>{t('updatesSub')}</p>
      </div>
      <div className="card">
        {items.length === 0 && <div className="empty">{t('noUpdatesYet')}</div>}
        {items.map(u => (
          <div key={u.id} className="item">
            <div style={{ flex: 1 }}>
              <div className="row">
                <span className="chip">{t('cat_' + u.category)}</span>
                <span className="meta">{new Date(u.date).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
              <div className="mt" style={{ fontSize: '.94rem' }}>{lang === 'es' ? (u.body_es || u.body_en) : u.body_en}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
