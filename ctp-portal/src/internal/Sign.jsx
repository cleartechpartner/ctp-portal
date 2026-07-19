import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ENVELOPE_STATUS, fmtDateTime } from '../lib/esign';

export default function Sign() {
  const nav = useNavigate();
  const location = useLocation();
  const tab = location.hash === '#templates' ? 'templates' : 'documents';

  const [envelopes, setEnvelopes] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [err, setErr] = useState('');

  const load = async () => {
    setErr('');
    const { data: envs, error: e1 } = await supabase
      .from('envelopes')
      .select('id, name, language, status, client_id, created_at, sent_at, completed_at, envelope_signers(id, name, email, status, sign_order)')
      .order('created_at', { ascending: false });
    if (e1) { setErr(e1.message); setEnvelopes([]); return; }
    setEnvelopes(envs || []);

    const { data: tpls, error: e2 } = await supabase
      .from('envelope_templates')
      .select('*')
      .order('created_at', { ascending: false });
    if (!e2) setTemplates(tpls || []);
  };
  useEffect(() => { load(); }, []);

  const deleteTemplate = async (tpl) => {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    await supabase.storage.from('esign').remove([tpl.source_ref]);
    const { error } = await supabase.from('envelope_templates').delete().eq('id', tpl.id);
    if (error) { setErr(error.message); return; }
    setTemplates(ts => ts.filter(t => t.id !== tpl.id));
  };

  const deleteDraft = async (env) => {
    if (!window.confirm(`Delete draft "${env.name}"?`)) return;
    if (env.status !== 'draft') return;
    await supabase.storage.from('esign').remove([`${env.id}/source.pdf`]);
    const { error } = await supabase.from('envelopes').delete().eq('id', env.id);
    if (error) { setErr(error.message); return; }
    setEnvelopes(es => es.filter(e => e.id !== env.id));
  };

  const lastActivity = (env) => env.completed_at || env.sent_at || env.created_at;

  if (!envelopes) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="spread" style={{ marginBottom: 14 }}>
        <span />
        <button className="btn sm" onClick={() => nav('/sign/new')}>+ New document</button>
      </div>

      <div className="es-tabs">
        <a href="/sign" className={'es-tab' + (tab === 'documents' ? ' on' : '')}>Documents</a>
        <a href="/sign#templates" className={'es-tab' + (tab === 'templates' ? ' on' : '')}>Templates</a>
      </div>

      {err && <div className="auth-err">{err}</div>}

      {tab === 'documents' && (
        <div className="card" style={{ padding: 0 }}>
          {envelopes.length === 0 && (
            <div className="empty" style={{ padding: 24 }}>No documents yet. Send the first one.</div>
          )}
          {envelopes.map(env => {
            const sc = ENVELOPE_STATUS[env.status] || ENVELOPE_STATUS.draft;
            const signers = [...(env.envelope_signers || [])].sort((a, b) => a.sign_order - b.sign_order);
            const recipients = signers.map(s => s.name || s.email).join(', ');
            return (
              <div key={env.id} className="es-row" onClick={() => nav(env.status === 'draft' ? `/sign/new?draft=${env.id}` : `/sign/${env.id}`)}>
                <div className="es-row-main">
                  <div className="es-row-name">{env.name}</div>
                  <div className="es-row-meta">{recipients || 'No recipients yet'}</div>
                </div>
                <span className="chip">{env.language === 'es' ? 'ES' : 'EN'}</span>
                <span className={`co-pill ${sc.cls}`}>
                  <span className="co-dot" style={{ background: sc.dot, marginRight: 6 }} />{sc.label}
                </span>
                <span className="es-row-date">{fmtDateTime(lastActivity(env))}</span>
                {env.status === 'draft' && (
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Delete draft"
                    onClick={(e) => { e.stopPropagation(); deleteDraft(env); }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'templates' && (
        <>
          <div className="card" style={{ padding: 0 }}>
            {templates.length === 0 && (
              <div className="empty" style={{ padding: 24 }}>
                No templates yet. Create one from scratch, or open a prepared document and choose Save as template.
              </div>
            )}
            {templates.map(tpl => (
              <div key={tpl.id} className="es-row" onClick={() => nav(`/sign/new?template=${tpl.id}`)}>
                <div className="es-row-main">
                  <div className="es-row-name">{tpl.name}</div>
                  <div className="es-row-meta">{tpl.category === 'contract' ? 'Contract' : 'Proposal'} · {(tpl.field_layout || []).length} fields</div>
                </div>
                <span className="chip">{tpl.language === 'es' ? 'ES' : 'EN'}</span>
                <span className="es-row-date">{fmtDateTime(tpl.created_at)}</span>
                <button
                  className="icon-btn icon-btn-danger"
                  title="Delete template"
                  onClick={(e) => { e.stopPropagation(); deleteTemplate(tpl); }}
                >×</button>
              </div>
            ))}
          </div>
          <div className="sub" style={{ marginTop: 12 }}>
            Click a template to start a new document from it. New template: <button className="link-btn" onClick={() => nav('/sign/new?as_template=1')}>upload a PDF and place fields</button>.
          </div>
        </>
      )}
    </div>
  );
}
