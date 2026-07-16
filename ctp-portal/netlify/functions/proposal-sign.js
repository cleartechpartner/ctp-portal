// Proposals: signer-side actions. No portal auth and no service role key.
// Every call is authorised by the signing token, validated inside the
// proposal_* security definer functions in Postgres. This function only
// adds what the database cannot know: the client IP, the user agent, the
// sealed PDF, and the emails.
const { buildProposalPdf } = require('./lib/proposal-pdf');

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.CLIENT_FROM_EMAIL || 'Clear Tech Partner <client@cleartechpartner.com>';
const INTERNAL_EMAIL = process.env.INTERNAL_NOTIFY_EMAIL || 'rainy@cleartechpartner.com';
const SITE = process.env.SITE_URL || 'https://portal.cleartechpartner.com';

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

// Call a Postgres function through PostgREST with the anon key. The signing
// token inside the arguments is the credential. Body always consumed.
async function rpc(name, args) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  var text = await res.text();
  if (!res.ok) {
    var msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) {}
    var err = new Error(msg.slice(0, 300));
    err.statusCode = res.status === 404 ? 404 : 400;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function clientIp(event) {
  var h = event.headers || {};
  return h['x-nf-client-connection-ip'] ||
    ((h['x-forwarded-for'] || '').split(',')[0].trim()) || null;
}

function userAgent(event) {
  var h = event.headers || {};
  return (h['user-agent'] || '').slice(0, 400) || null;
}

const formatNumber = (n) => 'CTP-PROP-' + String(n == null ? 0 : n).padStart(4, '0');

async function sendCompletionEmails(proposal, client, signer, pdfBuf) {
  var es = proposal.language === 'es';
  var number = formatNumber(proposal.proposal_number);
  var attachments = [
    { filename: number + (es ? '_firmada.pdf' : '_signed.pdf'), content: pdfBuf.toString('base64') }
  ];
  var subject = (es ? 'Firmada | ' : 'Signed | ') + proposal.project_title;

  if (client.email) {
    var intro = es
      ? 'Hola,<br/><br/>Gracias. La propuesta <b>' + esc(proposal.project_title) + '</b> (' + number + ') ha quedado firmada. ' +
        'Le adjuntamos el documento firmado para sus archivos. Nos pondremos en contacto en breve para los siguientes pasos.'
      : 'Hi,<br/><br/>Thank you. The proposal <b>' + esc(proposal.project_title) + '</b> (' + number + ') has been signed. ' +
        'The signed document is attached for your records. We will be in touch shortly with next steps.';
    await sendEmail(client.email, subject, emailShell(subject, intro, null, null), attachments);
  }

  await sendEmail(INTERNAL_EMAIL, 'Signed | ' + number + ' | ' + proposal.project_title,
    emailShell('Proposal signed',
      '<b>' + esc(client.name || '') + '</b> signed <b>' + esc(proposal.project_title) + '</b> (' + number + ').' +
      '<br/><br/>The signed PDF is attached and filed in their Documents tab. Their page now offers Convert to Active Client.',
      'Open portal', SITE + '/proposals'), attachments);
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var body = JSON.parse(event.body || '{}');
    var action = body.action;
    var token = body.token;
    if (!token) return { statusCode: 400, body: JSON.stringify({ error: 'Missing token' }) };
    var ip = clientIp(event);
    var ua = userAgent(event);

    if (action === 'load') {
      var d = await rpc('proposal_sign_load', { p_token: token });
      return { statusCode: 200, body: JSON.stringify(d) };
    }

    if (action === 'viewed') {
      var r = await rpc('proposal_sign_event', {
        p_token: token, p_event_type: 'viewed', p_ip: ip, p_ua: ua
      });
      return { statusCode: 200, body: JSON.stringify(r) };
    }

    if (action === 'finish') {
      var fin = await rpc('proposal_sign_finish', {
        p_token: token,
        p_signer_name: body.signer_name || null,
        p_signature_data: body.signature_data,
        p_signature_kind: body.signature_kind,
        p_ip: ip, p_ua: ua
      });

      var proposal = fin.proposal;
      var client = fin.client;
      var signer = fin.signer;

      var pdf = await buildProposalPdf({
        number: formatNumber(proposal.proposal_number),
        content: proposal.content,
        language: proposal.language,
        currency: proposal.currency,
        dateISO: proposal.sent_at,
        signer: signer,
      });

      await rpc('proposal_store_signed', { p_token: token, p_pdf_b64: pdf.toString('base64') });

      try {
        await sendCompletionEmails(proposal, client, signer, pdf);
      } catch (e) {
        // The proposal is signed and stored; email delivery must not undo that.
        console.error('Completion email failed:', e.message);
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return {
      statusCode: err.statusCode || 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
