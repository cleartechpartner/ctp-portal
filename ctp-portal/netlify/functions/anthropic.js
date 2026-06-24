const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

async function getCaller(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.slice(7);
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;

  var uRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!uRes.ok) return null;
  var user = await uRes.json();

  var pRes = await fetch(
    SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role,email,client_id,language',
    { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } }
  );
  var rows = await pRes.json();
  if (!rows || !rows[0]) return null;
  return { id: user.id, ...rows[0] };
}

async function claude(messages, max_tokens, system) {
  var body = { model: MODEL, max_tokens: max_tokens || 1000, messages: messages };
  if (system) body.system = system;
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    var e = await res.text();
    throw new Error('Anthropic ' + res.status + ': ' + e.slice(0, 200));
  }
  var d = await res.json();
  return (d.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n').trim();
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };

    var body = JSON.parse(event.body || '{}');

    if (body.mode === 'translate') {
      var target = body.target === 'en' ? 'English' : 'Spanish (peninsular Spain, tú register, hospitality-professional tone)';
      var text = await claude(
        [{ role: 'user', content: body.text || '' }],
        Math.max(1200, Math.ceil((body.text || '').length / 2)),
        'You are the official translator for Clear Tech Partner, a hospitality technology consultancy in Menorca. Translate the user\'s message into ' + target + '. Preserve meaning, tone, formatting and line breaks exactly. Never add commentary, notes, or quotation marks. Output only the translation.'
      );
      return { statusCode: 200, body: JSON.stringify({ text: text }) };
    }

    var text2 = await claude(body.messages || [], body.max_tokens || 1000, body.system);
    return { statusCode: 200, body: JSON.stringify({ text: text2 }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
