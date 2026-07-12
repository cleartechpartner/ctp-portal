import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ENVELOPE_STATUS, getEnvelopePdf, logEnvelopeEvent, downloadBlob, safeFileName, fmtDateTime } from '../lib/esign';

const SIGNER_STATUS = {
  pending:   'Waiting',
  sent:      'Link sent',
  viewed:    'Viewed',
  consented: 'Consented',
  signed:    'Signed',
  declined:  'Declined'
};

const EVENT_LABELS = {
  created: 'Envelope created',
  sent: 'Sent for signature',
  viewed: 'Viewed by signer',
  consented: 'Consent to electronic records given',
  signed: 'Signed',
  declined: 'Declined',
  completed: 'Completed and sealed',
  voided: 'Voided',
  archived: 'Sealed copies archived to storage'
};

export default function SignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [env, setEnv] = useState(null);
  const [events, setEvents] = useState([]);
  const [client, setClient] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const load = async () => {
    setErr('');
    // Explicit column list: the envelope row also carries PDF bytes (bytea),
    // which must never ride along on a detail fetch.
    const { data, error } = await supabase.from('envelopes')
      .select('id, name, language, status, client_id, signing_mode, message, source_path, sealed_path, certificate_path, source_hash, sealed_hash, void_reason, created_at, sent_at, completed_at, voided_at, envelope_signers(*), envelope_fields(id, type, signer_id)')
      .eq('id', id).single();
    if (error) { setErr(error.message); return; }
    setEnv(data);
    const { data: evs } = await supabase.from('envelope_events')
      .select('*').eq('envelope_id', id).order('created_at', { ascending: true }).order('id', { ascending: true });
    setEvents(evs || []);
    if (data.client_id) {
      const { data: c } = await supabase.from('clients').select('id, name').eq('id', data.client_id).single();
      setClient(c || null);
    }
    if (data.status === 'completed' && (!data.sealed_path || !data.certificate_path)) {
      mirrorToStorage(data);
    }
  };
  useEffect(() => { load(); }, [id]);

  // Sealed PDFs are written by the signer path into the envelope row; archive
  // them into the private bucket so downloads use signed expiring URLs.
  const mirrorToStorage = async (envelope) => {
    try {
      const patch = {};
      for (const kind of ['sealed', 'certificate']) {
        const pathKey = kind + '_path';
        if (envelope[pathKey]) continue;
        const bytes = await getEnvelopePdf(envelope.id, kind);
        if (!bytes) continue;
        const path = `${envelope.id}/${kind}.pdf`;
        const { error } = await supabase.storage.from('esign')
          .upload(path, new Blob([bytes], { type: 'application/pdf' }), { upsert: true });
        if (error) throw new Error(error.message);
        patch[pathKey] = path;
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('envelopes').update(patch).eq('id', envelope.id);
        if (error) throw new Error(error.message);
        await logEnvelopeEvent(envelope.id, 'archived', patch);
        setEnv(e => ({ ...e, ...patch }));
      }
    } catch (ex) {
      console.error('Archive to storage failed:', ex.message);
    }
  };

  const download = async (kind) => {
    setBusy(kind); setErr('');
    try {
      const pathKey = kind === 'source' ? 'source_path' : kind + '_path';
      const base = safeFileName(env.name);
      const fname = kind === 'source' ? `${base}.pdf` : kind === 'sealed' ? `${base}_signed.pdf`
        : (env.language === 'es' ? `${base}_certificado.pdf` : `${base}_certificate.pdf`);
      if (env[pathKey]) {
        const { data, error } = await supabase.storage.from('esign').createSignedUrl(env[pathKey], 300);
        if (error) throw new Error(error.message);
        const res = await fetch(data.signedUrl);
        const buf = await res.arrayBuffer();
        if (!res.ok) throw new Error('Download failed');
        downloadBlob(buf, fname);
      } else {
        const bytes = await getEnvelopePdf(env.id, kind);
        if (!bytes) throw new Error('File not available yet');
        downloadBlob(bytes, fname);
      }
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  const doVoid = async () => {
    setBusy('void'); setErr('');
    try {
      const { error } = await supabase.from('envelopes')
        .update({ status: 'voided', void_reason: voidReason.trim() || null, voided_at: new Date().toISOString() })
        .eq('id', env.id);
      if (error) throw new Error(error.message);
      await logEnvelopeEvent(env.id, 'voided', { reason: voidReason.trim() || null });
      setVoiding(false);
      await load();
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  if (!env) return <div className="center"><div className="sp" /></div>;

  const sc = ENVELOPE_STATUS[env.status] || ENVELOPE_STATUS.draft;
  const signers = [...(env.envelope_signers || [])].sort((a, b) => a.sign_order - b.sign_order);
  const canVoid = ['draft', 'sent', 'viewed', 'signed'].includes(env.status);

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>{env.name}</h1>
          <p className="sub">
            <span className={`co-pill ${sc.cls}`}>{sc.label}</span>
            <span className="chip" style={{ marginLeft: 8 }}>{env.language === 'es' ? 'Español' : 'English'}</span>
            {client && <span className="chip" style={{ marginLeft: 8 }}>{client.name}</span>}
            <span className="chip" style={{ marginLeft: 8 }}>{env.signing_mode === 'parallel' ? 'Parallel' : 'Sequential'}</span>
          </p>
        </div>
        <div className="co-actions">
          <button className="btn sm gh" onClick={() => nav('/sign')}>Back</button>
          {canVoid && <button className="btn sm" style={{ background: '#B33A3A' }} onClick={() => setVoiding(true)}>Void</button>}
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}
      {env.status === 'voided' && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #B33A3A' }}>
          Voided {fmtDateTime(env.voided_at)}{env.void_reason ? ` · Reason: ${env.void_reason}` : ''}. The signing links no longer work; the record and audit trail are kept.
        </div>
      )}

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <div className="co-section-label">Signers</div>
          <div className="card" style={{ padding: 0 }}>
            {signers.map((s, i) => (
              <div key={s.id} className="item" style={{ padding: '12px 16px' }}>
                <div className="nm">{i + 1}. {s.name} <span className="meta">{s.email}</span></div>
                <div className="meta">
                  {SIGNER_STATUS[s.status] || s.status}
                  {s.signed_at && ` · signed ${fmtDateTime(s.signed_at)}`}
                  {s.declined_at && ` · declined ${fmtDateTime(s.declined_at)}${s.decline_reason ? ': ' + s.decline_reason : ''}`}
                  {s.ip && ` · IP ${s.ip}`}
                </div>
              </div>
            ))}
          </div>

          <div className="co-section-label" style={{ marginTop: 18 }}>Downloads</div>
          <div className="card">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn sm gh" disabled={busy === 'source'} onClick={() => download('source')}>
                {busy === 'source' ? 'Preparing…' : 'Original PDF'}
              </button>
              <button className="btn sm" disabled={env.status !== 'completed' || busy === 'sealed'} onClick={() => download('sealed')}>
                {busy === 'sealed' ? 'Preparing…' : 'Sealed PDF'}
              </button>
              <button className="btn sm" disabled={env.status !== 'completed' || busy === 'certificate'} onClick={() => download('certificate')}>
                {busy === 'certificate' ? 'Preparing…' : 'Certificate of completion'}
              </button>
            </div>
            <div className="meta" style={{ marginTop: 10 }}>
              {env.source_hash && <div>Source SHA-256: <code className="es-hash">{env.source_hash}</code></div>}
              {env.sealed_hash && <div>Sealed SHA-256: <code className="es-hash">{env.sealed_hash}</code></div>}
            </div>
          </div>
        </div>

        <div>
          <div className="co-section-label">Audit trail</div>
          <div className="card" style={{ padding: 0 }}>
            {events.length === 0 && <div className="empty" style={{ padding: 20 }}>No events yet.</div>}
            {events.map(ev => (
              <div key={ev.id} className="item" style={{ padding: '10px 16px' }}>
                <div className="nm">{EVENT_LABELS[ev.event_type] || ev.event_type.replace(/_/g, ' ')}</div>
                <div className="meta">
                  {fmtDateTime(ev.created_at)}{ev.actor ? ` · ${ev.actor}` : ''}{ev.ip ? ` · ${ev.ip}` : ''}
                </div>
                {ev.metadata?.reason && <div className="meta">Reason: {ev.metadata.reason}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {voiding && (
        <div className="es-modal-backdrop" onClick={() => !busy && setVoiding(false)}>
          <div className="card es-modal" onClick={e => e.stopPropagation()}>
            <h3>Void this envelope?</h3>
            <p className="sub" style={{ marginTop: 8 }}>
              Signing links stop working immediately. The envelope and its audit trail are kept; nothing is deleted.
            </p>
            <div className="fld" style={{ marginTop: 12 }}>
              <label className="lab">Reason (recorded in the audit trail)</label>
              <input className="ti" value={voidReason} onChange={e => setVoidReason(e.target.value)} autoFocus />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn sm gh" onClick={() => setVoiding(false)} disabled={busy === 'void'}>Cancel</button>
              <button className="btn sm" style={{ background: '#B33A3A' }} onClick={doVoid} disabled={busy === 'void'}>
                {busy === 'void' ? 'Voiding…' : 'Void envelope'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
