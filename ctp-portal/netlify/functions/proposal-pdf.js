// Proposals: build the branded PDF for download. Runs with the caller's
// user JWT only; staff RLS authorises the read. No service role key.
const { buildProposalPdf } = require('./lib/proposal-pdf');

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
    SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role,email',
    { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } }
  );
  var rows = await pRes.json();
  return rows && rows[0] ? { id: user.id, token: token, ...rows[0] } : null;
}

async function pg(path, jwt) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + jwt }
  });
  var text = await res.text();
  if (!res.ok) {
    var msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) {}
    throw new Error('Database: ' + msg.slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}

const formatNumber = (n) => 'CTP-PROP-' + String(n == null ? 0 : n).padStart(4, '0');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };

    var body = JSON.parse(event.body || '{}');
    if (!body.proposal_id) return { statusCode: 400, body: JSON.stringify({ error: 'proposal_id required' }) };

    var rows = await pg(
      'proposals?id=eq.' + body.proposal_id +
      '&select=id,proposal_number,project_title,language,currency,status,content_json,sent_at',
      caller.token
    );
    var p = rows && rows[0];
    if (!p) return { statusCode: 404, body: JSON.stringify({ error: 'Proposal not found' }) };

    var pdf = await buildProposalPdf({
      number: formatNumber(p.proposal_number),
      content: p.content_json || {},
      language: p.language,
      currency: p.currency,
      dateISO: p.sent_at || new Date().toISOString(),
    });

    return { statusCode: 200, body: JSON.stringify({ pdf: pdf.toString('base64') }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
