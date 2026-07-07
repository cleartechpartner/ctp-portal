// E-sign: signer-side actions. No portal auth and no service role key.
// Every call is authorised by the signer token, validated inside the
// esign_* security definer functions in Postgres. This function only adds
// what the database cannot know: the client IP, the user agent, PDF
// sealing, the certificate, and the emails.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { createHash } = require('crypto');

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

// Call a Postgres function through PostgREST with the anon key. The signer
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

// ---------- PDF helpers ----------

// Keep drawn text inside WinAnsi so the standard fonts never throw.
function winAnsi(s) {
  return String(s == null ? '' : s).replace(/[—–]/g, '-').replace(/[^\x20-\x7E -ÿ€]/g, '?');
}

function wrapText(text, font, size, maxWidth) {
  var words = winAnsi(text).split(/\s+/);
  var lines = [];
  var line = '';
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    // Break single words that are longer than the line (hashes, user agents).
    while (font.widthOfTextAtSize(w, size) > maxWidth) {
      var cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
      if (line) { lines.push(line); line = ''; }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    var probe = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(probe, size) <= maxWidth) line = probe;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

function pngBytes(dataUrl) {
  return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
}

// Flatten every completed field into the source PDF.
async function buildSealed(data) {
  var pdf = await PDFDocument.load(Buffer.from(data.source_pdf, 'base64'));
  var helv = await pdf.embedFont(StandardFonts.Helvetica);
  var pages = pdf.getPages();
  var signersById = {};
  data.signers.forEach(function(s) { signersById[s.id] = s; });
  var pngCache = {};

  async function embedPng(dataUrl) {
    if (!pngCache[dataUrl]) pngCache[dataUrl] = await pdf.embedPng(pngBytes(dataUrl));
    return pngCache[dataUrl];
  }

  for (var i = 0; i < data.fields.length; i++) {
    var f = data.fields[i];
    if (!f.value) continue;
    var page = pages[f.page - 1];
    if (!page) continue;
    var pw = page.getWidth();
    var ph = page.getHeight();
    var x = f.x * pw;
    var w = f.w * pw;
    var h = f.h * ph;
    var y = ph - (f.y * ph) - h; // normalised top-left origin to PDF bottom-left

    if (f.type === 'signature' || f.type === 'initials') {
      var s = signersById[f.signer_id];
      var src = (f.type === 'initials' && String(f.value).indexOf('data:image') === 0) ? f.value : (s && s.signature_data);
      if (!src) continue;
      var png = await embedPng(src);
      var scale = Math.min(w / png.width, h / png.height);
      page.drawImage(png, {
        x: x + (w - png.width * scale) / 2,
        y: y + (h - png.height * scale) / 2,
        width: png.width * scale,
        height: png.height * scale
      });
    } else if (f.type === 'checkbox') {
      if (f.value === 'true') {
        var size = Math.min(w, h) * 0.85;
        page.drawText('X', {
          x: x + (w - helv.widthOfTextAtSize('X', size)) / 2,
          y: y + (h - size * 0.72) / 2,
          size: size, font: helv, color: rgb(0.1, 0.13, 0.2)
        });
      }
    } else {
      var txt = winAnsi(f.value);
      var tSize = Math.min(h * 0.68, 12);
      while (tSize > 5 && helv.widthOfTextAtSize(txt, tSize) > w - 4) tSize -= 0.5;
      page.drawText(txt, {
        x: x + 2, y: y + (h - tSize * 0.72) / 2,
        size: tSize, font: helv, color: rgb(0.1, 0.13, 0.2)
      });
    }
  }

  // Envelope stamp on every page, tying the paper to the audit trail.
  for (var p = 0; p < pages.length; p++) {
    pages[p].drawText(winAnsi('CTP eSign | Envelope ' + data.envelope.id + ' | Source SHA-256 ' + (data.envelope.source_hash || '')), {
      x: 20, y: 8, size: 6, font: helv, color: rgb(0.55, 0.6, 0.65)
    });
  }
  return Buffer.from(await pdf.save());
}

// ---------- certificate of completion ----------

var CERT = {
  en: {
    title: 'Certificate of completion',
    doc: 'Document', envelope: 'Envelope ID', language: 'Language', langName: 'English',
    mode: 'Signing order', sequential: 'Sequential', parallel: 'Parallel',
    completedAt: 'Completed', generated: 'Certificate generated',
    sourceHash: 'Source document SHA-256', sealedHash: 'Sealed document SHA-256',
    signer: 'Signer', email: 'Email', consented: 'Consented to electronic records',
    disclosureV: 'disclosure version', signedAt: 'Signed', ip: 'IP address', ua: 'Browser',
    sigKind: 'Signature adopted by', drawn: 'drawing', typed: 'typing',
    level: 'Signature level: Simple Electronic Signature (SES) under eIDAS, ESIGN and UETA.',
    footer: 'Clear Tech Partner | portal.cleartechpartner.com'
  },
  es: {
    title: 'Certificado de finalización',
    doc: 'Documento', envelope: 'ID del sobre', language: 'Idioma', langName: 'Español',
    mode: 'Orden de firma', sequential: 'Secuencial', parallel: 'En paralelo',
    completedAt: 'Completado', generated: 'Certificado generado',
    sourceHash: 'SHA-256 del documento original', sealedHash: 'SHA-256 del documento sellado',
    signer: 'Firmante', email: 'Correo', consented: 'Consintió los registros electrónicos',
    disclosureV: 'versión del aviso', signedAt: 'Firmó', ip: 'Dirección IP', ua: 'Navegador',
    sigKind: 'Firma adoptada mediante', drawn: 'dibujo', typed: 'texto',
    level: 'Nivel de firma: Firma Electrónica Simple (SES) conforme a eIDAS, ESIGN y UETA.',
    footer: 'Clear Tech Partner | portal.cleartechpartner.com'
  }
};

function fmtTs(ts, lang) {
  if (!ts) return '';
  var d = new Date(ts);
  var human = d.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', {
    timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return d.toISOString() + ' (UTC) | ' + human + ' (Europe/Madrid)';
}

async function buildCertificate(data, sealedHash) {
  var lang = data.envelope.language === 'es' ? 'es' : 'en';
  var L = CERT[lang];
  var pdf = await PDFDocument.create();
  var helv = await pdf.embedFont(StandardFonts.Helvetica);
  var bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  var W = 595.28, H = 841.89; // A4
  var margin = 56;
  var page = pdf.addPage([W, H]);
  var y = H - margin;

  function ensure(space) {
    if (y - space < margin + 20) {
      page = pdf.addPage([W, H]);
      y = H - margin;
    }
  }
  function line(text, opts) {
    opts = opts || {};
    var font = opts.bold ? bold : helv;
    var size = opts.size || 9.5;
    var color = opts.grey ? rgb(0.42, 0.47, 0.54) : rgb(0.08, 0.11, 0.17);
    var maxW = W - margin * 2 - (opts.indent || 0);
    var lines = wrapText(text, font, size, maxW);
    for (var i = 0; i < lines.length; i++) {
      ensure(size + 4);
      page.drawText(lines[i], { x: margin + (opts.indent || 0), y: y - size, size: size, font: font, color: color });
      y -= size + (opts.lead || 4);
    }
  }
  function gap(n) { y -= n; }

  page.drawText('CLEAR TECH PARTNER', { x: margin, y: y - 9, size: 9, font: bold, color: rgb(0.36, 0.42, 0.49) });
  y -= 26;
  page.drawText(winAnsi(L.title), { x: margin, y: y - 18, size: 18, font: bold, color: rgb(0.08, 0.11, 0.17) });
  y -= 34;

  line(L.doc + ': ' + data.envelope.name, { bold: true, size: 11 });
  line(L.envelope + ': ' + data.envelope.id);
  line(L.language + ': ' + L.langName);
  line(L.mode + ': ' + (data.envelope.signing_mode === 'parallel' ? L.parallel : L.sequential));
  line(L.completedAt + ': ' + fmtTs(new Date().toISOString(), lang));
  gap(8);
  line(L.sourceHash + ':', { bold: true });
  line(data.envelope.source_hash || '', { size: 8.5, grey: true });
  line(L.sealedHash + ':', { bold: true });
  line(sealedHash, { size: 8.5, grey: true });
  gap(10);

  for (var i = 0; i < data.signers.length; i++) {
    var s = data.signers[i];
    ensure(120);
    gap(6);
    page.drawLine({
      start: { x: margin, y: y }, end: { x: W - margin, y: y },
      thickness: 0.5, color: rgb(0.85, 0.88, 0.91)
    });
    gap(12);
    line(L.signer + ' ' + s.sign_order + ': ' + s.name, { bold: true, size: 11 });
    line(L.email + ': ' + s.email);
    if (s.consented_at) {
      line(L.consented + ': ' + fmtTs(s.consented_at, lang) +
        (s.disclosure_version ? ' (' + L.disclosureV + ' ' + s.disclosure_version + ')' : ''));
    }
    line(L.signedAt + ': ' + fmtTs(s.signed_at, lang));
    line(L.sigKind + ': ' + (s.signature_kind === 'typed' ? L.typed : L.drawn));
    if (s.ip) line(L.ip + ': ' + s.ip);
    if (s.user_agent) line(L.ua + ': ' + s.user_agent, { size: 7.5, grey: true });
    if (s.signature_data) {
      try {
        var png = await pdf.embedPng(pngBytes(s.signature_data));
        var sh = 34;
        var sw = png.width * (sh / png.height);
        if (sw > 220) { sw = 220; sh = png.height * (sw / png.width); }
        ensure(sh + 10);
        page.drawImage(png, { x: margin, y: y - sh, width: sw, height: sh });
        y -= sh + 8;
      } catch (e) { /* certificate stays valid without the thumbnail */ }
    }
  }

  gap(12);
  line(L.level, { grey: true, size: 8.5 });
  line(L.generated + ': ' + fmtTs(new Date().toISOString(), lang), { grey: true, size: 8.5 });
  line(L.footer, { grey: true, size: 8.5 });

  return Buffer.from(await pdf.save());
}

// ---------- completion emails ----------

function safeName(name) {
  return String(name || 'document').replace(/[^a-z0-9 _.-]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60);
}

async function sendCompletionEmails(data, sealedBuf, certBuf) {
  var env = data.envelope;
  var es = env.language === 'es';
  var base = safeName(env.name);
  var attachments = [
    { filename: base + '_signed.pdf', content: sealedBuf.toString('base64') },
    { filename: base + (es ? '_certificado.pdf' : '_certificate.pdf'), content: certBuf.toString('base64') }
  ];
  var subject = (es ? 'Completado | ' : 'Completed | ') + env.name;
  for (var i = 0; i < data.signers.length; i++) {
    var s = data.signers[i];
    var intro = es
      ? 'Hola ' + esc(s.name) + ',<br/><br/>Todas las partes han firmado <b>' + esc(env.name) + '</b>. Te adjuntamos el documento sellado y el certificado de finalización. Guarda ambos archivos.'
      : 'Hi ' + esc(s.name) + ',<br/><br/>All parties have signed <b>' + esc(env.name) + '</b>. The sealed document and the certificate of completion are attached. Keep both files for your records.';
    await sendEmail(s.email, subject, emailShell(subject, intro, null, null), attachments);
  }
  await sendEmail(INTERNAL_EMAIL, 'Completed | ' + env.name,
    emailShell('Envelope completed',
      '<b>' + esc(env.name) + '</b> has been signed by all parties and sealed. The sealed PDF and certificate are attached and available in the portal.',
      'Open portal', SITE + '/sign'), attachments);
}

// ---------- handler ----------

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    var body = JSON.parse(event.body || '{}');
    var action = body.action;
    var token = body.token;
    if (!token) return { statusCode: 400, body: JSON.stringify({ error: 'Missing token' }) };
    var ip = clientIp(event);
    var ua = userAgent(event);

    if (action === 'viewed' || action === 'consented') {
      var r = await rpc('esign_signer_event', {
        p_token: token, p_event_type: action, p_ip: ip, p_ua: ua, p_metadata: null
      });
      return { statusCode: 200, body: JSON.stringify(r) };
    }

    if (action === 'decline') {
      var d = await rpc('esign_signer_decline', {
        p_token: token, p_reason: body.reason || null, p_ip: ip, p_ua: ua
      });
      try {
        await sendEmail(INTERNAL_EMAIL, 'Declined | ' + (d.envelope_name || 'envelope'),
          emailShell('A signer declined',
            'The document <b>' + esc(d.envelope_name || '') + '</b> was declined.' +
            (body.reason ? '<br/><br/>Reason: <i>' + esc(body.reason) + '</i>' : ''),
            'Open portal', SITE + '/sign'));
      } catch (e) { /* the decline itself is already recorded */ }
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'finish') {
      var fin = await rpc('esign_signer_finish', {
        p_token: token,
        p_values: body.values || {},
        p_signature_data: body.signature_data,
        p_signature_kind: body.signature_kind,
        p_ip: ip, p_ua: ua
      });

      if (!fin.all_signed) {
        // Sequential: hand the envelope to the next signer.
        if (fin.next_signer && fin.next_signer.token) {
          var env = fin.envelope;
          var es = env.language === 'es';
          var subject = (es ? 'Firma solicitada | ' : 'Signature requested | ') + env.name;
          var intro = es
            ? 'Hola ' + esc(fin.next_signer.name) + ',<br/><br/>Es tu turno de firmar <b>' + esc(env.name) + '</b>.<br/><br/>Este enlace es personal. No lo reenvíes a nadie.'
            : 'Hi ' + esc(fin.next_signer.name) + ',<br/><br/>It is your turn to sign <b>' + esc(env.name) + '</b>.<br/><br/>This link is personal to you. Please do not forward it.';
          await sendEmail(fin.next_signer.email, subject,
            emailShell(subject, intro, es ? 'Revisar y firmar' : 'Review and sign', SITE + '/esign/' + fin.next_signer.token));
          await rpc('esign_mark_sent', { p_token: fin.next_signer.token });
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true, all_signed: false }) };
      }

      // Everyone has signed: seal, certify, store, notify.
      var data = await rpc('esign_seal_data', { p_token: token });
      var sealedBuf = await buildSealed(data);
      // Same bytes, same digest: the database recomputes and stores this
      // exact value in esign_store_sealed, so the certificate matches it.
      var sealedHash = createHash('sha256').update(sealedBuf).digest('hex');
      var certBuf = await buildCertificate(data, sealedHash);
      var stored = await rpc('esign_store_sealed', {
        p_token: token,
        p_sealed_b64: sealedBuf.toString('base64'),
        p_cert_b64: certBuf.toString('base64')
      });
      try {
        await sendCompletionEmails(data, sealedBuf, certBuf);
      } catch (e) {
        // The envelope is sealed and stored; email delivery must not undo that.
        console.error('Completion email failed:', e.message);
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, all_signed: true, sealed_hash: stored.sealed_hash }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    return {
      statusCode: err.statusCode || 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
