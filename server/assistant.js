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
  '- Home Water Softener (for an independent house): 3960, rated 4.9 stars. A drop-in tank softener: stops scaling, hair fall and skin irritation; one cartridge lasts 12 months.',
  '- Shower Head Filter: 2700, rated 4.8 stars. Easy to install, 14-stage filtration: reduces hair fall and dry skin; the cartridge is replaced every 6 months.',
  '- Tap Filter: 2700, rated 4.8 stars. No fitting needed — it simply hangs on the tap: reduces hair fall and skin irritation from hard water.',
  '- Washing Machine Ball: 500, rated 4.7 stars. Just drop it in the washing machine: cuts detergent use and keeps clothes looking new.',
  '- Tap and Tile Cleaner: 300, rated 4.6 stars. A gentle water-based liquid that brings back the shine of taps and tiles: spray it, scrub it, wash it off.',
  'When you explain a product, say what its line above says — nothing it does not say (no bacteria, no purifying, no health claims).',
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
  '- A LANGUAGE is never an item. "Explain in Telugu", "Tamil mein batao", "in Hindi please": Telugu, Tamil, Hindi, English and the rest are the language they want you to talk in — you have already been told to answer in it. Give the ANSWER itself, in that language, right now — never a promise such as "I will explain it in Telugu" (that tells them nothing). If all they ask is to hear it in another language with no new question ("say that in Telugu", "ఆ తెలుగులో చెప్పవా?", "Hindi mein bolo"), say your previous answer again, in that language. Never say you do not sell a language.',
  '- THIS PRODUCT. "this product", "this one", "it", "this" mean the product they are LOOKING AT, given in the situation line after the message. Answer about that product. Only if no product is given and you cannot tell which one they mean, ask which one in one short line.',
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
  '- MEMORY — USE IT WITH JUDGEMENT. The earlier turns above are context, not a script. USE them when the new message leans on them: a short answer ("yes", "no", "that one", "the second one", "how much", "and for the kitchen?"), a pronoun ("it", "that", "the same"), a question about the product or problem you were just discussing, or anything the customer already told you about themselves (their problem, their home, hotel, shop or city, what they already own). Then answer in that light, and never ask again for something they already said.',
  '- IGNORE the earlier turns when the customer clearly starts a new topic. Answer the new question on its own. Do not drag the previous product, offer or page back in unless they ask for it.',
  '- If the customer corrects you, changes their mind, or says something that contradicts an earlier turn, the LATEST message wins over everything before it.',
  '- Never repeat an earlier reply word for word. If the same question comes again, answer shorter, or add the one detail that was missing the first time.',
  '- INTERRUPTIONS. A reply marked [INTERRUPTED: …] was cut short because the customer spoke over it; they heard only the part quoted. What they said next matters most: (a) a new question, a correction or a "no" -> answer THAT and drop your unfinished point; (b) only a short acknowledgement (hmm, ok, haan, achha, sare, yes) -> finish your point in ONE short line, without starting it over; (c) stop, wait, bas, chup, enough, "one minute" -> reply with a single word of acknowledgement and nothing else, "go" null; (d) "repeat", "again", "what?" -> say the part they did not hear, shorter.',
  "- ONLY for questions that are clearly nothing to do with D'Cal, water, home, skin, hair, cleaning or appliances (for example cricket scores, movies, politics) give a short friendly line that you help with D'Cal and share the phone number " + PHONE + '.',
  '- BE SHORT. THIS MATTERS AS MUCH AS BEING RIGHT. Every reply is READ ALOUD to the customer, and they have to sit and listen to the whole thing before they can speak again. ONE sentence. Never more than 20 words. Two short sentences only if the second one is genuinely necessary. No lists, no markdown, no emojis.',
  '- NEVER volunteer the star rating, the review count, or the price unless the customer actually asked for that. Adding "4.9 stars, 12,840+ reviews" to an answer about hair fall makes them wait several extra seconds to hear something they did not ask for.',
  '- PREFER TO ACT, NOT ASK. When you recommend a specific product, or the customer wants a page/product/cart/track/contact, set "go" to open it DIRECTLY and confirm in one line (e.g. "I am opening the shower filter for you."). Do NOT ask "shall I open it?" — just open it. Only leave "go" as null and ask ONE short question when you genuinely cannot tell which product they need.',
  '- When you recommend ONE product, set "go" to that product page (e.g. /product/water-softener). If you suggest looking at several, use /collection.',
  '- Never invent prices, offers, or policies not stated here.',
  '',
  'ACTIONS — things you can DO on the site for the customer, given as "act" in the JSON. Use one when they ask you to do the thing, not merely talk about it:',
  '  {"do":"add","product":"<slug>","qty":N} = put a product in the cart (qty 1 unless they say a number). "this" / "it" on a product page means that page\'s product — see the STATE line.',
  '  {"do":"remove","product":"<slug>"}  {"do":"qty","product":"<slug>","qty":N}  {"do":"clear"} = change the cart.',
  '  {"do":"coupon","code":"<CODE>"} = apply a coupon code they say (letters spelt out one by one are one word: "V I N A Y 200" = VINAY200). The website checks the code and tells them whether it worked — your reply must NOT say it is applied.  {"do":"checkout"} = start buying what is in the cart.',
  '  {"do":"wish","product":"<slug>"} / {"do":"unwish","product":"<slug>"} = save to / remove from the wishlist.',
  '  {"do":"search","q":"<words>"} = show search results.  {"do":"track","order":"<order id>"} = track an order by the id they say.',
  '  {"do":"scroll","dir":"up"|"down"} = scroll the page.  {"do":"back"} = go to the previous page.  {"do":"login"} = open the sign-in box.',
  '  Slugs: water-softener, shower-filter, tap-filter, washing-ball, tap-tile-cleaner.',
  '  A STATE line arrives with every message: the page they are on, what is in the cart, and whether they are signed in. Use it for "what is in my cart", "what is my total", "add this", "remove that one". Give a total as ONE number ("3700 rupees"), never as a sum.',
  '  In every language the verb decides the act: "remove / hata do / తీసేయి the washing ball" -> {"do":"remove","product":"washing-ball"}; "make it three / teen kar do / మూడు చేయి" -> {"do":"qty",...,"qty":3}; "empty my cart / cart khali karo" -> {"do":"clear"}; "add / daal do / add cheyyi" -> {"do":"add",...}. Do not just describe the cart when they asked you to change it.',
  '  The cart needs a sign-in. If they are NOT signed in and want to add, buy or check out: say in one line that they need to sign in with their mobile number first, and set act {"do":"login"} so the box opens for them.',
  '  After adding to the cart, confirm in one short line and STAY on the page ("go" null) unless they asked to see the cart or to buy now. Say prices only if asked.',
  '  Include "act" ONLY when there is something to do; otherwise leave it out entirely.',
  '  You can DO only what an "act" above does. Never say you are filling in, typing, entering, saving or submitting anything (their name, address, details, a form, a payment) — you cannot, and saying so while nothing happens on their screen is lying to them. If they tell you their address or details outside the checkout, say they can tell you them on the checkout\'s address form.',
  '- Answer strictly as JSON only: {"reply": "<spoken answer>", "go": "<path or null>", "act": {…} only when acting}. No text outside the JSON.'
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
const PRODUCT_NAME = {
  'water-softener': 'Home Water Softener', 'shower-filter': 'Shower Head Filter', 'tap-filter': 'Tap Filter',
  'washing-ball': 'Washing Machine Ball', 'tap-tile-cleaner': 'Tap and Tile Cleaner'
};
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

/* ---- Actions: what the model may DO on the site, validated field by field ----
   The widget executes these in the browser (js/voice-assistant.js runAction),
   so nothing the model invents can reach it: unknown verbs, unknown products,
   silly quantities and odd characters are all dropped here. */
const ACT_DO = { add: 1, remove: 1, qty: 1, clear: 1, coupon: 1, checkout: 1, wish: 1, unwish: 1, search: 1, track: 1, scroll: 1, back: 1, login: 1 };
function safeAct(a) {
  if (!a || typeof a !== 'object') return null;
  const d = String(a.do || a.type || a.action || '').toLowerCase().trim();
  if (!ACT_DO[d]) return null;
  const out = { do: d };
  if (d === 'add' || d === 'remove' || d === 'qty' || d === 'wish' || d === 'unwish') {
    const p = String(a.product || a.slug || '').toLowerCase().trim();
    if (PRODUCT_SLUGS.indexOf(p) === -1) return null;
    out.product = p;
  }
  if (d === 'add' || d === 'qty') { let q = parseInt(a.qty, 10); if (!(q >= 1)) q = 1; out.qty = Math.min(99, q); }
  if (d === 'coupon') { const c = String(a.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20); if (!c) return null; out.code = c; }
  if (d === 'search') { const q = String(a.q || a.query || '').trim().slice(0, 80); if (!q) return null; out.q = q; }
  if (d === 'track') { const o = String(a.order || a.id || '').trim().replace(/[^A-Za-z0-9#_-]/g, '').slice(0, 40); if (!o) return null; out.order = o; }
  if (d === 'scroll') out.dir = /up|top/i.test(String(a.dir || '')) ? 'up' : 'down';
  return out;
}

/* ---- The customer's situation, in one short line the model can read ----
   Sent by the widget with every message: which page they are on, what is in
   the cart, whether they are signed in. About 25 tokens — this is what lets
   "add this", "what is in my cart" and "how much is my total" be answered
   without a single extra round trip. */
function describeState(state) {
  if (!state || typeof state !== 'object') return '';
  const page = String(state.page || '').replace(/[^\w\/?=&.#-]/g, '').slice(0, 80) || '/';
  let cart = 'empty';
  if (Array.isArray(state.cart) && state.cart.length) {
    cart = state.cart.slice(0, 10).map((i) => {
      const p = String((i && (i.p || i.product || i.slug)) || '').toLowerCase();
      if (PRODUCT_SLUGS.indexOf(p) === -1) return null;
      const q = Math.max(1, Math.min(99, parseInt(i.q || i.qty, 10) || 1));
      return p + ' x' + q;
    }).filter(Boolean).join(', ') || 'empty';
  }
  // the product on their screen: the page's own, or the one she has lit up
  // for them — what "this product" means
  const pm = /^\/product\/([a-z0-9-]+)/.exec(page);
  const show = PRODUCT_NAME[String(state.show || '')] || (pm && PRODUCT_NAME[pm[1]]) || '';
  return '\n(Their situation, for your information only — not their question: page ' + page +
         (show ? '; looking at: the ' + show : '') +
         '; cart: ' + cart + '; signed in: ' + (state.login ? 'yes' : 'no') + '.)';
}

/* "ఆ తెలుగులో చెప్పవా?", "say that in Hindi", "தமிழில் சொல்லுங்கள்" — nothing
   asked but the language. The model, told only "answer in Telugu", replied
   with a promise ("I will tell you about it in Telugu") and nothing else. So
   such a turn is put to it as what it is: say your last answer again, in
   Telugu. Same single call; no extra time. */
const LANG_ONLY_FILLER = new Set(('can could will would you please pls kindly say tell explain speak talk repeat again it that this ' +
  'same in me now the language answer reply ok okay sure do one more time ' +
  'में मे बोलो बोलिए बोलिये बताओ बताइए बताइये बोल दो दीजिए कहो कहिए फिर से यह वह ये वो इसे उसे मुझे भाषा ज़रा जरा कृपया ना ' +
  'లో ఆ అది ఇది దాన్ని చెప్పు చెప్పండి చెప్పవా చెప్తావా చెప్పగలవా మళ్ళీ నాకు భాషలో కొంచెం దయచేసి ' +
  'ில் இல் ல அதை இதை சொல்லுங்கள் சொல்லு சொல்லவும் மீண்டும் எனக்கு தயவுசெய்து').split(' '));
function onlyLanguageAsked(message) {
  let s = String(message || '').toLowerCase();
  for (const [, re] of LANG_ASKED) { re.lastIndex = 0; s = s.replace(re, ' '); }
  const rest = s.split(/[^\p{L}\p{M}\p{N}]+/u).filter((t) => t && !LANG_ONLY_FILLER.has(t));
  return rest.length === 0;
}
/* "ఈ ఉత్పత్తి గురించి తెలుగులో వివరిస్తాను, …" — an opening clause that only
   announces the language is time the customer spends waiting for the answer.
   Leading clauses naming the asked language go, if real content follows. */
function dropLanguagePromise(reply, asked) {
  const entry = LANG_ASKED.find(([code]) => code === asked);
  if (!entry || !reply) return reply;
  const parts = reply.split(/([,،:;।.!?]+\s*)/);
  let i = 0;
  while (i < parts.length - 2) {
    entry[1].lastIndex = 0;
    if (!entry[1].test(parts[i])) break;
    i += 2;                                      // the clause and the comma after it
  }
  const rest = parts.slice(i).join('').trim();
  return (i > 0 && rest.length >= 15) ? rest : reply;
}

/* The SCRIPT of what they said, as a check on the detected language: Telugu
   letters are Telugu, whatever the detector guessed for a short or mixed
   sentence. A script two languages share (Devanagari, Bengali) keeps the
   detector's choice when it is one of them. Latin text keeps it too. */
const SCRIPT_LANGS = [
  [/[ఀ-౿]/, ['te']], [/[஀-௿]/, ['ta']], [/[ಀ-೿]/, ['kn']],
  [/[ഀ-ൿ]/, ['ml']], [/[ऀ-ॿ]/, ['hi', 'mr', 'ne', 'sa']], [/[ঀ-৿]/, ['bn', 'as']],
  [/[઀-૿]/, ['gu']], [/[਀-੿]/, ['pa']], [/[଀-୿]/, ['or']], [/[؀-ۿ]/, ['ur']]
];
function langOfScript(text, detected) {
  const s = String(text || '');
  for (const [re, owners] of SCRIPT_LANGS) if (re.test(s)) return owners.indexOf(detected) !== -1 ? detected : owners[0];
  return detected;
}

/* "Explain it in Telugu", "Tamil mein batao", "తెలుగులో చెప్పండి": the customer
   asked for a language BY NAME. That is the language of the answer, whatever
   language the question itself was spoken in — speech-to-text heard English,
   but they want Telugu. The language named last wins, unless it was negated
   ("in Telugu, not Hindi"). -> a language code, or null */
const LANG_ASKED = [
  ['te', /\btelugu|తెలుగు|तेलुगु|தெலுங்கு/gi],
  ['ta', /\btamil(?!\s*nadu)|தமிழ(?!்நாடு)|तमिल(?!\s*नाडु)|తమిళ/gi],
  ['hi', /\bhindi|हिंदी|हिन्दी|హిందీ|ஹிந்தி/gi],
  ['kn', /\bkannada|ಕನ್ನಡ|कन्नड़|కన్నడ/gi],
  ['ml', /\bmalayalam|മലയാള|मलयालम|మలయాళ/gi],
  ['mr', /\bmarathi|मराठी|మరాఠీ/gi],
  ['bn', /\b(bengali|bangla)|বাংলা|बंगाली/gi],
  ['gu', /\bgujarati|ગુજરાતી|गुजराती/gi],
  ['pa', /\bpunjabi|ਪੰਜਾਬੀ|पंजाबी/gi],
  ['or', /\b(odia|oriya)|ଓଡ଼ିଆ|ओड़िया/gi],
  ['as', /\bassamese|অসমীয়া|असमिया/gi],
  ['ur', /\burdu|اردو|उर्दू/gi],
  ['en', /\benglish|इंग्लिश|अंग्रेज़ी|अंग्रेजी|ఇంగ్లీష్|ఇంగ్లిష్|ஆங்கில/gi]
];
const NOT_BEFORE = /(\bnot|\bno|\bdon'?t|नहीं|मत|కాదు|వద్దు)\s*$/i;
const NOT_AFTER = /^\s*(नहीं|मत|కాదు|వద్దు)/;
// "in Telugu", "speak Tamil", "Hindi mein", "తెలుగులో", "தமிழில்": the name
// is the language of the ANSWER — over a name merely mentioned ("I don't
// understand Hindi").
const ASK_BEFORE = /\b(in|into|speak|talk|use|say|explain|tell)\s*$/i;
const ASK_AFTER = /^\s*(mein|me|mai|lo|il|la|में|मे|लो|లో|ில்|இல்|ல|ದಲ್ಲಿ|ത്തിൽ|ਵਿੱਚ|ते|मध्ये|তে|માં|ରେ)/i;
function askedLanguage(message) {
  const s = String(message || '');
  let best = null, at = -1, marked = false;
  for (const [code, re] of LANG_ASKED) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 12), m.index), after = s.slice(m.index + m[0].length, m.index + m[0].length + 8);
      if (NOT_BEFORE.test(before) || NOT_AFTER.test(after)) continue;
      const ask = ASK_BEFORE.test(before) || ASK_AFTER.test(after);
      if ((ask && !marked) || (ask === marked && m.index > at)) { best = code; at = m.index; marked = ask; }
    }
  }
  return best;
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
    return { reply: cleanReply(obj.reply), go: safeGo(obj.go), act: safeAct(obj.act) };
  }
  return { reply: cleanReply(raw.replace(/[{}"]/g, '')), go: null, act: null };   // last resort: speak the text
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
/* Clause by clause, not word by word. Cutting just "4.7 stars" and "12,840+
   reviews" out of "…500 rupees, rated 4.7 stars with 12,840+ reviews." left
   "500 rupees, ratedwith." to be read aloud (Hindi: "इसकी रेटिंगएं हैं"). So a
   clause that carries a rating or a review count goes WHOLE, together with
   the comma / "and" / "with" that tied it on. */
const STAT_IN_CLAUSE =
  /\d[.,]\d\s*(stars?|स्टार|స్టార్)|\d[\d,]*\s*\+?\s*(reviews?|रिव्यू|समीक्षा|రివ్యూ|సమీక్ష)|\b(rated|ratings?)\b|रेटिंग|రేటింగ్/i;
// a comma (not the one inside 12,840), a semicolon, a sentence end (not the
// point inside 4.7), or a joining word
const CLAUSE_SPLIT = /(\s*(?:;|,(?!\d))\s*|(?:[!?।]|\.(?!\d))+\s*|\s+(?:and|with|और|तथा|మరియు)\s+)/i;
function dropStatClauses(reply) {
  const parts = reply.split(CLAUSE_SPLIT);            // clause, joint, clause, joint, …
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    if (STAT_IN_CLAUSE.test(parts[i])) continue;      // the clause, and the joint before it
    out += (i > 0 && out ? parts[i - 1] : '') + parts[i];
  }
  return out.trim();
}
function stripUnsolicitedStats(reply, question) {
  if (ASKED_ABOUT_STATS.test(String(question || ''))) return reply;   // they DID ask
  let s = dropStatClauses(reply);
  if (!s) {                       // the whole answer was one such clause: cut just the numbers
    s = reply;
    for (const re of STAT_CLAUSES) s = s.replace(re, '');
  }
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

/* Ask for a strict JSON object where supported. If the model/provider rejects
   it we retry once without — but we REMEMBER that, because paying for a
   failed call before every single answer is pure added latency. -> the text */
async function completeJson(opts) {
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
  return (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) || '';
}

/* ---- The checkout's address form, filled from what the customer SAID ----
   The widget sends what they said while the address form is on screen; this
   turns it into the form's fields, which the page then types in itself
   (js/auth.js DcalStore.fillAddress). Only what was actually said in THIS
   message comes back — never a guess. Validated field by field below, and
   every number must really be among the digits they said. */
const ADDRESS_PROMPT = [
  'You fill an Indian customer form from what a customer just said, in any language. They may say several details in one breath, in any order.',
  'Return ONLY a JSON object with any of these keys: "name", "email", "phone", "line", "pincode", "city", "state", "landmark".',
  'Put a key in ONLY if the customer actually said that detail in this message. Leave every other key out. Never guess, never invent, never fill a value from these instructions.',
  'Every detail goes in its OWN key and nowhere else: the email never inside "line" or "name", the phone number never inside "line", the pincode only in "pincode".',
  '"name": the person\'s name only — no numbers. "email": their email address written normally (spoken "at" / "at the rate" is @, "dot" is .), lower case, no spaces.',
  '"phone": their 10-digit mobile number, digits only. "pincode": the 6-digit PIN code, digits only.',
  '"line": house or flat number, building, street and area, as one line. "city": the city, town or district. "state": the Indian state. "landmark": a nearby landmark (near / opposite / behind something).',
  'Numbers said as words become digits ("five zero zero zero eight one" -> "500081", "double nine" -> "99").',
  'Write every value in English letters: transliterate names and places spoken in Hindi, Telugu or any Indian script. Capitalise names and places.',
  'If the message contains none of these details (a question, a greeting, "yes", "no"), return {}.'
].join('\n');

function digitsOf(s) { return String(s || '').replace(/\D/g, ''); }
/* Every digit they SAID, in order — numerals and number words alike: "nine
   eight seven …" next to "4-1-20" must still count as a phone number they
   said. (The widget's spokenDigits() reads speech the same way.) */
const DIGIT_WORDS = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  'शून्य': '0', 'जीरो': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
  'సున్నా': '0', 'జీరో': '0', 'ఒకటి': '1', 'రెండు': '2', 'మూడు': '3', 'నాలుగు': '4', 'ఐదు': '5', 'ఆరు': '6', 'ఏడు': '7', 'ఎనిమిది': '8', 'తొమ్మిది': '9'
};
const REPEAT_WORDS = { double: 2, triple: 3, 'डबल': 2, 'ट्रिपल': 3, 'డబుల్': 2, 'ట్రిపుల్': 3 };
function digitsSaid(message) {
  let out = '', times = 1;
  for (const t of String(message || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)) {
    if (!t) continue;
    if (/^\d+$/.test(t)) { out += t.charAt(0).repeat(times - 1) + t; times = 1; }
    else if (DIGIT_WORDS[t]) { out += DIGIT_WORDS[t].repeat(times); times = 1; }
    else if (REPEAT_WORDS[t]) times = REPEAT_WORDS[t];
  }
  return out;
}
function safeAddress(o, message) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  const said = digitsSaid(message);
  // a number counts only if it is really among the digits they said (when
  // they said digits at all — "nine eight seven…" in words has none to check)
  const heard = (d) => !said || said.indexOf(d) !== -1;
  const text = (v, max) => (typeof v === 'string' ? v.replace(/[<>{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  // a name is letters: anything with a digit or an @ in it is a detail that strayed
  const name = text(o.name, 60);
  if (name.length >= 2 && !/[\d@]/.test(name)) out.name = name;
  const email = text(o.email, 80).toLowerCase().replace(/\s+/g, '');
  if (/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email)) out.email = email;
  let ph = digitsOf(o.phone);
  if (ph.length === 12 && ph.slice(0, 2) === '91') ph = ph.slice(2);
  else if (ph.length === 11 && ph[0] === '0') ph = ph.slice(1);
  if (/^[6-9]\d{9}$/.test(ph) && heard(ph)) out.phone = ph;
  const pin = digitsOf(o.pincode);
  if (/^[1-9]\d{5}$/.test(pin) && heard(pin)) out.pincode = pin;
  // The address parts must not carry another detail: an email, or the
  // mobile number, that the model let slip into them.
  const notMine = (v) => {
    v = v.replace(/\S+@\S+/g, ' ');
    if (out.phone) v = v.replace(new RegExp('(\\+?91[\\s-]*)?' + out.phone.slice(0, 5) + '[\\s-]*' + out.phone.slice(5), 'g'), ' ');
    return v.replace(/\s*,\s*(,\s*)+/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ');
  };
  for (const [k, max] of [['line', 160], ['city', 60], ['state', 40], ['landmark', 80]]) {
    const v = notMine(text(o[k], max));
    if (v && !(k !== 'line' && /\d{6,}/.test(v))) out[k] = v;
  }
  return out;
}
async function extractAddress(message) {
  message = typeof message === 'string' ? message.trim().slice(0, 600) : '';
  if (!message || !ENABLED || !client) return {};
  const opts = {
    model: MODEL, temperature: 0, max_tokens: 220,
    messages: [{ role: 'system', content: ADDRESS_PROMPT }, { role: 'user', content: message }]
  };
  if (IS_OPENROUTER) opts.provider = { sort: 'throughput' };
  const raw = await completeJson(opts);
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) {
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
  }
  return safeAddress(obj, message);
}

/* ---- GET /api/assistant/health -> tells the widget whether AI is available ---- */
function health(_req, res) { res.json({ enabled: ENABLED, model: ENABLED ? MODEL : null }); }

/* ---- answer(message, lang, history, state, pref) -> { reply, go, act, lang, asked }
   The brain on its own, with no HTTP around it, so /api/ask can call it the
   instant speech-to-text finishes instead of sending the text back to the
   browser and waiting to be asked again.
   `lang` is the language they SPOKE. The answer is in that language — unless
   they asked for one by name ("explain in Telugu": `asked`), or asked for one
   earlier and are still speaking the way they were then (`pref` =
   {want, spoke}). The answer's language comes back as `lang`. */
async function answer(message, lang, history, state, pref) {
  message = typeof message === 'string' ? message.trim() : '';
  lang = LANG_NAME[lang] ? lang : 'en';
  if (!message) throw new Error('empty');
  lang = langOfScript(message, lang);
  const asked = askedLanguage(message);
  if (asked) lang = asked;
  else if (pref && LANG_NAME[pref.want] && pref.spoke === lang) lang = pref.want;
  if (message.length > 500) message = message.slice(0, 500);
  {
    // Twelve turns, not six: replies are one short spoken sentence, so this is a
    // few hundred tokens, and it is what lets "the second one" or "my hotel"
    // still mean something four questions later. The widget already trims the
    // oldest turns when they will not fit in its header.
    history = Array.isArray(history) ? history.slice(-12) : [];
    const messages = [{ role: 'system', content: KNOWLEDGE }];
    for (const h of history) {
      if (!h || typeof h.text !== 'string') continue;
      let content = String(h.text).slice(0, 500);
      // She was talked over while saying this. The customer heard only the part
      // she had reached — the prompt's INTERRUPTIONS rule says what to do with that.
      if (h.role === 'assistant' && h.cut) {
        const said = typeof h.said === 'string' ? h.said.trim().slice(0, 200) : '';
        content += '\n[INTERRUPTED: the customer started talking over this reply' +
                   (said ? ' when you had said only: "' + said + '"' : ' almost at once') +
                   '. They did not hear the rest.]';
      }
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: content });
    }
    // The language line is repeated on every turn (not just in the system prompt)
    // because the customer can switch language mid-conversation — the earlier
    // turns in `history` may well be in a different one.
    // Nothing asked but the language ("say that in Telugu"): it is her last
    // answer they want, again, in that language.
    // A language asked for by name: the model's habit is to answer with a
    // promise ("I will explain it in Tamil") and nothing else. Said right next
    // to the question, where it is read, not 200 lines up.
    let said = message;
    if (asked) {
      const L = LANG_NAME[lang];
      const prevQ = history.slice().reverse().find((h) => h && h.role !== 'assistant' && typeof h.text === 'string');
      if (onlyLanguageAsked(message) && prevQ) {
        said = message + '\n(Nothing new is asked: they want the answer to their previous question — "' +
               String(prevQ.text).slice(0, 200) + '" — again, in ' + L + '. Give that real answer now, in ' + L + '.)';
      } else {
        said = message + '\n(Give the real answer now, in ' + L + ' — what it is and what it does — not "I will explain".)';
      }
    }
    messages.push({
      role: 'user',
      content: 'Answer in ' + LANG_NAME[lang] + ' only, using ' + LANG_NAME[lang] +
               ' script. Customer says: ' + said + describeState(state)
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

    const raw = await completeJson(opts);
    let out = parseReply(raw);
    if (!out.reply) out.reply = (ASK_AGAIN[lang] || ASK_AGAIN.en);
    else out.reply = stripUnsolicitedStats(out.reply, message);   // seconds they never asked to wait
    if (asked) out.reply = dropLanguagePromise(out.reply, asked);   // "I will explain in Telugu, …" -> the explanation
    // Start making the audio NOW, not after the browser reads this and asks.
    if (tts && tts.warm) { try { tts.warm(out.reply, lang); } catch (e) {} }
    return { reply: out.reply, go: out.go, act: out.act || null, lang: lang, asked: asked || null };
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
    const out = await answer(body.message, body.lang, body.history, body.state, body.pref);
    res.json(out);
  } catch (e) {
    try { console.error('assistant error:', e && (e.status || ''), e && e.message); } catch (x) {}
    // let the browser widget fall back to its free offline engine
    res.status(502).json({ error: 'ai_error' });
  }
}

/* ---- POST /api/assistant/address  { text } -> { form: {name, phone, …} } ---- */
async function handleAddress(req, res) {
  if (!ENABLED || !client) return res.status(503).json({ error: 'ai_disabled' });
  try {
    const body = req.body || {};
    res.json({ form: await extractAddress(body.text) });
  } catch (e) {
    try { console.error('address error:', e && (e.status || ''), e && e.message); } catch (x) {}
    res.status(502).json({ error: 'ai_error' });
  }
}

module.exports = { handle, handleAddress, health, answer, extractAddress, askedLanguage, langOfScript, ENABLED, MODEL };
