/* =============================================================================
   D'Cal Voice — conversation transcripts and what went wrong in them

   The voice assistant (js/voice-assistant.js) posts every conversation here
   as it happens: what the customer said, what she said back, how long they
   waited for her voice, and what happened around it (a coupon checked, a page
   opened, the brain unreachable). Stored in MongoDB (VoiceSession) — or, with
   no database, in .voice-logs/sessions.json: a hidden folder, never served,
   and outside server/ so that `node --watch` does not restart on every save.
   Shown ONLY in the admin dashboard's "Voice assistant" tab.

   What went wrong is worked out when the admin reads them, not when they are
   recorded, so a better rule finds problems in old conversations too:
     red   — the customer did not get what they came for
     amber — they got it, but it was slow or took more than one try
   And an AI review, on request, reads a whole conversation the way a person
   would: what did they want, did they get it, where did she fail them.

   Privacy: phone numbers and emails are partly masked here, whatever the
   browser sent; one-time codes are never sent at all (the widget masks them);
   nothing is recorded while Razorpay is open (she is switched off). Kept 30
   days.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

let VoiceSession = null;
try { VoiceSession = require('./models/VoiceSession'); } catch (e) { VoiceSession = null; }

const KEEP_DAYS = parseInt(process.env.VOICE_LOG_DAYS || '30', 10);
const KEEP_MAX = parseInt(process.env.VOICE_LOG_MAX || '5000', 10);
const SLOW_MS = parseInt(process.env.VOICE_SLOW_MS || '3000', 10);      // customer stopped -> her voice
const VERY_SLOW_MS = parseInt(process.env.VOICE_VERY_SLOW_MS || '5000', 10);
const MAX_ITEMS = 400;

/* ---------- storage: MongoDB, else a local file ---------- */
const FILE_DIR = path.join(__dirname, '..', '.voice-logs');
const FILE = path.join(FILE_DIR, 'sessions.json');
let fileCache = null, fileTimer = null;
function fileLoad() {
  if (fileCache) return fileCache;
  try { fileCache = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { fileCache = {}; }
  return fileCache;
}
function fileSave() {
  if (fileTimer) return;
  fileTimer = setTimeout(() => {
    fileTimer = null;
    try { fs.mkdirSync(FILE_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(fileCache)); } catch (e) {}
  }, 800);
}
let useDb = () => false;
function setDbReady(fn) { useDb = fn; }

/* ---------- what the browser may send: checked, capped, masked ---------- */
const DIGIT_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple|शून्य|जीरो|एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|డబుల్|సున్నా|ఒకటి|రెండు|మూడు|నాలుగు|ఐదు|ఆరు|ఏడు|ఎనిమిది|తొమ్మిది)';
const DIGIT_WORDS_RUN = new RegExp('(?:' + DIGIT_WORD + '[\\s,.-]+){6,}' + DIGIT_WORD, 'gi');
function maskText(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  // emails, written or spoken: a•••@gmail.com, "a••• at gmail dot com"
  s = s.replace(/([a-z0-9._%+-])[a-z0-9._%+-]*@([a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,})/gi, '$1•••@$2');
  s = s.replace(/\b([a-z])[a-z0-9_]*((?:\s+(?:dot|underscore)\s+[a-z0-9_]+)*)\s+at\s+(?:the\s+rate\s+(?:of\s+)?)?([a-z0-9-]+)\s+dot\s+([a-z]{2,})\b/gi, '$1••• at $3 dot $4');
  // a mobile number, however it is spaced or read back ("9 8 7 6 5, 4 3 2 1 0"):
  // only its first two and last three digits stay
  s = s.replace(/\+?\d[\d\s,.-]{8,30}\d/g, (run) => {
    const d = run.replace(/\D/g, '');
    if (!/[6-9]\d{9}/.test(d)) return run;
    let seen = 0;
    return run.replace(/\d/g, (c) => { seen++; return seen <= 2 || seen > d.length - 3 ? c : '•'; });
  });
  // …or said as words ("nine eight seven six …"): too many digit words in a row
  s = s.replace(DIGIT_WORDS_RUN, '[number in words]');
  return s;
}
const T_OK = { you: 1, bot: 1, ev: 1 };
function cleanItem(it) {
  if (!it || !T_OK[it.t]) return null;
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 600000 ? Math.round(v) : undefined);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const out = { t: it.t, at: num(it.at) || Date.now() };
  if (it.t === 'ev') {
    out.kind = String(it.kind || '').replace(/[^a-z_]/g, '').slice(0, 30);
    if (!out.kind) return null;
    if (it.detail != null) out.detail = maskText(String(it.detail)).slice(0, 200);
  } else {
    out.text = maskText(it.text);
    if (!out.text) return null;
  }
  out.lang = str(it.lang, 5); out.page = str(it.page, 120); out.via = str(it.via, 12);
  out.ms = num(it.ms); out.voiceMs = num(it.voiceMs);
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

async function append(body, ua) {
  const sid = String((body && body.sid) || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (sid.length < 6) return false;
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 25).map(cleanItem).filter(Boolean);
  if (!items.length) return false;
  const now = Date.now();
  const device = /Mobi|Android|iPhone/i.test(ua || '') ? 'phone' : 'desktop';
  const signedIn = !!body.signedIn;
  if (useDb() && VoiceSession) {
    await VoiceSession.updateOne({ sid }, {
      $setOnInsert: { sid, startedAt: items[0].at || now },
      $set: { lastAt: now, device, signedIn },
      $push: { items: { $each: items, $slice: -MAX_ITEMS } }
    }, { upsert: true });
    return true;
  }
  const db = fileLoad();
  const s = db[sid] || (db[sid] = { sid, startedAt: items[0].at || now, items: [], review: null });
  s.lastAt = now; s.device = device; s.signedIn = signedIn;
  s.items = s.items.concat(items).slice(-MAX_ITEMS);
  fileSave();
  return true;
}

async function sweep() {
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  if (useDb() && VoiceSession) {
    await VoiceSession.deleteMany({ lastAt: { $lt: cutoff } });
    return;
  }
  const db = fileLoad();
  const ids = Object.keys(db).filter((k) => db[k].lastAt >= cutoff).sort((a, b) => db[b].lastAt - db[a].lastAt);
  const keep = {};
  ids.slice(0, KEEP_MAX).forEach((k) => { keep[k] = db[k]; });
  if (Object.keys(keep).length !== Object.keys(db).length) { fileCache = keep; fileSave(); }
}
async function all(limit) {
  await sweep().catch(() => {});
  if (useDb() && VoiceSession) return VoiceSession.find({}).sort({ lastAt: -1 }).limit(limit).lean();
  const db = fileLoad();
  return Object.keys(db).map((k) => db[k]).sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
}
async function one(sid) {
  if (useDb() && VoiceSession) return VoiceSession.findOne({ sid }).lean();
  return fileLoad()[sid] || null;
}
async function saveReview(sid, review) {
  if (useDb() && VoiceSession) { await VoiceSession.updateOne({ sid }, { $set: { review } }); return; }
  const s = fileLoad()[sid]; if (s) { s.review = review; fileSave(); }
}
async function remove(sid) {
  if (useDb() && VoiceSession) { await VoiceSession.deleteOne({ sid }); return; }
  const db = fileLoad(); delete db[sid]; fileSave();
}

/* ---------- what went wrong ---------- */
const PROBLEMS = {
  // red: the customer did not get what they came for
  no_answer:      { sev: 'red',   label: 'Said nothing back' },
  not_understood: { sev: 'red',   label: "Didn't understand them" },
  brain_down:     { sev: 'red',   label: 'AI / speech service unreachable' },
  wrong_language: { sev: 'red',   label: 'Answered in the wrong language' },
  claimed:        { sev: 'red',   label: "Said she did something she didn't" },
  failed:         { sev: 'red',   label: 'Task failed (coupon, OTP, form, order)' },
  abandoned:      { sev: 'red',   label: 'Customer left right after a failure' },
  // amber: they got it, but it was slow or took more than one try
  slow:           { sev: 'amber', label: 'Slow to answer (over ' + (SLOW_MS / 1000) + 's)' },
  repeated:       { sev: 'amber', label: 'Customer had to repeat themselves' },
  corrected:      { sev: 'amber', label: 'Customer corrected her' },
  cut_off:        { sev: 'amber', label: 'Cut off early — answer not wanted' },
  long_reply:     { sev: 'amber', label: 'Answer too long to listen to' },
  heard_nothing:  { sev: 'amber', label: 'Heard nothing / noise' }
};

const SCRIPT_OF = [
  ['te', /[ఀ-౿]/g], ['ta', /[஀-௿]/g], ['kn', /[ಀ-೿]/g], ['ml', /[ഀ-ൿ]/g],
  ['hi', /[ऀ-ॿ]/g], ['bn', /[ঀ-৿]/g], ['gu', /[઀-૿]/g], ['pa', /[਀-੿]/g],
  ['or', /[଀-୿]/g], ['ur', /[؀-ۿ]/g]
];
const SAME_SCRIPT = { mr: 'hi', ne: 'hi', sa: 'hi', as: 'bn' };
// the language a line is mostly written in, by its letters; null when unclear
function scriptLang(text) {
  const s = String(text || '');
  let best = null, n = 0;
  for (const [code, re] of SCRIPT_OF) { const c = (s.match(re) || []).length; if (c > n) { best = code; n = c; } }
  if (n >= 4) return best;
  return (s.match(/[A-Za-z]/g) || []).length >= 8 && n === 0 ? 'en' : null;
}
function sameLang(a, b) { return (SAME_SCRIPT[a] || a) === (SAME_SCRIPT[b] || b); }

const FAIL_EVENTS = { coupon_invalid: 1, coupon_rejected: 1, otp_wrong: 1, signin_failed: 1, form_error: 1, order_failed: 1 };
const DOWN_EVENTS = { ai_unreachable: 1, stt_failed: 1, tts_failed: 1, ask_failed: 1 };
const DONE_EVENTS = { cart_add: 1, cart_change: 1, coupon_applied: 1, form_filled: 1, order_place: 1, payment_handoff: 1, nav: 1, signin_ok: 1, checkout: 1, act: 1 };
// she claims a thing is done: added, applied, filled in, placed, saved, opened
const CLAIM_RE = /\b(i (have |'ve )?(added|applied|filled|entered|placed|saved|booked|ordered)|(has been|is) (added|applied|placed|saved)|added (it |the [a-z ]+ )?to your cart|i am (filling|adding|applying|placing))\b|(डाल दिया|लगा दिया|भर दिया|जोड़ दिया|प्लेस कर दिया|పెట్టాను|అప్లై చేశాను|నమోదు చేశాను)/i;
const CORRECT_RE = /^\s*(no\b|nope|not (that|this|what)|wrong|that'?s not|i (said|asked|meant)|nahi|nahin|नहीं|ग़लत|गलत|मैंने कहा|కాదు|తప్పు|నేను అడిగింది|இல்லை|தவறு)/i;
function words(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1); }
function similar(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (A.size < 2 || B.size < 2) return false;
  let both = 0; A.forEach((w) => { if (B.has(w)) both++; });
  return both / (A.size + B.size - both) >= 0.75;      // "apply coupon Abhiram 200" vs "… Vini 200" is not a repeat
}

/* -> { items: [item + problems[]], problems: {code: count}, exchanges, voiceMs[] } */
function analyze(session) {
  const items = (session.items || []).map((it) => Object.assign({}, it, { problems: [] }));
  const flag = (it, code) => { if (it && it.problems.indexOf(code) === -1) it.problems.push(code); };
  // exchanges: a customer line and everything up to their next one
  const ex = [];
  let cur = null;
  items.forEach((it, i) => {
    if (it.t === 'you') { cur = { you: it, i, bots: [], evs: [] }; ex.push(cur); }
    else if (cur) (it.t === 'bot' ? cur.bots : cur.evs).push(it);
    else if (it.t === 'ev' && DOWN_EVENTS[it.kind]) flag(it, 'brain_down');
  });
  const voiceMs = [];
  let pref = null;              // a language asked for by name, kept while they speak as they did then
  ex.forEach((e, k) => {
    const you = e.you, first = e.bots[0];
    const asked = e.evs.filter((v) => v.kind === 'lang' && /asked/.test(v.detail || '')).pop();
    if (asked) pref = { want: String(asked.detail).split(' ')[0], spoke: you.lang };
    else if (pref && you.lang && pref.spoke && you.lang !== pref.spoke) pref = null;
    // said nothing back (a page opening for them counts as an answer)
    if (!e.bots.length && !e.evs.some((v) => v.kind === 'nav' || v.kind === 'payment_handoff')) flag(you, 'no_answer');
    e.evs.forEach((v) => {
      if (v.kind === 'fallback') flag(you, 'not_understood');
      if (v.kind === 'heard_nothing') flag(you, 'heard_nothing');
      if (DOWN_EVENTS[v.kind]) flag(you, 'brain_down');
      if (FAIL_EVENTS[v.kind]) flag(you, 'failed');
      if (v.kind === 'barge' && parseFloat(v.detail) < 0.3) flag(e.bots[e.bots.length - 1] || you, 'cut_off');
    });
    e.bots.forEach((b) => {
      // the language: the one they asked for by name (now or earlier); else the
      // one their words are written in — Indian letters are unambiguous, Latin
      // may be English or romanised Hindi, so then the detected language
      const sc = scriptLang(you.text);
      const want = pref ? pref.want : (sc && sc !== 'en' ? sc : you.lang || sc);
      const got = scriptLang(b.text);
      if (want && got && !sameLang(want, got)) flag(b, 'wrong_language');
      if (CLAIM_RE.test(b.text) && !e.evs.some((v) => DONE_EVENTS[v.kind])) flag(b, 'claimed');
      if ((b.text || '').length > 260) flag(b, 'long_reply');
    });
    if (first) {
      const wait = first.voiceMs != null ? first.voiceMs : first.ms;
      if (wait != null) {
        if (you.via === 'voice') voiceMs.push(wait);
        if (wait > SLOW_MS) flag(first, 'slow');
      }
    }
    // they said it again: the answer before did not help them
    for (let j = Math.max(0, k - 2); j < k; j++) { if (similar(ex[j].you.text, you.text)) { flag(you, 'repeated'); break; } }
    // "no, I said …" after an answer that asked them nothing
    const prevBot = k > 0 ? ex[k - 1].bots[ex[k - 1].bots.length - 1] : null;
    if (prevBot && !/[?？]\s*$/.test(prevBot.text || '') && CORRECT_RE.test(you.text || '')) flag(you, 'corrected');
  });
  // they left right after she failed them
  const last = ex[ex.length - 1];
  if (last && Date.now() - (session.lastAt || 0) > 10 * 60000) {
    const bad = [last.you].concat(last.bots).some((it) => it.problems.some((p) => PROBLEMS[p].sev === 'red'));
    if (bad) flag(last.you, 'abandoned');
  }
  const counts = {};
  items.forEach((it) => it.problems.forEach((p) => { counts[p] = (counts[p] || 0) + 1; }));
  return { items, problems: counts, exchanges: ex.length, voiceMs };
}

function summaryOf(session) {
  const a = analyze(session);
  const you = a.items.filter((it) => it.t === 'you');
  const langs = Array.from(new Set(a.items.filter((it) => it.t !== 'ev' && it.lang).map((it) => it.lang)));
  const pages = Array.from(new Set(a.items.map((it) => it.page).filter(Boolean)));
  const firstSaid = (you[0] && you[0].text) || '';
  const red = Object.keys(a.problems).filter((p) => PROBLEMS[p].sev === 'red').length;
  return {
    sid: session.sid, startedAt: session.startedAt, lastAt: session.lastAt, device: session.device, signedIn: session.signedIn,
    turns: you.length, langs, pages, firstSaid: firstSaid.slice(0, 120), problems: a.problems, red,
    voiceMs: a.voiceMs, review: session.review ? { achieved: session.review.achieved, summary: session.review.summary, stale: session.review.items !== (session.items || []).length } : null
  };
}

/* ---------- the AI review: a whole conversation read the way a person would ---------- */
const REVIEW_PROMPT = [
  "You audit conversations between customers and \"Saathi\", the voice shopping assistant of D'Cal (hard-water products: Water Softener, Shower Head Filter, Tap Filter, Washing Machine Ball, Tap and Tile Cleaner) on dcal.co.in. Customers speak Telugu, Hindi, English and other Indian languages; many cannot read.",
  'You get the conversation as numbered lines: C = customer, S = Saathi, E = something that happened on the site. [wait Xs] is how long the customer waited after speaking until Saathi\'s voice started.',
  'Find EVERY place Saathi failed the customer: misunderstood them, answered something else, wrong or invented facts, wrong language, too long or too slow, said she did something that did not happen, did not finish what they asked (adding to cart, sign-in, address, coupon, checkout, payment), made them repeat, or left them stuck.',
  'Be concrete and fair: do not report what went fine. If nothing went wrong, issues is [].',
  'A wait over ' + (SLOW_MS / 1000) + 's is too slow for a spoken conversation: report every such line as too_slow, even if the answer was right.',
  'When an E line shows the CAUSE (ai_unreachable, stt_failed, tts_failed, fallback, coupon_invalid, form_error…), name that cause in "what" — do not guess another one.',
  'She does these ON PURPOSE — they are not faults: asking "Did you mean the X coupon?" when a heard code is close to a real one; reading a phone number or address back and asking before submitting it; asking before placing a cash-on-delivery order; asking for missing details one at a time; switching herself off before the Razorpay payment window opens (she must not hear card numbers or OTPs). An invalid coupon the customer made up is not her fault either; how she handled it may be.',
  'Return ONLY JSON: {"wanted": "<what the customer came to do, one short sentence>", "achieved": "yes"|"partly"|"no", "summary": "<two short sentences on how it went>", "issues": [{"line": <line number>, "type": "misunderstood"|"wrong_answer"|"invented"|"wrong_language"|"too_long"|"too_slow"|"false_claim"|"task_failed"|"repeat_needed"|"stuck"|"other", "what": "<what went wrong, one sentence>", "fix": "<what should change in the assistant, one sentence>"}]}',
  'Write in English. Quote the customer briefly where it helps.'
].join('\n');

function transcriptForReview(session) {
  const lines = [];
  (session.items || []).forEach((it) => {
    if (it.t === 'you') lines.push('C [' + (it.lang || '?') + ', ' + (it.via || 'voice') + ']: ' + it.text);
    else if (it.t === 'bot') lines.push('S [' + (it.lang || '?') + (it.voiceMs != null ? ', wait ' + (it.voiceMs / 1000).toFixed(1) + 's' : it.ms != null ? ', reply ' + (it.ms / 1000).toFixed(1) + 's' : '') + ']: ' + it.text);
    else lines.push('E: ' + it.kind + (it.detail ? ' ' + it.detail : '') + (it.page ? ' (on ' + it.page + ')' : ''));
  });
  return lines.slice(-160).map((l, i) => (i + 1) + '. ' + l).join('\n');
}

async function review(sid, complete) {
  const s = await one(sid);
  if (!s) return null;
  const raw = await complete({
    temperature: 0, max_tokens: 900,
    messages: [{ role: 'system', content: REVIEW_PROMPT }, { role: 'user', content: transcriptForReview(s) }]
  });
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { const m = String(raw).match(/\{[\s\S]*\}/); if (m) { try { o = JSON.parse(m[0]); } catch (e2) { o = null; } } }
  if (!o || typeof o !== 'object') throw new Error('review unreadable');
  const r = {
    at: Date.now(), items: (s.items || []).length,
    wanted: String(o.wanted || '').slice(0, 300),
    achieved: /^(yes|partly|no)$/.test(o.achieved) ? o.achieved : 'partly',
    summary: String(o.summary || '').slice(0, 600),
    issues: (Array.isArray(o.issues) ? o.issues : []).slice(0, 20).map((x) => ({
      line: parseInt(x.line, 10) || null, type: String(x.type || 'other').slice(0, 20),
      what: String(x.what || '').slice(0, 300), fix: String(x.fix || '').slice(0, 300)
    }))
  };
  await saveReview(sid, r);
  return r;
}

module.exports = { setDbReady, append, all, one, remove, analyze, summaryOf, review, transcriptForReview, maskText, PROBLEMS, SLOW_MS };
