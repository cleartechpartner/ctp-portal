import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

function initialsOf(name) {
  if (!name) return 'RP';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'RP';
}

export default function Settings() {
  const nav = useNavigate();
  const fileRef = useRef(null);

  const [userId, setUserId] = useState(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const u = userData?.user;
      if (!u) { setLoading(false); return; }
      setUserId(u.id);
      setEmail(u.email || '');

      const { data: prof } = await supabase.from('profiles').select('*').eq('id', u.id).single();
      if (prof) {
        setFullName(prof.full_name || '');
        setAvatarUrl(prof.avatar_url || null);
      }
      setLoading(false);
    })();
  }, []);

  const pickFile = () => fileRef.current?.click();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErr('Please choose an image file.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setErr('Image must be under 4MB.');
      return;
    }
    setErr('');
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const uploadAvatar = async () => {
    if (!pendingFile || !userId) return null;
    setUploading(true);
    setErr('');
    try {
      const ext = pendingFile.name.split('.').pop();
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, pendingFile, { upsert: true, cacheControl: '3600' });
      if (upErr) throw new Error(upErr.message);

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      return pub?.publicUrl || null;
    } catch (ex) {
      setErr(ex.message || 'Upload failed.');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setErr('');
    setSavedMsg('');

    let finalAvatarUrl = avatarUrl;
    if (pendingFile) {
      const uploaded = await uploadAvatar();
      if (!uploaded) { setSaving(false); return; }
      finalAvatarUrl = uploaded;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, avatar_url: finalAvatarUrl })
      .eq('id', userId);

    setSaving(false);
    if (error) { setErr(error.message); return; }

    setAvatarUrl(finalAvatarUrl);
    setPendingFile(null);
    setSavedMsg('Saved.');
    setTimeout(() => setSavedMsg(''), 2500);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    nav('/login');
  };

  if (loading) return <div className="center"><div className="sp" /></div>;

  const displayUrl = previewUrl || avatarUrl;

  return (
    <div className="page" style={{ maxWidth: 480 }}>
      <div className="page-h">
        <span className="eyebrow">Settings</span>
        <h1>Your profile</h1>
      </div>

      <div className="card spine">
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            onClick={pickFile}
            style={{
              width: 72, height: 72, borderRadius: '50%', cursor: 'pointer',
              overflow: 'hidden', flexShrink: 0, position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#f0f0f0'
            }}
            title="Change avatar"
          >
            {displayUrl ? (
              <img src={displayUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{initialsOf(fullName)}</span>
            )}
          </div>
          <div>
            <button className="btn sm" onClick={pickFile} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Change photo'}
            </button>
            <div className="meta" style={{ marginTop: 6 }}>JPG or PNG, under 4MB</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            style={{ display: 'none' }}
          />
        </div>

        <div className="fld" style={{ marginTop: 22 }}>
          <label className="lab">Full name</label>
          <input className="ti" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Rainy Porreca-Donato" />
        </div>

        <div className="fld" style={{ marginTop: 12 }}>
          <label className="lab">Email</label>
          <input className="ti" value={email} disabled style={{ opacity: 0.6 }} />
        </div>

        {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}
        {savedMsg && <div className="sub" style={{ marginTop: 12, color: '#1D9E75' }}>{savedMsg}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn" onClick={save} disabled={saving || uploading}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={() => nav('/')}>
            Back
          </button>
        </div>
      </div>

      <div className="mt3">
        <button className="link-btn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
