import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import Avatar from './Avatar';

// Lightweight account settings panel opened from the gear in the account
// area. Two things only, per spec: change avatar photo, change language.
export default function SettingsPanel({ profile, onClose, onAvatarChange }) {
  const { t, lang, setLang } = useLang();
  const fileRef = useRef(null);

  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const displayProfile = { ...profile, avatar_url: previewUrl || avatarUrl };

  const pickFile = () => fileRef.current?.click();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file.'); return; }
    if (file.size > 4 * 1024 * 1024) { setErr('Image must be under 4MB.'); return; }
    setErr(''); setOk('');
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const savePhoto = async () => {
    if (!pendingFile) return;
    setBusy(true); setErr(''); setOk('');
    try {
      const ext = (pendingFile.name.split('.').pop() || 'png').toLowerCase();
      const path = `${profile.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, pendingFile, { upsert: true, cacheControl: '3600' });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || null;
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id);
      if (error) throw new Error(error.message);
      setAvatarUrl(url);
      setPendingFile(null);
      setPreviewUrl(null);
      setOk('Photo updated.');
      onAvatarChange && onAvatarChange(url);
    } catch (ex) { setErr(ex.message || 'Upload failed.'); }
    setBusy(false);
  };

  const changeLang = async (next) => {
    if (next === lang) return;
    setLang(next);
    setErr(''); setOk('');
    const { error } = await supabase.from('profiles').update({ language: next }).eq('id', profile.id);
    if (error) { setErr(error.message); return; }
    setOk(t('langSaved'));
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('settingsTitle')}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="fld">
          <label className="lab">{t('avatarLabel')}</label>
          <div className="settings-avatar-row">
            <button type="button" className="settings-avatar-btn" onClick={pickFile} title={t('changePhoto')}>
              <Avatar profile={displayProfile} size={64} />
              <span className="settings-avatar-hint">{t('changePhoto')}</span>
            </button>
            <div className="settings-avatar-actions">
              <button className="btn sm gh" onClick={pickFile} disabled={busy}>{t('choosePhoto')}</button>
              {pendingFile && (
                <button className="btn sm" onClick={savePhoto} disabled={busy}>
                  {busy ? '…' : t('savePhoto')}
                </button>
              )}
              <div className="meta" style={{ marginTop: 4 }}>JPG or PNG, under 4MB</div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} style={{ display: 'none' }} />
        </div>

        <div className="fld" style={{ marginBottom: 0 }}>
          <label className="lab">{t('language')}</label>
          <select className="sel" value={lang} onChange={e => changeLang(e.target.value)}>
            <option value="en">{t('english')}</option>
            <option value="es">{t('spanish')}</option>
          </select>
        </div>

        {err && <div className="auth-err" style={{ marginTop: 14 }}>{err}</div>}
        {ok && <div className="auth-ok" style={{ marginTop: 14 }}>{ok}</div>}
      </div>
    </div>
  );
}
