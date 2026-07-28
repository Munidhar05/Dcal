/* =============================================================================
   D'Cal Voice — ElevenLabs text-to-speech proxy (natural Indian female voice)

   The browser widget (js/voice-assistant.js) POSTs the reply TEXT here; this
   calls ElevenLabs with the SECRET api key and returns MP3 audio in a natural
   Telugu / Hindi / English (India) voice. The key NEVER reaches the browser.

   - Customer supplies ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env.
   - Model is eleven_multilingual_v2 — the model that supports Telugu (the fast
     turbo/flash models do NOT). It auto-detects the language from the script,
     so one voice speaks all three languages; per-language voice overrides are
     optional (ELEVENLABS_VOICE_TE / _HI / _EN).
   - Graceful fallback: if the key/voice is missing or a call fails, this returns
     5xx and the widget drops back to the FREE browser voice — never silent.
   - A small bounded cache means repeated lines (greeting, "opening the cart", …)
     are only paid for once per server run.
   ============================================================================= */
'use strict';

const https = require('https');
const crypto = require('crypto');

const API_KEY = process.env.ELEVENLABS_API_KEY || '';
// eleven_multilingual_v2 supports Telugu; turbo/flash do not — do not change
// this unless you switch to eleven_v3 (also supports Telugu, but slower/pricier).
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
// One voice can speak all 3 languages; per-language overrides are optional.
const VOICE_DEFAULT = process.env.ELEVENLABS_VOICE_ID || '';
const VOICE = {
  te: process.env.ELEVENLABS_VOICE_TE || VOICE_DEFAULT,
  hi: process.env.ELEVENLABS_VOICE_HI || VOICE_DEFAULT,
  en: process.env.ELEVENLABS_VOICE_EN || VOICE_DEFAULT
};
const ENABLED = !!(API_KEY && VOICE_DEFAULT);

/* ---- Bounded LRU cache: same text -> reuse audio instead of paying again ---- */
const CACHE = new Map();
const CACHE_MAX = 200;
function cacheKey(voiceId, text) {
  return crypto.createHash('sha1').update(voiceId + '\n' + text).digest('hex');
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

/* ---- Call ElevenLabs and return the MP3 bytes ---- */
function elevenFetch(voiceId, text) {
  const payload = JSON.stringify({
    text: text,
    model_id: MODEL,
    // multilingual_v2 auto-detects language from the script (Telugu / Devanagari /
    // Latin) — do NOT send language_code here, this model rejects it.
    voice_settings: { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true }
  });
  const opts = {
    method: 'POST',
    hostname: 'api.elevenlabs.io',
    path: '/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_128',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(buf);
        else reject(new Error('eleven ' + r.statusCode + ' ' + buf.toString('utf8').slice(0, 200)));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('eleven timeout')));
    req.write(payload);
    req.end();
  });
}

/* ---- GET /api/tts/health -> tells the widget whether the natural voice is on -- */
function health(_req, res) { res.json({ enabled: ENABLED, model: ENABLED ? MODEL : null }); }

/* ---- POST /api/tts  { text, lang } -> audio/mpeg ---- */
async function handle(req, res) {
  if (!ENABLED) return res.status(503).json({ error: 'tts_disabled' });
  try {
    const body = req.body || {};
    let text = typeof body.text === 'string' ? body.text.trim() : '';
    const lang = (body.lang === 'te' || body.lang === 'hi') ? body.lang : 'en';
    if (!text) return res.status(400).json({ error: 'empty' });
    if (text.length > 800) text = text.slice(0, 800);        // guard cost + latency

    const voiceId = VOICE[lang] || VOICE_DEFAULT;
    const key = cacheKey(voiceId, text);
    let audio = cacheGet(key);
    if (!audio) { audio = await elevenFetch(voiceId, text); cachePut(key, audio); }

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(audio);
  } catch (e) {
    try { console.error('tts error:', e && e.message); } catch (x) {}
    res.status(502).json({ error: 'tts_error' });            // widget -> browser-voice fallback
  }
}

module.exports = { handle, health, ENABLED, MODEL };
