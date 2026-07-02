import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';

const CAT_COLORS = {
  knowledge_base: { bg: '#E8F4FD', text: '#0C2D6B', border: '#B8DDFB' },
  agent_tuning:   { bg: '#E6FAF6', text: '#0E6E5C', border: '#A8E8D8' },
  new_feature:    { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  fix:            { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  update:         { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' },
  learning:       { bg: '#E0E7FF', text: '#3730A3', border: '#C7D2FE' },
  other:          { bg: '#F5F3FF', text: '#4C1D95', border: '#DDD6FE' },
};

const DEFAULT_COLOR = { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' };

function catColor(category) {
  return CAT_COLORS[category] || DEFAULT_COLOR;
}

export default function Updates({ profile }) {
  const { t, lang } = useLang();
  const [items, setItems] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    supabase.from('updates').select('*').eq('client_id', profile.client_id)
      .order('date', { ascending: false }).order('created_at', { ascending: false })
      .then(({ data }) => setItems(data || []));
  }, [profile.client_id]);

  const categories = useMemo(() => {
    if (!items) return [];
    const seen = new Map();
    items.forEach(u => {
      if (!seen.has(u.category)) seen.set(u.category, 0);
      seen.set(u.category, seen.get(u.category) + 1);
    });
    return Array.from(seen.entries()).map(([cat, count]) => ({ cat, count }));
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (activeFilter === 'all') return items;
    return items.filter(u => u.category === activeFilter);
  }, [items, activeFilter]);

  if (!items) return <div className="center"><div className="sp" /></div>;

  return (
    <div className="page">
      <div className="page-h">
        <span className="eyebrow">Clear Tech Partner</span>
        <h1>{t('updatesTitle')}</h1>
        <p>{t('updatesSub')}</p>
      </div>

      {items.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '8px',
          marginBottom: '16px', alignItems: 'center'
        }}>
          <button
            onClick={() => setActiveFilter('all')}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: activeFilter === 'all' ? '2px solid #0C2D6B' : '1px solid #CBD5E1',
              background: activeFilter === 'all' ? '#0C2D6B' : '#fff',
              color: activeFilter === 'all' ? '#fff' : '#334155',
              fontSize: '.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all .15s ease',
            }}
          >
            {t('filterAll') || 'All'} ({items.length})
          </button>
          {categories.map(({ cat, count }) => {
            const c = catColor(cat);
            const isActive = activeFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveFilter(isActive ? 'all' : cat)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: isActive ? `2px solid ${c.text}` : `1px solid ${c.border}`,
                  background: isActive ? c.text : c.bg,
                  color: isActive ? '#fff' : c.text,
                  fontSize: '.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all .15s ease',
                }}
              >
                {t('cat_' + cat)} ({count})
              </button>
            );
          })}
        </div>
      )}

      <div className="card">
        {filtered.length === 0 && <div className="empty">{t('noUpdatesYet')}</div>}
        {filtered.map(u => {
          const c = catColor(u.category);
          return (
            <div key={u.id} className="item">
              <div style={{ flex: 1 }}>
                <div className="row">
                  <span style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    fontSize: '.75rem',
                    fontWeight: 700,
                    letterSpacing: '.03em',
                    textTransform: 'uppercase',
                    background: c.bg,
                    color: c.text,
                    border: `1px solid ${c.border}`,
                  }}>
                    {t('cat_' + u.category)}
                  </span>
                  <span className="meta">
                    {new Date(u.date).toLocaleDateString(
                      lang === 'es' ? 'es-ES' : 'en-GB',
                      { day: 'numeric', month: 'short', year: 'numeric' }
                    )}
                  </span>
                </div>
                <div className="mt" style={{ fontSize: '.94rem' }}>
                  {lang === 'es' ? (u.body_es || u.body_en) : u.body_en}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}