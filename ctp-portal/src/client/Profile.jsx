import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';

export default function Profile({ profile }) {
  const { t, lang, setLang } = useLang();
  const [client, setClient] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile.client_id) supabase.from('clients').select('*').eq('id', profile.client_id).single().then(({ data }) => setClient(data));
  }, [profile.client_id]);

  const changeLang = async (l) => {
    setLang(l);
    await supabase.from('profiles').update({ language: l }).eq('id', profile.id);
    setSaved(true); setTimeout(() => setSaved(false), 2400);
  };

  return (
    <div className="page">
      <div className="page-h">
        <span className="eyebrow">Clear Tech Partner</span>
        <h1>{t('profileTitle')}</h1>
        <p>{t('profileSub')}</p>
      </div>
      <div className="grid2">
        <div className="card">
          <h3>{client?.name || ''}</h3>
          <div className="mt">
            <div className="item"><span className="sub">{t('property')}</span><span>{client?.property_type || '—'}</span></div>
            <div className="item"><span className="sub">{t('contact')}</span><span>{client?.contact_name || '—'}</span></div>
            <div className="item"><span className="sub">{t('statusLabel')}</span><span className={`chip ${client?.status || ''}`}>{client ? t('status_' + client.status) : ''}</span></div>
          </div>
        </div>
        <div className="card">
          <h3>{t('languagePref')}</h3>
          <div className="row mt">
            <div className="lang-toggle">
              <button className={lang === 'en' ? 'on' : ''} onClick={() => changeLang('en')}>{t('english')}</button>
              <button className={lang === 'es' ? 'on' : ''} onClick={() => changeLang('es')}>{t('spanish')}</button>
            </div>
            {saved && <span className="sub">{t('langSaved')}</span>}
          </div>
          <div className="mt2">
            <h3 style={{ fontSize: '.94rem' }}>{t('needHelp')}</h3>
            <div className="sub mt">{t('helpText')}</div>
            <a href="mailto:client@cleartechpartner.com" className="btn sm gh" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>client@cleartechpartner.com</a>
          </div>
        </div>
      </div>
    </div>
  );
}
