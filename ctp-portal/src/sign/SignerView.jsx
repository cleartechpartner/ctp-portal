import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { loadPdf, renderPageToCanvas, signerLoad, signerApi } from '../lib/esign';

const STRINGS = {
  en: {
    docFor: 'Document for signature',
    invitedBy: 'Sent by Clear Tech Partner',
    consentTitle: 'Before you begin',
    consentAgree: 'I agree and consent to sign electronically',
    consentDecline: 'Decline to sign',
    reviewTitle: 'Review and complete the fields',
    progress: (done, total) => `${done} of ${total} fields complete`,
    start: 'Start',
    next: 'Next field',
    finish: 'Finish signing',
    finishing: 'Sealing the document…',
    adoptTitle: 'Adopt your signature',
    adoptIntro: 'Draw or type your signature. It will be applied to the signature fields in this document.',
    draw: 'Draw',
    type: 'Type',
    typedPlaceholder: 'Type your full name',
    clear: 'Clear',
    adopt: 'Adopt and continue',
    initialsLabel: 'Your initials',
    signHere: 'Sign',
    initialsHere: 'Initials',
    dateHere: 'Date',
    checkHere: 'Check',
    textHere: 'Text',
    optional: 'optional',
    declineTitle: 'Decline to sign',
    declineIntro: 'If you decline, the sender will be notified. You can tell them why below.',
    declineReason: 'Reason (optional)',
    declineConfirm: 'Decline',
    cancel: 'Cancel',
    doneTitle: 'Thank you. Your signature has been recorded.',
    doneAllSigned: 'The completed document and its certificate have been emailed to you.',
    donePending: 'You will receive the final document by email once every signer has finished.',
    declinedTitle: 'You have declined to sign this document.',
    declinedBody: 'The sender has been notified. You can close this window.',
    completedTitle: 'This document is already completed.',
    completedBody: 'Check your inbox for the sealed document and its certificate.',
    closedTitle: 'This document is no longer available for signing.',
    closedBody: 'Contact the sender if you think this is a mistake.',
    waitTitle: 'It is not your turn to sign yet.',
    waitBody: 'You will receive an email when the previous signer has finished. You can close this window.',
    errorTitle: 'This signing link is not valid.',
    errorBody: 'The link may have expired or been used already. Contact the sender for a new one.',
    sealNote: 'This document is protected with an audit trail. Date, time, IP address and browser details of each action are recorded.',
    langName: 'English'
  },
  es: {
    docFor: 'Documento para firmar',
    invitedBy: 'Enviado por Clear Tech Partner',
    consentTitle: 'Antes de empezar',
    consentAgree: 'Acepto y consiento firmar electrónicamente',
    consentDecline: 'Rechazar la firma',
    reviewTitle: 'Revise y complete los campos',
    progress: (done, total) => `${done} de ${total} campos completados`,
    start: 'Empezar',
    next: 'Siguiente campo',
    finish: 'Terminar la firma',
    finishing: 'Sellando el documento…',
    adoptTitle: 'Adopte su firma',
    adoptIntro: 'Dibuje o escriba su firma. Se aplicará a los campos de firma de este documento.',
    draw: 'Dibujar',
    type: 'Escribir',
    typedPlaceholder: 'Escriba su nombre completo',
    clear: 'Borrar',
    adopt: 'Adoptar y continuar',
    initialsLabel: 'Sus iniciales',
    signHere: 'Firmar',
    initialsHere: 'Iniciales',
    dateHere: 'Fecha',
    checkHere: 'Marcar',
    textHere: 'Texto',
    optional: 'opcional',
    declineTitle: 'Rechazar la firma',
    declineIntro: 'Si rechaza, avisaremos al remitente. Puede indicar el motivo abajo.',
    declineReason: 'Motivo (opcional)',
    declineConfirm: 'Rechazar',
    cancel: 'Cancelar',
    doneTitle: 'Gracias. Su firma ha quedado registrada.',
    doneAllSigned: 'Le hemos enviado por correo el documento completado y su certificado.',
    donePending: 'Recibirá el documento final por correo cuando todos los firmantes hayan terminado.',
    declinedTitle: 'Ha rechazado firmar este documento.',
    declinedBody: 'Hemos avisado al remitente. Ya puede cerrar esta ventana.',
    completedTitle: 'Este documento ya está completado.',
    completedBody: 'Revise su correo: allí tiene el documento sellado y su certificado.',
    closedTitle: 'Este documento ya no está disponible para firmar.',
    closedBody: 'Contacte con el remitente si cree que es un error.',
    waitTitle: 'Todavía no es su turno de firmar.',
    waitBody: 'Recibirá un correo cuando el firmante anterior haya terminado. Puede cerrar esta ventana.',
    errorTitle: 'Este enlace de firma no es válido.',
    errorBody: 'Puede que haya caducado o que ya se haya utilizado. Pida al remitente uno nuevo.',
    sealNote: 'Este documento está protegido con un registro de auditoría. Se registran la fecha, la hora, la dirección IP y los datos del navegador de cada acción.',
    langName: 'Español'
  }
};

const SIG_FONT = '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive';

function fieldPrompt(t, f) {
  if (f.type === 'signature') return t.signHere;
  if (f.type === 'initials') return t.initialsHere;
  if (f.type === 'date') return t.dateHere;
  if (f.type === 'checkbox') return f.label || t.checkHere;
  return f.label || t.textHere;
}

// ---------- signature adoption modal ----------
// Exported: the proposal signing page (ProposalSignView) reuses it.

export function AdoptModal({ t, signerName, needInitials, onAdopt, onClose }) {
  const [mode, setMode] = useState('draw');
  const [typed, setTyped] = useState(signerName || '');
  const [hasInk, setHasInk] = useState(false);
  const [hasInitialInk, setHasInitialInk] = useState(false);
  const sigCanvas = useRef(null);
  const iniCanvas = useRef(null);
  const drawing = useRef(null);

  useEffect(() => {
    [sigCanvas, iniCanvas].forEach(ref => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1a2233';
    });
  }, [mode]);

  const pos = (c, e) => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
  };
  const down = (ref, setInk) => (e) => {
    e.preventDefault();
    const c = ref.current;
    c.setPointerCapture(e.pointerId);
    drawing.current = { ref, last: pos(c, e) };
    setInk(true);
  };
  const move = (ref) => (e) => {
    const d = drawing.current;
    if (!d || d.ref !== ref) return;
    const c = ref.current;
    const p = pos(c, e);
    const ctx = c.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(d.last[0], d.last[1]);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    d.last = p;
  };
  const up = () => { drawing.current = null; };
  const clear = (ref, setInk) => {
    const c = ref.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setInk(false);
  };

  const typedToPng = (text, w, h, size) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a2233';
    ctx.font = `${size}px ${SIG_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let s = size;
    while (ctx.measureText(text).width > w - 24 && s > 14) {
      s -= 2;
      ctx.font = `${s}px ${SIG_FONT}`;
    }
    ctx.fillText(text, w / 2, h / 2);
    return c.toDataURL('image/png');
  };

  const initialsOf = (nm) => nm.trim().split(/\s+/).map(p => p[0] || '').join('').toUpperCase().slice(0, 4);

  const adopt = () => {
    if (mode === 'typed') {
      if (!typed.trim()) return;
      onAdopt({
        kind: 'typed',
        signature: typedToPng(typed.trim(), 600, 160, 52),
        initials: typedToPng(initialsOf(typed), 240, 160, 64)
      });
    } else {
      if (!hasInk) return;
      onAdopt({
        kind: 'drawn',
        signature: sigCanvas.current.toDataURL('image/png'),
        initials: needInitials && hasInitialInk ? iniCanvas.current.toDataURL('image/png') : sigCanvas.current.toDataURL('image/png')
      });
    }
  };

  const canAdopt = mode === 'typed' ? !!typed.trim() : (hasInk && (!needInitials || hasInitialInk));

  return (
    <div className="es-modal-backdrop" onClick={onClose}>
      <div className="card es-modal" onClick={e => e.stopPropagation()}>
        <h3>{t.adoptTitle}</h3>
        <p className="sub" style={{ marginTop: 6 }}>{t.adoptIntro}</p>
        <div className="es-tabs" style={{ marginTop: 10 }}>
          <button className={'es-tab' + (mode === 'draw' ? ' on' : '')} onClick={() => setMode('draw')}>{t.draw}</button>
          <button className={'es-tab' + (mode === 'typed' ? ' on' : '')} onClick={() => setMode('typed')}>{t.type}</button>
        </div>

        {mode === 'draw' && (
          <>
            <canvas
              ref={sigCanvas} width={600} height={160} className="es-sig-canvas"
              onPointerDown={down(sigCanvas, setHasInk)} onPointerMove={move(sigCanvas)} onPointerUp={up}
            />
            <button className="link-btn" onClick={() => clear(sigCanvas, setHasInk)}>{t.clear}</button>
            {needInitials && (
              <>
                <div className="lab" style={{ marginTop: 10 }}>{t.initialsLabel}</div>
                <canvas
                  ref={iniCanvas} width={240} height={160} className="es-sig-canvas sm"
                  onPointerDown={down(iniCanvas, setHasInitialInk)} onPointerMove={move(iniCanvas)} onPointerUp={up}
                />
                <button className="link-btn" onClick={() => clear(iniCanvas, setHasInitialInk)}>{t.clear}</button>
              </>
            )}
          </>
        )}

        {mode === 'typed' && (
          <>
            <input className="ti" style={{ marginTop: 12 }} value={typed} placeholder={t.typedPlaceholder}
              onChange={e => setTyped(e.target.value)} autoFocus />
            <div className="es-sig-preview" style={{ fontFamily: SIG_FONT }}>{typed.trim() || ' '}</div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn sm gh" onClick={onClose}>{t.cancel}</button>
          <button className="btn" disabled={!canAdopt} onClick={adopt}>{t.adopt}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- page renderer ----------

function SignerPage({ pdfDoc, pageNum, width, children }) {
  const canvasRef = useRef(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    let alive = true;
    if (pdfDoc && canvasRef.current) {
      renderPageToCanvas(pdfDoc, pageNum, canvasRef.current, width).then(({ height }) => { if (alive) setH(height); });
    }
    return () => { alive = false; };
  }, [pdfDoc, pageNum, width]);
  return (
    <div className="es-page" style={{ width, height: h || undefined }} data-page={pageNum}>
      <canvas ref={canvasRef} />
      {children}
    </div>
  );
}

// ---------- main view ----------

export default function SignerView() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [screen, setScreen] = useState('loading'); // loading | error | closed | wait | completed | consent | fields | done | declined
  const [values, setValues] = useState({});
  const [sig, setSig] = useState(null); // { kind, signature, initials }
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [pendingSigField, setPendingSigField] = useState(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [allSigned, setAllSigned] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const width = Math.min(760, (typeof window !== 'undefined' ? window.innerWidth : 800) - 24);
  const lang = data?.envelope?.language === 'es' ? 'es' : 'en';
  const t = STRINGS[lang];

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await signerLoad(token);
        if (!alive) return;
        setData(d);
        const env = d.envelope;
        const me = d.signer;
        if (env.status === 'completed' || me.status === 'signed') { setScreen(env.status === 'completed' ? 'completed' : 'done'); setAllSigned(env.status === 'completed'); return; }
        if (env.status === 'declined' && me.status === 'declined') { setScreen('declined'); return; }
        if (!['sent', 'viewed', 'signed'].includes(env.status)) { setScreen('closed'); return; }
        if (!d.my_turn) { setScreen('wait'); return; }
        if (d.source_pdf) {
          const bin = atob(d.source_pdf.replace(/\n/g, ''));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const doc = await loadPdf(bytes);
          if (!alive) return;
          setPdfDoc(doc);
        }
        // Prefill date fields with today, seed any values already present.
        const seed = {};
        for (const f of d.fields) {
          if (!f.mine) continue;
          if (f.value) seed[f.id] = f.value;
          else if (f.type === 'date') {
            seed[f.id] = new Date().toLocaleDateString(env.language === 'es' ? 'es-ES' : 'en-GB');
          }
        }
        setValues(seed);
        setScreen(me.consented_at ? 'fields' : 'consent');
        // Record the view with server-side IP capture; failure is non-fatal.
        signerApi('viewed', { token }).catch(() => {});
      } catch (ex) {
        if (alive) { setScreen('error'); setErr(ex.message); }
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const myFields = useMemo(() => (data?.fields || []).filter(f => f.mine), [data]);
  const otherFields = useMemo(() => (data?.fields || []).filter(f => !f.mine), [data]);

  const isComplete = (f) => {
    const v = values[f.id];
    if (f.type === 'signature' || f.type === 'initials') return !!sig;
    if (f.type === 'checkbox') return v === 'true' || !f.required;
    return !!(v && String(v).trim());
  };
  const requiredMine = myFields.filter(f => f.required);
  const doneCount = requiredMine.filter(isComplete).length;
  const canFinish = doneCount === requiredMine.length && !!sig;

  const scrollToNext = () => {
    const nxt = requiredMine.find(f => !isComplete(f));
    if (!nxt) return;
    const el = document.querySelector(`[data-field="${nxt.id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const consent = async () => {
    setBusy(true); setErr('');
    try {
      await signerApi('consented', { token });
      setScreen('fields');
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const decline = async () => {
    setBusy(true); setErr('');
    try {
      await signerApi('decline', { token, reason: declineReason.trim() });
      setDeclineOpen(false);
      setScreen('declined');
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const clickField = (f) => {
    if (f.type === 'signature' || f.type === 'initials') {
      if (!sig) { setPendingSigField(f.id); setAdoptOpen(true); }
      return;
    }
    if (f.type === 'checkbox') {
      setValues(v => ({ ...v, [f.id]: v[f.id] === 'true' ? 'false' : 'true' }));
    }
  };

  const finish = async () => {
    setBusy(true); setErr('');
    try {
      const payload = {};
      for (const f of myFields) {
        if (f.type === 'signature') payload[f.id] = 'signed';
        else if (f.type === 'initials') payload[f.id] = sig.initials;
        else payload[f.id] = values[f.id] || '';
      }
      const res = await signerApi('finish', {
        token, values: payload, signature_data: sig.signature, signature_kind: sig.kind
      });
      setAllSigned(!!res.all_signed);
      setScreen('done');
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  // ---------- render helpers ----------

  const header = data && (
    <div className="es-signer-head">
      <div className="es-signer-brand">CLEAR TECH PARTNER</div>
      <div className="es-signer-title">{data.envelope.name}</div>
      <div className="es-signer-sub">{t.docFor} · {data.signer.name} · {t.invitedBy}</div>
      {data.envelope.message && screen !== 'done' && screen !== 'declined' && (
        <div className="es-signer-msg">{data.envelope.message}</div>
      )}
    </div>
  );

  const notice = (title, body) => (
    <div className="es-signer-wrap">
      {header}
      <div className="card es-signer-card">
        <h3>{title}</h3>
        <p className="sub" style={{ marginTop: 8 }}>{body}</p>
      </div>
    </div>
  );

  if (screen === 'loading') return <div className="center"><div className="sp" /></div>;
  if (screen === 'error') return notice(STRINGS.en.errorTitle, STRINGS.en.errorBody + (err ? ` (${err})` : ''));
  if (screen === 'closed') return notice(t.closedTitle, t.closedBody);
  if (screen === 'wait') return notice(t.waitTitle, t.waitBody);
  if (screen === 'completed') return notice(t.completedTitle, t.completedBody);
  if (screen === 'declined') return notice(t.declinedTitle, t.declinedBody);
  if (screen === 'done') return notice(t.doneTitle, allSigned ? t.doneAllSigned : t.donePending);

  if (screen === 'consent') {
    return (
      <div className="es-signer-wrap">
        {header}
        <div className="card es-signer-card">
          <h3>{t.consentTitle}</h3>
          {err && <div className="auth-err" style={{ marginTop: 10 }}>{err}</div>}
          <div className="es-disclosure">{data.disclosure?.text}</div>
          <label className="es-check" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)} />
            {t.consentAgree}
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!consentChecked || busy} onClick={consent}>
              {busy ? '…' : t.consentAgree}
            </button>
            <button className="btn sm gh" disabled={busy} onClick={() => setDeclineOpen(true)}>{t.consentDecline}</button>
          </div>
        </div>
        {declineOpen && declineModal()}
      </div>
    );
  }

  // screen === 'fields'
  function declineModal() {
    return (
      <div className="es-modal-backdrop" onClick={() => !busy && setDeclineOpen(false)}>
        <div className="card es-modal" onClick={e => e.stopPropagation()}>
          <h3>{t.declineTitle}</h3>
          <p className="sub" style={{ marginTop: 6 }}>{t.declineIntro}</p>
          <div className="fld" style={{ marginTop: 10 }}>
            <label className="lab">{t.declineReason}</label>
            <input className="ti" value={declineReason} onChange={e => setDeclineReason(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn sm gh" onClick={() => setDeclineOpen(false)} disabled={busy}>{t.cancel}</button>
            <button className="btn sm" style={{ background: '#B33A3A' }} onClick={decline} disabled={busy}>{t.declineConfirm}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="es-signer-wrap">
      {header}
      <div className="es-signer-bar card">
        <div>
          <b>{t.reviewTitle}</b>
          <div className="meta">{t.progress(doneCount, requiredMine.length)}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm gh" onClick={scrollToNext}>{doneCount === 0 ? t.start : t.next}</button>
          <button className="btn sm gh" onClick={() => setDeclineOpen(true)}>{t.consentDecline}</button>
          <button className="btn" disabled={!canFinish || busy} onClick={finish}>
            {busy ? t.finishing : t.finish}
          </button>
        </div>
      </div>
      {err && <div className="auth-err" style={{ margin: '10px auto', maxWidth: width }}>{err}</div>}

      <div className="es-pages" style={{ margin: '0 auto' }}>
        {pdfDoc && Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1).map(pn => (
          <SignerPage key={pn} pdfDoc={pdfDoc} pageNum={pn} width={width}>
            {otherFields.filter(f => f.page === pn && f.value).map(f => (
              <div key={f.id} className="es-field-flat" style={{
                left: (f.x * 100) + '%', top: (f.y * 100) + '%',
                width: (f.w * 100) + '%', height: (f.h * 100) + '%'
              }}>
                {(f.type === 'signature' || f.type === 'initials')
                  ? (() => {
                      const s = (data.signers || []).find(x => x.id === f.signer_id);
                      const src = f.type === 'initials' && f.value?.startsWith('data:image') ? f.value : s?.signature_data;
                      return src ? <img src={src} alt="" /> : null;
                    })()
                  : f.type === 'checkbox' ? (f.value === 'true' ? 'X' : '') : f.value}
              </div>
            ))}
            {myFields.filter(f => f.page === pn).map(f => {
              const complete = isComplete(f);
              return (
                <div key={f.id} data-field={f.id}
                  className={'es-field-live' + (complete ? ' done' : '') + (f.required ? '' : ' opt')}
                  style={{
                    left: (f.x * 100) + '%', top: (f.y * 100) + '%',
                    width: (f.w * 100) + '%', height: (f.h * 100) + '%'
                  }}
                  onClick={() => clickField(f)}
                >
                  {(f.type === 'signature') && (sig
                    ? <img src={sig.signature} alt="" />
                    : <span className="es-field-cta">{fieldPrompt(t, f)}</span>)}
                  {(f.type === 'initials') && (sig
                    ? <img src={sig.initials} alt="" />
                    : <span className="es-field-cta">{fieldPrompt(t, f)}</span>)}
                  {(f.type === 'date' || f.type === 'text') && (
                    <input
                      className="es-field-input"
                      value={values[f.id] || ''}
                      placeholder={fieldPrompt(t, f) + (f.required ? '' : ` (${t.optional})`)}
                      onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))}
                    />
                  )}
                  {(f.type === 'checkbox') && (
                    <span className="es-field-checkbox">{values[f.id] === 'true' ? 'X' : ''}</span>
                  )}
                </div>
              );
            })}
          </SignerPage>
        ))}
      </div>

      <div className="es-signer-foot">{t.sealNote}</div>

      {adoptOpen && (
        <AdoptModal
          t={t}
          signerName={data.signer.name}
          needInitials={myFields.some(f => f.type === 'initials')}
          onClose={() => setAdoptOpen(false)}
          onAdopt={(s) => {
            setSig(s);
            setAdoptOpen(false);
            if (pendingSigField) setPendingSigField(null);
          }}
        />
      )}
      {declineOpen && declineModal()}
    </div>
  );
}
