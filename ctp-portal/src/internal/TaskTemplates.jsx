import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TASK_PRIORITY } from '../lib/tasks';

// Template manager. A template is a stamp: applying it generates real,
// independent tasks. Editing a template never touches tasks already made.

const EMPTY_ITEM = { title: '', description: '', priority: 'medium', offset_days: 0, duration_days: 1 };

export default function TaskTemplates() {
  const [templates, setTemplates] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [items, setItems] = useState([]);
  const [tplForm, setTplForm] = useState({ name: '', target_duration_weeks: 4 });
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const flash = (m) => { setOk(m); setTimeout(() => setOk(''), 2200); };

  const loadTemplates = async () => {
    setErr('');
    const { data, error } = await supabase.from('task_templates')
      .select('*, task_template_items(id)')
      .order('created_at', { ascending: false });
    if (error) { setErr(error.message); setTemplates([]); return; }
    setTemplates(data || []);
  };
  useEffect(() => { loadTemplates(); }, []);

  const loadItems = async (tplId) => {
    const { data, error } = await supabase.from('task_template_items')
      .select('*').eq('template_id', tplId)
      .order('sort_order').order('offset_days');
    if (error) { setErr(error.message); return; }
    setItems(data || []);
  };

  const select = (tpl) => {
    setSelectedId(tpl.id === selectedId ? null : tpl.id);
    setItems([]);
    if (tpl.id !== selectedId) loadItems(tpl.id);
  };

  const createTemplate = async (e) => {
    e.preventDefault();
    if (!tplForm.name.trim()) { setErr('Give the template a name.'); return; }
    const weeks = +tplForm.target_duration_weeks;
    if (!(weeks > 0)) { setErr('Duration must be more than zero weeks.'); return; }
    setBusy(true); setErr('');
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('task_templates')
      .insert({ name: tplForm.name.trim(), target_duration_weeks: weeks, created_by: userData?.user?.id })
      .select('id').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setTplForm({ name: '', target_duration_weeks: 4 });
    await loadTemplates();
    setSelectedId(data.id);
    setItems([]);
  };

  const updateTemplate = async (id, patch) => {
    const { error } = await supabase.from('task_templates').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    setTemplates(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
  };

  const deleteTemplate = async (tpl) => {
    if (!window.confirm(`Delete template "${tpl.name}" and its ${tpl.task_template_items?.length || 0} items? Tasks already generated from it are kept.`)) return;
    const { error } = await supabase.from('task_templates').delete().eq('id', tpl.id);
    if (error) { setErr(error.message); return; }
    if (selectedId === tpl.id) { setSelectedId(null); setItems([]); }
    await loadTemplates();
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!itemForm.title.trim()) { setErr('The task needs a title.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('task_template_items').insert({
      template_id: selectedId,
      title: itemForm.title.trim(),
      description: itemForm.description.trim() || null,
      priority: itemForm.priority,
      offset_days: +itemForm.offset_days || 0,
      duration_days: Math.max(1, +itemForm.duration_days || 1),
      sort_order: items.length
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setItemForm(EMPTY_ITEM);
    await loadItems(selectedId);
    await loadTemplates();
  };

  const updateItem = async (id, patch) => {
    const { error } = await supabase.from('task_template_items').update(patch).eq('id', id);
    if (error) { setErr(error.message); return; }
    setItems(list => list.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  const removeItem = async (item) => {
    const { error } = await supabase.from('task_template_items').delete().eq('id', item.id);
    if (error) { setErr(error.message); return; }
    await loadItems(selectedId);
    await loadTemplates();
  };

  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const a = items[idx], b = items[j];
    // Swap sort positions; normalise to index order to heal any gaps.
    await updateItem(a.id, { sort_order: j });
    await updateItem(b.id, { sort_order: idx });
    await loadItems(selectedId);
  };

  if (!templates) return <div className="center"><div className="sp" /></div>;

  return (
    <>
      {err && <div className="auth-err" style={{ marginBottom: 14 }}>{err}</div>}
      {ok && <div className="auth-ok" style={{ marginBottom: 14 }}>{ok}</div>}

      <form className="card spine" onSubmit={createTemplate}>
        <h3>New template</h3>
        <div className="sub">Onboarding, offboarding, monthly cycle: build the group once, stamp it onto any project.</div>
        <div className="tm-tpl-form">
          <input className="ti" placeholder="Template name" value={tplForm.name}
            onChange={e => setTplForm(f => ({ ...f, name: e.target.value }))} />
          <input className="ti tm-weeks" type="number" min="0.5" step="0.5" title="Target duration in weeks"
            value={tplForm.target_duration_weeks}
            onChange={e => setTplForm(f => ({ ...f, target_duration_weeks: e.target.value }))} />
          <button className="btn sm" disabled={busy}>Create template</button>
        </div>
      </form>

      {templates.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}><div className="empty">No templates yet.</div></div>
      )}

      {templates.map(tpl => (
        <div key={tpl.id} className="card" style={{ marginTop: 14, padding: 0 }}>
          <div className="tm-tpl-head" onClick={() => select(tpl)}>
            <div className="tm-project-main">
              <div className="nm">{tpl.name}</div>
              <div className="meta">{tpl.task_template_items?.length || 0} tasks | {+tpl.target_duration_weeks} wk target</div>
            </div>
            <button className="icon-btn icon-btn-danger" title="Delete template"
              onClick={(e) => { e.stopPropagation(); deleteTemplate(tpl); }}>×</button>
            <span className="tm-tpl-chevron">{selectedId === tpl.id ? '▾' : '▸'}</span>
          </div>

          {selectedId === tpl.id && (
            <div className="tm-tpl-body">
              <div className="tm-tpl-meta">
                <label className="lab" style={{ margin: 0 }}>Name</label>
                <input className="ti" defaultValue={tpl.name}
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== tpl.name) updateTemplate(tpl.id, { name: v }); }} />
                <label className="lab" style={{ margin: 0 }}>Target weeks</label>
                <input className="ti tm-weeks" type="number" min="0.5" step="0.5" defaultValue={tpl.target_duration_weeks}
                  onBlur={e => { const v = +e.target.value; if (v > 0 && v !== +tpl.target_duration_weeks) updateTemplate(tpl.id, { target_duration_weeks: v }); }} />
              </div>

              <div className="tm-item-head">
                <span>Task</span><span>Priority</span><span title="Days after project start">Offset</span>
                <span title="Working window in days">Days</span><span></span>
              </div>
              {items.map((it, idx) => (
                <div key={it.id} className="tm-item-row">
                  <div>
                    <input className="ti" defaultValue={it.title}
                      onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.title) updateItem(it.id, { title: v }); }} />
                    <input className="ti tm-item-desc" placeholder="Description (optional)" defaultValue={it.description || ''}
                      onBlur={e => { const v = e.target.value.trim() || null; if (v !== it.description) updateItem(it.id, { description: v }); }} />
                  </div>
                  <select className="sel" value={it.priority} onChange={e => updateItem(it.id, { priority: e.target.value })}>
                    {TASK_PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input className="ti" type="number" min="0" value={it.offset_days}
                    onChange={e => updateItem(it.id, { offset_days: Math.max(0, +e.target.value || 0) })} />
                  <input className="ti" type="number" min="1" value={it.duration_days}
                    onChange={e => updateItem(it.id, { duration_days: Math.max(1, +e.target.value || 1) })} />
                  <div className="tm-item-actions">
                    <button className="icon-btn" title="Move up" disabled={idx === 0} onClick={() => move(idx, -1)}>↑</button>
                    <button className="icon-btn" title="Move down" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}>↓</button>
                    <button className="icon-btn icon-btn-danger" title="Remove task" onClick={() => removeItem(it)}>×</button>
                  </div>
                </div>
              ))}
              {items.length === 0 && <div className="empty" style={{ padding: 14 }}>No tasks in this template yet.</div>}

              <form className="tm-item-row tm-item-new" onSubmit={addItem}>
                <div>
                  <input className="ti" placeholder="New task title" value={itemForm.title}
                    onChange={e => setItemForm(f => ({ ...f, title: e.target.value }))} />
                  <input className="ti tm-item-desc" placeholder="Description (optional)" value={itemForm.description}
                    onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <select className="sel" value={itemForm.priority} onChange={e => setItemForm(f => ({ ...f, priority: e.target.value }))}>
                  {TASK_PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input className="ti" type="number" min="0" value={itemForm.offset_days}
                  onChange={e => setItemForm(f => ({ ...f, offset_days: e.target.value }))} />
                <input className="ti" type="number" min="1" value={itemForm.duration_days}
                  onChange={e => setItemForm(f => ({ ...f, duration_days: e.target.value }))} />
                <button className="btn sm" disabled={busy || !itemForm.title.trim()}>Add</button>
              </form>
              <div className="sub" style={{ padding: '0 16px 14px' }}>
                Offset is days after project start. Due date on generated tasks = start + offset + days.
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
