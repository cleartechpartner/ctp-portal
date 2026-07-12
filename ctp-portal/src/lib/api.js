import { supabase } from './supabase';

export async function fx(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`
    },
    body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = d.debug ? ' [' + d.debug.join(' → ') + ']' : '';
    throw new Error((d.error || `Request failed (${r.status})`) + detail);
  }
  return d;
}

export const claudeCall = (payload) => fx('/api/anthropic', { mode: 'generate', ...payload }).then(d => d.text);
export const translate = (text, target = 'es') => fx('/api/anthropic', { mode: 'translate', text, target }).then(d => d.text);
export const notify = (event, payload = {}) => fx('/api/notify', { event, ...payload });
export const inviteClient = (payload) => fx('/api/invite', payload);

export async function signedUrl(path) {
  const { data, error } = await supabase.storage.from('client-docs').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export function fmtBytes(b) {
  if (!b && b !== 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function monthLabel(m, lang = 'en') {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, (mo || 1) - 1, 1);
  return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', { month: 'long', year: 'numeric' });
}
