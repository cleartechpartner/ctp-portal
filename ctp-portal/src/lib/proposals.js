import { supabase } from './supabase';
import { fx } from './api';

export const PROPOSAL_STATUS = {
  draft:  { label: 'Draft',  dot: '#9ca3af', cls: 'st-paused'   },
  sent:   { label: 'Sent',   dot: '#EF9F27', cls: 'st-proposal' },
  viewed: { label: 'Viewed', dot: '#2196F3', cls: 'st-contract' },
  signed: { label: 'Signed', dot: '#1D9E75', cls: 'st-active'   },
};

export const proposalNumber = (n) => 'CTP-PROP-' + String(n ?? 0).padStart(4, '0');

export function fmtMoney(amount, currency = 'EUR', lang = 'en') {
  if (amount == null || amount === '' || isNaN(Number(amount))) return '[VERIFY]';
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number(amount));
}

// Totals from the editable content. Any phase without a confirmed price
// makes the money lines show [VERIFY] instead of a misleading partial sum.
export function computeTotals(content) {
  const phases = content.phases || [];
  const missing = phases.some(p => p.price == null || p.price === '' || isNaN(Number(p.price)));
  const subtotal = phases.reduce((s, p) => s + (Number(p.price) || 0), 0);
  const discount = content.discount && Number(content.discount.amount) > 0 ? Number(content.discount.amount) : 0;
  const base = Math.max(0, subtotal - discount);
  const taxRate = content.include_iva ? Number(content.tax_rate ?? 21) : 0;
  const tax = content.include_iva ? base * taxRate / 100 : 0;
  return { missing, subtotal, discount, base, taxRate, tax, total: base + tax };
}

export const emptyContent = (client = {}) => ({
  client_name: client.name || '',
  client_location: client.location || '',
  client_tax_id: client.tax_id || '',
  client_email: client.contact_email || '',
  project_title: '',
  summary: '',
  phases: [],
  services: [],
  discovery_notes: '',
  discount: null,               // { label, amount }
  include_iva: true,
  tax_rate: 21,                 // parameterized, editable per proposal
  retainer: { included: false, price: null, cadence_note: '' },
  agreement_text: '',
});

export const DEFAULT_AGREEMENT = {
  en: 'By signing below, both parties agree to the scope, pricing, and terms outlined in this proposal.',
  es: 'Al firmar abajo, ambas partes aceptan el alcance, los precios y las condiciones descritos en esta propuesta.',
};

export const proposalPdf = (proposal_id) => fx('/api/proposal-pdf', { proposal_id });
export const proposalSend = (proposal_id) => fx('/api/proposal-send', { proposal_id });

export function downloadBase64Pdf(b64, filename) {
  const bin = atob(String(b64).replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Documents rows whose storage_path starts with proposal/ have no storage
// object; the bytes live in proposals.signed_pdf and come back over RPC.
export const isProposalDoc = (doc) => (doc?.storage_path || '').startsWith('proposal/');

export async function openProposalDoc(doc) {
  const proposalId = doc.storage_path.split('/')[1];
  const { data, error } = await supabase.rpc('proposal_signed_pdf', { p_proposal_id: proposalId });
  if (error) throw new Error(error.message);
  downloadBase64Pdf(data, doc.name);
}
