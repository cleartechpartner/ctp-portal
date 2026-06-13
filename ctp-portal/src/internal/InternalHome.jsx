import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const PROPERTY_TYPES = ['Hotel & Spa', 'Boutique hotel', 'Villa / vacation rental', 'Spa', 'Restaurant', 'Independent owner', 'Other'];

export default function InternalHome() {
  const nav = useNavigate();
  const [clients, setClients] = useState(null);
  const [activity, setActivity] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', property_type: PROPERTY_TYPES[0], contact_name: '', contact_email: '', language: 'en', partner_notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const { data: cs } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    setClients(cs || []);
    const { data: act } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(8);
    setActivity(act || []);
  };
  useEffect(() => { load(); }, []);

  const createClient = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { data, error } = await supabase.from('clients').insert(form).select().single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav(`/clients/${data.id}`);
  };

  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (!clients) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h spread">
        <div>
          <span className="eyebrow">Clear Tech Partner — Internal</span>
          <h1>Clients</h1>
          <p>Every active engagement, its portal, and its history.</p>
        </div>
        <button className="btn" onClick={() => setCreating(c => !c)}>{creating ? 'Close' : 'New client'}</button>
      </div>

      {creating && (
        <form className="card spine" onSubmit={createClient} style={{ marginBottom: 22 }}>
          <h3>New client</h3>
          <div className="sub" style={{ marginBottom: 16 }}>Create the record first — projects, reports and portal access come next.</div>
          {err && <div className="auth-err">{err}</div>}
          <div className="grid2">
            <div className="fld"><label className="lab">Client / property name</label>
              <input className="ti" value={form.name} onChange={F('name')} required placeholder="Hotel Ses Bruixes & Spa" /></div>
            <div className="fld"><label className="lab">Type</label>
              <select className="sel" value={form.property_type} onChange={F('property_type')}>
                {PROPERTY_TYPES.map(p => <option key={p}>{p}</option>)}
              </select></div>
            <div className="fld"><label className="lab">Contact name</label>
              <input className="ti" value={form.contact_name} onChange={F('contact_name')} placeholder="Anya" /></div>
            <div className="fld"><label className="lab">Contact email</label>
              <input className="ti" type="email" value={form.contact_email} onChange={F('contact_email')} /></div>
            <div className="fld"><label className="lab">Portal language</label>
              <select className="sel" value={form.language} onChange={F('language')}>
                <option value="en">English</option><option value="es">Español</option>
              </select></div>
          </div>
          <div className="fld"><label className="lab">Internal notes (never visible to the client)</label>
            <textarea className="ta" value={form.partner_notes} onChange={F('partner_notes')} placeholder="Partner discount, context, anything useful." /></div>
          <button className="btn" disabled={busy || !form.name.trim()}>Create client</button>
        </form>
      )}

      {clients.length === 0 && !creating && (
        <div className="card"><div className="empty">No clients yet. Create the first one — Ses Bruixes is waiting.</div></div>
      )}

      <div className="grid3">
        {clients.map(c => (
          <button key={c.id} className="card spine" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => nav(`/clients/${c.id}`)}>
            <div className="spread">
              <h3>{c.name}</h3>
              <span className={`chip ${c.language}`}>{c.language.toUpperCase()}</span>
            </div>
            <div className="sub">{c.property_type || '—'}</div>
            <div className="row mt">
              <span className={`chip ${c.status}`}>{c.status}</span>
              {c.contact_name && <span className="sub">{c.contact_name}</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="mt3">
        <span className="eyebrow">Recent activity</span>
        <div className="card mt">
          {activity.length === 0 && <div className="empty">Activity will appear here — publishes, uploads, invites.</div>}
          {activity.map(a => (
            <div key={a.id} className="item">
              <div>
                <div className="nm">{a.action.replace(/_/g, ' ')}</div>
                <div className="meta">{a.details || ''}</div>
              </div>
              <div className="meta">{new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
