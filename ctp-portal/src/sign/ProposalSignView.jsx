import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdoptModal } from './SignerView';
import { proposalNumber, fmtMoney, computeTotals } from '../lib/proposals';

// Public proposal signing page at /sign/:token. No portal login: the token
// is the credential, validated by the proposal-sign Netlify function. The
// proposal renders as HTML mirroring the PDF layout, with the signature
// pad from the e-sign module at the bottom.

const STRINGS = {
  en: {
    invitedBy: 'Sent by Clear Tech Partner',
    proposalFor: (n, c) => `Proposal ${n} prepared for ${c}`,
    preparedFor: 'Prepared for',
    date: 'Date',
    phase: 'Phase',
    description: 'Description',
    price: 'Price',
    subtotal: 'Subtotal',
    tax: 'Tax (VAT/IVA)',
    na: 'N/A',
    totalDue: 'Total due',
    retainer: 'Monthly retainer',
    perMonth: '/month',
    agreement: 'Agreement',
    signCta: 'Sign and Accept',
    signing: 'Sealing the document…',
    yourName: 'Your full name',
    adoptFirst: 'Add your signature',
    changeSig: 'Change signature',
    adoptTitle: 'Adopt your signature',
    adoptIntro: 'Draw or type your signature. It will be applied to this proposal.',
    draw: 'Draw',
    type: 'Type',
    typedPlaceholder: 'Type your full name',
    clear: 'Clear',
    adopt: 'Adopt and continue',
    initialsLabel: 'Your initials',
    cancel: 'Cancel',
    doneTitle: 'Thank you. The proposal has been signed.',
    doneBody: 'A copy of the signed document is on its way to your inbox. We will be in touch shortly.',
    completedTitle: 'This proposal is already signed.',
    completedBody: 'Check your inbox for the signed copy.',
    errorTitle: 'This signing link is not valid.',
    errorBody: 'The link may have expired or been replaced. Contact rainy@cleartechpartner.com for a new one.',
    sealNote: 'This document is protected with an audit trail. Date, time, IP address and browser details of the signature are recorded.',
    footer: 'Clear Tech Partner | www.cleartechpartner.com',
  },
  es: {
    invitedBy: 'Enviado por Clear Tech Partner',
    proposalFor: (n, c) => `Propuesta ${n} preparada para ${c}`,
    preparedFor: 'Preparado para',
    date: 'Fecha',
    phase: 'Fase',
    description: 'Descripción',
    price: 'Precio',
    subtotal: 'Subtotal',
    tax: 'Impuestos (IVA)',
    na: 'N/A',
    totalDue: 'Total',
    retainer: 'Cuota mensual',
    perMonth: '/mes',
    agreement: 'Acuerdo',
    signCta: 'Firmar y aceptar',
    signing: 'Sellando el documento…',
    yourName: 'Su nombre completo',
    adoptFirst: 'Añadir su firma',
    changeSig: 'Cambiar la firma',
    adoptTitle: 'Adopte su firma',
    adoptIntro: 'Dibuje o escriba su firma. Se aplicará a esta propuesta.',
    draw: 'Dibujar',
    type: 'Escribir',
    typedPlaceholder: 'Escriba su nombre completo',
    clear: 'Borrar',
    adopt: 'Adoptar y continuar',
    initialsLabel: 'Sus iniciales',
    cancel: 'Cancelar',
    doneTitle: 'Gracias. La propuesta ha quedado firmada.',
    doneBody: 'Le hemos enviado una copia firmada por correo. Nos pondremos en contacto en breve.',
    completedTitle: 'Esta propuesta ya está firmada.',
    completedBody: 'Revise su correo: allí tiene la copia firmada.',
    errorTitle: 'Este enlace de firma no es válido.',
    errorBody: 'Puede que haya caducado o que se haya sustituido. Escriba a rainy@cleartechpartner.com para recibir uno nuevo.',
    sealNote: 'Este documento está protegido con un registro de auditoría. Se registran la fecha, la hora, la dirección IP y los datos del navegador de la firma.',
    footer: 'Clear Tech Partner | www.cleartechpartner.com',
  },
};

async function signApi(action, payload) {
  const r = await fetch('/api/proposal-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

// The token normally arrives as a prop from the App.jsx public gate (which
// runs before any session handling); useParams is only the fallback. This
// page must never check for or require a portal session.
export default function ProposalSignView({ token: tokenProp }) {
  const { token: tokenParam } = useParams();
  const token = tokenProp || tokenParam;
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState('loading'); // loading | error | completed | review | done
  const [err, setErr] = useState('');
  const [sig, setSig] = useState(null);            // { kind, signature }
  const [signerName, setSignerName] = useState('');
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await signApi('load', { token });
        if (!alive) return;
        setData(d);
        setSignerName(d.client_name || d.proposal?.content?.client_name || '');
        if (d.proposal.status === 'signed' || d.already_signed) { setScreen('completed'); return; }
        setScreen('review');
        // Viewed tracking with server-side IP capture; failure is non-fatal.
        signApi('viewed', { token }).catch(() => {});
      } catch (ex) {
        if (alive) { setScreen('error'); setErr(ex.message); }
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const lang = data?.proposal?.language === 'es' ? 'es' : 'en';
  const t = STRINGS[lang];

  const finish = async () => {
    if (!sig || !signerName.trim() || busy) return;
    setBusy(true); setErr('');
    try {
      await signApi('finish', {
        token,
        signer_name: signerName.trim(),
        signature_data: sig.signature,
        signature_kind: sig.kind,
      });
      setScreen('done');
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const notice = (title, body) => (
    <div className="es-signer-wrap">
      <div className="es-signer-head">
        <div className="es-signer-brand">CLEAR TECH PARTNER</div>
        <div className="es-signer-title">{title}</div>
        <div className="es-signer-sub">{body}</div>
      </div>
    </div>
  );

  if (screen === 'loading') return <div className="center"><div className="sp" /></div>;
  if (screen === 'error') return notice(STRINGS.en.errorTitle, STRINGS.en.errorBody + (err ? ` (${err})` : ''));
  if (screen === 'completed') return notice(t.completedTitle, t.completedBody);
  if (screen === 'done') return notice(t.doneTitle, t.doneBody);

  const p = data.proposal;
  const content = p.content || {};
  const number = proposalNumber(p.proposal_number);
  const totals = computeTotals(content);
  const money = (v) => fmtMoney(v, p.currency, lang);
  const dateStr = new Date(p.sent_at || Date.now()).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="es-signer-wrap">
      <div className="es-signer-head">
        <div className="es-signer-brand">CLEAR TECH PARTNER</div>
        <div className="es-signer-title">{content.project_title}</div>
        <div className="es-signer-sub">{t.proposalFor(number, content.client_name || data.client_name)} · {t.invitedBy}</div>
      </div>

      <div className="pv-doc">
        <div className="pv-band">
          <div>
            <div className="pv-brand">Clear Tech Partner</div>
            <div className="pv-contact">rainy@cleartechpartner.com | www.cleartechpartner.com</div>
          </div>
          <div className="pv-doclabel">{lang === 'es' ? 'PROPUESTA' : 'PROPOSAL'}</div>
        </div>

        <div className="pv-body">
          <div className="pv-meta">
            <div>
              <div><b>{lang === 'es' ? 'Propuesta n.' : 'Proposal No'}:</b> {number}</div>
              <div><b>{t.date}:</b> {dateStr}</div>
            </div>
            <div className="pv-meta-right">
              <div className="pv-meta-label">{t.preparedFor.toUpperCase()}:</div>
              <div><b>{content.client_name}</b></div>
              {content.client_location && <div>{content.client_location}</div>}
              {content.client_tax_id && <div>{content.client_tax_id}</div>}
            </div>
          </div>

          <div className="pv-rule" />
          <h2 className="pv-title">{content.project_title}</h2>
          {content.summary && <p className="pv-summary">{content.summary}</p>}

          <table className="pv-table">
            <thead>
              <tr><th>#</th><th>{t.phase}</th><th>{t.description}</th><th className="pv-num">{t.price}</th></tr>
            </thead>
            <tbody>
              {(content.phases || []).map((ph, i) => (
                <tr key={i}>
                  <td>{ph.number || i + 1}</td>
                  <td>{ph.name}</td>
                  <td>{ph.description}</td>
                  <td className="pv-num">{money(ph.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pv-totals">
            <div><span>{t.subtotal}:</span><b>{totals.missing ? '[VERIFY]' : money(totals.subtotal)}</b></div>
            {content.discount && totals.discount > 0 && (
              <div><span>{content.discount.label}:</span><b>- {money(totals.discount)}</b></div>
            )}
            <div><span>{t.tax}:</span><b>{content.include_iva ? `${totals.missing ? '[VERIFY]' : money(totals.tax)} (${totals.taxRate}%)` : t.na}</b></div>
            <div className="pv-total-due"><span>{t.totalDue.toUpperCase()}:</span><b>{totals.missing ? '[VERIFY]' : money(totals.total)}</b></div>
          </div>

          {content.retainer?.included && (
            <div className="pv-retainer">
              <div className="spread">
                <b>{t.retainer}</b>
                <b>{(content.retainer.price == null ? '[VERIFY]' : money(content.retainer.price)) + t.perMonth}</b>
              </div>
              {content.retainer.cadence_note && <p>{content.retainer.cadence_note}</p>}
            </div>
          )}

          <div className="pv-agreement">
            <b>{t.agreement}</b>
            <p>{content.agreement_text}</p>
          </div>
        </div>
      </div>

      <div className="card es-signer-card pv-signcard">
        <h3>{t.signCta}</h3>
        {err && <div className="auth-err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="fld mt">
          <label className="lab">{t.yourName}</label>
          <input className="ti" value={signerName} onChange={e => setSignerName(e.target.value)} />
        </div>
        {sig ? (
          <div className="pv-sig-preview">
            <img src={sig.signature} alt="Signature" />
            <button className="link-btn" onClick={() => setAdoptOpen(true)}>{t.changeSig}</button>
          </div>
        ) : (
          <button className="btn gh mt" onClick={() => setAdoptOpen(true)}>{t.adoptFirst}</button>
        )}
        <div className="mt2">
          <button className="btn" disabled={!sig || !signerName.trim() || busy} onClick={finish}>
            {busy ? t.signing : t.signCta}
          </button>
        </div>
        <div className="es-signer-foot" style={{ marginTop: 16 }}>{t.sealNote}</div>
      </div>

      <div className="pv-footer">{t.footer}</div>

      {adoptOpen && (
        <AdoptModal
          t={t}
          signerName={signerName}
          needInitials={false}
          onClose={() => setAdoptOpen(false)}
          onAdopt={(s) => { setSig(s); setAdoptOpen(false); }}
        />
      )}
    </div>
  );
}
