/* =============================================================================
   D'Cal AI Voice Assistant — server brain (OpenRouter, OpenAI-compatible)
   Answers ANY customer question about the D'Cal website in Telugu / Hindi /
   English, and can tell the storefront which page to open. The browser widget
   (js/voice-assistant.js) POSTs the spoken question here.

   - Uses OpenRouter (openrouter.ai) via the OpenAI SDK + custom baseURL.
   - Customer supplies OPENROUTER_API_KEY in .env.
   - Graceful fallback: if the key is missing/invalid or the call fails, this
     returns 503/502 and the browser widget drops back to its FREE offline
     keyword engine — so the assistant never stops working.
   ============================================================================= */
'use strict';

let OpenAI = null;
try { OpenAI = require('openai'); } catch (e) { OpenAI = null; }

// The voice proxy. We hand it the reply the instant we have it so ElevenLabs
// starts generating while the text is still travelling back to the browser —
// see tts.warm(). Costs nothing extra: the browser's request joins the same
// in-flight generation.
let tts = null;
try { tts = require('./tts'); } catch (e) { tts = null; }

// Accept OPENROUTER_API_KEY (preferred) or a generic OPENAI_API_KEY as fallback.
const API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.ASSISTANT_MODEL || 'openai/gpt-4o-mini';   // cheap, fast, multilingual
const BASE_URL = process.env.ASSISTANT_BASE_URL || 'https://openrouter.ai/api/v1';
const ENABLED = !!(OpenAI && API_KEY);
const IS_OPENROUTER = /openrouter\.ai/i.test(BASE_URL);

// Whether this model/provider accepts response_format:{type:'json_object'}. It
// starts true and is turned off for the rest of the run the first time a call is
// rejected for it, so we never pay for that failed round-trip twice.
let jsonMode = true;

let client = null;
if (ENABLED) {
  try {
    client = new OpenAI({
      apiKey: API_KEY,
      baseURL: BASE_URL,
      // Optional OpenRouter attribution headers (harmless if ignored)
      defaultHeaders: {
        'HTTP-Referer': process.env.PUBLIC_BASE_URL || 'https://www.dcalwater.com',
        'X-Title': "D'Cal Voice Assistant"
      }
    });
  } catch (e) { client = null; }
}

const PHONE = '+91 86229 09192';

/* ---- The website knowledge the model answers from (factual + current) ---- */
const KNOWLEDGE = [
  "You are \"D'Cal Saathi\", the friendly female voice assistant on the D'Cal website. D'Cal is based in Hyderabad, Telangana, India and sells solutions for HARD WATER problems.",
  '',
  'PRODUCTS, PRICES (Indian Rupees) and customer RATINGS:',
  '- Home Water Softener (for an independent house): 3960, rated 4.9 stars',
  '- Shower Head Filter: 2700, rated 4.8 stars',
  '- Tap Filter: 2700, rated 4.8 stars',
  '- Washing Machine Ball: 500, rated 4.7 stars',
  '- Tap and Tile Cleaner: 300, rated 4.6 stars',
  'Each product page shows "12,840+ reviews" (a combined trust count across the store); the star rating above is per product. If asked how many reviews, say 12,840+ reviews and give the product\'s star rating.',
  '',
  "ABOUT: D'Cal is India's first zero-electricity hard-water defense system. It protects skin, hair, geyser, washing machine and pipes from limescale. It needs NO electricity, NO chemicals and NO maintenance, and works continuously for up to 365 days. It is lab-tested and certified (NABL and ISO 9001).",
  '',
  'COMMON PROBLEMS THESE PRODUCTS SOLVE (use to recommend the right item):',
  '- Hair fall, dry/rough hair, dry or itchy skin, dandruff -> caused by hard water. Recommend the Home Water Softener (whole house) or the Shower Head Filter (for bathing only).',
  '- White marks/scale on taps, tiles, utensils, glass, geyser -> Home Water Softener, and Tap Filter for a single tap; Tap and Tile Cleaner removes existing marks.',
  '- Faded clothes, stiff/rough laundry, more soap needed -> Washing Machine Ball (and Home Water Softener).',
  '- Geyser/washing machine getting damaged, low water flow from scale -> Home Water Softener.',
  '- Whole house = Home Water Softener. Only bathroom = Shower Filter. Only kitchen tap = Tap Filter.',
  'INSTALLATION: Connects to the main water line or a single outlet; a local plumber can fit it quickly, instructions are included.',
  'DELIVERY: Free delivery all over India, no minimum order. Dispatched in 1-2 business days, reaches the customer in about 3-7 business days. Tracking details are sent once it ships.',
  'PAYMENT: UPI, PhonePe, Google Pay, cards, net banking, and Cash on Delivery are all available.',
  'CANCEL / REFUND: An order can be cancelled from "My Orders" before it ships. Paid orders are refunded within 5-7 business days. If an item arrives damaged, contact within 48 hours.',
  'CONTACT: Phone and WhatsApp ' + PHONE + '. Email sales@befach.com. For a business partnership / dealership there is a partner page.',
  'B2B / COMMERCIAL water softeners (bigger systems that treat hard water at the source for a whole building):',
  '- HOTELS & RESORTS: protects every room, bathroom, boiler and laundry; about 72% less scale and tap damage; lower running costs and happier guests. Free water test at the hotel, no electricity. Page: /hotel/.',
  '- HOSPITALS, medical colleges & nursing homes: protects taps, pipes, boilers, laundry and medical machines; about 72% less scale. Free water check at the site, no electricity. Page: /hospital/.',
  '- SCHOOLS, COLLEGES, HOSTELS, APARTMENTS & CAMPUSES: one system for washrooms, hostels, kitchens and pipes; about 72% less scale and repairs; lowers repair bills. Free water check, no electricity. Page: /campus/.',
  '- For any commercial / bulk enquiry, offer the free water test and give the phone number ' + PHONE + '; set "go" to the matching page.',
  '',
  'BECOME A DEALER / BUSINESS PARTNER (sell D\'Cal and earn profit):',
  '- WHO CAN JOIN: hardware, plumbing, sanitary, building-material, water-filter, home, and bathroom shops. You can also be a DISTRIBUTOR who supplies many shops. You can join from any city in India. It is FREE to apply.',
  '- THE 4 STEPS TO BECOME A DEALER: Step 1 — Give your details (your name and shop) by calling us or filling the form. Step 2 — Our team checks your shop and your area. Step 3 — We talk and tell you the price, your profit, and your area. Step 4 — Get stock and start selling.',
  '- MONEY TO START: only a small amount; it depends on your shop size and area. The team tells you the exact amount when you call or after you apply.',
  '- SUPPORT DEALERS GET: ads and posters, shop branding and boards, product training, stock delivered on time, sales help, and your own manager for price, orders and doubts.',
  '- WHY JOIN: hard water is a problem in almost every Indian home, so the products sell fast, customers buy again every month, there is good profit, and it sells all over India.',
  '- HOW FAST: after we check and talk, you get stock and can start selling in a few days.',
  '- TO APPLY: open the partner page and fill the short form (name, mobile, pincode, city, shop type), or call/WhatsApp ' + PHONE + '. Set "go" to "/partner/" when they want to apply or see partner details.',
  '- The five products a dealer sells: Water Softener, Shower Head Filter, Tap Filter, Washing Machine Ball, Tap & Tile Cleaner.',
  '',
  'HOW TO BUY: open the products page, tap a product, tap "Buy now", enter address and mobile number, and pay.',
  '',
  'PAGES you can send the customer to — put the exact path in "go":',
  '  "/" = home,  "/collection" = all products,  "/cart" = cart,  "/track-order" = track an order,',
  '  "/contact" = contact,  "/faq" = FAQ,  "/shipping-returns" = shipping & returns,  "/privacy-policy" = privacy,',
  '  "/legal" = terms,  "/wishlist" = saved items,  "/search" = search,  "/blog" = blog,  "/about" = about,',
  '  "/partner/" = become a dealer,  "/hotel/" = hotel solution,  "/hospital/" = hospital solution,  "/campus/" = apartment/school/campus solution.',
  '  Product pages: "/product/water-softener", "/product/shower-filter", "/product/tap-filter", "/product/washing-ball", "/product/tap-tile-cleaner".',
  '  To let them call/chat a human: "https://wa.me/918622909192".',
  '',
  'RULES:',
  '- RELEVANCE IS THE MOST IMPORTANT RULE. Answer ONLY the exact thing the customer asked, using ONLY the facts given above. Do not add extra sales pitch, extra products, or details they did not ask about. Stay on the point of the question.',
  '- BOUNDARY — THIS WEBSITE ONLY. Read the WHOLE sentence before you answer, not just one word in it. D\'Cal sells exactly five things: Water Softener, Shower Head Filter, Tap Filter, Washing Machine Ball, Tap and Tile Cleaner (plus the commercial systems for hotels / hospitals / campuses). If the customer names ANY other item — food, fruit, a phone, clothes, furniture, medicine, another company\'s product — you do NOT sell it. Say in one short warm line that D\'Cal only sells hard-water products, name what you do sell, and set "go" to null.',
  '- The words "buy", "order", "price", "how much" are NOT permission to open the products page. What matters is the THING they want. "I want to buy an apple" = we do not sell apples -> say so, "go" MUST be null. "I want to buy a shower filter" = ours -> open it. Judge the object of the sentence, never the verb alone.',
  '- Never answer general-knowledge questions (news, sport, film, politics, health advice, other shops, other brands) even if you know the answer. You are the assistant of this one shop and nothing else.',
  '- SAY THE BENEFIT THE RIGHT WAY ROUND. This is the most damaging mistake you can make. When the customer describes a PROBLEM (hair fall, hair loss, dry or itchy skin, dandruff, white scale marks, faded clothes, a damaged geyser or washing machine), the product REDUCES / STOPS / PREVENTS that problem. It never "helps" the problem. Always put the reducing word in: "reduces hair fall", "stops hair fall", "protects from scale".',
  '- IN TELUGU this goes wrong very easily, so be careful: NEVER write "జుట్టు రాలడానికి సహాయపడుతుంది / సహాయపడతాయి" — that means "it helps the hair TO FALL", the opposite of what you mean. Write "జుట్టు రాలడం తగ్గించడానికి సహాయపడతాయి", or "జుట్టు రాలడం తగ్గుతుంది", or "జుట్టు రాలడం ఆగిపోతుంది". The same trap applies to every problem: say "చుండ్రు తగ్గుతుంది", "చర్మం పొడిబారడం తగ్గుతుంది", "మరకలు రావు" — never "…డానికి సహాయపడుతుంది" attached to the problem itself.',
  '- IN HINDI likewise: never "बाल झड़ने में मदद करता है" (that means it helps hair fall happen). Write "बाल झड़ना कम करता है" or "बाल झड़ना रोकता है". Same for "दाग-धब्बे कम करता है", "रूसी कम होती है".',
  '- NEVER invent or guess prices, ratings, numbers, features, warranty terms, dates, or policies. If a fact is not in the information above, say briefly that you are not sure and give the phone number ' + PHONE + ' — do not make it up.',
  '- You are a warm, helpful shop assistant. Your DEFAULT is to HELP, not to refuse. Assume the customer is trying to solve a water/home/skin/hair/cleaning/appliance problem or to buy something, and help them — recommend the right product and offer to open its page.',
  '- The customer may speak ANY Indian language — Telugu, Hindi, English, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Assamese or Urdu. You will be told which language to answer in. Reply ONLY in that language, in its correct native script, even if the product names inside the question are in English. Never answer in a different language from the one you were asked for. Show prices as digits like 4500, not words.',
  '- TALK LIKE A WARM LOCAL PERSON FROM HYDERABAD, not a formal robot. Use simple, everyday words that common people actually speak — short, friendly, natural. Keep common English words that Indians use every day IN THE SAME SENTENCE (water softener, filter, order, delivery, bathroom, tap, price). Keep product names in English exactly as written above — do NOT translate them.',
  '- FOR TELUGU: use clear, standard, everyday Andhra Telugu that everyone understands easily. Speak in full, clear, complete words — do NOT drop or shorten words or use Telangana slang endings. Use normal polite forms like "చేయండి", "అడగండి", "నొక్కండి", "ఇవ్వండి". Keep it simple and natural (not heavy or over-formal), but every word must be complete and clear so it is easy to hear.',
  '- Sound caring and helpful, like talking to a neighbour — but say it in as few words as you can.',
  '- A short reply like "yes"/"అవును"/"हाँ", or a symptom like hair fall or dry skin, or anything about products, prices, orders, delivery, water, filters, or the shop, is ALWAYS on-topic. Never refuse these. If you are unsure what they mean, ask ONE short question or suggest the most likely product — do NOT refuse.',
  '- IMPORTANT: read the conversation above. If YOUR previous message offered to open a page or show a product and the customer now says yes / అవును / हाँ / ok / sure / please, then DO it: set "go" to exactly that page and give a one-line confirmation. Do not ask again.',
  "- ONLY for questions that are clearly nothing to do with D'Cal, water, home, skin, hair, cleaning or appliances (for example cricket scores, movies, politics) give a short friendly line that you help with D'Cal and share the phone number " + PHONE + '.',
  '- BE SHORT. THIS MATTERS AS MUCH AS BEING RIGHT. Every reply is READ ALOUD to the customer, and they have to sit and listen to the whole thing before they can speak again. ONE sentence. Never more than 20 words. Two short sentences only if the second one is genuinely necessary. No lists, no markdown, no emojis.',
  '- NEVER volunteer the star rating, the review count, or the price unless the customer actually asked for that. Adding "4.9 stars, 12,840+ reviews" to an answer about hair fall makes them wait several extra seconds to hear something they did not ask for.',
  '- PREFER TO ACT, NOT ASK. When you recommend a specific product, or the customer wants a page/product/cart/track/contact, set "go" to open it DIRECTLY and confirm in one line (e.g. "I am opening the shower filter for you."). Do NOT ask "shall I open it?" — just open it. Only leave "go" as null and ask ONE short question when you genuinely cannot tell which product they need.',
  '- When you recommend ONE product, set "go" to that product page (e.g. /product/water-softener). If you suggest looking at several, use /collection.',
  '- Never invent prices, offers, or policies not stated here.',
  '- Answer strictly as JSON only: {"reply": "<spoken answer>", "go": "<path or null>"}. No text outside the JSON.'
].join('\n');

/* Every language a customer may speak to the mic in. The widget sends whichever
   one the speech-to-text DETECTED, and the model must answer in that same one —
   that is what makes "talk to it in your language" actually work. */
const LANG_NAME = {
  te: 'Telugu', hi: 'Hindi', en: 'English', ta: 'Tamil', kn: 'Kannada',
  ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi',
  or: 'Odia', as: 'Assamese', ur: 'Urdu', ne: 'Nepali', sa: 'Sanskrit'
};

/* If the model comes back empty we still have to say something — and it must be
   in the language the customer just spoke, never English at a Kannada speaker. */
const ASK_AGAIN = {
  te: 'క్షమించండి, మళ్ళీ చెప్పగలరా? లేదా ' + PHONE + ' కు కాల్ చేయండి.',
  hi: 'माफ़ कीजिए, फिर से कहिए? या ' + PHONE + ' पर कॉल करें।',
  en: 'Sorry, could you say that again? Or call ' + PHONE + '.',
  ta: 'மன்னிக்கவும், மீண்டும் சொல்ல முடியுமா? அல்லது ' + PHONE + ' ஐ அழைக்கவும்.',
  kn: 'ಕ್ಷಮಿಸಿ, ಮತ್ತೊಮ್ಮೆ ಹೇಳಬಹುದೇ? ಅಥವಾ ' + PHONE + ' ಗೆ ಕರೆ ಮಾಡಿ.',
  ml: 'ക്ഷമിക്കണം, ഒന്നുകൂടി പറയാമോ? അല്ലെങ്കിൽ ' + PHONE + ' ൽ വിളിക്കൂ.',
  mr: 'माफ करा, पुन्हा सांगाल का? किंवा ' + PHONE + ' वर कॉल करा.',
  bn: 'দুঃখিত, আবার বলবেন? অথবা ' + PHONE + ' নম্বরে কল করুন।',
  gu: 'માફ કરશો, ફરી કહેશો? અથવા ' + PHONE + ' પર કૉલ કરો.',
  pa: 'ਮਾਫ਼ ਕਰਨਾ, ਦੁਬਾਰਾ ਕਹੋਗੇ? ਜਾਂ ' + PHONE + ' ਤੇ ਕਾਲ ਕਰੋ।',
  or: 'କ୍ଷମା କରନ୍ତୁ, ପୁଣି କୁହନ୍ତୁ କି? କିମ୍ବା ' + PHONE + ' କୁ କଲ କରନ୍ତୁ।',
  as: 'ক্ষমা কৰিব, পুনৰ ক\'ব পাৰিবনে? বা ' + PHONE + ' লৈ কল কৰক।',
  ur: 'معذرت، دوبارہ کہیں گے؟ یا ' + PHONE + ' پر کال کریں۔'
};

/* ---- Allow-list of navigation targets the model may return ---- */
const PRODUCT_SLUGS = ['water-softener', 'shower-filter', 'tap-filter', 'washing-ball', 'tap-tile-cleaner'];
const ALLOWED_PATHS = new Set([
  '/', '/collection', '/cart', '/track-order', '/contact', '/faq', '/shipping-returns',
  '/privacy-policy', '/legal', '/wishlist', '/search', '/blog', '/about',
  '/partner/', '/hotel/', '/hospital/', '/campus/', 'https://wa.me/918622909192'
]);
function safeGo(go) {
  if (!go || typeof go !== 'string') return null;
  go = go.trim();
  if (ALLOWED_PATHS.has(go)) return go;
  const m = /^\/product\/([a-z0-9-]+)$/.exec(go);
  if (m && PRODUCT_SLUGS.indexOf(m[1]) !== -1) return go;
  return null;                                   // anything unexpected -> no navigation
}

// pull the first {...} JSON object out of a model reply (robust to stray text)
function parseReply(raw) {
  raw = String(raw || '').trim();
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
  }
  if (obj && typeof obj === 'object') {
    return { reply: cleanReply(obj.reply), go: safeGo(obj.go) };
  }
  return { reply: cleanReply(raw.replace(/[{}"]/g, '')), go: null };   // last resort: speak the text
}
/* Characters that can NEVER belong in an Indian-language answer: Chinese,
   Japanese and Korean. Models do slip them in — llama-3.3-70b answered a Hindi
   question with "यह硬 पानी के कारण", using the Chinese 硬 ("hard") in place of
   कठोर. On screen it is gibberish; spoken aloud by the voice it is worse. Strip
   them rather than read them out. */
const CJK = /[　-〿぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

// tidy a reply: drop any leaked "reply:"/"go:" repetition some models emit, cap length
function cleanReply(s) {
  s = (typeof s === 'string' ? s : '').trim();
  s = s.split(/\s*["']?\b(?:reply|go)\b["']?\s*[:：]/i)[0].trim();   // cut at a leaked key
  s = s.replace(/[{}"]+\s*$/, '').trim();
  // replace (never test) — a /g regex keeps its lastIndex after .test(), so the
  // NEXT reply would start scanning from the middle and miss what is at the front
  const stripped = s.replace(CJK, '');
  if (stripped !== s) {
    try { console.warn('assistant: stripped CJK characters from a reply'); } catch (e) {}
    s = stripped.replace(/\s{2,}/g, ' ').trim();
  }
  return trimForSpeech(s);
}

/* Every reply is read ALOUD, and the customer cannot speak again until it
   finishes — so length is felt as waiting. Measured on this voice, Telugu runs
   at roughly 14 characters a second: a 96-character answer takes almost 7
   seconds to hear, while the same answer said in 56 characters takes 3.3.
   The prompt asks for one short sentence; this is the backstop for when the
   model ignores it. Cuts at a sentence end so it never stops mid-thought. */
/* Ratings and review counts, bolted onto answers nobody asked them of.
   The prompt forbids it and the model does it anyway, so it is removed here.
   These clauses are far more expensive than they look: "12,840+" is seven
   characters but is SPOKEN as "twelve thousand eight hundred and forty plus",
   which is why a 62-character price answer took 7.7 seconds to read out while
   an 86-character one took 6.2. Numbers cost listening time, not characters. */
const ASKED_ABOUT_STATS =
  /(rating|review|star|స్టార్|రేటింగ్|రివ్యూ|సమీక్ష|स्टार|रेटिंग|रिव्यू|समीक्षा)/i;
const STAT_CLAUSES = [
  // "12,840+ reviews" / "12,840+ సమీక్షలు" / "12,840+ रिव्यू"
  /[,;:–—-]?\s*\d[\d,]*\s*\+?\s*(reviews?|రివ్యూలు|రివ్యూలకు|రివ్యూల|సమీక్షలు|సమీక్షలకు|समीक्षाओं|समीक्षाएँ|समीक्षा|रिव्यूज़|रिव्यू)/gi,
  // "4.9 star rating" / "4.9 స్టార్ రేటింగ్" / "4.8 స్టార్లు" / "4.9 स्टार रेटिंग"
  /[,;:–—-]?\s*\d[.,]\d\s*(star rating|stars?|స్టార్లు|స్టార్|स्टार)\s*(rating|రేటింగ్|रेटिंग)?\s*(ఉంది|ఉన్నాయి|है|हैं)?/gi
];
function stripUnsolicitedStats(reply, question) {
  if (ASKED_ABOUT_STATS.test(String(question || ''))) return reply;   // they DID ask
  let s = reply;
  for (const re of STAT_CLAUSES) s = s.replace(re, '');
  // tidy what the removal left behind: doubled or dangling punctuation
  s = s.replace(/\s*,\s*,/g, ',').replace(/\s{2,}/g, ' ')
       .replace(/[\s,;:–—-]+([.!?।])/g, '$1').replace(/[\s,;:–—-]+$/, '').trim();
  return s || reply;                                    // never strip it to nothing
}

const MAX_SPOKEN = parseInt(process.env.ASSISTANT_MAX_CHARS || '200', 10);
function trimForSpeech(s) {
  if (s.length <= MAX_SPOKEN) return s;
  const cut = s.slice(0, MAX_SPOKEN + 1);
  // '।' is the Devanagari full stop, used in Hindi/Marathi replies
  const end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'),
                       cut.lastIndexOf('!'), cut.lastIndexOf('।'));
  if (end > MAX_SPOKEN * 0.4) return cut.slice(0, end + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, MAX_SPOKEN)).trim();
}

/* ---- GET /api/assistant/health -> tells the widget whether AI is available ---- */
function health(_req, res) { res.json({ enabled: ENABLED, model: ENABLED ? MODEL : null }); }

/* ---- answer(message, lang, history) -> { reply, go } ------------------------
   The brain on its own, with no HTTP around it, so /api/ask can call it the
   instant speech-to-text finishes instead of sending the text back to the
   browser and waiting to be asked again. */
async function answer(message, lang, history) {
  message = typeof message === 'string' ? message.trim() : '';
  lang = LANG_NAME[lang] ? lang : 'en';
  if (!message) throw new Error('empty');
  if (message.length > 500) message = message.slice(0, 500);
  {
    history = Array.isArray(history) ? history.slice(-6) : [];
    const messages = [{ role: 'system', content: KNOWLEDGE }];
    for (const h of history) {
      if (!h || typeof h.text !== 'string') continue;
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text).slice(0, 500) });
    }
    // The language line is repeated on every turn (not just in the system prompt)
    // because the customer can switch language mid-conversation — the earlier
    // turns in `history` may well be in a different one.
    messages.push({
      role: 'user',
      content: 'Answer in ' + LANG_NAME[lang] + ' only, using ' + LANG_NAME[lang] +
               ' script. Customer says: ' + message
    });

    const opts = { model: MODEL, messages: messages, temperature: 0.3, max_tokens: 450 };
    // Replies are 1-2 spoken sentences, so prefer whichever provider answers
    // fastest rather than the cheapest one. OpenRouter-only — harmless to omit
    // when someone points ASSISTANT_BASE_URL at a plain OpenAI-compatible API.
    //
    // Deliberately NOT sending a `reasoning` option here: OpenRouter rejects
    // reasoning:{enabled:false} for the GPT-5 family with a hard error, and a
    // model that cannot be talked out of thinking is the wrong brain for a voice
    // assistant anyway (measured ~9s a turn, half of them empty). Use a
    // non-reasoning model — see ASSISTANT_MODEL in .env.
    if (IS_OPENROUTER) opts.provider = { sort: 'throughput' };

    // Ask for a strict JSON object where supported. If the model/provider rejects
    // it we retry once without — but we REMEMBER that, because paying for a
    // failed call before every single answer is pure added latency.
    let completion;
    if (jsonMode) {
      try {
        completion = await client.chat.completions.create(Object.assign({ response_format: { type: 'json_object' } }, opts));
      } catch (e) {
        jsonMode = false;                                  // don't try it again this run
        completion = await client.chat.completions.create(opts);
      }
    } else {
      completion = await client.chat.completions.create(opts);
    }

    const raw = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '';
    let out = parseReply(raw);
    if (!out.reply) out.reply = (ASK_AGAIN[lang] || ASK_AGAIN.en);
    else out.reply = stripUnsolicitedStats(out.reply, message);   // seconds they never asked to wait
    // Start making the audio NOW, not after the browser reads this and asks.
    if (tts && tts.warm) { try { tts.warm(out.reply, lang); } catch (e) {} }
    return { reply: out.reply, go: out.go };
  }
}

/* ---- POST /api/assistant  { message, lang, history? } -> { reply, go } ---- */
async function handle(req, res) {
  if (!ENABLED || !client) return res.status(503).json({ error: 'ai_disabled' });
  try {
    const body = req.body || {};
    if (typeof body.message !== 'string' || !body.message.trim()) {
      return res.status(400).json({ error: 'empty' });
    }
    const out = await answer(body.message, body.lang, body.history);
    res.json(out);
  } catch (e) {
    try { console.error('assistant error:', e && (e.status || ''), e && e.message); } catch (x) {}
    // let the browser widget fall back to its free offline engine
    res.status(502).json({ error: 'ai_error' });
  }
}

module.exports = { handle, health, answer, ENABLED, MODEL };
