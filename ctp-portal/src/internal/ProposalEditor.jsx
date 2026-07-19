import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { claudeCall } from '../lib/api';
import {
  PROPOSAL_STATUS, proposalNumber, fmtMoney, computeTotals,
  emptyContent, DEFAULT_AGREEMENT, proposalPdf, proposalSend, downloadBase64Pdf
} from '../lib/proposals';

// Confirmed retainer copy from invoice CTP-0001; editable per proposal.
const RETAINER_NOTE = {
  en: 'Charged on the 1st of each month, effective from go-live date. Includes: agent maintenance, updates, on-call support, transcripts, integration subscriptions, software charges, and monthly reporting.',
  es: 'Se cobra el dia 1 de cada mes, a partir de la fecha de puesta en marcha. Incluye: mantenimiento del agente, actualizaciones, soporte, transcripciones, suscripciones de integraciones, costes de software e informe mensual.',
};

export default function ProposalEditor() {
  const { id } = useParams();
  return id ? <Editor proposalId={id} /> : <NewProposal />;
}

/* =========================================================
   Step 1 | Input form: prospect info + services + discovery
   notes. "Generate" asks Claude for the summary and phase
   wording only; every price comes from proposal_pricing.
   ========================================================= */

function NewProposal() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const presetClientId = params.get('client') || '';

  const [prospects, setProspects] = useState(null);
  const [services, setServices] = useState([]);
  const [clientId, setClientId] = useState(presetClientId);
  const [form, setForm] = useState({
    client_name: '', client_location: '', client_tax_id: '', client_email: '',
    project_title: '', discovery_notes: '',
    language: 'en', currency: 'EUR',
    discount_label: '', discount_amount: '',
    include_iva: true, include_retainer: false,
  });
  const [ivaTouched, setIvaTouched] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const { data: cs, error } = await supabase
        .from('clients')
        .select('id, name, contact_email, location, tax_id, language, client_status')
        .eq('client_status', 'prospect')
        .order('name');
      if (error) { setErr(error.message); setProspects([]); return; }
      let list = cs || [];
      // Generate Proposal is also offered from Active client pages; pull
      // the preset client into the list when it is not a prospect so the
      // form still prefills and submits.
      if (presetClientId && !list.some(c => c.id === presetClientId)) {
        const { data: preset } = await supabase
          .from('clients')
          .select('id, name, contact_email, location, tax_id, language, client_status')
          .eq('id', presetClientId)
          .single();
        if (preset) list = [preset, ...list];
      }
      setProspects(list);
      const { data: svcs } = await supabase
        .from('proposal_services').select('*').eq('is_active', true).order('sort_order').order('name');
      setServices(svcs || []);
    })();
  }, [presetClientId]);

  // Prefill from the chosen prospect.
  useEffect(() => {
    const c = (prospects || []).find(x => x.id === clientId);
    if (!c) return;
    setForm(f => ({
      ...f,
      client_name: c.name || '',
      client_location: c.location || '',
      client_tax_id: c.tax_id || '',
      client_email: c.contact_email || '',
      language: c.language || f.language,
    }));
  }, [clientId, prospects]);

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const setCurrency = (cur) => {
    setForm(f => ({ ...f, currency: cur, include_iva: ivaTouched ? f.include_iva : cur === 'EUR' }));
  };

  const toggleService = (id) => {
    setSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  };

  const retainerService = useMemo(
    () => services.find(s => /retainer/i.test(s.name)),
    [services]
  );

  // A service maps to a price only when exactly one active tier exists in
  // the proposal currency. Anything else stays null and shows [VERIFY]:
  // the AI never sees prices and the form never guesses one.
  const priceFor = (pricing, serviceId, currency) => {
    const tiers = pricing.filter(p => p.service_id === serviceId && p.is_active && p.currency === currency);
    return tiers.length === 1 ? Number(tiers[0].base_price) : null;
  };

  const generate = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data: pricing, error: pErr } = await supabase
        .from('proposal_pricing').select('*').eq('is_active', true);
      if (pErr) throw new Error(pErr.message);

      const chosen = services.filter(s => selected.includes(s.id));
      const includeRetainer = form.include_retainer || (retainerService && selected.includes(retainerService.id));
      const phaseServices = chosen.filter(s => s.id !== retainerService?.id);

      let summary = '';
      let aiPhases = [];
      if (phaseServices.length || form.discovery_notes.trim()) {
        const langName = form.language === 'es' ? 'Spanish (peninsular Spain, hospitality-professional tone)' : 'English';
        const system =
          'You draft the narrative for Clear Tech Partner client proposals. Clear Tech Partner is a hospitality technology consultancy in Menorca. ' +
          'Write in ' + langName + '. Respond with a single JSON object and nothing else, shaped exactly like ' +
          '{"summary": "...", "phases": [{"name": "...", "description": "..."}]}. ' +
          'The summary is 3 to 4 plain sentences describing the project for the client, grounded strictly in the discovery notes. ' +
          'Produce exactly one phase per listed service, in the same order, with a short name and a one-line description tailored to this project. ' +
          'Never mention, invent, estimate or imply any price, cost, fee, discount or amount of money anywhere in the output. ' +
          'No greetings, no marketing superlatives, no exclamation marks.';
        const user =
          'Project title: ' + form.project_title + '\n' +
          'Client: ' + form.client_name + (form.client_location ? ' (' + form.client_location + ')' : '') + '\n' +
          'Services, in order:\n' + phaseServices.map((s, i) => (i + 1) + '. ' + s.name + (s.description ? ' | ' + s.description : '')).join('\n') + '\n\n' +
          'Discovery notes:\n' + form.discovery_notes;
        const raw = await claudeCall({ system, messages: [{ role: 'user', content: user }], max_tokens: 1400 });
        const parsed = parseAiJson(raw);
        summary = String(parsed.summary || '').trim();
        aiPhases = Array.isArray(parsed.phases) ? parsed.phases : [];
      }

      const phases = phaseServices.map((s, i) => ({
        number: i + 1,
        name: String(aiPhases[i]?.name || s.name).trim(),
        description: String(aiPhases[i]?.description || s.description || '').trim(),
        price: priceFor(pricing || [], s.id, form.currency),
      }));

      const discountAmount = Number(form.discount_amount);
      const content = {
        ...emptyContent(),
        client_name: form.client_name.trim(),
        client_location: form.client_location.trim(),
        client_tax_id: form.client_tax_id.trim(),
        client_email: form.client_email.trim(),
        project_title: form.project_title.trim(),
        summary,
        phases,
        services: selected,
        discovery_notes: form.discovery_notes,
        discount: form.discount_label.trim() && discountAmount > 0
          ? { label: form.discount_label.trim(), amount: discountAmount }
          : null,
        include_iva: form.include_iva,
        tax_rate: 21,
        retainer: {
          included: !!includeRetainer,
          price: includeRetainer && retainerService ? priceFor(pricing || [], retainerService.id, form.currency) : null,
          cadence_note: includeRetainer ? RETAINER_NOTE[form.language] : '',
        },
        agreement_text: DEFAULT_AGREEMENT[form.language],
      };

      const { data: row, error: iErr } = await supabase.from('proposals').insert({
        client_id: clientId,
        project_title: content.project_title,
        language: form.language,
        currency: form.currency,
        content_json: content,
        created_by: (await supabase.auth.getUser()).data?.user?.id || null,
      }).select().single();
      if (iErr) throw new Error(iErr.message);
      nav(`/proposals/${row.id}`);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  };

  if (!prospects) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h">
        <Link to="/proposals" className="link-btn">&larr; All proposals</Link>
        <h1 className="mt">New proposal</h1>
        <p className="sub">Claude drafts the summary and phase wording from your discovery notes. Prices only ever come from the pricing settings.</p>
      </div>

      <form className="card spine" onSubmit={generate}>
        {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="fld"><label className="lab">Prospect</label>
          <select className="sel" value={clientId} onChange={e => setClientId(e.target.value)} required>
            <option value="">Choose a prospect…</option>
            {prospects.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {prospects.length === 0 && <div className="sub mt">No prospects yet. Create one in Client Overview with status Prospect.</div>}
        </div>

        <div className="grid2">
          <div className="fld"><label className="lab">Client name</label>
            <input className="ti" value={form.client_name} onChange={F('client_name')} required /></div>
          <div className="fld"><label className="lab">Client email (receives the signing link)</label>
            <input className="ti" type="email" value={form.client_email} onChange={F('client_email')} required /></div>
          <div className="fld"><label className="lab">Location</label>
            <input className="ti" value={form.client_location} onChange={F('client_location')} placeholder="Mahón, Menorca, Spain" /></div>
          <div className="fld"><label className="lab">Tax ID (optional)</label>
            <input className="ti" value={form.client_tax_id} onChange={F('client_tax_id')} /></div>
        </div>

        <div className="fld"><label className="lab">Project title</label>
          <input className="ti" value={form.project_title} onChange={F('project_title')} required placeholder="Dynamic Website Upgrade for example.com" /></div>

        <div className="fld">
          <label className="lab">Services to include</label>
          <div className="doc-filters" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            {services.map(s => (
              <button type="button" key={s.id}
                className={`filter-chip${selected.includes(s.id) ? ' on' : ''}`}
                onClick={() => toggleService(s.id)}>
                {s.name}
              </button>
            ))}
            {services.length === 0 && <span className="sub">No active services. Add them under Proposals &gt; Settings.</span>}
          </div>
        </div>

        <div className="fld"><label className="lab">Discovery notes (Claude drafts the summary from these)</label>
          <textarea className="ta big" value={form.discovery_notes} onChange={F('discovery_notes')} required
            placeholder="What they need, what you saw on the call, scope boundaries, timelines." /></div>

        <div className="grid2">
          <div className="fld"><label className="lab">Language</label>
            <select className="sel" value={form.language} onChange={F('language')}>
              <option value="en">English</option><option value="es">Español</option>
            </select></div>
          <div className="fld"><label className="lab">Currency</label>
            <select className="sel" value={form.currency} onChange={e => setCurrency(e.target.value)}>
              <option value="EUR">EUR</option><option value="USD">USD</option>
            </select></div>
          <div className="fld"><label className="lab">Discount label (optional)</label>
            <input className="ti" value={form.discount_label} onChange={F('discount_label')} placeholder="Partner Launch Discount" /></div>
          <div className="fld"><label className="lab">Discount amount</label>
            <input className="ti" type="number" min="0" step="0.01" value={form.discount_amount} onChange={F('discount_amount')} /></div>
        </div>

        <div className="row" style={{ gap: 22, flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 8, fontSize: '.88rem' }}>
            <input type="checkbox" checked={form.include_iva}
              onChange={e => { setIvaTouched(true); setForm(f => ({ ...f, include_iva: e.target.checked })); }} />
            Include IVA
          </label>
          <label className="row" style={{ gap: 8, fontSize: '.88rem' }}>
            <input type="checkbox" checked={form.include_retainer}
              onChange={e => setForm(f => ({ ...f, include_retainer: e.target.checked }))} />
            Include monthly retainer section
          </label>
        </div>

        <button className="btn mt2" disabled={busy || !clientId || !form.project_title.trim() || !form.discovery_notes.trim()}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </form>
    </div>
  );
}

function parseAiJson(raw) {
  const text = String(raw || '').replace(/```json|```/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Claude returned an unexpected format. Try Generate again.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Claude returned an unexpected format. Try Generate again.');
  }
}

/* =========================================================
   Step 2 | Editor: every field of the proposal, directly
   editable. Totals are always computed, never typed.
   ========================================================= */

function Editor({ proposalId }) {
  const nav = useNavigate();
  const [proposal, setProposal] = useState(null);
  const [content, setContent] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [signLink, setSignLink] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = async () => {
    const { data, error } = await supabase
      .from('proposals')
      .select('*, clients(id, name, client_status)')
      .eq('id', proposalId).single();
    if (error) { setErr(error.message); return; }
    setProposal(data);
    setContent({ ...emptyContent(), ...(data.content_json || {}) });
  };
  useEffect(() => { load(); }, [proposalId]);

  const locked = proposal?.status === 'signed';

  const C = (k) => (e) => { setContent(c => ({ ...c, [k]: e.target.value })); setDirty(true); };
  const patch = (obj) => { setContent(c => ({ ...c, ...obj })); setDirty(true); };

  const setPhase = (i, key, value) => {
    setContent(c => {
      const phases = c.phases.map((p, idx) => idx === i ? { ...p, [key]: value } : p);
      return { ...c, phases };
    });
    setDirty(true);
  };
  const movePhase = (i, dir) => {
    setContent(c => {
      const phases = [...c.phases];
      const j = i + dir;
      if (j < 0 || j >= phases.length) return c;
      [phases[i], phases[j]] = [phases[j], phases[i]];
      return { ...c, phases: phases.map((p, idx) => ({ ...p, number: idx + 1 })) };
    });
    setDirty(true);
  };
  const removePhase = (i) => {
    setContent(c => ({ ...c, phases: c.phases.filter((_, idx) => idx !== i).map((p, idx) => ({ ...p, number: idx + 1 })) }));
    setDirty(true);
  };
  const addPhase = () => {
    setContent(c => ({ ...c, phases: [...c.phases, { number: c.phases.length + 1, name: '', description: '', price: null }] }));
    setDirty(true);
  };

  const save = async () => {
    setBusy('save'); setErr('');
    const { error } = await supabase.from('proposals').update({
      project_title: content.project_title,
      content_json: content,
    }).eq('id', proposalId);
    setBusy('');
    if (error) { setErr(error.message); return false; }
    setDirty(false);
    flash('Saved');
    return true;
  };

  const downloadPdf = async () => {
    setBusy('pdf'); setErr('');
    try {
      if (dirty && !(await save())) { setBusy(''); return; }
      const d = await proposalPdf(proposalId);
      downloadBase64Pdf(d.pdf, `${proposalNumber(proposal.proposal_number)}_${content.project_title.replace(/[^\w-]+/g, '_')}.pdf`);
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  const downloadSigned = async () => {
    setBusy('pdf'); setErr('');
    try {
      const { data, error } = await supabase.rpc('proposal_signed_pdf', { p_proposal_id: proposalId });
      if (error) throw new Error(error.message);
      downloadBase64Pdf(data, `${proposalNumber(proposal.proposal_number)}_signed.pdf`);
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  const send = async () => {
    if (!content.client_email.trim()) { setErr('Client email is required to send the signing link.'); return; }
    const totals = computeTotals(content);
    if (totals.missing && !confirm('Some phases still show [VERIFY] instead of a price. Send anyway?')) return;
    if (!confirm(`Email the signing link to ${content.client_email}?`)) return;
    setBusy('send'); setErr('');
    try {
      if (dirty && !(await save())) { setBusy(''); return; }
      const res = await proposalSend(proposalId);
      if (res.sign_url) setSignLink(res.sign_url);
      flash(res.emailed ? 'Proposal sent' : 'Signing link created. Email not configured; share the link below.');
      load();
    } catch (ex) { setErr(ex.message); }
    setBusy('');
  };

  if (err && !proposal) return <div className="page"><div className="auth-err">{err}</div></div>;
  if (!proposal || !content) return <div className="center"><div className="sp" /></div>;

  const sc = PROPOSAL_STATUS[proposal.status] || PROPOSAL_STATUS.draft;
  const totals = computeTotals(content);
  const cur = proposal.currency;
  const money = (v) => fmtMoney(v, cur, proposal.language);

  return (
    <div className="page">
      <div className="page-h">
        <Link to="/proposals" className="link-btn">&larr; All proposals</Link>
        <div className="spread mt">
          <div>
            <h1>{proposalNumber(proposal.proposal_number)}</h1>
            <p>
              <button className="link-btn" onClick={() => nav(`/clients/${proposal.client_id}`)}>{proposal.clients?.name}</button>
              {' '}· {proposal.language === 'es' ? 'Español' : 'English'} · {cur}
            </p>
          </div>
          <div className="row">
            <span className={`co-pill ${sc.cls}`}>
              <span className="co-dot" style={{ background: sc.dot, marginRight: 6 }} />{sc.label}
            </span>
          </div>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 12 }}>{err}</div>}

      {locked && (
        <div className="card" style={{ marginBottom: 16, background: '#effaf5', borderColor: '#bfe9da' }}>
          <b>Signed{proposal.signed_at ? ' on ' + new Date(proposal.signed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}.</b>{' '}
          The content is locked. The signed PDF is in the client's Documents tab and below.
        </div>
      )}

      <fieldset disabled={locked} style={{ border: 'none', padding: 0, margin: 0 }}>

        <div className="card">
          <h3>Prepared for</h3>
          <div className="grid2 mt">
            <div className="fld"><label className="lab">Client name</label>
              <input className="ti" value={content.client_name} onChange={C('client_name')} /></div>
            <div className="fld"><label className="lab">Client email</label>
              <input className="ti" type="email" value={content.client_email} onChange={C('client_email')} /></div>
            <div className="fld"><label className="lab">Location</label>
              <input className="ti" value={content.client_location} onChange={C('client_location')} /></div>
            <div className="fld"><label className="lab">Tax ID</label>
              <input className="ti" value={content.client_tax_id} onChange={C('client_tax_id')} /></div>
          </div>
        </div>

        <div className="card mt2">
          <h3>Project</h3>
          <div className="fld mt"><label className="lab">Project title</label>
            <input className="ti" value={content.project_title} onChange={C('project_title')} /></div>
          <div className="fld"><label className="lab">Summary (Claude's draft; edit before sending)</label>
            <textarea className="ta big" value={content.summary} onChange={C('summary')} /></div>
        </div>

        <div className="card mt2">
          <div className="spread">
            <h3>Phases</h3>
            <button className="btn sm gh" onClick={addPhase}>+ Add phase</button>
          </div>
          {content.phases.length === 0 && <div className="empty mt">No phases yet. Add the first one.</div>}
          {content.phases.map((p, i) => (
            <div key={i} className="prop-phase-row">
              <div className="prop-phase-num">{i + 1}</div>
              <div className="prop-phase-fields">
                <input className="ti" value={p.name} placeholder="Phase name"
                  onChange={e => setPhase(i, 'name', e.target.value)} />
                <input className="ti" value={p.description} placeholder="One-line description"
                  onChange={e => setPhase(i, 'description', e.target.value)} />
              </div>
              <input className="ti prop-phase-price" type="number" min="0" step="0.01"
                value={p.price ?? ''} placeholder="[VERIFY]"
                onChange={e => setPhase(i, 'price', e.target.value === '' ? null : Number(e.target.value))} />
              <div className="prop-phase-actions">
                <button className="icon-btn" title="Move up" onClick={() => movePhase(i, -1)} disabled={i === 0}>↑</button>
                <button className="icon-btn" title="Move down" onClick={() => movePhase(i, 1)} disabled={i === content.phases.length - 1}>↓</button>
                <button className="icon-btn icon-btn-danger" title="Remove phase" onClick={() => removePhase(i)}>×</button>
              </div>
            </div>
          ))}
        </div>

        <div className="card mt2">
          <h3>Pricing</h3>
          <div className="grid2 mt">
            <div className="fld"><label className="lab">Discount label</label>
              <input className="ti" value={content.discount?.label || ''} placeholder="Partner Launch Discount"
                onChange={e => patch({ discount: e.target.value ? { label: e.target.value, amount: content.discount?.amount || 0 } : null })} /></div>
            <div className="fld"><label className="lab">Discount amount</label>
              <input className="ti" type="number" min="0" step="0.01" value={content.discount?.amount ?? ''}
                disabled={!content.discount?.label}
                onChange={e => patch({ discount: { label: content.discount?.label || '', amount: Number(e.target.value) || 0 } })} /></div>
          </div>
          <div className="row" style={{ gap: 22, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 8, fontSize: '.88rem' }}>
              <input type="checkbox" checked={!!content.include_iva}
                onChange={e => patch({ include_iva: e.target.checked })} />
              Include IVA
            </label>
            {content.include_iva && (
              <label className="row" style={{ gap: 8, fontSize: '.88rem' }}>
                Rate
                <input className="ti" style={{ width: 70 }} type="number" min="0" max="100" step="0.1"
                  value={content.tax_rate ?? 21}
                  onChange={e => patch({ tax_rate: Number(e.target.value) })} />%
              </label>
            )}
          </div>

          <div className="prop-totals mt2">
            <div><span>Subtotal</span><b>{totals.missing ? '[VERIFY]' : money(totals.subtotal)}</b></div>
            {totals.discount > 0 && <div><span>{content.discount?.label || 'Discount'}</span><b>- {money(totals.discount)}</b></div>}
            <div><span>Tax (IVA)</span><b>{content.include_iva ? (totals.missing ? '[VERIFY]' : money(totals.tax)) + ' (' + totals.taxRate + '%)' : 'N/A'}</b></div>
            <div className="prop-totals-due"><span>Total due</span><b>{totals.missing ? '[VERIFY]' : money(totals.total)}</b></div>
          </div>
          {totals.missing && <div className="sub mt">One or more phases have no confirmed price. Fill them in or set the price under Proposals &gt; Settings.</div>}
        </div>

        <div className="card mt2">
          <div className="spread">
            <h3>Monthly retainer</h3>
            <label className="row" style={{ gap: 8, fontSize: '.88rem' }}>
              <input type="checkbox" checked={!!content.retainer?.included}
                onChange={e => patch({ retainer: { ...(content.retainer || {}), included: e.target.checked, cadence_note: content.retainer?.cadence_note || RETAINER_NOTE[proposal.language] } })} />
              Include on the proposal
            </label>
          </div>
          {content.retainer?.included && (
            <>
              <div className="grid2 mt">
                <div className="fld"><label className="lab">Monthly price</label>
                  <input className="ti" type="number" min="0" step="0.01"
                    value={content.retainer?.price ?? ''} placeholder="[VERIFY]"
                    onChange={e => patch({ retainer: { ...content.retainer, price: e.target.value === '' ? null : Number(e.target.value) } })} /></div>
              </div>
              <div className="fld"><label className="lab">Retainer terms</label>
                <textarea className="ta" value={content.retainer?.cadence_note || ''}
                  onChange={e => patch({ retainer: { ...content.retainer, cadence_note: e.target.value } })} /></div>
            </>
          )}
        </div>

        <div className="card mt2">
          <h3>Agreement</h3>
          <div className="fld mt"><label className="lab">Agreement text (above the signature lines)</label>
            <textarea className="ta" value={content.agreement_text} onChange={C('agreement_text')} /></div>
        </div>

      </fieldset>

      <div className="row mt2" style={{ flexWrap: 'wrap' }}>
        {!locked && (
          <button className="btn gh" disabled={!!busy || !dirty} onClick={save}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        )}
        <button className="btn gh" disabled={!!busy} onClick={locked ? downloadSigned : downloadPdf}>
          {busy === 'pdf' ? 'Building PDF…' : locked ? 'Download signed PDF' : 'Download PDF'}
        </button>
        {!locked && (
          <button className="btn" disabled={!!busy} onClick={send}>
            {busy === 'send' ? 'Sending…' : proposal.status === 'draft' ? 'Send proposal' : 'Resend proposal'}
          </button>
        )}
      </div>
      {proposal.status !== 'draft' && !locked && proposal.sent_at && (
        <div className="sub mt">Signing link emailed {new Date(proposal.sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} to {content.client_email}. Resending issues a fresh link.</div>
      )}
      {signLink && (
        <div className="fld mt2"><label className="lab">Signing link</label>
          <textarea className="ta" style={{ minHeight: 54, fontSize: '.78rem' }} readOnly value={signLink} onClick={e => e.target.select()} /></div>
      )}

      {toast && <div className="tst">{toast}</div>}
    </div>
  );
}
