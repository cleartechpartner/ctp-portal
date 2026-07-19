import { useState } from 'react';
import { supabase } from '../lib/supabase';
import PhoneInput from '../components/PhoneInput';
import { PRIORITIES } from '../lib/prospects';

// Quick-create form for a prospect. Lands at stage New with a "Created
// manually" interaction so the timeline records where the record came from.

export default function NewProspectModal({ myProfile, onClose, onCreated, toast }) {
  const [form, setForm] = useState({
    name: '', locality: '', segment: '', ownership: '', website: '', phone: '', priority: 'Medium', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const F = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { data: row, error } = await supabase.from('clients').insert({
        name: form.name.trim(),
        locality: form.locality.trim() || null,
        segment: form.segment.trim() || null,
        ownership: form.ownership.trim() || null,
        website: form.website.trim() || null,
        phone: (form.phone || '').trim() || null,
        priority: form.priority,
        partner_notes: form.notes.trim() || null,
        client_status: 'prospect',
        pipeline_stage: 'New',
      }).select('id, name').single();
      if (error) throw new Error(error.message);

      const { error: iErr } = await supabase.from('interactions').insert({
        client_id: row.id,
        kind: 'note',
        title: 'Created manually',
        created_by: myProfile?.id || null,
      });
      if (iErr) throw new Error('Prospect created, but logging failed: ' + iErr.message);

      toast('Prospect created');
      onCreated(row);
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={create}>
        <div className="modal-head"><h3>New prospect</h3><button type="button" className="link-btn" onClick={onClose}>Close</button></div>
        {err && <div className="auth-err">{err}</div>}
        <div className="fld"><label className="lab">Property name</label>
          <input className="ti" value={form.name} onChange={F('name')} required autoFocus placeholder="Hotel Example & Spa" /></div>
        <div className="grid2">
          <div className="fld"><label className="lab">Locality</label>
            <input className="ti" value={form.locality} onChange={F('locality')} placeholder="Es Castell" /></div>
          <div className="fld"><label className="lab">Segment</label>
            <input className="ti" value={form.segment} onChange={F('segment')} placeholder="Boutique / spa" /></div>
          <div className="fld"><label className="lab">Ownership</label>
            <input className="ti" value={form.ownership} onChange={F('ownership')} placeholder="Independent" /></div>
          <div className="fld"><label className="lab">Priority</label>
            <select className="sel" value={form.priority} onChange={F('priority')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select></div>
          <div className="fld"><label className="lab">Website</label>
            <input className="ti" value={form.website} onChange={F('website')} placeholder="hotel-example.com" /></div>
          <div className="fld"><label className="lab">Phone</label>
            <PhoneInput value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} /></div>
        </div>
        <div className="fld"><label className="lab">Notes</label>
          <textarea className="ta" style={{ minHeight: 70 }} value={form.notes} onChange={F('notes')} /></div>
        <div className="modal-foot">
          <button type="button" className="btn gh sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" disabled={busy || !form.name.trim()}>{busy ? 'Creating...' : 'Create prospect'}</button>
        </div>
      </form>
    </div>
  );
}
