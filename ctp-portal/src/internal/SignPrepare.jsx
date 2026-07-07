import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  loadPdf, renderPageToCanvas, bytesToB64, getEnvelopePdf, esignSend,
  FIELD_TYPES, SIGNER_COLORS
} from '../lib/esign';

const PAGE_WIDTH = 760;
let fieldKeySeq = 1;

function PageCanvas({ pdfDoc, pageNum, onReady, onPageClick, children }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    let alive = true;
    if (pdfDoc && canvasRef.current) {
      renderPageToCanvas(pdfDoc, pageNum, canvasRef.current, PAGE_WIDTH).then(({ height }) => {
        if (alive) { setH(height); onReady && onReady(pageNum, height); }
      });
    }
    return () => { alive = false; };
  }, [pdfDoc, pageNum]);

  return (
    <div
      ref={wrapRef}
      className="es-page"
      style={{ width: PAGE_WIDTH, height: h || undefined }}
      onClick={(e) => {
        if (!onPageClick || e.target !== e.currentTarget && e.target !== canvasRef.current) return;
        const rect = wrapRef.current.getBoundingClientRect();
        onPageClick(pageNum, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
    >
      <canvas ref={canvasRef} />
      {children}
      <div className="es-page-num">Page {pageNum}</div>
    </div>
  );
}

export default function SignPrepare() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const draftId = params.get('draft');
  const templateId = params.get('template');
  const asTemplate = params.get('as_template') === '1';

  const [step, setStep] = useState(1);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [fileName, setFileName] = useState('');

  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [clientId, setClientId] = useState('');
  const [message, setMessage] = useState('');
  const [signingMode, setSigningMode] = useState('sequential');
  const [signers, setSigners] = useState([{ key: 1, name: '', email: '' }]);
  const [tplCategory, setTplCategory] = useState('proposal');

  const [fields, setFields] = useState([]);
  const [activeSigner, setActiveSigner] = useState(0);
  const [tool, setTool] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);

  const [clients, setClients] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [envelopeId, setEnvelopeId] = useState(draftId || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dragRef = useRef(null);

  // ---------- initial load ----------

  useEffect(() => {
    supabase.from('clients').select('id, name, status').order('name')
      .then(({ data }) => setClients(data || []));
    if (!asTemplate) {
      supabase.from('envelope_templates').select('*').order('created_at', { ascending: false })
        .then(({ data }) => setTemplates(data || []));
    }
  }, []);

  useEffect(() => {
    if (draftId) resumeDraft(draftId);
    else if (templateId) startFromTemplate(templateId);
  }, [draftId, templateId]);

  const setBytes = async (bytes, fname) => {
    const doc = await loadPdf(bytes.slice());
    setPdfBytes(bytes);
    setPdfDoc(doc);
    setNumPages(doc.numPages);
    if (fname) setFileName(fname);
  };

  const onFile = async (e) => {
    setErr('');
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { setErr('PDF is too large. Keep it under 8 MB.'); return; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      await setBytes(bytes, f.name);
      if (!name) setName(f.name.replace(/\.pdf$/i, ''));
      setFields([]);
    } catch (ex) {
      setErr('Could not read that PDF: ' + ex.message);
    }
  };

  const resumeDraft = async (id) => {
    setBusy(true); setErr('');
    try {
      // Explicit columns: keep the bytea PDF columns out of the fetch.
      const { data: env, error } = await supabase.from('envelopes')
        .select('id, name, language, status, client_id, signing_mode, message, envelope_signers(*), envelope_fields(*)')
        .eq('id', id).single();
      if (error) throw new Error(error.message);
      setEnvelopeId(env.id);
      setName(env.name); setLanguage(env.language); setClientId(env.client_id || '');
      setMessage(env.message || ''); setSigningMode(env.signing_mode);
      const sgs = [...(env.envelope_signers || [])].sort((a, b) => a.sign_order - b.sign_order);
      if (sgs.length) setSigners(sgs.map((s, i) => ({ key: i + 1, name: s.name, email: s.email, dbId: s.id })));
      const idToIdx = Object.fromEntries(sgs.map((s, i) => [s.id, i]));
      setFields((env.envelope_fields || []).map(f => ({
        key: fieldKeySeq++, signerIdx: idToIdx[f.signer_id] ?? 0, type: f.type, page: f.page,
        x: +f.x, y: +f.y, w: +f.w, h: +f.h, required: f.required, label: f.label || ''
      })));
      const bytes = await getEnvelopePdf(id, 'source');
      if (bytes) await setBytes(bytes, env.name + '.pdf');
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const startFromTemplate = async (id) => {
    setBusy(true); setErr('');
    try {
      const { data: tpl, error } = await supabase.from('envelope_templates').select('*').eq('id', id).single();
      if (error) throw new Error(error.message);
      const { data: urlData, error: e2 } = await supabase.storage.from('esign').createSignedUrl(tpl.source_ref, 300);
      if (e2) throw new Error(e2.message);
      const res = await fetch(urlData.signedUrl);
      const buf = await res.arrayBuffer();
      if (!res.ok) throw new Error('Could not download the template PDF');
      await setBytes(new Uint8Array(buf), tpl.name + '.pdf');
      setLanguage(tpl.language);
      const layout = tpl.field_layout || [];
      setFields(layout.map(f => ({
        key: fieldKeySeq++, signerIdx: f.signer_index || 0, type: f.type, page: f.page,
        x: f.x, y: f.y, w: f.w, h: f.h, required: f.required !== false, label: f.label || ''
      })));
      const nSigners = Math.max(1, ...layout.map(f => (f.signer_index || 0) + 1));
      setSigners(Array.from({ length: nSigners }, (_, i) => ({ key: i + 1, name: '', email: '' })));
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  // ---------- field placement ----------

  const placeField = (pageNum, x, y) => {
    if (!tool) return;
    const cfg = FIELD_TYPES[tool];
    const f = {
      key: fieldKeySeq++, signerIdx: activeSigner, type: tool, page: pageNum,
      x: Math.min(Math.max(x - cfg.w / 2, 0), 1 - cfg.w),
      y: Math.min(Math.max(y - cfg.h / 2, 0), 1 - cfg.h),
      w: cfg.w, h: cfg.h, required: true, label: ''
    };
    setFields(fs => [...fs, f]);
    setSelectedKey(f.key);
  };

  const updateField = (key, patch) => setFields(fs => fs.map(f => f.key === key ? { ...f, ...patch } : f));
  const removeField = (key) => { setFields(fs => fs.filter(f => f.key !== key)); if (selectedKey === key) setSelectedKey(null); };

  const startDrag = (e, field, mode) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedKey(field.key);
    const pageEl = e.currentTarget.closest('.es-page');
    const rect = pageEl.getBoundingClientRect();
    dragRef.current = { key: field.key, mode, rect, startX: e.clientX, startY: e.clientY, orig: { ...field } };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / d.rect.width;
      const dy = (ev.clientY - d.startY) / d.rect.height;
      if (d.mode === 'move') {
        updateField(d.key, {
          x: Math.min(Math.max(d.orig.x + dx, 0), 1 - d.orig.w),
          y: Math.min(Math.max(d.orig.y + dy, 0), 1 - d.orig.h)
        });
      } else {
        updateField(d.key, {
          w: Math.min(Math.max(d.orig.w + dx, 0.02), 1 - d.orig.x),
          h: Math.min(Math.max(d.orig.h + dy, 0.012), 1 - d.orig.y)
        });
      }
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------- persistence ----------

  const validEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

  const validate = (forSend) => {
    if (!pdfBytes) return 'Choose a PDF first.';
    if (!name.trim()) return 'Give the document a name.';
    if (asTemplate) return fields.length === 0 ? 'Place at least one field.' : '';
    const active = signers.filter(s => s.name.trim() || s.email.trim());
    if (active.length === 0) return 'Add at least one recipient.';
    for (const s of active) {
      if (!s.name.trim() || !validEmail(s.email.trim())) return 'Every recipient needs a name and a valid email.';
    }
    if (forSend) {
      for (let i = 0; i < active.length; i++) {
        if (!fields.some(f => f.signerIdx === i && f.type === 'signature')) {
          return `Recipient ${i + 1} (${active[i].name}) has no signature field yet.`;
        }
      }
    }
    return '';
  };

  const persistEnvelope = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const activeSigners = signers.filter(s => s.name.trim() || s.email.trim());
    let id = envelopeId;

    const core = {
      name: name.trim(), language, client_id: clientId || null,
      message: message.trim() || null, signing_mode: signingMode
    };
    if (!id) {
      // No audit event yet: drafts must stay deletable, and the append-only
      // trigger on envelope_events blocks cascade deletes. The audit trail
      // starts at send.
      const { data, error } = await supabase.from('envelopes')
        .insert({ ...core, status: 'draft', created_by: userData?.user?.id })
        .select('id').single();
      if (error) throw new Error(error.message);
      id = data.id;
      setEnvelopeId(id);
    } else {
      const { error } = await supabase.from('envelopes').update(core).eq('id', id);
      if (error) throw new Error(error.message);
    }

    // Source PDF: private bucket copy (canonical) + in-row bytes for the signer path.
    const path = `${id}/source.pdf`;
    const { error: upErr } = await supabase.storage.from('esign')
      .upload(path, new Blob([pdfBytes], { type: 'application/pdf' }), { upsert: true });
    if (upErr) throw new Error('Storage upload failed: ' + upErr.message);
    const { error: pErr } = await supabase.from('envelopes').update({ source_path: path }).eq('id', id);
    if (pErr) throw new Error(pErr.message);
    const { error: rpcErr } = await supabase.rpc('esign_put_source', { p_envelope_id: id, p_b64: bytesToB64(pdfBytes) });
    if (rpcErr) throw new Error(rpcErr.message);

    // Replace signers and fields wholesale; this only ever runs on drafts.
    const { error: delF } = await supabase.from('envelope_fields').delete().eq('envelope_id', id);
    if (delF) throw new Error(delF.message);
    const { error: delS } = await supabase.from('envelope_signers').delete().eq('envelope_id', id);
    if (delS) throw new Error(delS.message);

    const { data: newSigners, error: insS } = await supabase.from('envelope_signers')
      .insert(activeSigners.map((s, i) => ({
        envelope_id: id, name: s.name.trim(), email: s.email.trim().toLowerCase(), sign_order: i + 1
      })))
      .select('id, sign_order');
    if (insS) throw new Error(insS.message);
    const byOrder = Object.fromEntries((newSigners || []).map(s => [s.sign_order, s.id]));

    const rows = fields
      .filter(f => f.signerIdx < activeSigners.length)
      .map(f => ({
        envelope_id: id, signer_id: byOrder[f.signerIdx + 1], type: f.type, page: f.page,
        x: f.x.toFixed(6), y: f.y.toFixed(6), w: f.w.toFixed(6), h: f.h.toFixed(6),
        required: f.required, label: f.label || null
      }));
    if (rows.length) {
      const { error: insF } = await supabase.from('envelope_fields').insert(rows);
      if (insF) throw new Error(insF.message);
    }
    return id;
  };

  const saveDraft = async () => {
    const v = validate(false);
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try {
      await persistEnvelope();
      nav('/sign');
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  const send = async () => {
    const v = validate(true);
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try {
      const id = await persistEnvelope();
      await esignSend(id);
      nav(`/sign/${id}`);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  const saveTemplate = async () => {
    const v = validate(false);
    if (v) { setErr(v); return; }
    setBusy(true); setErr('');
    try {
      const ref = `templates/${crypto.randomUUID()}.pdf`;
      const { error: upErr } = await supabase.storage.from('esign')
        .upload(ref, new Blob([pdfBytes], { type: 'application/pdf' }), { upsert: false });
      if (upErr) throw new Error(upErr.message);
      const layout = fields.map(f => ({
        signer_index: f.signerIdx, type: f.type, page: f.page,
        x: +f.x.toFixed(6), y: +f.y.toFixed(6), w: +f.w.toFixed(6), h: +f.h.toFixed(6),
        required: f.required, label: f.label || null
      }));
      const { error } = await supabase.from('envelope_templates')
        .insert({ name: name.trim(), language, category: tplCategory, source_ref: ref, field_layout: layout });
      if (error) throw new Error(error.message);
      nav('/sign#templates');
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  // ---------- render ----------

  const activeSigners = signers.filter(s => s.name.trim() || s.email.trim());
  const signerLabel = (i) => asTemplate
    ? `Signer ${i + 1}`
    : (signers[i]?.name.trim() || signers[i]?.email.trim() || `Recipient ${i + 1}`);

  const selected = fields.find(f => f.key === selectedKey);

  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>{asTemplate ? 'New template' : 'Prepare & send'}</h1>
          <p className="sub">
            {asTemplate
              ? 'Upload a base PDF and pre-place fields. Recipients are assigned when you use it.'
              : 'Pick a PDF, add recipients, place fields, send.'}
          </p>
        </div>
        <div className="co-actions">
          <button className="btn sm gh" onClick={() => nav('/sign')}>Back</button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="es-steps">
        {[1, 2, 3].map(n => (
          <button key={n} className={'es-step' + (step === n ? ' on' : '')} onClick={() => setStep(n)}>
            {n}. {n === 1 ? 'Document' : n === 2 ? (asTemplate ? 'Signers & details' : 'Recipients') : 'Fields'}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="card spine">
          <h3>Document</h3>
          <div className="grid2" style={{ marginTop: 12 }}>
            <div className="fld">
              <label className="lab">PDF file</label>
              <input type="file" accept="application/pdf,.pdf" onChange={onFile} className="ti" style={{ paddingTop: 9 }} />
              {fileName && <div className="sub" style={{ marginTop: 6 }}>{fileName} · {numPages} page{numPages === 1 ? '' : 's'}</div>}
            </div>
            <div className="fld">
              <label className="lab">Document name</label>
              <input className="ti" value={name} onChange={e => setName(e.target.value)} placeholder="Proposal | Hotel Ses Bruixes" />
            </div>
          </div>
          {!asTemplate && templates.length > 0 && (
            <div className="fld" style={{ marginTop: 8 }}>
              <label className="lab">Or start from a template</label>
              <div className="es-tpl-list">
                {templates.map(t => (
                  <button key={t.id} className="chip es-tpl-chip" onClick={() => nav(`/sign/new?template=${t.id}`)}>
                    {t.name} · {t.language.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="btn" style={{ marginTop: 14 }} disabled={!pdfBytes} onClick={() => setStep(2)}>Continue</button>
        </div>
      )}

      {step === 2 && (
        <div className="card spine">
          <h3>{asTemplate ? 'Signers & details' : 'Recipients'}</h3>
          {!asTemplate && (
            <>
              {signers.map((s, i) => (
                <div key={s.key} className="es-signer-row">
                  <span className="es-signer-dot" style={{ background: SIGNER_COLORS[i % SIGNER_COLORS.length] }}>{i + 1}</span>
                  <input className="ti" placeholder="Name" value={s.name}
                    onChange={e => setSigners(ss => ss.map(x => x.key === s.key ? { ...x, name: e.target.value } : x))} />
                  <input className="ti" type="email" placeholder="Email" value={s.email}
                    onChange={e => setSigners(ss => ss.map(x => x.key === s.key ? { ...x, email: e.target.value } : x))} />
                  {signers.length > 1 && (
                    <button className="icon-btn icon-btn-danger" onClick={() => setSigners(ss => ss.filter(x => x.key !== s.key))}>×</button>
                  )}
                </div>
              ))}
              <button className="link-btn" onClick={() => setSigners(ss => [...ss, { key: Math.max(...ss.map(x => x.key)) + 1, name: '', email: '' }])}>
                + Add another recipient
              </button>
            </>
          )}
          {asTemplate && (
            <div className="fld">
              <label className="lab">Number of signers</label>
              <select className="sel" value={signers.length}
                onChange={e => {
                  const n = +e.target.value;
                  setSigners(Array.from({ length: n }, (_, i) => signers[i] || { key: i + 1, name: `Signer ${i + 1}`, email: `signer${i + 1}@placeholder.local` }));
                }}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          <div className="grid2" style={{ marginTop: 16 }}>
            {!asTemplate && signers.filter(s => s.name.trim() || s.email.trim()).length > 1 && (
              <div className="fld">
                <label className="lab">Signing order</label>
                <select className="sel" value={signingMode} onChange={e => setSigningMode(e.target.value)}>
                  <option value="sequential">Sequential (one after another)</option>
                  <option value="parallel">Parallel (everyone at once)</option>
                </select>
              </div>
            )}
            <div className="fld">
              <label className="lab">Language (signer screen, email, disclosure, certificate)</label>
              <select className="sel" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
            {!asTemplate && (
              <div className="fld">
                <label className="lab">Link to client (optional, any status)</label>
                <select className="sel" value={clientId} onChange={e => setClientId(e.target.value)}>
                  <option value="">No client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {asTemplate && (
              <div className="fld">
                <label className="lab">Category</label>
                <select className="sel" value={tplCategory} onChange={e => setTplCategory(e.target.value)}>
                  <option value="proposal">Proposal</option>
                  <option value="contract">Contract</option>
                </select>
              </div>
            )}
          </div>
          {!asTemplate && (
            <div className="fld">
              <label className="lab">Message to recipients (optional)</label>
              <textarea className="ta" value={message} onChange={e => setMessage(e.target.value)}
                placeholder="A short note shown in the email and on the signing screen." />
            </div>
          )}
          <button className="btn" style={{ marginTop: 8 }} onClick={() => setStep(3)}>Continue to fields</button>
        </div>
      )}

      {step === 3 && (
        <div className="es-editor">
          <div className="es-palette card">
            <div className="lab" style={{ marginBottom: 8 }}>Assign to</div>
            <div className="es-signer-chips">
              {(asTemplate ? signers : (activeSigners.length ? activeSigners : [{ key: 0 }])).map((s, i) => (
                <button key={s.key} className={'es-signer-chip' + (activeSigner === i ? ' on' : '')}
                  style={{ borderColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }}
                  onClick={() => setActiveSigner(i)}>
                  <span className="es-signer-dot sm" style={{ background: SIGNER_COLORS[i % SIGNER_COLORS.length] }}>{i + 1}</span>
                  {signerLabel(i)}
                </button>
              ))}
            </div>
            <div className="lab" style={{ margin: '14px 0 8px' }}>Field</div>
            <div className="es-tools">
              {Object.entries(FIELD_TYPES).map(([k, cfg]) => (
                <button key={k} className={'es-tool' + (tool === k ? ' on' : '')} onClick={() => setTool(tool === k ? null : k)}>
                  {cfg.label}
                </button>
              ))}
            </div>
            <div className="sub" style={{ marginTop: 10 }}>
              {tool ? 'Click on the document to place the field.' : 'Pick a field type, then click on the document. Drag to move, corner to resize.'}
            </div>

            {selected && (
              <div className="es-inspector">
                <div className="lab">Selected: {FIELD_TYPES[selected.type].label} · p{selected.page}</div>
                {(selected.type === 'text' || selected.type === 'checkbox') && (
                  <input className="ti" placeholder="Label (shown to the signer)" value={selected.label}
                    onChange={e => updateField(selected.key, { label: e.target.value })} style={{ marginTop: 8 }} />
                )}
                <label className="es-check">
                  <input type="checkbox" checked={selected.required}
                    onChange={e => updateField(selected.key, { required: e.target.checked })} /> Required
                </label>
                <button className="btn sm" style={{ background: '#B33A3A', marginTop: 8 }} onClick={() => removeField(selected.key)}>
                  Remove field
                </button>
              </div>
            )}

            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {asTemplate ? (
                <button className="btn" disabled={busy} onClick={saveTemplate}>{busy ? 'Saving…' : 'Save template'}</button>
              ) : (
                <>
                  <button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send for signature'}</button>
                  <button className="btn sm gh" disabled={busy} onClick={saveDraft}>Save as draft</button>
                </>
              )}
            </div>
          </div>

          <div className="es-pages">
            {pdfDoc && Array.from({ length: numPages }, (_, i) => i + 1).map(pn => (
              <PageCanvas key={pn} pdfDoc={pdfDoc} pageNum={pn} onPageClick={placeField}>
                {fields.filter(f => f.page === pn).map(f => (
                  <div key={f.key}
                    className={'es-field' + (selectedKey === f.key ? ' on' : '')}
                    style={{
                      left: (f.x * 100) + '%', top: (f.y * 100) + '%',
                      width: (f.w * 100) + '%', height: (f.h * 100) + '%',
                      borderColor: SIGNER_COLORS[f.signerIdx % SIGNER_COLORS.length],
                      background: SIGNER_COLORS[f.signerIdx % SIGNER_COLORS.length] + '22'
                    }}
                    onPointerDown={(e) => startDrag(e, f, 'move')}
                  >
                    <span className="es-field-tag" style={{ background: SIGNER_COLORS[f.signerIdx % SIGNER_COLORS.length] }}>
                      {FIELD_TYPES[f.type].label}{f.required ? '' : ' (optional)'} · {signerLabel(f.signerIdx)}
                    </span>
                    <span className="es-field-resize" onPointerDown={(e) => startDrag(e, f, 'resize')} />
                  </div>
                ))}
              </PageCanvas>
            ))}
            {!pdfDoc && <div className="card"><div className="empty">Choose a PDF in step 1 first.</div></div>}
          </div>
        </div>
      )}
    </div>
  );
}
