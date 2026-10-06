const mongoose = require('mongoose');

/* One conversation with the voice assistant (one browser tab, from the first
   word to the panel being closed). Recorded by js/voice-assistant.js through
   POST /api/voice/log and shown ONLY in the admin dashboard's "Voice
   assistant" tab, where server/voicelog.js finds what went wrong in it.
   `items` is the conversation in order: what the customer said ("you"), what
   she said ("bot", with how long the customer waited), and what happened
   around it ("ev": a coupon checked, a page opened, the brain unreachable…). */
const ItemSchema = new mongoose.Schema({
  t: String,            // 'you' | 'bot' | 'ev'
  at: Number,
  text: String,
  lang: String,
  page: String,
  via: String,          // you: 'voice' | 'typed' | 'recogniser'
  ms: Number,           // bot: customer stopped -> reply ready
  voiceMs: Number,      // bot: customer stopped -> her voice started
  kind: String,         // ev
  detail: String        // ev
}, { _id: false });

const VoiceSessionSchema = new mongoose.Schema({
  sid: { type: String, unique: true, index: true },
  startedAt: { type: Number, index: true },
  lastAt: { type: Number, index: true },
  device: { type: String, default: '' },
  signedIn: { type: Boolean, default: false },
  items: { type: [ItemSchema], default: [] },
  review: { type: Object, default: null }      // the AI review, once run
});

module.exports = mongoose.model('VoiceSession', VoiceSessionSchema);
