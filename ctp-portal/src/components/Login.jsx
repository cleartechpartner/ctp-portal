import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { LOGO } from '../lib/logo';

export default function Login({ authError })
  const { t, lang, setLang } = useLang();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
const [err, setErr] = useState(authError || '');  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async (e) => {
    e.preventDefault();
    setErr(''); setOk(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(t('badLogin'));
  };

  const forgot = async () => {
    if (!email.trim()) { setErr(t('email')); return; }
    setErr(''); setBusy(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/welcome` });
    setBusy(false);
    setOk(t('resetSent'));
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <img className="logo" src={LOGO} alt="Clear Tech Partner" />
        <h1>Clear Tech Partner</h1>
        <div className="sub">{t('portalName')}</div>
        {err && <div className="auth-err">{err}</div>}
        {ok && <div className="auth-ok">{ok}</div>}
        <form onSubmit={signIn}>
          <div className="fld">
            <label className="lab" htmlFor="em">{t('email')}</label>
            <input id="em" className="ti" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="pw">{t('password')}</label>
            <input id="pw" className="ti" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} required />
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{t('signIn')}</button>
        </form>
        <div className="row mt" style={{ justifyContent: 'space-between' }}>
          <button className="link-btn" type="button" onClick={forgot}>{t('forgot')}</button>
          <div className="lang-toggle">
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            <button className={lang === 'es' ? 'on' : ''} onClick={() => setLang('es')}>ES</button>
          </div>
        </div>
      </div>
    </div>
  );
}
