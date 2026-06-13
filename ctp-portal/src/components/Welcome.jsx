import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { LOGO } from '../lib/logo';

export default function Welcome({ onDone }) {
  const { t } = useLang();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    if (p1.length < 8) { setErr(t('passwordShort')); return; }
    if (p1 !== p2) { setErr(t('passwordMismatch')); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone();
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <img className="logo" src={LOGO} alt="Clear Tech Partner" />
        <h1>{t('welcomeTitle')}</h1>
        <div className="sub">{t('welcomeIntro')}</div>
        {err && <div className="auth-err">{err}</div>}
        <form onSubmit={save}>
          <div className="fld">
            <label className="lab" htmlFor="p1">{t('newPassword')}</label>
            <input id="p1" className="ti" type="password" autoComplete="new-password" value={p1} onChange={e => setP1(e.target.value)} required />
          </div>
          <div className="fld">
            <label className="lab" htmlFor="p2">{t('confirmPassword')}</label>
            <input id="p2" className="ti" type="password" autoComplete="new-password" value={p2} onChange={e => setP2(e.target.value)} required />
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{t('savePassword')}</button>
        </form>
      </div>
    </div>
  );
}
