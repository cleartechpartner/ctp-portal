// Proposals: send the signing link. Runs with the caller's user JWT only;
// the staff RLS policies authorise every read and write. No service role key.
const { randomBytes } = require('crypto');
const { buildProposalPdf } = require('./lib/proposal-pdf');

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

async function sendEmail(to, subject, html, attachments) {
  if (!RESEND_KEY) return { skipped: true };
  var payload = { from: FROM, to: [to], subject: subject, html: html };
  if (attachments) payload.attachments = attachments;
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
    body: JSON.stringify(payload)
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

const formatNumber = (n) => 'CTP-PROP-' + String(n == null ? 0 : n).padStart(4, '0');

function proposalEmail(p, content, link) {
  var es = p.language === 'es';
  var subject = (es ? 'Propuesta | ' : 'Proposal | ') + p.project_title;
  var intro = es
    ? 'Hola,<br/><br/>Clear Tech Partner le ha preparado la propuesta <b>' + esc(p.project_title) + '</b> (' + formatNumber(p.proposal_number) + '). ' +
      'Puede revisarla y firmarla electronicamente desde el enlace. Tambien la adjuntamos en PDF.' +
      '<br/><br/>Este enlace es personal y caduca en ' + TOKEN_DAYS + ' dias. No lo reenvie a nadie.'
    : 'Hi,<br/><br/>Clear Tech Partner has prepared the proposal <b>' + esc(p.project_title) + '</b> (' + formatNumber(p.proposal_number) + ') for you. ' +
      'You can review and sign it electronically from the link below. A PDF copy is attached.' +
      '<br/><br/>This link is personal to you and expires in ' + TOKEN_DAYS + ' days. Please do not forward it.';
  return { subject: subject, html: emailShell(subject, intro, es ? 'Revisar y firmar' : 'Review and sign', link) };
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };
    if (caller.role !== 'internal') return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };

    var body = JSON.parse(event.body || '{}');
    var proposalId = body.proposal_id;
    if (!proposalId) return { statusCode: 400, body: JSON.stringify({ error: 'proposal_id required' }) };

    var rows = await pg(
      'proposals?id=eq.' + proposalId +
      '&select=id,client_id,proposal_number,project_title,language,currency,status,content_json,sent_at',
      null, caller.token
    );
    var p = rows && rows[0];
    if (!p) return { statusCode: 404, body: JSON.stringify({ error: 'Proposal not found' }) };
    if (p.status === 'signed') return { statusCode: 400, body: JSON.stringify({ error: 'Proposal already signed' }) };

    var content = p.content_json || {};
    var to = (content.client_email || '').trim();
    if (!to) return { statusCode: 400, body: JSON.stringify({ error: 'No client email on the proposal' }) };

    // Fresh token every send; older links for this proposal are retired so
    // exactly one link is live at a time.
    var token = randomBytes(32).toString('hex');
    var expires = new Date(Date.now() + TOKEN_DAYS * 86400000).toISOString();
    await pg('proposal_tokens?proposal_id=eq.' + p.id + '&signed_at=is.null', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { expires_at: new Date().toISOString() }
    }, caller.token);
    await pg('proposal_tokens', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { proposal_id: p.id, token: token, expires_at: expires }
    }, caller.token);

    var link = SITE + '/sign/' + token;
    var pdf = await buildProposalPdf({
      number: formatNumber(p.proposal_number),
      content: content,
      language: p.language,
      currency: p.currency,
      dateISO: new Date().toISOString(),
    });

    var mail = proposalEmail(p, content, link);
    var emailed = false;
    var sent = await sendEmail(to, mail.subject, mail.html, [
      { filename: formatNumber(p.proposal_number) + '.pdf', content: pdf.toString('base64') }
    ]);
    emailed = !sent.skipped;

    await pg('proposals?id=eq.' + p.id, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { status: 'sent', sent_at: new Date().toISOString() }
    }, caller.token);

    await pg('activity_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        actor_email: caller.email, action: 'proposal_sent', client_id: p.client_id,
        details: formatNumber(p.proposal_number) + ' | ' + p.project_title + ' | ' + to
      }
    }, caller.token);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, emailed: emailed, sign_url: emailed ? undefined : link })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
