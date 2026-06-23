// /api/anthropic — Claude proxy for the Content Studio + translation engine.
// The Anthropic API key lives only in Netlify environment variables.
// Only authenticated internal (@cleartechpartner.com) users may call this.

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

async function getCaller(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (!SUPABASE_URL || !ANON_KEY) { console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars'); return null; }
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!uRes.ok) { console.error('Auth check failed:', uRes.status, await uRes.text().catch(() => '')); return null; }
  const user = await uRes.json();
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,email,client_id,language`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await pRes.json();
  if (!rows || !rows[0]) return null;
  return { id: user.id, ...rows[0] };
}

async function claude(messages, max_tokens, system) {
  const body = { model: MODEL, max_tokens: max_tokens || 1000, messages };
  if (system) body.system = system;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(`Anthropic ${res.status}: ${e.slice(0, 200)}`);
  }
  const d = await res.json();
  return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };

    const body = JSON.parse(event.body || '{}');

    if (body.mode === 'translate') {
      const target = body.target === 'en' ? 'English' : 'Spanish (peninsular Spain, tú register, hospitality-professional tone)';
      const text = await claude(
        [{ role: 'user', content: body.text || '' }],
        Math.max(1200, Math.ceil((body.text || '').length / 2)),
        `You are the official translator for Clear Tech Partner, a hospitality technology consultancy in Menorca. Translate the user's message into ${target}. Preserve meaning, tone, formatting and line breaks exactly. Never add commentary, notes, or quotation marks. Output only the translation.`
      );
      return { statusCode: 200, body: JSON.stringify({ text }) };
    }

    // default: generate (Content Studio)
    const text = await claude(body.messages || [], body.max_tokens || 1000, body.system);
    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
