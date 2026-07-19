// Proposal PDF builder. Layout mirrors invoice CTP-0001 (Guida Setup &
// Deployment): branded header band, metadata + Prepared for, project
// title, summary, phase table, totals, retainer box, agreement block
// with dual signature lines, centered footer. Shared by the download
// endpoint (unsigned) and the signer function (signed).
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const W = 595.28;  // A4
const H = 841.89;
const SIDE = 14;   // header band inset
const M = 64;      // content margin

const INK = rgb(0.08, 0.11, 0.17);
const DIM = rgb(0.42, 0.47, 0.54);
const FAINT = rgb(0.85, 0.88, 0.91);
const HEAD_FILL = rgb(0.09, 0.11, 0.15);
const ZEBRA = rgb(0.965, 0.97, 0.975);
const BOX = rgb(0.945, 0.955, 0.96);

const L10N = {
  en: {
    doc: 'PROPOSAL',
    number: 'Proposal No:',
    date: 'Date:',
    preparedFor: 'PREPARED FOR:',
    phase: 'Phase',
    description: 'Description',
    price: 'Price',
    subtotal: 'Subtotal:',
    tax: 'Tax (VAT/IVA):',
    na: 'N/A',
    totalDue: 'TOTAL DUE:',
    retainer: 'Monthly Retainer',
    perMonth: '/month',
    agreement: 'Agreement',
    ctpSide: 'Clear Tech Partner',
    dateLine: 'Date:',
    footer1: 'Clear Tech Partner | www.cleartechpartner.com',
    footer2: 'Thank you for your trust and partnership.',
    signedStamp: 'Signed electronically via CTP Proposals',
  },
  es: {
    doc: 'PROPUESTA',
    number: 'Propuesta n.:',
    date: 'Fecha:',
    preparedFor: 'PREPARADO PARA:',
    phase: 'Fase',
    description: 'Descripcion',
    price: 'Precio',
    subtotal: 'Subtotal:',
    tax: 'Impuestos (IVA):',
    na: 'N/A',
    totalDue: 'TOTAL:',
    retainer: 'Cuota mensual',
    perMonth: '/mes',
    agreement: 'Acuerdo',
    ctpSide: 'Clear Tech Partner',
    dateLine: 'Fecha:',
    footer1: 'Clear Tech Partner | www.cleartechpartner.com',
    footer2: 'Gracias por su confianza.',
    signedStamp: 'Firmado electronicamente via CTP Proposals',
  },
};

// Keep drawn text inside WinAnsi so the standard fonts never throw.
function winAnsi(s) {
  return String(s == null ? '' : s).replace(/[—–]/g, '-').replace(/[^\x20-\x7E -ÿ€]/g, '?');
}

function wrapText(text, font, size, maxWidth) {
  var words = winAnsi(text).split(/\s+/).filter(Boolean);
  var lines = [];
  var line = '';
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
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
  return lines.length ? lines : [''];
}

function money(v, currency, lang) {
  if (v == null || v === '' || isNaN(Number(v))) return '[VERIFY]';
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', {
    style: 'currency', currency: currency, minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(v));
}

// Mirror of computeTotals in src/lib/proposals.js.
function totalsOf(content) {
  var phases = content.phases || [];
  var missing = phases.some(function(p) { return p.price == null || p.price === '' || isNaN(Number(p.price)); });
  var subtotal = phases.reduce(function(s, p) { return s + (Number(p.price) || 0); }, 0);
  var discount = content.discount && Number(content.discount.amount) > 0 ? Number(content.discount.amount) : 0;
  var base = Math.max(0, subtotal - discount);
  var taxRate = content.include_iva ? Number(content.tax_rate == null ? 21 : content.tax_rate) : 0;
  var tax = content.include_iva ? base * taxRate / 100 : 0;
  return { missing: missing, subtotal: subtotal, discount: discount, taxRate: taxRate, tax: tax, total: base + tax };
}

function fmtDate(ts, lang) {
  var d = ts ? new Date(ts) : new Date();
  return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid'
  });
}

// Brand gradient band, approximated with vertical slices:
// #0052FF -> #00B8E6 -> #2ED6A6 (same stops as the email templates).
function drawGradientBand(page, x, y, w, h) {
  var stops = [
    { t: 0.0, c: [0 / 255, 82 / 255, 255 / 255] },
    { t: 0.55, c: [0 / 255, 184 / 255, 230 / 255] },
    { t: 1.0, c: [46 / 255, 214 / 255, 166 / 255] },
  ];
  var slices = 90;
  for (var i = 0; i < slices; i++) {
    var t = i / (slices - 1);
    var a = stops[0], b = stops[1];
    if (t > 0.55) { a = stops[1]; b = stops[2]; }
    var lt = (t - a.t) / (b.t - a.t || 1);
    var c = a.c.map(function(v, k) { return v + (b.c[k] - v) * lt; });
    page.drawRectangle({
      x: x + (w / slices) * i, y: y,
      width: w / slices + 0.6, height: h,
      color: rgb(c[0], c[1], c[2]),
    });
  }
}

/**
 * @param {object} opts
 * @param {string} opts.number       formatted proposal number, e.g. CTP-PROP-0001
 * @param {object} opts.content      proposals.content_json
 * @param {string} opts.language     'en' | 'es'
 * @param {string} opts.currency     'EUR' | 'USD'
 * @param {string} [opts.dateISO]    proposal date (sent date); defaults to now
 * @param {object} [opts.signer]     { name, signature_data (png data url), signed_at } for the sealed version
 * @returns {Promise<Buffer>}
 */
async function buildProposalPdf(opts) {
  var content = opts.content || {};
  var lang = opts.language === 'es' ? 'es' : 'en';
  var L = L10N[lang];
  var cur = opts.currency || 'EUR';
  var mon = function(v) { return money(v, cur, lang); };

  var pdf = await PDFDocument.create();
  var helv = await pdf.embedFont(StandardFonts.Helvetica);
  var bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  var page = pdf.addPage([W, H]);
  var y = H;

  function newPage() {
    page = pdf.addPage([W, H]);
    y = H - 56;
  }
  function ensure(space) {
    if (y - space < 56) newPage();
  }
  function text(str, x, size, opts2) {
    opts2 = opts2 || {};
    page.drawText(winAnsi(str), {
      x: x, y: y - size,
      size: size,
      font: opts2.bold ? bold : helv,
      color: opts2.color || INK,
      opacity: opts2.opacity,
    });
  }
  function rightText(str, rightX, size, opts2) {
    opts2 = opts2 || {};
    var f = opts2.bold ? bold : helv;
    page.drawText(winAnsi(str), {
      x: rightX - f.widthOfTextAtSize(winAnsi(str), size), y: y - size,
      size: size, font: f,
      color: opts2.color || INK,
      opacity: opts2.opacity,
    });
  }

  // ---------- header band ----------
  var bandH = 74;
  drawGradientBand(page, SIDE, H - SIDE - bandH, W - SIDE * 2, bandH);
  page.drawText('Clear Tech Partner', {
    x: M, y: H - SIDE - 40, size: 23, font: bold, color: rgb(1, 1, 1),
  });
  page.drawText('rainy@cleartechpartner.com  |  www.cleartechpartner.com', {
    x: M, y: H - SIDE - 58, size: 8.5, font: helv, color: rgb(1, 1, 1), opacity: 0.85,
  });
  var docLabel = L.doc;
  page.drawText(docLabel, {
    x: W - M - bold.widthOfTextAtSize(docLabel, 26), y: H - SIDE - 44,
    size: 26, font: bold, color: rgb(1, 1, 1), opacity: 0.55,
  });

  // ---------- metadata ----------
  y = H - SIDE - bandH - 24;
  var metaTop = y;
  text(L.number, M, 10, { bold: true });
  text(opts.number, M + 90, 10);
  y -= 16;
  text(L.date, M, 10, { bold: true });
  text(fmtDate(opts.dateISO, lang), M + 90, 10);

  y = metaTop;
  rightText(L.preparedFor, W - M, 10, { bold: true });
  y -= 16;
  rightText(content.client_name || '', W - M, 10.5);
  if (content.client_location) { y -= 14; rightText(content.client_location, W - M, 9.5, { color: DIM }); }
  if (content.client_tax_id) { y -= 14; rightText(content.client_tax_id, W - M, 9.5, { color: DIM }); }

  y -= 20;
  page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 2.4, color: INK });
  y -= 20;

  // ---------- project title ----------
  var titleLines = wrapText(content.project_title || '', bold, 14.5, W - M * 2);
  titleLines.forEach(function(t) {
    ensure(24);
    text(t, M, 14.5, { bold: true });
    y -= 19;
  });
  y -= 2;

  // ---------- summary ----------
  if (content.summary) {
    var sumLines = wrapText(content.summary, helv, 9.5, W - M * 2);
    sumLines.forEach(function(t) {
      ensure(18);
      text(t, M, 9.5, { color: rgb(0.2, 0.24, 0.3) });
      y -= 13.5;
    });
    y -= 6;
  }

  // ---------- phase table ----------
  var numX = M + 12;
  var phaseX = M + 34;
  var descX = M + 150;
  var priceRight = W - M - 12;
  var phaseW = descX - phaseX - 10;
  var descW = priceRight - 74 - descX;

  ensure(60);
  page.drawRectangle({ x: M, y: y - 20, width: W - M * 2, height: 20, color: HEAD_FILL });
  var headY = y;
  y -= 5.5;
  text('#', numX, 9, { bold: true, color: rgb(1, 1, 1) });
  text(L.phase, phaseX, 9, { bold: true, color: rgb(1, 1, 1) });
  text(L.description, descX, 9, { bold: true, color: rgb(1, 1, 1) });
  rightText(L.price, priceRight, 9, { bold: true, color: rgb(1, 1, 1) });
  y = headY - 20;

  var phases = content.phases || [];
  phases.forEach(function(p, i) {
    var nameLines = wrapText(p.name || '', helv, 9.2, phaseW);
    var descLines = wrapText(p.description || '', helv, 9.2, descW);
    var lines = Math.max(nameLines.length, descLines.length, 1);
    var rowH = lines * 12 + 9;
    ensure(rowH + 4);
    if (i % 2 === 1) {
      page.drawRectangle({ x: M, y: y - rowH, width: W - M * 2, height: rowH, color: ZEBRA });
    }
    var rowTop = y;
    y -= 6;
    text(String(p.number || i + 1), numX, 9.2, { color: DIM });
    nameLines.forEach(function(t, li) {
      y = rowTop - 6 - li * 12;
      text(t, phaseX, 9.2);
    });
    descLines.forEach(function(t, li) {
      y = rowTop - 6 - li * 12;
      text(t, descX, 9.2, { color: rgb(0.24, 0.28, 0.34) });
    });
    y = rowTop - 6;
    rightText(mon(p.price), priceRight, 9.2);
    y = rowTop - rowH;
    page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.5, color: FAINT });
  });

  // ---------- totals ----------
  var totals = totalsOf(content);
  y -= 18;
  ensure(105);
  var labX = W - M - 240;
  function totalLine(label, value, opts2) {
    opts2 = opts2 || {};
    text(label, labX, opts2.size || 9.5, { color: opts2.em ? INK : DIM, bold: !!opts2.em });
    rightText(value, priceRight, opts2.size || 9.5, { bold: !!opts2.em });
    y -= opts2.gap || 15;
  }
  totalLine(L.subtotal, totals.missing ? '[VERIFY]' : mon(totals.subtotal));
  if (content.discount && totals.discount > 0) {
    totalLine(winAnsi(content.discount.label || 'Discount') + ':', '- ' + mon(totals.discount));
  }
  totalLine(L.tax, content.include_iva
    ? (totals.missing ? '[VERIFY]' : mon(totals.tax)) + '  (' + totals.taxRate + '%)'
    : L.na, { gap: 12 });
  y -= 4;
  page.drawLine({ start: { x: labX, y: y }, end: { x: priceRight, y: y }, thickness: 1.8, color: INK });
  y -= 9;
  totalLine(L.totalDue, totals.missing ? '[VERIFY]' : mon(totals.total), { em: true, size: 13, gap: 22 });

  // ---------- retainer box ----------
  if (content.retainer && content.retainer.included) {
    var noteW = W - M * 2 - 150;
    var noteLines = wrapText(content.retainer.cadence_note || '', helv, 8.2, noteW - 28);
    var boxH = 40 + noteLines.length * 11.5;
    ensure(boxH + 14);
    page.drawRectangle({ x: M, y: y - boxH, width: W - M * 2, height: boxH, color: BOX });
    var boxTop = y;
    y -= 14;
    text(L.retainer, M + 16, 11, { bold: true });
    var priceStr = (content.retainer.price == null ? '[VERIFY]' : mon(content.retainer.price)) + L.perMonth;
    rightText(priceStr, W - M - 16, 11.5, { bold: true });
    y -= 18;
    noteLines.forEach(function(t) {
      text(t, M + 16, 8.2, { color: rgb(0.28, 0.33, 0.39) });
      y -= 11.5;
    });
    y = boxTop - boxH - 18;
  } else {
    y -= 6;
  }

  // ---------- agreement ----------
  ensure(130);
  text(L.agreement, M, 11.5, { bold: true });
  y -= 16;
  var agreeLines = wrapText(content.agreement_text || '', helv, 9, W - M * 2);
  agreeLines.forEach(function(t) {
    ensure(16);
    text(t, M, 9, { color: rgb(0.2, 0.24, 0.3) });
    y -= 12.5;
  });

  ensure(94);
  y -= 44; // room above the lines for ink
  var colW = (W - M * 2 - 60) / 2;
  var leftX = M;
  var rightX = M + colW + 60;
  var lineY = y;

  // Client signature image, when sealing.
  if (opts.signer && opts.signer.signature_data) {
    try {
      var pngBytes = Buffer.from(String(opts.signer.signature_data).split(',')[1] || '', 'base64');
      var png = await pdf.embedPng(pngBytes);
      var sh = 38;
      var sw = png.width * (sh / png.height);
      if (sw > colW) { sw = colW; sh = png.height * (sw / png.width); }
      page.drawImage(png, { x: rightX + 8, y: lineY + 4, width: sw, height: sh });
    } catch (e) { /* the signature stays recorded in the database */ }
  }

  page.drawLine({ start: { x: leftX, y: lineY }, end: { x: leftX + colW, y: lineY }, thickness: 0.8, color: INK });
  page.drawLine({ start: { x: rightX, y: lineY }, end: { x: rightX + colW, y: lineY }, thickness: 0.8, color: INK });
  y = lineY - 6;
  text(L.ctpSide, leftX, 9, { color: DIM });
  text((opts.signer && opts.signer.name) || content.client_name || '', rightX, 9, { color: DIM });
  y -= 15;
  text(L.dateLine, leftX, 9, { color: DIM });
  var signedDate = opts.signer && opts.signer.signed_at ? fmtDate(opts.signer.signed_at, lang) : '';
  text(L.dateLine + (signedDate ? '  ' + signedDate : ''), rightX, 9, { color: DIM });

  // ---------- footer, last page ----------
  var f1 = L.footer1;
  var f2 = L.footer2;
  page.drawText(f1, {
    x: (W - helv.widthOfTextAtSize(f1, 8)) / 2, y: 42, size: 8, font: helv, color: DIM,
  });
  page.drawText(f2, {
    x: (W - helv.widthOfTextAtSize(f2, 8)) / 2, y: 30, size: 8, font: helv, color: DIM,
  });

  // Seal stamp ties the paper to the record.
  if (opts.signer && opts.signer.signed_at) {
    var pages = pdf.getPages();
    var stamp = 'CTP Proposals | ' + opts.number + ' | ' + L.signedStamp + ' | ' +
      new Date(opts.signer.signed_at).toISOString();
    for (var pi = 0; pi < pages.length; pi++) {
      pages[pi].drawText(winAnsi(stamp), {
        x: 20, y: 8, size: 6, font: helv, color: rgb(0.55, 0.6, 0.65),
      });
    }
  }

  return Buffer.from(await pdf.save());
}

module.exports = { buildProposalPdf, totalsOf, money };
