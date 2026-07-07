// E-sign: send an envelope. Runs with the caller's user JWT only — the
// internal RLS policies authorise every read and write. No service role key.
const { randomBytes } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';
const SITE = process.env.SITE_URL || 'https://portal.cleartechpartner.com';

const TOKEN_DAYS = 30;

var GRADIENT = 'linear-gradient(120deg,#0052FF 0%,#00B8E6 55%,#2ED6A6 100%)';

function emailShell(title, bodyHtml, cta, ctaUrl) {
  return '<!doctype html><html><body style="margin:0;background:#f7f9fb;font-family:Helvetica,Arial,sans-serif;color:#101826">' +
  '<div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e3e9f0;border-radius:12px;overflow:hidden">' +
    '<div style="height:5px;background:' + GRADIENT + '"></div>' +
    '<div style="padding:32px 36px">' +
      '<p style="font-size:11px;letter-spacing:3px;color:#5d6b7e;margin:0 0 18px">CLEAR TECH PARTNER</p>' +
      '<h1 style="font-size:20px;margin:0 0 14px">' + title + '</h1>' +
      '<div style="font-size:15px;line-height:1.6;color:#33404f">' + bodyHtml + '</div>' +
      (cta ? '<a href="' + ctaUrl + '" style="display:inline-block;margin-top:22px;background:#0052FF;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:14px;font-weight:600">' + cta + '</a>' : '') +
      '<p style="font-size:12px;color:#8b97a5;margin-top:30px">Clear Tech Partner · Mahon, Menorca · cleartechpartner.com</p>' +
    '</div>' +
  '</div></body></html>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return { skipped: true };
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
    body: JSON.stringify({ from: FROM, to: [to], subject: subject, html: html })
  });
  var body = await res.text();
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + body.slice(0, 200));
  return JSON.parse(body);
}

async function getCaller(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.slice(7);
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  var uRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
  });
  var uBody = await uRes.text();
  if (!uRes.ok) return null;
  var user = JSON.parse(uBody);
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

function signerEmail(env, signer, token) {
  var link = SITE + '/esign/' + token;
  var es = env.language === 'es';
  var subject = (es ? 'Firma solicitada | ' : 'Signature requested | ') + env.name;
  var intro = es
    ? 'Hola ' + esc(signer.name) + ',<br/><br/>Clear Tech Partner te ha enviado <b>' + esc(env.name) + '</b> para revisarlo y firmarlo electrónicamente.'
    : 'Hi ' + esc(signer.name) + ',<br/><br/>Clear Tech Partner has sent you <b>' + esc(env.name) + '</b> to review and sign electronically.';
  if (env.message) {
    intro += '<br/><br/><i>' + esc(env.message) + '</i>';
  }
  intro += '<br/><br/>' + (es
    ? 'Este enlace es personal. No lo reenvíes a nadie.'
    : 'This link is personal to you. Please do not forward it.');
  return sendEmail(signer.email, subject, emailShell(subject, intro, es ? 'Revisar y firmar' : 'Review and sign', link));
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };

    var body = JSON.parse(event.body || '{}');
    var envelopeId = body.envelope_id;
    if (!envelopeId) return { statusCode: 400, body: JSON.stringify({ error: 'envelope_id required' }) };

    var rows = await pg(
      'envelopes?id=eq.' + envelopeId +
      '&select=id,name,language,status,message,signing_mode,envelope_signers(id,name,email,sign_order,status)',
      null, caller.token
    );
    var env = rows && rows[0];
    if (!env) return { statusCode: 404, body: JSON.stringify({ error: 'Envelope not found' }) };
    if (env.status !== 'draft') return { statusCode: 400, body: JSON.stringify({ error: 'Envelope already ' + env.status }) };
    var signers = (env.envelope_signers || []).sort(function(a, b) { return a.sign_order - b.sign_order; });
    if (!signers.length) return { statusCode: 400, body: JSON.stringify({ error: 'No signers on this envelope' }) };
    var expires = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();

    // Tokens for everyone; the token is the signer's only credential.
    var tokens = {};
    for (var i = 0; i < signers.length; i++) {
      tokens[signers[i].id] = randomBytes(32).toString('hex');
      await pg('envelope_signers?id=eq.' + signers[i].id, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { token: tokens[signers[i].id], token_expires_at: expires }
      }, caller.token);
    }

    // Email now: everyone (parallel) or just the first signer (sequential).
    var toEmail = env.signing_mode === 'parallel' ? signers : [signers[0]];
    for (var j = 0; j < toEmail.length; j++) {
      var s = toEmail[j];
      await signerEmail(env, s, tokens[s.id]);
      await pg('envelope_signers?id=eq.' + s.id, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { status: 'sent', sent_at: new Date().toISOString() }
      }, caller.token);
      await pg('envelope_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: {
          envelope_id: env.id, event_type: 'sent', actor: caller.email,
          metadata: { signer: s.email, sign_order: s.sign_order }
        }
      }, caller.token);
    }

    await pg('envelopes?id=eq.' + env.id, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { status: 'sent', sent_at: new Date().toISOString() }
    }, caller.token);

    return { statusCode: 200, body: JSON.stringify({ ok: true, emailed: toEmail.length }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
