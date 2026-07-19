// Prospect CRM: send a one-off email to a prospect contact and log it as
// an interaction. Runs with the caller's user JWT only; the staff RLS
// policies authorise every read and write. No service role key.
//
// TODO: Resend open-tracking webhooks are not wired up yet. When they are,
// store open counts in interactions.metadata.opens; the timeline already
// renders them with the "unreliable signal" hint. Send-logging only for now.

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';

var GRADIENT = 'linear-gradient(120deg,#0052FF 0%,#00B8E6 55%,#2ED6A6 100%)';

function emailShell(title, bodyHtml) {
  return '<!doctype html><html><body style="margin:0;background:#f7f9fb;font-family:Helvetica,Arial,sans-serif;color:#101826">' +
  '<div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e3e9f0;border-radius:12px;overflow:hidden">' +
    '<div style="height:5px;background:' + GRADIENT + '"></div>' +
    '<div style="padding:32px 36px">' +
      '<p style="font-size:11px;letter-spacing:3px;color:#5d6b7e;margin:0 0 18px">CLEAR TECH PARTNER</p>' +
      '<h1 style="font-size:20px;margin:0 0 14px">' + title + '</h1>' +
      '<div style="font-size:15px;line-height:1.6;color:#33404f">' + bodyHtml + '</div>' +
      '<p style="font-size:12px;color:#8b97a5;margin-top:30px">Clear Tech Partner · Mahon, Menorca · cleartechpartner.com</p>' +
    '</div>' +
  '</div></body></html>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

// PostgREST call under the caller's JWT. Always consumes the response body.
async function pg(path, opts, jwt) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: (opts && opts.method) || 'GET',
    headers: Object.assign({
      apikey: ANON_KEY,
      Authorization: 'Bearer ' + jwt,
      'Content-Type': 'application/json'
    }, (opts && opts.headers) || {}),
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined
  });
  var text = await res.text();
  if (!res.ok) {
    var msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) {}
    throw new Error('Database: ' + msg.slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };

    var body = JSON.parse(event.body || '{}');
    var clientId = body.client_id;
    var to = String(body.to || '').trim();
    var subject = String(body.subject || '').trim();
    var message = String(body.message || '').trim();
    if (!clientId) return { statusCode: 400, body: JSON.stringify({ error: 'client_id required' }) };
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { statusCode: 400, body: JSON.stringify({ error: 'A valid recipient email is required' }) };
    if (!subject) return { statusCode: 400, body: JSON.stringify({ error: 'Subject is required' }) };
    if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'Message is required' }) };
    if (!RESEND_KEY) return { statusCode: 400, body: JSON.stringify({ error: 'Email is not configured (RESEND_API_KEY missing)' }) };

    // Confirms the client exists and that staff RLS lets this caller see it.
    var rows = await pg('clients?id=eq.' + clientId + '&select=id,name', null, caller.token);
    if (!rows || !rows[0]) return { statusCode: 404, body: JSON.stringify({ error: 'Client not found' }) };

    var html = emailShell(esc(subject), esc(message).replace(/\r?\n/g, '<br/>'));
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
      body: JSON.stringify({ from: FROM, to: [to], subject: subject, html: html, reply_to: caller.email })
    });
    var resText = await res.text();
    if (!res.ok) throw new Error('Resend ' + res.status + ': ' + resText.slice(0, 200));
    var sent = JSON.parse(resText);

    await pg('interactions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        client_id: clientId,
        contact_id: body.contact_id || null,
        kind: 'email',
        title: subject,
        body: message,
        created_by: caller.id,
        metadata: { resend_id: sent.id || null, to: to }
      }
    }, caller.token);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
