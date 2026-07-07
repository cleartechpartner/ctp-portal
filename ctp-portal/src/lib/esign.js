import { supabase } from './supabase';
import { fx } from './api';

// pdfjs is heavy; load it only when a PDF actually needs rendering so the
// rest of the portal does not carry it in the initial bundle.
let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

// ---------- envelope status config (dashboard pills) ----------

export const ENVELOPE_STATUS = {
  draft:     { label: 'Draft',     dot: '#9ca3af', cls: 'es-draft' },
  sent:      { label: 'Sent',      dot: '#EF9F27', cls: 'es-sent' },
  viewed:    { label: 'Viewed',    dot: '#2196F3', cls: 'es-viewed' },
  signed:    { label: 'Signed',    dot: '#7C5CFC', cls: 'es-signed' },
  completed: { label: 'Completed', dot: '#1D9E75', cls: 'es-completed' },
  declined:  { label: 'Declined',  dot: '#B33A3A', cls: 'es-declined' },
  voided:    { label: 'Voided',    dot: '#6b7280', cls: 'es-voided' }
};

export const FIELD_TYPES = {
  signature: { label: 'Signature', w: 0.22, h: 0.045 },
  initials:  { label: 'Initials',  w: 0.08, h: 0.045 },
  date:      { label: 'Date',      w: 0.14, h: 0.03 },
  text:      { label: 'Text',      w: 0.22, h: 0.03 },
  checkbox:  { label: 'Checkbox',  w: 0.025, h: 0.018 }
};

// Colour per signer index, used on placed fields.
export const SIGNER_COLORS = ['#0052FF', '#1D9E75', '#EF9F27', '#7C5CFC', '#B33A3A', '#00B8E6'];

// ---------- pdf.js helpers ----------

export async function loadPdf(data) {
  // data: ArrayBuffer or Uint8Array
  const pdfjsLib = await getPdfjs();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  return doc;
}

export async function renderPageToCanvas(pdfDoc, pageNum, canvas, cssWidth) {
  const page = await pdfDoc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = (viewport.height / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: cssWidth, height: viewport.height / dpr };
}

// ---------- bytes / hash helpers ----------

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    out += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(out);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function downloadBlob(bytes, filename, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(name) {
  return (name || 'document').replace(/[^a-z0-9 _.-]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60);
}

// ---------- API calls ----------

// Internal: trigger the send function (user JWT via fx).
export const esignSend = (envelope_id) => fx('/api/esign-send', { envelope_id });

// Signer side: token-validated function calls, no portal auth.
export async function signerApi(action, payload) {
  const r = await fetch('/api/esign-signer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

// Signer side: direct RPC with the anon key (big payload, no IP capture needed).
export async function signerLoad(token) {
  const { data, error } = await supabase.rpc('esign_signer_load', { p_token: token });
  if (error) throw new Error(error.message);
  return data;
}

// Internal: fetch a stored PDF (base64) through the is_internal gated RPC.
export async function getEnvelopePdf(envelopeId, kind) {
  const { data, error } = await supabase.rpc('esign_get_pdf', { p_envelope_id: envelopeId, p_kind: kind });
  if (error) throw new Error(error.message);
  if (!data) return null;
  return b64ToBytes(data.replace(/\n/g, ''));
}

// Internal: record an audit event under the portal JWT (insert policy is internal-only).
export async function logEnvelopeEvent(envelopeId, eventType, metadata) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from('envelope_events').insert({
    envelope_id: envelopeId,
    event_type: eventType,
    actor: userData?.user?.email || 'internal',
    metadata: metadata || null
  });
  if (error) throw new Error(error.message);
}

export function fmtDateTime(ts, lang = 'en') {
  if (!ts) return '';
  return new Date(ts).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}
