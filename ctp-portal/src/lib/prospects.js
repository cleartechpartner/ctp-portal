import { supabase } from './supabase';

// Prospect CRM data layer. A prospect is a clients row with
// client_status = 'prospect' (lowercase in the DB, from proposals.sql);
// pipeline_stage values are capitalized per the CRM spec.

export const STAGES = ['New', 'Contacted', 'Meeting', 'Proposal Sent', 'Won', 'Lost'];
export const BOARD_STAGES = ['New', 'Contacted', 'Meeting', 'Proposal Sent', 'Won'];
export const PRIORITIES = ['High', 'Medium', 'Low'];

export const STAGE_CLS = {
  'New': 'pr-s-new',
  'Contacted': 'pr-s-contacted',
  'Meeting': 'pr-s-meeting',
  'Proposal Sent': 'pr-s-proposal',
  'Won': 'pr-s-won',
  'Lost': 'pr-s-lost',
};

export const PRIORITY_CLS = { High: 'high', Medium: 'med', Low: 'low' };
export const PRIORITY_SHORT = { High: 'HIGH', Medium: 'MED', Low: 'LOW' };

// Kinds offered in the Log activity modal. proposal / task / import /
// stage_change rows are written by their own flows, never logged by hand.
export const LOG_KINDS = [['note', 'Note'], ['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting']];

// Kinds that count as actually reaching out, for "last contacted".
const CONTACT_KINDS = ['call', 'email', 'meeting', 'proposal'];

export function stageOf(c) {
  return STAGES.includes(c?.pipeline_stage) ? c.pipeline_stage : 'New';
}

export function priorityOf(c) {
  return PRIORITIES.includes(c?.priority) ? c.priority : 'Medium';
}

export function companyInitials(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// 'Punta Prima (Sant Lluis)' filters under Sant Lluis, its parent town.
export function townOf(locality) {
  const m = /\(([^)]+)\)\s*$/.exec(locality || '');
  return (m ? m[1] : locality || '').trim();
}

export function timeAgoShort(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  if (days < 35) return Math.floor(days / 7) + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}

const VERB = { call: 'called', email: 'emailed', meeting: 'met', proposal: 'proposal sent' };

export function lastContact(interactions) {
  let latest = null;
  for (const i of interactions || []) {
    if (!CONTACT_KINDS.includes(i.kind)) continue;
    if (!latest || i.occurred_at > latest.occurred_at) latest = i;
  }
  return latest;
}

// Card and table phrase: "emailed 2d ago", "not yet contacted".
export function lastActivityPhrase(interactions) {
  const latest = lastContact(interactions);
  if (!latest) return 'not yet contacted';
  return (VERB[latest.kind] || 'contacted') + ' ' + timeAgoShort(latest.occurred_at);
}

export async function fetchProspects() {
  const { data, error } = await supabase
    .from('clients')
    .select('*, contacts(id, full_name, role, email, is_primary, avatar_url), interactions(kind, occurred_at)')
    .eq('client_status', 'prospect')
    .order('name');
  if (error) throw new Error(error.message);
  return data || [];
}

// Stage change plus its audit interaction (drag and drop, card menu,
// detail header). Proposal-driven moves come from the DB trigger instead.
export async function changeStage(client, stage, userId) {
  const from = stageOf(client);
  const { error } = await supabase.from('clients')
    .update({ pipeline_stage: stage }).eq('id', client.id);
  if (error) throw new Error(error.message);
  const { error: iErr } = await supabase.from('interactions').insert({
    client_id: client.id,
    kind: 'stage_change',
    title: 'Moved to ' + stage,
    body: from + ' to ' + stage,
    created_by: userId || null,
    metadata: { from, to: stage },
  });
  if (iErr) throw new Error(iErr.message);
}
