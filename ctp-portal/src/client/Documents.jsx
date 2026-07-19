import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { signedUrl, fmtBytes, notify } from '../lib/api';
import { isProposalDoc, openProposalDoc } from '../lib/proposals';

export default function Documents({ profile }) {
  const { t, lang } = useLang();
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => supabase.from('documents').select('*').eq('client_id', profile.client_id)
    .order('created_at', { ascending: false }).then(({ data }) => setDocs(data || []));
  useEffect(() => { load(); }, [profile.client_id]);

  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setMsg('');
    try {
      const path = `${profile.client_id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('client-docs').upload(path, file);
      if (upErr) throw new Error(upErr.message);
      const { error: rowErr } = await supabase.from('documents').insert({
        client_id: profile.client_id, name: file.name, category: 'general',
        storage_path: path, size_bytes: file.size, uploaded_by: 'client'
      });
      if (rowErr) throw new Error(rowErr.message);
      notify('client_uploaded', { name: file.name }).catch(() => {});
      setMsg(t('uploaded') + ' ✓');
      load();
    } catch (err) { setMsg(err.message); }
    setBusy(false);
    e.target.value = '';
  };

  const open = async (d) => {
    try {
      if (isProposalDoc(d)) { await openProposalDoc(d); return; }
      window.open(await signedUrl(d.storage_path), '_blank');
    } catch {}
  };

  if (!docs) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h">
        <span className="eyebrow">Clear Tech Partner</span>
        <h1>{t('documentsTitle')}</h1>
        <p>{t('documentsSub')}</p>
      </div>
      <div className="card">
        <div className="row">
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            {busy ? t('uploading') : t('upload')}
            <input type="file" hidden onChange={upload} disabled={busy} />
          </label>
          {msg && <span className="sub">{msg}</span>}
        </div>
        <div className="mt2">
          {docs.length === 0 && <div className="empty">{t('noDocs')}</div>}
          {docs.map(d => (
            <div key={d.id} className="item">
              <div>
                <div className="nm">{d.name}</div>
                <div className="meta">
                  {t('docCat_' + d.category)} · {fmtBytes(d.size_bytes)} · {d.uploaded_by === 'client' ? t('sharedByYou') : t('sharedByCTP')} · {new Date(d.created_at).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB')}
                </div>
              </div>
              <button className="btn sm gh" onClick={() => open(d)}>{t('download')}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
