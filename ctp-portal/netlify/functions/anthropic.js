const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

async function getCaller(authHeader) {
  const debug = [];
  if (!authHeader || !authHeader.startsWith('Bearer ')) { debug.push('No auth header'); return { caller: null, debug }; }
  const token = authHeader.slice(7);
  if (!token) { debug.push('Empty token'); return { caller: null, debug }; }
  debug.push('Token present');
  if (!SUPABASE_URL) { debug.push('SUPABASE_URL missing'); return { caller: null, debug }; }
  if (!ANON_KEY) { debug.push('SUPABASE_ANON_KEY missing'); return { caller: null, debug }; }
  debug.push('URL: ' + SUPABASE_URL.slice(0, 30) + '...');

  const uRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!uRes.ok) {
    const body = await uRes.text().catch(function() { return ''; });
    debug.push('Auth check failed: ' + uRes.status + ' ' + body.slice(0, 200));
    return { caller: null, debug };
  }
  var user = await uRes.json();
  debug.push('User found: ' + user.email);

  if (!SERVICE_KEY) { debug.push('SERVICE_ROLE_KEY missing'); return { caller: null, debug }; }
  var pRes = await fetch(
    SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role,email,client_id,language',
    { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }
  );
  var rows = await pRes.json();
  if (!rows || !rows[0]) { debug.push('No profile row for user ' + user.id); return { caller: null, debug }; }
  debug.push('Profile role: ' + rows[0].role);
  return { caller: { id: user.id, ...rows[0] }, debug };
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
    var result = await getCaller(event.headers.authorization || event.headers.Authorization);
    var caller = result.caller;
    var debug = result.debug;
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in', debug: debug }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only', debug: debug }) };

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
