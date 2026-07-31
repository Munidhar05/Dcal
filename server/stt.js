/* =============================================================================
   D'Cal Voice — ElevenLabs speech-to-text (Scribe) with LANGUAGE DETECTION

   The browser widget (js/voice-assistant.js) records the customer's voice and
   POSTs the raw audio here. This sends it to ElevenLabs Scribe with the SECRET
   api key and returns BOTH what they said and WHICH LANGUAGE they said it in:

       POST /api/stt   (body = audio bytes, Content-Type = audio/webm|mp4|…)
       ->  { text: "నాకు వాటర్ సాఫ్ట్‌నర్ కావాలి", lang: "te", confidence: 0.99 }

   Why this exists: the browser's own Web Speech API cannot detect a language —
   you must tell it in advance which one to expect, which is exactly what we do
   not know. Scribe listens to the audio and tells us. That is what lets a
   customer simply press the mic and talk in Telugu, Hindi, Tamil, English…
   and be answered in that same language.

   - Uses the SAME ELEVENLABS_API_KEY as the voice; no extra account needed.
   - Graceful fallback: if the key is missing or a call fails, this returns 5xx
     and the widget drops back to the browser's own recogniser — so the mic
     never stops working, it just stops auto-detecting the language.
   ============================================================================= */
'use strict';

const https = require('https');
const crypto = require('crypto');

const API_KEY = process.env.ELEVENLABS_API_KEY || '';
// scribe_v1 is ElevenLabs' transcription model; it auto-detects the language.
const MODEL = process.env.ELEVENLABS_STT_MODEL || 'scribe_v1';
const ENABLED = !!API_KEY;

const MAX_BYTES = 6 * 1024 * 1024;      // ~6MB — plenty for a spoken question

/* ---- Scribe returns ISO-639-3 ("tel") or ISO-639-1 ("te"); we speak 639-1 ----
   Only Indian languages (plus English) are mapped: anything else falls back to
   English so a stray detection can never leave the customer stranded. */
const LANG_MAP = {
  eng: 'en', en: 'en',
  hin: 'hi', hi: 'hi',
  tel: 'te', te: 'te',
  tam: 'ta', ta: 'ta',
  kan: 'kn', kn: 'kn',
  mal: 'ml', ml: 'ml',
  mar: 'mr', mr: 'mr',
  ben: 'bn', bn: 'bn',
  guj: 'gu', gu: 'gu',
  pan: 'pa', pa: 'pa',
  ori: 'or', ory: 'or', or: 'or',
  asm: 'as', as: 'as',
  urd: 'ur', ur: 'ur',
  nep: 'ne', ne: 'ne',
  san: 'sa', sa: 'sa'
};
function normalizeLang(code) {
  const c = String(code || '').toLowerCase().split(/[-_]/)[0];
  return LANG_MAP[c] || 'en';
}

/* ---- Build a multipart/form-data body by hand (no extra dependency) ---- */
function buildMultipart(fields, file) {
  const boundary = '----dcal' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  for (const name of Object.keys(fields)) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="' + name + '"\r\n\r\n' +
      fields[name] + '\r\n'
    ));
  }
  parts.push(Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="' + file.name + '"\r\n' +
    'Content-Type: ' + file.type + '\r\n\r\n'
  ));
  parts.push(file.data);
  parts.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
  return { boundary: boundary, body: Buffer.concat(parts) };
}

/* ---- Call ElevenLabs Scribe and return { text, language_code, … } ---- */
function scribe(audio, mime, filename) {
  const form = buildMultipart(
    { model_id: MODEL, tag_audio_events: 'false' },
    { name: filename, type: mime, data: audio }
  );
  const opts = {
    method: 'POST',
    hostname: 'api.elevenlabs.io',
    path: '/v1/speech-to-text',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'multipart/form-data; boundary=' + form.boundary,
      'Content-Length': form.body.length,
      'Accept': 'application/json'
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return reject(new Error('scribe ' + r.statusCode + ' ' + raw.slice(0, 300)));
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('scribe bad json: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('scribe timeout')));
    req.write(form.body);
    req.end();
  });
}

/* ---- GET /api/stt/health -> tells the widget whether auto-detect is available -- */
function health(_req, res) { res.json({ enabled: ENABLED, model: ENABLED ? MODEL : null }); }

/* ---- transcribe(audio, contentType) -> { text, lang, confidence } -----------
   The recogniser on its own, with no HTTP around it, so /api/ask can hand the
   result straight to the AI instead of returning it to the browser first. */
async function transcribe(audio, contentType) {
  if (!Buffer.isBuffer(audio) || !audio.length) throw new Error('empty');
  if (audio.length > MAX_BYTES) throw new Error('too_large');
  // keep the container the browser actually recorded (webm/ogg on Chrome and
  // Firefox, mp4 on Safari) — Scribe reads the format from the file itself.
  const mime = String(contentType || 'audio/webm').split(';')[0].trim();
  const ext = mime.indexOf('mp4') !== -1 ? 'mp4' : mime.indexOf('ogg') !== -1 ? 'ogg' : 'webm';
  const out = await scribe(audio, mime, 'speech.' + ext);
  return {
    text: String((out && out.text) || '').trim(),
    lang: normalizeLang(out && out.language_code),
    confidence: (out && typeof out.language_probability === 'number') ? out.language_probability : null
  };
}

/* ---- POST /api/stt   (raw audio body) -> { text, lang, confidence } ---- */
async function handle(req, res) {
  if (!ENABLED) return res.status(503).json({ error: 'stt_disabled' });
  try {
    const audio = req.body;
    if (!Buffer.isBuffer(audio) || !audio.length) return res.status(400).json({ error: 'empty' });
    if (audio.length > MAX_BYTES) return res.status(413).json({ error: 'too_large' });
    res.json(await transcribe(audio, req.get('Content-Type')));
  } catch (e) {
    try { console.error('stt error:', e && e.message); } catch (x) {}
    // widget falls back to the browser's own recogniser
    res.status(502).json({ error: 'stt_error' });
  }
}

module.exports = { handle, health, transcribe, normalizeLang, ENABLED, MODEL };
