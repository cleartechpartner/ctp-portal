import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { claudeCall } from "../lib/api";
import { LOGO } from "../lib/logo";

/* Supabase-backed persistence (replaces Claude artifact storage).
   Internal-only via RLS on studio_store. */
const storage = {
  async get(key){
    const { data, error } = await supabase.from("studio_store").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data ? { key, value: data.value } : null;
  },
  async set(key, value){
    const { error } = await supabase.from("studio_store").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { key, value };
  }
};


/* ============ CONSTANTS ============ */
const PILLARS = [
  {id:'guida', name:'AI that answers when you can\'t', sub:'Guida — after-hours & post-stay concierge'},
  {id:'partner', name:'Partner, not vendor', sub:'Tech clarity for independent hospitality owners'},
  {id:'proof', name:'Proof from the island', sub:'Real client stories, real results'},
  {id:'operator', name:'The operator\'s eye', sub:'Founder POV — ops experience, design thinking'}
];
const LANG3=[{v:'EN',l:'English'},{v:'ES',l:'Español'},{v:'BOTH',l:'Both EN + ES'}];
const LANG2=[{v:'EN',l:'English'},{v:'ES',l:'Español'}];
const VOICES=[{v:'rainy',l:'Rainy — founder voice'},{v:'ctp',l:'CTP — brand voice'}];
const GROUPS=[{id:'create',label:'Create & Publish'},{id:'clients',label:'Win & Keep Clients'},{id:'quality',label:'Quality Control'}];

const MODULES=[
{id:'social',group:'create',name:'Social Content Creator',glyph:'SC',tag:'Three on-brand post options for LinkedIn or Instagram',desc:'Pick a pillar, add any specifics, get three distinct angles ready to edit and post.',fields:[
  {k:'voice',label:'Voice',type:'radio',options:VOICES,def:'rainy',req:true},
  {k:'pillar',label:'Content pillar',type:'pillar',req:true},
  {k:'platform',label:'Platform',type:'radio',options:[{v:'LinkedIn',l:'LinkedIn'},{v:'Instagram',l:'Instagram'}],def:'LinkedIn',req:true},
  {k:'lang',label:'Language',type:'radio',options:LANG3,def:'EN',req:true},
  {k:'details',label:'Specific details or context',type:'textarea',ph:'Names, dates, numbers, a story — anything real you want woven in'},
  {k:'media',label:'Media accompanying this post',type:'textarea',ph:'Describe the photo, video, or graphic (optional)',small:true}
]},
{id:'thought',group:'create',name:'Thought Leadership Writer',glyph:'TL',tag:'Founder-voice articles and opinion posts',desc:'Builds Rainy\'s reputation as the operator who sees what vendors miss. Always contains one earned opinion.',fields:[
  {k:'pillar',label:'Content pillar',type:'pillar',req:true},
  {k:'format',label:'Format',type:'radio',options:[{v:'short',l:'Short post',s:'~250 words, 3 options'},{v:'article',l:'Full article',s:'600–750 words, 1 draft'}],def:'short',req:true},
  {k:'lang',label:'Language',type:'radio',options:LANG2,def:'EN',req:true},
  {k:'details',label:'The idea, story, or opinion to build on',type:'textarea',ph:'What happened, what you noticed, what you disagree with',req:true}
]},
{id:'blog',group:'create',name:'Blog Post Writer',glyph:'BP',tag:'SEO + AI-search optimized posts in the CTP brand voice',desc:'Built for the near-empty Spanish hospitality-AI space and English long-tail. Question-style H2s, direct answers, FAQ block. Rhythm target: 2 posts per month.',fields:[
  {k:'pillar',label:'Content pillar',type:'pillar',req:true},
  {k:'topic',label:'Topic or target keyword',type:'text',ph:'e.g. "qué es un conserje virtual para hoteles"',req:true},
  {k:'goal',label:'Goal of this post',type:'radio',options:[{v:'educate',l:'Educate prospects'},{v:'service',l:'Explain a service'},{v:'leads',l:'Generate inquiries'}],def:'educate',req:true},
  {k:'lang',label:'Language',type:'radio',options:LANG2.concat([{v:'BOTH',l:'Both (two drafts)'}]),def:'ES',req:true},
  {k:'details',label:'Specific details or context',type:'textarea',ph:'Angle, examples, anything the post must include (optional)'}
]},
{id:'video',group:'create',name:'Short-Form Video Scripter',glyph:'YT',tag:'Hooks, scripts, captions for the Riverside → Klap workflow',desc:'You record and edit in Riverside/Klap — this writes the hook, beats, and packaging that determine whether anyone watches.',fields:[
  {k:'pillar',label:'Content pillar',type:'pillar',req:true},
  {k:'topic',label:'What is this video about?',type:'text',ph:'e.g. "the night Guida took its first calls"',req:true},
  {k:'length',label:'Length',type:'radio',options:[{v:'30',l:'~30 seconds'},{v:'60',l:'~60 seconds'}],def:'30',req:true},
  {k:'lang',label:'Language',type:'radio',options:LANG3,def:'EN',req:true},
  {k:'details',label:'Specific details or context',type:'textarea',ph:'Key facts, the setting, what footage exists (optional)'}
]},
{id:'relationship',group:'clients',name:'Relationship Manager',glyph:'RM',tag:'Strategy + ready-to-send message for any contact',desc:'The referral engine. Describe the person and where things stand — get a strategic read and a message at Menorca pace.',fields:[
  {k:'ctype',label:'Who are you reaching out to?',type:'radio',options:[{v:'Referral source',l:'Referral source'},{v:'Prospective client',l:'Prospect'},{v:'Strategic partner',l:'Strategic partner'},{v:'Current/past client',l:'Current client'},{v:'Industry colleague',l:'Colleague'},{v:'Other',l:'Other'}],def:'Prospective client',req:true},
  {k:'name',label:'Contact name',type:'text',ph:'First and last name',req:true},
  {k:'company',label:'Company / property',type:'text',ph:'Hotel, business, or organization'},
  {k:'context',label:'Relationship context',type:'textarea',ph:'How you met, when you last spoke, why reach out now',req:true},
  {k:'goal',label:'What should this message accomplish?',type:'text',ph:'e.g. set a coffee, revive a stalled proposal',req:true},
  {k:'channel',label:'Channel',type:'radio',options:[{v:'Email',l:'Email'},{v:'WhatsApp',l:'WhatsApp'},{v:'LinkedIn DM',l:'LinkedIn DM'}],def:'WhatsApp',req:true},
  {k:'lang',label:'Language',type:'radio',options:LANG2,def:'EN',req:true}
]},
{id:'story',group:'clients',name:'Client Story Writer',glyph:'CS',tag:'Turns a client win into a case study + LinkedIn post + video idea',desc:'Hospitality buys on proof. Feed it the before, turning point, and after — get three usable assets. Every draft is flagged for owner approval.',fields:[
  {k:'client',label:'Client / property',type:'text',ph:'e.g. Hotel Ses Bruixes & Spa',req:true},
  {k:'before',label:'The before — what was broken or manual?',type:'textarea',req:true,ph:'What life looked like before CTP'},
  {k:'turning',label:'The turning point — what did CTP do?',type:'textarea',req:true,ph:'The engagement, the build, the moment it changed'},
  {k:'after',label:'The after — what changed?',type:'textarea',req:true,ph:'Results, even small ones. Unverified → [VERIFY]'},
  {k:'quote',label:'Owner quote (exact words, if available)',type:'textarea',ph:'Leave blank for a [PLACEHOLDER]'},
  {k:'lang',label:'Language',type:'radio',options:LANG2,def:'EN',req:true}
]},
{id:'proposal',group:'clients',name:'Proposal Writer',glyph:'PR',tag:'Discovery notes in, polished proposal out',desc:'Scope, exclusions, phased investment, terms, one clear next step — pulling current pricing from Settings.',fields:[
  {k:'client',label:'Client name',type:'text',req:true,ph:'Who this proposal is for'},
  {k:'property',label:'Property / business',type:'text',ph:'Property name and brief description'},
  {k:'services',label:'Services to include',type:'multi',options:[{v:'Tech stack — Foundation',l:'Tech stack — Foundation'},{v:'Tech stack — Premier',l:'Tech stack — Premier'},{v:'Guida deployment',l:'Guida deployment'},{v:'Monthly retainer',l:'Monthly retainer'},{v:'Consulting hours',l:'Consulting hours'}],req:true},
  {k:'notes',label:'Discovery notes',type:'textarea',req:true,ph:'Everything from the conversation: pain points, requirements, timeline'},
  {k:'lang',label:'Language',type:'radio',options:LANG2,def:'EN',req:true}
]},
{id:'guardian',group:'quality',name:'Brand Voice Guardian',glyph:'BG',tag:'Checks any draft against CTP voice, positioning, and language rules',desc:'Paste anything written outside the studio — web copy, a bio, an email. Get flagged issues with suggested rewrites.',fields:[
  {k:'voice',label:'Which voice should this match?',type:'radio',options:[{v:'rainy',l:'Rainy — founder'},{v:'ctp',l:'CTP — brand'},{v:'either',l:'Either'}],def:'either',req:true},
  {k:'content',label:'Paste your content',type:'textarea',req:true,ph:'The draft to review',big:true}
]}
];

/* ============ KNOWLEDGE BASE ============ */
function buildKB(s){
return `BUSINESS KNOWLEDGE BASE — Clear Tech Partner (CTP)

WHO WE ARE: Clear Tech Partner is a hospitality technology consultancy based in Mahón, Menorca (office: Concept 8B), founded by Rainy — ~14 years of operations experience, product design degree, former executive assistant to founders and executives. CTP builds AI-powered guest experience agents and the operational technology infrastructure that keeps independent hotels and spas running — reliably, multilingually, and without adding headcount. Public tagline: \"We build what your business actually needs.\"

FLAGSHIP PRODUCT: Guida — multilingual AI voice agent for hospitality. CRITICAL: Guida is exclusively an AFTER-HOURS and POST-STAY concierge. NEVER position as daytime staff replacement. Guida gives small teams 24/7 coverage without night shifts. Roadmap: Guida During (in-stay, live now) → Guida After (post-checkout) → Guida Before (pre-arrival).

POSITIONING: Partner, not vendor. One-line: "Clear Tech Partner builds the tech infrastructure boutique hospitality runs on — and stays to run it with you."

DIFFERENTIATORS: 1) Operator empathy — designed for owners with no IT department. 2) On the island, in the market — local, present, bilingual. 3) Multilingual by design (EN/ES native). 4) Boutique-first — independent properties, transparent pricing. 5) Privacy-aware, EU-grounded.

WHAT CTP IS NOT: not a software reseller, call-center replacement, offshore dev shop, or AI hype. Never promise to replace staff.

PRIMARY AUDIENCE: Independent owner (1–3 boutique properties), wears every hat, buys on trust and proof. SECONDARY: Property managers (50–150 rooms). TERTIARY: hospitality peers/referrers.

VOICE A — RAINY (FOUNDER): Direct, warm, grounded. First person, real stories, concrete. Confident without hype. DO: short sentences, numbers, "here's what happened." DON'T: corporate jargon, "thrilled to announce", humble-brag.

VOICE B — CTP (BRAND): Clear, calm, precise. Premium but human. "We" voice. DO: why before what, owner's pain in their words. DON'T: feature lists without context, fear-mongering, enterprise-speak.

BANNED: game-changer, revolutionize, unlock, seamless, "in today's fast-paced world", elevate, cutting-edge, "let that sink in." ES: revolucionario, "no te quedes atrás", "lleva tu negocio al siguiente nivel."

LANGUAGE: Spanish = peninsular, tú register. Never machine-translate idioms. Vocab: huéspedes, alojamiento, temporada alta/baja. Use "alquilar" not "rentar." Local flavor (Menorca, Balears) welcome.

PILLARS: 1) AI that answers when you can't (Guida). 2) Partner, not vendor (consulting). 3) Proof from the island (client stories — need owner approval). 4) The operator's eye (founder thought leadership).

VERIFIED PROOF: ${s.proofPoints || '[none yet]'}

PRICING: Foundation ${s.stackFoundation||'[not set]'} | Premier ${s.stackPremier||'[not set]'} | Retainers ${s.retainers||'[not set]'} | Guida setup ${s.guidaSetup||'[VERIFY]'} | Guida monthly ${s.guidaMonthly||'[VERIFY]'} | Consulting ${s.consultRate||'[not set]'}. Software subscriptions billed under CTP, passed through at cost.
${s.extraContext ? '\nADDITIONAL CONTEXT: '+s.extraContext : ''}

RULES: Never invent stats/names/results — use [VERIFY: description]. Client stories need [NEEDS OWNER APPROVAL]. Output plain text only — no markdown, JSON, or code fences.`;
}

/* ============ PROMPT BUILDERS ============ */
function langLine(v){
  if(v==='ES') return 'Write in peninsular Spanish, tú register. Must read as an original.';
  if(v==='BOTH') return 'Produce TWO versions: English labeled "EN —", then Spanish (tú) labeled "ES —". Each an original.';
  return 'Write in English.';
}
function pillarLine(id){ const p=PILLARS.find(x=>x.id===id); return p?p.name+' ('+p.sub+')':''; }
function voiceLine(v){ return v==='ctp'?'Use VOICE B — Clear Tech Partner brand voice.':'Use VOICE A — Rainy founder voice.'; }

function buildPrompt(mod,v,s){
  const KB=buildKB(s);
  let task='',mode='single';

  if(mod.id==='social'){
    mode='options';
    task=`TASK: Write 3 distinct ${v.platform} post options for pillar "${pillarLine(v.pillar)}".
${voiceLine(v.voice)} ${langLine(v.lang)}
Each option: genuinely different angle (story / insight / question). ${v.platform==='LinkedIn'?'LinkedIn: 120–200 words, short paragraphs, max 3 hashtags.':'Instagram: caption + "Visual:" line suggesting image/video. Max 5 hashtags.'}
${v.details?'SPECIFICS: '+v.details:''}${v.media?'\nMEDIA: '+v.media:''}
Separate options with: ===OPTION===
After each, add "Angle:" in under 15 words.`;
  }
  if(mod.id==='thought'){
    const isArt=v.format==='article'; mode=isArt?'single':'options';
    task=`TASK: ${isArt?'Write one thought-leadership article (600–750 words)':'Write 3 short posts (~200–250 words each)'} for LinkedIn under Rainy's name, pillar "${pillarLine(v.pillar)}".
VOICE A — Rainy, first person. ${langLine(v.lang)}
Must contain one earned opinion a vendor wouldn't say. End with a question or quiet CTA, never a pitch.
RAW MATERIAL: ${v.details}
${isArt?'No headers, well-paced paragraphs.':'Separate with: ===OPTION===\nAfter each, "Angle:" in under 15 words.'}`;
  }
  if(mod.id==='blog'){
    task=`TASK: Write one SEO/AI-search optimized blog post (700–900 words). Pillar: "${pillarLine(v.pillar)}". Keyword: "${v.topic}". Goal: ${v.goal}.
VOICE B — CTP brand. ${langLine(v.lang)}
Structure (plain text, section titles on own line in Title Case — no # symbols):
- Title with keyword naturally
- Opening answering core question in first 2 sentences
- 3–4 sections titled as owner questions; answer directly in first 2 sentences each
- FAQ: 3 questions, 2–3 sentence answers
- One-line closing CTA
${v.details?'MUST INCLUDE: '+v.details:''}`;
  }
  if(mod.id==='video'){
    task=`TASK: Short-form video script (~${v.length}s) for YouTube Shorts/Reels. Pillar: "${pillarLine(v.pillar)}". Topic: "${v.topic}".
VOICE A — Rainy speaks to camera. ${langLine(v.lang)}
Output labeled sections:
HOOK (first 2s): spoken line + on-screen text
SCRIPT: full script with timing beats [0–3s]
TITLE: under 60 chars
CAPTION: 1–3 sentences
HASHTAGS: max 5
B-ROLL: 3–4 shot suggestions
Feeds Riverside → Klap workflow. Keep natural to read aloud.
${v.details?'DETAILS: '+v.details:''}`;
  }
  if(mod.id==='relationship'){
    task=`TASK: Outreach message. Type: ${v.ctype}. Name: ${v.name}. ${v.company?'Company: '+v.company+'.':''}
CONTEXT: ${v.context}
GOAL: ${v.goal}
CHANNEL: ${v.channel}. ${langLine(v.lang)}
Output:
STRATEGY: 2 lines max — approach and why.
MESSAGE: ready-to-send in Rainy's voice. ${v.channel==='Email'?'Include "Subject:" line first.':'Natural '+v.channel+' length.'}
Warm, unhurried, Menorca pace. Never pushy.`;
  }
  if(mod.id==='story'){
    task=`TASK: Turn client win into 3 assets. Client: ${v.client}.
BEFORE: ${v.before}
TURNING POINT: ${v.turning}
AFTER: ${v.after}
${v.quote?'QUOTE (use verbatim): '+v.quote:'No quote — insert [PLACEHOLDER: owner quote about X].'}
${langLine(v.lang)}
Begin with: [NEEDS OWNER APPROVAL BEFORE PUBLISHING]
Then:
CASE STUDY: 300–400 words, brand voice, before/turning/after.
LINKEDIN POST: 120–180 words, Rainy's voice, personal.
VIDEO IDEA: 2–3 lines for a short-form video.
Only use provided numbers; else [VERIFY: ...].`;
  }
  if(mod.id==='proposal'){
    task=`TASK: Client proposal. Client: ${v.client}. ${v.property?'Property: '+v.property+'.':''}
SERVICES: ${(v.services||[]).join(', ')}
NOTES: ${v.notes}
${langLine(v.lang)} VOICE B — CTP brand. Readable in 3 minutes.
Sections (plain text):
UNDERSTANDING — 2–3 sentences proving CTP heard them
SCOPE — what's included
NOT INCLUDED — explicit exclusions
TIMELINE — phased, realistic
INVESTMENT — use pricing frames; 50/25/25 phasing; software passed through at cost
TERMS — validity [DATE + 30 days], payment terms
NEXT STEP — one clear action
Any missing pricing → [VERIFY: ...].`;
  }
  if(mod.id==='guardian'){
    const vt=v.voice==='either'?'whichever CTP voice fits — state which':(v.voice==='ctp'?'VOICE B — CTP brand':'VOICE A — Rainy founder');
    task=`TASK: Review against CTP knowledge base. Judge against ${vt}. Check: voice match, banned phrases, positioning (especially Guida after-hours rule), unverified claims, language register.
Output:
VERDICT: ready / needs edits / off-brand
FLAGS: quoted fragment → issue → "Rewrite:" suggestion. If none: "No flags."
WHAT WORKS: 1–2 lines.
Do not rewrite the whole piece.
CONTENT:
${v.content}`;
  }
  return {prompt:KB+'\n\n'+task, mode};
}

function splitOptions(text){
  const p=text.split(/^\s*===OPTION===\s*$/m).map(x=>x.trim()).filter(Boolean);
  return p.length>1?p:[text.trim()];
}

/* ============ API ============ */
async function callAPI(prompt){
  const t = await claudeCall({ messages:[{ role:"user", content: prompt }], max_tokens: 1000 });
  if(!t) throw new Error("Empty response");
  return t;
}

/* ============ DEFAULT SETTINGS ============ */
const DEF_SETTINGS={
  consultRate:'60–80 €/hr',
  stackFoundation:'€5,800 (Foundation — phased 50/25/25)',
  stackPremier:'€8,500 (Premier Experience — phased 50/25/25)',
  retainers:'€350–€550/month per property',
  guidaSetup:'',guidaMonthly:'',
  proofPoints:'Guida live as night agent at Hotel Ses Bruixes & Spa (Mahón) — handled its first guest calls on launch night, June 2026.',
  extraContext:''
};

/* ============ STYLES ============ */
const CSS=`
.studio{color:var(--ink);font-size:16px;line-height:1.55}
.studio .eyebrow{font-weight:600;letter-spacing:.22em;text-transform:uppercase;font-size:.68rem;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
.studio .hdr{border-bottom:1px solid var(--line);background:var(--panel);padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;z-index:5}
.studio .brand{display:flex;align-items:center;gap:13px;cursor:pointer;background:none;border:none;color:var(--ink);text-align:left}
.studio .logo{width:44px;height:44px;flex-shrink:0;display:block}
.studio .wmark{font-size:1rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700}
.studio .wmark small{display:block;letter-spacing:.26em;font-size:.58rem;color:var(--dim);margin-top:3px;font-weight:500}
.studio .tnav{display:flex;gap:6px}
.studio .tnav button{background:none;border:1px solid transparent;color:var(--dim);font-weight:600;letter-spacing:.14em;text-transform:uppercase;font-size:.66rem;padding:9px 13px;border-radius:8px;cursor:pointer}
.studio .tnav button:hover{color:var(--blue)}
.studio .tnav button.on{color:var(--blue);background:var(--blue-soft);border-color:rgba(0,82,255,.18)}
.studio .mn{max-width:980px;margin:0 auto;padding:28px 20px 80px}
.studio .hero{margin:18px 0 8px}
.studio .hero h1{font-size:1.7rem;font-weight:700;letter-spacing:-.01em;margin:10px 0 6px}
.studio .hero p{color:var(--dim);max-width:620px}
.studio .grp{margin-top:38px}
.studio .grp-r{display:flex;align-items:center;gap:14px;margin-bottom:16px}
.studio .grp-r .ln{flex:1;height:2px;background:var(--grad);opacity:.25;border-radius:2px}
.studio .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:14px}
.studio .mc{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:20px 18px 18px;cursor:pointer;text-align:left;color:var(--ink);transition:border-color .18s,transform .18s,box-shadow .18s;display:flex;flex-direction:column;gap:8px;box-shadow:0 1px 3px rgba(16,24,38,.04)}
.studio .mc:hover{border-color:var(--cyan);transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,82,255,.10)}
.studio .mc h3{font-weight:600;font-size:1.05rem}
.studio .mc p{color:var(--dim);font-size:.86rem;line-height:1.5}
.studio .doc{margin-top:46px;border:1px solid var(--line);border-radius:var(--r);padding:20px;background:var(--panel)}
.studio .doc ol{margin:10px 0 0 18px;color:var(--dim);font-size:.9rem}
.studio .doc li{margin:5px 0}
.studio .doc li b{color:var(--ink);font-weight:600}
.studio .bk{background:none;border:none;color:var(--blue);cursor:pointer;font-weight:600;letter-spacing:.16em;text-transform:uppercase;font-size:.66rem;padding:4px 0;margin-bottom:18px}
.studio .mh h1{font-weight:700;font-size:1.5rem;margin:6px 0 6px}
.studio .mh p{color:var(--dim);max-width:640px;font-size:.93rem}
.studio .fld{margin-bottom:22px}
.studio .lab{display:block;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:9px;font-weight:600}
.studio .lab .rq{color:var(--blue)}
.studio .chs{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:9px}
.studio .ch{border:1px solid var(--line);border-radius:10px;padding:11px 13px;cursor:pointer;background:var(--panel);font-size:.88rem;color:var(--ink);text-align:left;line-height:1.4}
.studio .ch small{display:block;color:var(--dim);font-size:.76rem;margin-top:3px}
.studio .ch.sel{border-color:var(--blue);background:var(--blue-soft);box-shadow:inset 0 0 0 1px var(--blue)}
.studio .ta,.studio .ti{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:11px 13px;font-family:inherit;font-size:.95rem;resize:vertical}
.studio .ta{min-height:96px}.ta.big{min-height:180px}.ta.sm{min-height:64px}
.studio .ta:focus,.studio .ti:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,82,255,.14)}
.studio .btn{background:var(--grad);color:#fff;border:none;border-radius:10px;padding:13px 22px;font-family:inherit;font-size:.93rem;font-weight:600;cursor:pointer;letter-spacing:.02em}
.studio .btn:disabled{opacity:.45;cursor:default}
.studio .btn.gh{background:var(--panel);border:1px solid var(--line);color:var(--ink)}
.studio .btn.sm{padding:8px 14px;font-size:.8rem}
.studio .br{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.studio .oc{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:20px;margin-bottom:18px;box-shadow:0 1px 3px rgba(16,24,38,.04)}
.studio .oc .ot{font-weight:700;letter-spacing:.2em;text-transform:uppercase;font-size:.64rem;margin-bottom:12px;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
.studio .oc pre{white-space:pre-wrap;font-family:inherit;font-size:.95rem;line-height:1.65;color:var(--ink);word-break:break-word}
.studio .oc .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.studio .revta{min-height:60px;font-size:.88rem;margin-top:8px}
.studio .ld{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);padding:34px;text-align:center;color:var(--dim)}
.studio .sp{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;margin:0 auto 14px;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.studio .err{border:1px solid var(--danger);border-radius:var(--r);padding:16px;color:var(--danger);background:#fdf3f2;font-size:.9rem}
.studio .spnl{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:22px;margin-top:22px;box-shadow:0 1px 3px rgba(16,24,38,.04)}
.studio .spnl h3{font-weight:600;margin-bottom:6px}
.studio .spnl .hn{color:var(--dim);font-size:.84rem;margin-bottom:16px}
.studio .sg{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.studio .tst{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:11px 20px;border-radius:10px;font-size:.9rem;z-index:50;box-shadow:0 6px 24px rgba(16,24,38,.25)}
.studio .li{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;margin-top:12px;cursor:pointer;box-shadow:0 1px 3px rgba(16,24,38,.04)}
.studio .li .tp{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.studio .li .tp b{font-weight:600}.li .tp span{color:var(--dim);font-size:.76rem}
.studio .li pre{display:none;white-space:pre-wrap;font-family:inherit;font-size:.9rem;line-height:1.6;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.studio .li.open pre{display:block}
.studio .li.open .acts{display:flex}.li .acts{display:none;gap:8px;margin-top:10px}
.studio .empty{color:var(--dim);padding:30px 0;text-align:center}
@media(max-width:640px){.studio .mn{padding:20px 14px 70px}.studio .hdr{padding:14px}.studio .wmark{font-size:.86rem;letter-spacing:.1em}.studio .cards{grid-template-columns:1fr 1fr}}
@media(max-width:460px){.studio .cards{grid-template-columns:1fr}.studio .chs{grid-template-columns:1fr 1fr}}
`;

/* ============ MAIN COMPONENT ============ */
export default function Studio(){
  const[view,setView]=useState('dash');
  const[modId,setModId]=useState(null);
  const[form,setForm]=useState({});
  const[outputs,setOutputs]=useState([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState('');
  const[settings,setSettings]=useState({...DEF_SETTINGS});
  const[libItems,setLibItems]=useState([]);
  const[toastMsg,setToastMsg]=useState('');
  const[revInputs,setRevInputs]=useState({});
  const[openLib,setOpenLib]=useState({});
  const[backupText,setBackupText]=useState('');
  const[importText,setImportText]=useState('');
  const settingsRef=useRef(settings);
  settingsRef.current=settings;

  const toast=useCallback((m)=>{setToastMsg(m);setTimeout(()=>setToastMsg(''),2200);},[]);

  useEffect(()=>{
    (async()=>{
      try{const r=await storage.get('ctp-s');if(r&&r.value){const v=JSON.parse(r.value);setSettings(s=>({...DEF_SETTINGS,...v}));}}catch(e){}
    })();
  },[]);

  const saveS=async(s)=>{try{await storage.set('ctp-s',JSON.stringify(s));toast('Settings saved');}catch(e){toast('Save failed');}};
  const loadLib=async()=>{try{const r=await storage.get('ctp-lib');if(r&&r.value)setLibItems(JSON.parse(r.value));}catch(e){setLibItems([]);}};
  const saveLib=async(items)=>{try{await storage.set('ctp-lib',JSON.stringify(items));setLibItems(items);return true;}catch(e){toast('Save failed');return false;}};

  const goTo=(v,mid)=>{setView(v);setModId(mid||null);if(v!=='mod'){setForm({});setOutputs([]);setError('');}setRevInputs({});window.scrollTo?.({top:0});};

  const mod=modId?MODULES.find(m=>m.id===modId):null;

  // Init form defaults when module opens
  useEffect(()=>{
    if(mod){
      const f={};
      mod.fields.forEach(fd=>{
        if(fd.type==='radio')f[fd.k]=fd.def||fd.options[0].v;
        else if(fd.type==='pillar')f[fd.k]='';
        else if(fd.type==='multi')f[fd.k]=[];
        else f[fd.k]='';
      });
      setForm(f);setOutputs([]);setError('');
    }
  },[modId]);

  const setF=(k,v)=>setForm(p=>({...p,[k]:v}));
  const togMulti=(k,v)=>setForm(p=>{const a=p[k]||[];return{...p,[k]:a.includes(v)?a.filter(x=>x!==v):[...a,v]};});

  const validate=()=>{
    if(!mod)return false;
    for(const f of mod.fields){
      if(f.req){const val=form[f.k];if(f.type==='multi'?!(val&&val.length):!val||(typeof val==='string'&&!val.trim())){toast('Missing: '+f.label);return false;}}}
    return true;
  };

  const generate=async()=>{
    if(!validate())return;
    setLoading(true);setError('');setOutputs([]);
    try{
      const newOutputs=[];
      if(mod.id==='blog'&&form.lang==='BOTH'){
        for(const L of ['EN','ES']){
          const{prompt}=buildPrompt(mod,{...form,lang:L},settingsRef.current);
          const text=await callAPI(prompt);
          newOutputs.push({tag:mod.name+' — '+L,content:text,bp:prompt});
        }
      }else{
        const{prompt,mode}=buildPrompt(mod,form,settingsRef.current);
        const text=await callAPI(prompt);
        if(mode==='options'){splitOptions(text).forEach((o,i)=>newOutputs.push({tag:'Option '+(i+1),content:o,bp:prompt}));}
        else{newOutputs.push({tag:mod.name,content:text,bp:prompt});}
      }
      setOutputs(newOutputs);
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  const revise=async(i)=>{
    const inst=(revInputs[i]||'').trim();
    if(!inst){toast('Describe the change');return;}
    const o=outputs[i];
    setOutputs(p=>p.map((x,j)=>j===i?{...x,revising:true}:x));
    try{
      const p2=o.bp+`\n\nA draft was produced. Apply this revision and return ONLY the full revised version, same format, plain text.\nREVISION: ${inst}\n\nDRAFT:\n${o.content}`;
      const text=await callAPI(p2);
      setOutputs(p=>p.map((x,j)=>j===i?{tag:o.tag+' · revised',content:text,bp:o.bp,revising:false}:x));
      setRevInputs(p=>({...p,[i]:''}));
    }catch(e){setOutputs(p=>p.map((x,j)=>j===i?{...x,revising:false}:x));toast('Revision failed');}
  };

  const saveToLib=async(i)=>{
    const o=outputs[i];
    const items=[{id:Date.now(),module:mod?mod.name:o.tag,tag:o.tag,content:o.content,date:new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})},...libItems];
    if(await saveLib(items))toast('Saved to library');
  };

  const copyT=async(t)=>{try{await navigator.clipboard.writeText(t);toast('Copied');}catch(e){toast('Copy failed');}};

  const exportBackup=async()=>{
    let lib=[];
    try{const r=await storage.get('ctp-lib');if(r&&r.value)lib=JSON.parse(r.value);}catch(e){}
    const data=JSON.stringify({app:'CTP Content Studio',exported:new Date().toISOString(),settings,library:lib},null,2);
    setBackupText(data);
    try{
      const blob=new Blob([data],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download='ctp-studio-backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
      toast('Backup ready — downloaded + shown below');
    }catch(e){toast('Backup shown below — copy it somewhere safe');}
  };
  const importBackup=async()=>{
    try{
      const d=JSON.parse(importText);
      if(d.settings){const ns={...DEF_SETTINGS,...d.settings};setSettings(ns);await storage.set('ctp-s',JSON.stringify(ns));}
      if(Array.isArray(d.library)){await storage.set('ctp-lib',JSON.stringify(d.library));setLibItems(d.library);}
      setImportText('');toast('Backup restored');
    }catch(e){toast('Invalid backup — paste the full JSON');}
  };

  // ============ RENDER ============
  return(
    <div className="studio">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{CSS}</style>
      <header className="hdr">
        <button className="brand" onClick={()=>goTo('dash')}>
          <img src={LOGO} alt="Clear Tech Partner" className="logo"/>
          <span className="wmark">Clear Tech Partner<small>Content Studio</small></span>
        </button>
        <nav className="tnav">
          <button className={view==='dash'||view==='mod'?'on':''} onClick={()=>goTo('dash')}>Studio</button>
          <button className={view==='lib'?'on':''} onClick={()=>{goTo('lib');loadLib();}}>Library</button>
          <button className={view==='set'?'on':''} onClick={()=>goTo('set')}>Settings</button>
        </nav>
      </header>

      <main className="mn">
      {view==='dash'&&(<>
        <div className="hero">
          <div className="eyebrow">Modern systems for business</div>
          <h1>What are we creating today?</h1>
          <p>Every specialist is trained on Clear Tech Partner — the voice, the pillars, the proof, the pricing. They get you 85%. The last 15% is you.</p>
        </div>
        {GROUPS.map(g=>(
          <div className="grp" key={g.id}>
            <div className="grp-r"><span className="eyebrow">{g.label}</span><span className="ln"/></div>
            <div className="cards">
              {MODULES.filter(m=>m.group===g.id).map(m=>(
                <button className="mc" key={m.id} onClick={()=>goTo('mod',m.id)}>
                  <h3>{m.name}</h3>
                  <p>{m.tag}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="doc">
          <span className="eyebrow">Operating doctrine</span>
          <ol>
            <li><b>Read everything before you publish.</b> The studio drafts — you decide.</li>
            <li><b>One pillar per piece.</b> If it fits two, it's unfocused.</li>
            <li><b>Rhythm beats volume.</b> 2 blog posts a month. Consistent LinkedIn.</li>
            <li><b>Never publish an unverified number.</b></li>
            <li><b>Every client story gets owner approval first.</b></li>
          </ol>
        </div>
      </>)}

      {view==='mod'&&mod&&(<>
        <button className="bk" onClick={()=>goTo('dash')}>← Studio</button>
        <div className="mh">
          <div className="eyebrow">{GROUPS.find(g=>g.id===mod.group)?.label}</div>
          <h1>{mod.name}</h1>
          <p>{mod.desc}</p>
        </div>
        <div style={{marginTop:26}}>
          {mod.fields.map(f=>(
            <div className="fld" key={f.k}>
              <label className="lab">{f.label}{f.req&&<span className="rq"> *</span>}</label>
              {f.type==='radio'&&(
                <div className="chs">{f.options.map(o=>(
                  <button key={o.v} type="button" className={`ch${form[f.k]===o.v?' sel':''}`} onClick={()=>setF(f.k,o.v)}>{o.l}{o.s&&<small>{o.s}</small>}</button>
                ))}</div>
              )}
              {f.type==='pillar'&&(
                <div className="chs">{PILLARS.map(p=>(
                  <button key={p.id} type="button" className={`ch${form[f.k]===p.id?' sel':''}`} onClick={()=>setF(f.k,p.id)}>{p.name}<small>{p.sub}</small></button>
                ))}</div>
              )}
              {f.type==='multi'&&(
                <div className="chs">{f.options.map(o=>(
                  <button key={o.v} type="button" className={`ch${(form[f.k]||[]).includes(o.v)?' sel':''}`} onClick={()=>togMulti(f.k,o.v)}>{o.l}</button>
                ))}</div>
              )}
              {f.type==='textarea'&&(
                <textarea className={`ta${f.big?' big':''}${f.small?' sm':''}`} placeholder={f.ph||''} value={form[f.k]||''} onChange={e=>setF(f.k,e.target.value)}/>
              )}
              {f.type==='text'&&(
                <input className="ti" type="text" placeholder={f.ph||''} value={form[f.k]||''} onChange={e=>setF(f.k,e.target.value)}/>
              )}
            </div>
          ))}
          <div className="br">
            <button className="btn" onClick={generate} disabled={loading}>Generate</button>
            <button className="btn gh" onClick={()=>{const f={};mod.fields.forEach(fd=>{if(fd.type==='radio')f[fd.k]=fd.def||fd.options[0].v;else if(fd.type==='pillar')f[fd.k]='';else if(fd.type==='multi')f[fd.k]=[];else f[fd.k]='';});setForm(f);setOutputs([]);setError('');}}>Reset form</button>
          </div>
        </div>
        <div style={{marginTop:34}}>
          {loading&&<div className="ld"><div className="sp"/>Drafting in the CTP voice…<br/><small style={{color:'var(--muted)'}}>usually 10–25 seconds</small></div>}
          {error&&<div className="err">Something went wrong ({error}). Your inputs are still here — try Generate again.</div>}
          {outputs.map((o,i)=>(
            <div className="oc" key={i}>
              {o.revising?<div className="ld"><div className="sp"/>Revising…</div>:<>
              <div className="ot">{o.tag}</div>
              <pre>{o.content}</pre>
              <div className="acts">
                <button className="btn sm" onClick={()=>copyT(o.content)}>Copy</button>
                <button className="btn sm gh" onClick={()=>saveToLib(i)}>Save to library</button>
              </div>
              <div style={{marginTop:12}}>
                <label className="lab">Want changes?</label>
                <textarea className="ta revta" placeholder="e.g. shorter, add the launch-night story, make the opinion sharper" value={revInputs[i]||''} onChange={e=>setRevInputs(p=>({...p,[i]:e.target.value}))}/>
                <div className="br" style={{marginTop:9}}>
                  <button className="btn sm gh" onClick={()=>revise(i)}>Revise this option</button>
                </div>
              </div>
              </>}
            </div>
          ))}
        </div>
      </>)}

      {view==='set'&&(<>
        <div className="hero">
          <div className="eyebrow">Business settings</div>
          <h1>The numbers behind the words</h1>
          <p>Everything here feeds directly into the specialists — especially the Proposal Writer.</p>
        </div>
        <div className="spnl">
          <h3>Pricing frames</h3>
          <div className="hn">Used by the Proposal Writer. Write them the way you'd say them.</div>
          <div className="sg">
            {[['stackFoundation','Tech stack — Foundation'],['stackPremier','Tech stack — Premier'],['retainers','Monthly retainers'],['consultRate','Consulting rate'],['guidaSetup','Guida — setup fee'],['guidaMonthly','Guida — monthly']].map(([k,l])=>(
              <div className="fld" key={k}><label className="lab">{l}</label><input className="ti" value={settings[k]||''} placeholder={k.startsWith('guida')?'not set — proposals show [VERIFY]':''} onChange={e=>setSettings(s=>({...s,[k]:e.target.value}))}/></div>
            ))}
          </div>
        </div>
        <div className="spnl">
          <h3>Verified proof points</h3>
          <div className="hn">One per line. The ONLY facts specialists may state as true.</div>
          <textarea className="ta" style={{minHeight:130}} value={settings.proofPoints||''} onChange={e=>setSettings(s=>({...s,proofPoints:e.target.value}))}/>
        </div>
        <div className="spnl">
          <h3>Additional business context</h3>
          <div className="hn">Anything else every specialist should know.</div>
          <textarea className="ta" value={settings.extraContext||''} onChange={e=>setSettings(s=>({...s,extraContext:e.target.value}))}/>
        </div>
        <div className="spnl">
          <h3>Backup & portability</h3>
          <div className="hn">Your settings + saved library, as one JSON file you own. Keep a copy outside Claude — it restores everything anywhere, including a future standalone version.</div>
          <div className="br">
            <button className="btn gh" onClick={exportBackup}>Export backup</button>
          </div>
          {backupText&&<textarea className="ta" style={{minHeight:120,marginTop:12,fontSize:'.78rem'}} readOnly value={backupText} onClick={e=>e.target.select()}/>}
          <div style={{marginTop:16}}>
            <label className="lab">Restore from backup</label>
            <textarea className="ta sm" placeholder="Paste a backup JSON here" value={importText} onChange={e=>setImportText(e.target.value)}/>
            <div className="br" style={{marginTop:9}}>
              <button className="btn sm gh" onClick={importBackup} disabled={!importText.trim()}>Restore</button>
            </div>
          </div>
        </div>
        <div className="br" style={{marginTop:20}}>
          <button className="btn" onClick={()=>saveS(settings)}>Save settings</button>
          <button className="btn gh" onClick={()=>{if(confirm('Reset all settings to defaults?')){const d={...DEF_SETTINGS};setSettings(d);saveS(d);}}}>Reset to defaults</button>
        </div>
      </>)}

      {view==='lib'&&(<>
        <div className="hero">
          <div className="eyebrow">Library</div>
          <h1>Saved work</h1>
          <p>Final drafts you kept. Tap to expand, copy, or delete.</p>
        </div>
        {!libItems.length?<div className="empty">Nothing saved yet. Hit "Save to library" on any draft.</div>:
          libItems.map(it=>(
            <div className={`li${openLib[it.id]?' open':''}`} key={it.id} onClick={()=>setOpenLib(p=>({...p,[it.id]:!p[it.id]}))}>
              <div className="tp"><b>{it.module}{it.tag&&it.tag!==it.module?' · '+it.tag:''}</b><span>{it.date}</span></div>
              <pre>{it.content}</pre>
              <div className="acts">
                <button className="btn sm gh" onClick={e=>{e.stopPropagation();copyT(it.content);}}>Copy</button>
                <button className="btn sm gh" onClick={async e=>{e.stopPropagation();const ni=libItems.filter(x=>x.id!==it.id);await saveLib(ni);toast('Deleted');}}>Delete</button>
              </div>
            </div>
          ))
        }
      </>)}
      </main>
      {toastMsg&&<div className="tst">{toastMsg}</div>}
    </div>
  );
}
