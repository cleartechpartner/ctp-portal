const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';
const INTERNAL_EMAIL = process.env.INTERNAL_NOTIFY_EMAIL || 'rainy@cleartechpartner.com';
const SITE = process.env.SITE_URL || 'https://portal.cleartechpartner.com';
const WEBHOOK = process.env.PIPEDREAM_WEBHOOK_URL;

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

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return { skipped: true };
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + RESEND_KEY },
    body: JSON.stringify({ from: FROM, to: [to], subject: subject, html: html })
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
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
    SUPABASE_URL + '/rest/v1/profiles?id=eq.' + user.id + '&select=role,email,client_id',
    { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } }
  );
  var rows = await pRes.json();
  return rows && rows[0] ? { id: user.id, token: token, ...rows[0] } : null;
}

async function getClient(clientId, token) {
  var res = await fetch(
    SUPABASE_URL + '/rest/v1/clients?id=eq.' + clientId + '&select=name,contact_name,contact_email,language',
    { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } }
  );
  var rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

async function logActivity(actor, action, clientId, details, token) {
  await fetch(SUPABASE_URL + '/rest/v1/activity_log', {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ actor_email: actor, action: action, client_id: clientId || null, details: details || null })
  });
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };

    var body = JSON.parse(event.body || '{}');
    var ev = body.event;
    var internalEvents = ['report_published', 'document_uploaded'];
    if (internalEvents.indexOf(ev) >= 0 && caller.role !== 'internal') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };
    }
    if (ev === 'client_uploaded' && caller.role !== 'client') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Client event' }) };
    }

    var result = {};

    if (ev === 'report_published') {
      var c = await getClient(body.client_id, caller.token);
      if (c && c.contact_email) {
        var es = c.language === 'es';
        var monthLabel = body.month || '';
        var subject = es ? 'Tu informe de ' + monthLabel + ' ya esta disponible' : 'Your ' + monthLabel + ' report is ready';
        var intro = es
          ? 'Hola ' + (c.contact_name || '') + ',<br/><br/>Tu informe mensual ya esta publicado en tu portal de cliente.'
          : 'Hi ' + (c.contact_name || '') + ',<br/><br/>Your monthly report is now live in your client portal.';
        result = await sendEmail(c.contact_email, subject, emailShell(subject, intro, es ? 'Ver mi informe' : 'View my report', SITE + '/reports'));
      }
      await logActivity(caller.email, 'report_published', body.client_id, body.month, caller.token);
    }

    if (ev === 'document_uploaded') {
      var c2 = await getClient(body.client_id, caller.token);
      if (c2 && c2.contact_email && body.notifyClient) {
        var es2 = c2.language === 'es';
        var subj2 = es2 ? 'Nuevo documento en tu portal' : 'A new document is in your portal';
        var intro2 = es2
          ? 'Hola ' + (c2.contact_name || '') + ',<br/><br/>Hemos anadido <b>' + (body.name || 'un documento') + '</b> a tu portal.'
          : 'Hi ' + (c2.contact_name || '') + ',<br/><br/>We have added <b>' + (body.name || 'a document') + '</b> to your client portal.';
        result = await sendEmail(c2.contact_email, subj2, emailShell(subj2, intro2, es2 ? 'Ver documentos' : 'View documents', SITE + '/documents'));
      }
      await logActivity(caller.email, 'document_uploaded', body.client_id, body.name, caller.token);
    }

    if (ev === 'client_uploaded') {
      var c3 = await getClient(caller.client_id, caller.token);
      var subj3 = 'Portal upload — ' + (c3 ? c3.name : 'client') + ': ' + (body.name || 'document');
      result = await sendEmail(INTERNAL_EMAIL, subj3, emailShell('A client uploaded a document',
        '<b>' + (c3 ? c3.name : caller.email) + '</b> uploaded <b>' + (body.name || 'a document') + '</b> to their portal.',
        'Open portal', SITE + '/clients'));
      await logActivity(caller.email, 'client_uploaded', caller.client_id, body.name, caller.token);
    }

    if (WEBHOOK) {
      fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: ev, actor: caller.email, ts: new Date().toISOString() })
      }).catch(function(){});
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, result: result }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
