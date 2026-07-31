/* =============================================================================
   D'Cal Voice — ElevenLabs text-to-speech proxy (natural Indian female voice)

   The browser widget (js/voice-assistant.js) asks for the reply TEXT here; this
   calls ElevenLabs with the SECRET api key and returns MP3 audio in a natural
   Telugu / Hindi / English (India) voice. The key NEVER reaches the browser.

   - Customer supplies ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.
   - Graceful fallback: if the key/voice is missing or a call fails, this returns
     5xx and the widget drops back to the FREE browser voice — never silent.

   LATENCY — this file is the single biggest source of "she takes ages to talk",
   so four things are done to cut it:
     1. STREAMING. We call ElevenLabs' /stream endpoint and pipe each chunk to
        the browser the moment it arrives, instead of waiting for the whole MP3
        to be generated and only then sending it. The browser plays the first
        chunk while the rest is still being made. This alone is worth ~1-2s.
     2. SMALLER AUDIO. mp3_22050_32 instead of mp3_44100_128 — about 4x fewer
        bytes for speech that sounds the same on a phone speaker. Big win on a
        mobile connection.
     3. FAST MODEL WHERE IT IS SAFE. eleven_flash_v2_5 is ~75ms to first audio
        but does NOT support Telugu, so it is used only for Hindi/English and
        Telugu keeps eleven_multilingual_v2. Set ELEVENLABS_FAST=0 to turn this
        off and use one model everywhere.
     4. WARM START. assistant.js calls warm() the instant the AI reply is ready,
        so ElevenLabs starts generating while the reply is still travelling to
        the browser. The browser's request then joins that same in-flight
        generation (see INFLIGHT below) — one API call, one bill, less waiting.

   A small bounded cache means repeated lines (greeting, "opening the cart", …)
   are only paid for once per server run, and are then served instantly.
   ============================================================================= */
'use strict';

const https = require('https');
const crypto = require('crypto');

const API_KEY = process.env.ELEVENLABS_API_KEY || '';
// eleven_multilingual_v2 supports Telugu; turbo/flash do not — do not change
// this unless you switch to eleven_v3 (also supports Telugu, but slower/pricier).
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
// Low-latency model used ONLY for the languages it actually supports (below).
const MODEL_FAST = process.env.ELEVENLABS_MODEL_FAST || 'eleven_flash_v2_5';
const USE_FAST = process.env.ELEVENLABS_FAST !== '0';
// Languages eleven_flash_v2_5 covers. Telugu is deliberately absent — flash
// cannot speak it, so 'te' always falls through to MODEL.
const FAST_LANGS = { en: 1, hi: 1 };
// Speech, not music: 22kHz / 32kbps mono is clear on a phone and ~4x smaller
// than the 44100_128 default, so it arrives sooner on a weak mobile network.
const FORMAT = process.env.ELEVENLABS_FORMAT || 'mp3_22050_32';
// 0 = no latency optimisation … 3 = maximum. 4 also disables ElevenLabs' text
// normaliser, which we must NOT do — it is what reads "4500" as a price.
const LATENCY = String(process.env.ELEVENLABS_LATENCY || '3');
// eleven_v3 REJECTS this parameter outright ("Providing optimize_streaming_latency
// is not supported with the 'eleven_v3' model", HTTP 400), so it must only be
// sent to the models that accept it — otherwise every reply fails and she goes
// completely silent.
function latencyFor(model) {
  if (LATENCY === '0' || /v3\b/i.test(model)) return null;
  return LATENCY;
}
// One voice can speak all 3 languages; per-language overrides are optional.
const VOICE_DEFAULT = process.env.ELEVENLABS_VOICE_ID || '';
const VOICE = {
  te: process.env.ELEVENLABS_VOICE_TE || VOICE_DEFAULT,
  hi: process.env.ELEVENLABS_VOICE_HI || VOICE_DEFAULT,
  en: process.env.ELEVENLABS_VOICE_EN || VOICE_DEFAULT
};
const ENABLED = !!(API_KEY && VOICE_DEFAULT);

const MAX_TEXT = 800;                          // guard cost + latency

// Only these three have a voice mapping; every other language the customer may
// speak (Tamil, Kannada, …) is spoken by the default voice, which handles the
// script itself.
function normLang(l) { return (l === 'te' || l === 'hi') ? l : 'en'; }
function modelFor(lang) { return (USE_FAST && FAST_LANGS[lang]) ? MODEL_FAST : MODEL; }

/* ---- Bounded LRU cache: same text -> reuse audio instead of paying again ---- */
const CACHE = new Map();
const CACHE_MAX = 200;
function cacheKey(voiceId, model, text) {
  return crypto.createHash('sha1').update(voiceId + '\n' + model + '\n' + text).digest('hex');
}
function cacheGet(k) {
  if (!CACHE.has(k)) return null;
  const v = CACHE.get(k); CACHE.delete(k); CACHE.set(k, v);   // refresh recency
  return v;
}
function cachePut(k, buf) {
  CACHE.set(k, buf);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);   // drop oldest
}

/* ---------------------------------------------------------------------------
   IN-FLIGHT BROKER
   One ElevenLabs generation, many listeners. warm() starts a generation and the
   browser's request a moment later attaches to the SAME one: it is replayed the
   chunks that already arrived and then follows the rest live. Without this the
   warm start would double the bill instead of saving time.
   --------------------------------------------------------------------------- */
const INFLIGHT = new Map();

function startStream(key, voiceId, model, text) {
  const entry = { chunks: [], done: false, error: null, subs: [] };
  INFLIGHT.set(key, entry);

  function fail(e) {
    if (entry.done || entry.error) return;
    entry.error = e;
    const subs = entry.subs; entry.subs = [];
    for (const s of subs) { try { s.error(e); } catch (x) {} }
    if (INFLIGHT.get(key) === entry) INFLIGHT.delete(key);
    try { console.error('tts error:', e && e.message); } catch (x) {}
  }
  function finish() {
    if (entry.done || entry.error) return;
    entry.done = true;
    const buf = Buffer.concat(entry.chunks);
    if (buf.length) cachePut(key, buf);
    const subs = entry.subs; entry.subs = [];
    for (const s of subs) { try { s.end(); } catch (x) {} }
    if (INFLIGHT.get(key) === entry) INFLIGHT.delete(key);
  }

  const payload = JSON.stringify({
    text: text,
    model_id: model,
    // multilingual_v2 auto-detects language from the script (Telugu / Devanagari /
    // Latin) — do NOT send language_code here, this model rejects it.
    voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true }
  });
  const lat = latencyFor(model);
  const opts = {
    method: 'POST',
    hostname: 'api.elevenlabs.io',
    path: '/v1/text-to-speech/' + encodeURIComponent(voiceId) +
          '/stream?output_format=' + encodeURIComponent(FORMAT) +
          (lat === null ? '' : '&optimize_streaming_latency=' + encodeURIComponent(lat)),
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const req = https.request(opts, (r) => {
    if (r.statusCode < 200 || r.statusCode >= 300) {
      const errChunks = [];
      r.on('data', (c) => errChunks.push(c));
      r.on('end', () => fail(new Error('eleven ' + r.statusCode + ' ' +
        Buffer.concat(errChunks).toString('utf8').slice(0, 200))));
      r.on('error', fail);
      return;
    }
    r.on('data', (c) => {
      entry.chunks.push(c);
      for (const s of entry.subs) { try { s.data(c); } catch (x) {} }
    });
    r.on('end', finish);
    r.on('error', fail);
  });
  req.on('error', fail);
  // First audio should arrive in well under a second; 20s is only a hard stop.
  req.setTimeout(20000, () => req.destroy(new Error('eleven timeout')));
  req.write(payload);
  req.end();
  return entry;
}

// Attach a listener to a generation: replay what already arrived, then follow.
// Returns a detach function for when the browser hangs up mid-sentence.
function subscribe(entry, sub) {
  for (const c of entry.chunks) { try { sub.data(c); } catch (x) {} }
  if (entry.error) { sub.error(entry.error); return function () {}; }
  if (entry.done) { sub.end(); return function () {}; }
  entry.subs.push(sub);
  return function detach() {
    const i = entry.subs.indexOf(sub);
    if (i !== -1) entry.subs.splice(i, 1);
  };
}

// Get (or start) the generation for this text — cached buffer wins outright.
function generation(text, lang) {
  const l = normLang(lang);
  const voiceId = VOICE[l] || VOICE_DEFAULT;
  const model = modelFor(l);
  const key = cacheKey(voiceId, model, text);
  const cached = cacheGet(key);
  if (cached) return { cached: cached };
  return { entry: INFLIGHT.get(key) || startStream(key, voiceId, model, text) };
}

/* ---- warm(text, lang) — start generating BEFORE the browser asks ----------
   Called by assistant.js the moment the AI reply is ready. Fire and forget: the
   audio lands in the cache / in-flight map, and the browser's request that
   arrives a network round-trip later joins it instead of starting over. */
function warm(text, lang) {
  if (!ENABLED) return;
  let t = typeof text === 'string' ? text.trim() : '';
  if (!t) return;
  if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT);
  try { generation(t, lang); } catch (e) { /* never let a warm-up break a reply */ }
}

/* ---- GET /api/tts/health -> tells the widget whether the natural voice is on -- */
function health(_req, res) { res.json({ enabled: ENABLED, model: ENABLED ? MODEL : null }); }

function sendWhole(res, buf) {
  res.set('Content-Type', 'audio/mpeg');
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(buf);
}

/* ---- POST /api/tts { text, lang }  /  GET /api/tts?text=…&lang=…  -> audio/mpeg
   GET is the fast path: the browser points an <audio> straight at it and starts
   playing while we are still streaming. POST stays for long replies (too big for
   a URL) and as the widget's fallback, and buffers the whole clip as before. */
async function handle(req, res) {
  if (!ENABLED) return res.status(503).json({ error: 'tts_disabled' });
  try {
    const isGet = req.method === 'GET';
    const src = isGet ? (req.query || {}) : (req.body || {});
    let text = typeof src.text === 'string' ? src.text.trim() : '';
    const lang = normLang(src.lang);
    if (!text) return res.status(400).json({ error: 'empty' });
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

    const g = generation(text, lang);
    if (g.cached) return sendWhole(res, g.cached);       // instant replay

    if (!isGet) {                                       // POST: buffer, then send
      const parts = [];
      const detach = subscribe(g.entry, {
        data: (c) => parts.push(c),
        end: () => sendWhole(res, Buffer.concat(parts)),
        error: () => { if (!res.headersSent) res.status(502).json({ error: 'tts_error' }); }
      });
      res.on('close', detach);
      return;
    }

    // GET: stream it out chunk by chunk.
    let wrote = false;
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Accept-Ranges', 'none');       // no seeking — don't invite range requests
    res.set('X-Accel-Buffering', 'no');     // tell any reverse proxy not to buffer us
    const detach = subscribe(g.entry, {
      data: (c) => { wrote = true; res.write(c); },
      end: () => res.end(),
      // If it dies before a single byte we can still say 502; after that all we
      // can do is close the stream and let the widget retry over POST.
      error: () => { if (wrote || res.headersSent) res.end(); else res.status(502).end(); }
    });
    res.on('close', detach);
  } catch (e) {
    try { console.error('tts error:', e && e.message); } catch (x) {}
    if (!res.headersSent) res.status(502).json({ error: 'tts_error' });   // -> browser-voice fallback
  }
}

module.exports = { handle, health, warm, ENABLED, MODEL };
