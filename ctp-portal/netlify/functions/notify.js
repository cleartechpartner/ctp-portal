// /api/notify — transactional notifications.
// Events:
//   report_published   (internal) -> emails the client contact
//   document_uploaded  (internal) -> emails the client contact
//   client_uploaded    (client)   -> emails Clear Tech Partner
// Every event is also POSTed to PIPEDREAM_WEBHOOK_URL if configured
// (future: WhatsApp Business channel) and written to activity_log.

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';
const INTERNAL_EMAIL = process.env.INTERNAL_NOTIFY_EMAIL || 'rainy@cleartechpartner.com';
const SITE = process.env.SITE_URL || 'https://portal.cleartechpartner.com';
const WEBHOOK = process.env.PIPEDREAM_WEBHOOK_URL;

const GRADIENT = 'linear-gradient(120deg,#0052FF 0%,#00B8E6 55%,#2ED6A6 100%)';

function emailShell(title, bodyHtml, cta, ctaUrl) {
  return `<!doctype html><html><body style="margin:0;background:#f7f9fb;font-family:Helvetica,Arial,sans-serif;color:#101826">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border:1px solid #e3e9f0;border-radius:12px;overflow:hidden">
    <div style="height:5px;background:${GRADIENT}"></div>
    <div style="padding:32px 36px">
      <p style="font-size:11px;letter-spacing:3px;color:#5d6b7e;margin:0 0 18px">CLEAR TECH PARTNER</p>
      <h1 style="font-size:20px;margin:0 0 14px">${title}</h1>
      <div style="font-size:15px;line-height:1.6;color:#33404f">${bodyHtml}</div>
      ${cta ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:22px;background:#0052FF;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:14px;font-weight:600">${cta}</a>` : ''}
      <p style="font-size:12px;color:#8b97a5;margin-top:30px">Clear Tech Partner · Mahón, Menorca · cleartechpartner.com</p>
    </div>
  </div></body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function getCaller(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!uRes.ok) return null;
  const user = await uRes.json();
  const pRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,email,client_id`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await pRes.json();
  return rows && rows[0] ? { id: user.id, ...rows[0] } : null;
}

async function getClient(clientId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/clients?id=eq.${clientId}&select=name,contact_name,contact_email,language`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json();
  return rows && rows[0] ? rows[0] : null;
}

async function logActivity(actor, action, clientId, details) {
  await fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_email: actor, action, client_id: clientId || null, details: details || null })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const caller = await getCaller(event.headers.authorization || event.headers.Authorization);
    if (!caller) return { statusCode: 401, body: JSON.stringify({ error: 'Not signed in' }) };

    const body = JSON.parse(event.body || '{}');
    const ev = body.event;
    const internalEvents = ['report_published', 'document_uploaded'];
    if (internalEvents.includes(ev) && caller.role !== 'internal') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Internal access only' }) };
    }
    if (ev === 'client_uploaded' && caller.role !== 'client') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Client event' }) };
    }

    let result = {};

    if (ev === 'report_published') {
      const c = await getClient(body.client_id);
      if (c && c.contact_email) {
        const es = c.language === 'es';
        const monthLabel = body.month || '';
        const subject = es
          ? `Tu informe de ${monthLabel} ya está disponible`
          : `Your ${monthLabel} report is ready`;
        const intro = es
          ? `Hola ${c.contact_name || ''},<br/><br/>Tu informe mensual ya está publicado en tu portal de cliente. Dentro encontrarás un resumen de la actividad, las mejoras realizadas y los próximos pasos.`
          : `Hi ${c.contact_name || ''},<br/><br/>Your monthly report is now live in your client portal. Inside you'll find a summary of activity, the improvements we made, and what's next.`;
        result = await sendEmail(c.contact_email, subject,
          emailShell(subject, intro, es ? 'Ver mi informe' : 'View my report', `${SITE}/reports`));
      }
      await logActivity(caller.email, 'report_published', body.client_id, body.month);
    }

    if (ev === 'document_uploaded') {
      const c = await getClient(body.client_id);
      if (c && c.contact_email && body.notifyClient) {
        const es = c.language === 'es';
        const subject = es ? 'Nuevo documento en tu portal' : 'A new document is in your portal';
        const intro = es
          ? `Hola ${c.contact_name || ''},<br/><br/>Hemos añadido <b>${body.name || 'un documento'}</b> a tu portal de cliente. Puedes consultarlo o descargarlo cuando quieras.`
          : `Hi ${c.contact_name || ''},<br/><br/>We've added <b>${body.name || 'a document'}</b> to your client portal. You can view or download it any time.`;
        result = await sendEmail(c.contact_email, subject,
          emailShell(subject, intro, es ? 'Ver documentos' : 'View documents', `${SITE}/documents`));
      }
      await logActivity(caller.email, 'document_uploaded', body.client_id, body.name);
    }

    if (ev === 'client_uploaded') {
      const c = await getClient(caller.client_id);
      const subject = `Portal upload — ${c ? c.name : 'client'}: ${body.name || 'document'}`;
      result = await sendEmail(INTERNAL_EMAIL, subject,
        emailShell('A client uploaded a document',
          `<b>${c ? c.name : caller.email}</b> uploaded <b>${body.name || 'a document'}</b> to their portal.`,
          'Open portal', `${SITE}/clients`));
      await logActivity(caller.email, 'client_uploaded', caller.client_id, body.name);
    }

    // Future channel (WhatsApp via Pipedream) — fires for every event when configured.
    if (WEBHOOK) {
      fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: ev, actor: caller.email, ...body, ts: new Date().toISOString() })
      }).catch(() => {});
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, result }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
