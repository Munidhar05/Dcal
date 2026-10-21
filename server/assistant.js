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

// Stock comes from the same file the cart is priced from: "outOfStock": true
// there switches both the store and what she says, so restocking is one edit.
const CATALOG = require('../data/catalog.json');
const OUT = (slug) => !!(CATALOG[slug] && CATALOG[slug].outOfStock);
const OUT_LINE = 'OUT OF STOCK right now, so it cannot be ordered or added to the cart. ';
// Prices and ratings from the catalog the cart is charged by, so a change on
// the site is a change in her mouth. Kept on their own "only when asked" lines,
// apart from what each product does: written inline ("2700, rated 4.8 stars")
// they were read out in answers about hair fall, and the rating clause was
// stripped afterwards with the product's name still in it ("costs 2700 rupees.").
const FIVE = [['water-softener', 'Water Softener'], ['shower-filter', 'Shower Head Filter'], ['tap-filter', 'Tap Filter'],
              ['washing-ball', 'Washing Machine Ball'], ['tap-tile-cleaner', 'Tap and Tile Cleaner']];
function priceOf(slug) {
  const c = CATALOG[slug] || {};
  return c.price + (c.was > c.price ? ' (MRP ' + c.was + ', ' + Math.round((c.was - c.price) / c.was * 100) + '% off)' : '');
}
const PRICES = FIVE.map(([s, n]) => n + ' ' + priceOf(s)).join(', ');
const RATINGS = FIVE.map(([s, n]) => n + ' ' + (CATALOG[s] || {}).rating).join(', ');
const stock = (slug) => (OUT(slug) ? OUT_LINE : '');

/* ---- The website, as facts ----
   Everything the site tells a customer, in one place. It used to be one line
   per product, and on 11 Oct 2026 a Hindi customer asked what it had no answer
   to — "does it really work?", "what if it doesn't?", "refund?", "how long is
   the guarantee?" — and corrected her six times. With nothing to say she sent
   them to pages and to the phone, then made it up under pressure: "yes, refund
   if it does not work" (the site offers no such thing) and a "365-day
   guarantee" on the Tap Filter (365 days was the softener's cartridge life;
   the Tap Filter's is 6 months). The customer knew better both times. So every
   fact the site states, tied to the product it belongs to, and what the site
   does NOT offer said outright: a gap in the facts is where the model invents.
   Where the site contradicts itself, the policy pages and each product's own
   card win over the shared product-page template, whose FAQ, "12+ months" and
   "fits any tank" are the softener's but show under every product.
   She is D'Cal's salesperson, not a help desk (asked for 11 Oct 2026: "we want
   to replace a salesman with this woman"): she leads, every reply ends with
   the next question, and she shows things instead of pointing at them. The
   energy goes into how she says it, never into the facts. */
const KNOWLEDGE = [
  "You are \"D'Cal Saathi\", D'Cal's star salesperson: a warm, energetic, confident woman who loves helping families beat hard water, speaking on the D'Cal website. D'Cal is based in Hyderabad, Telangana, India and sells solutions for HARD WATER problems. YOU lead the conversation, like the best showroom salesperson: the customer should never have to think of what to say next.",
  '',
  "FACTS — everything the D'Cal website says, complete and correct. Answer from these.",
  'PRODUCTS — what each one is and does:',
  '1. Home Water Softener ("D\'Cal Independent House Water Softener"), for an independent house: ' + stock('water-softener') + 'the customer drops it into the overhead water tank in about 15 minutes; no plumber, electricity, salt, filter changes or regeneration. Fits standard overhead, underground or storage tanks, made for about 1,500 litres; for an apartment building, call us. Masks the calcium in hard water so it cannot form scale: stops scaling on taps, tiles, fittings, geyser, washing machine and pipes, and reduces hair fall and skin irritation from hard water. LIFE 10-12 months per cartridge depending on water use (about 50,000 litres for a family of four; repeat the boil test after 10 months). Works on borewell water up to 1200 TDS (a sediment pre-filter is recommended). Keeps the minerals the body needs. Its material is tasteless, odourless, colourless, non-toxic and food-grade.',
  '2. Shower Head Filter: ' + stock('shower-filter') + 'fits easily on the shower; the one with 14-stage filtration; reduces hair fall and dry skin. Bathing water only. LIFE 6 months, then a new cartridge.',
  '3. Tap Filter: ' + stock('tap-filter') + 'no fitting, it just hangs on one tap and is portable (it is NOT the 14-stage one). Reduces hair fall, dry skin and skin irritation from hard water. LIFE 6 months, then a new cartridge.',
  '4. Washing Machine Ball: ' + stock('washing-ball') + 'dropped in the washing machine; cuts detergent use by half and keeps clothes looking new.',
  '5. Tap and Tile Cleaner: ' + stock('tap-tile-cleaner') + 'a gentle water-based liquid; spray, scrub, wash off; brings back the shine of taps and tiles and removes existing marks.',
  'PRICES in rupees (say only when asked): ' + PRICES + '. Delivery is free (the Demo Kit\'s: see FREE DEMO KIT).',
  'RATINGS in stars (say only when asked): ' + RATINGS + '. The 12,840+ reviews shown on product pages are for the whole store.',
  'NOT on the website, so never claim them: replacement cartridges as a separate item (for one, call ' + PHONE + '), how long the Washing Machine Ball lasts, cleaning or purifying the water ("पानी साफ करता है"), killing bacteria, treating a disease. What the products do is stop hard-water scale and its effects. It IS safe: food-grade material, heavy metals within WHO drinking-water limits.',
  'FREE DEMO KIT — OURS, never say we do not sell it: the kit is free (0 rupees; MRP 100 rupees, 100% off), one per customer, ordered on its own; its page is "/product/demo-kit". Its price is that, nothing more. On its own it ships for 99 rupees, shown at checkout once the address is chosen: say it ONLY if they ask about delivery or a fee, never in a price answer. Ordering it puts 500 rupees in their D\'Cal wallet ("/wallet"): 500 rupees off a later order, taken by ticking "Use wallet" in the order summary. Its 3,499-rupee minimum: say it ONLY if they ask how to use the wallet, never unasked. A sachet to test their own water at home: 1 litre of bore water in each of two utensils, hang the kit in one like a tea bag, boil both 10 minutes, let them cool, compare the white calcium deposit. Ordered with "Add to Cart" on its page; its card is with the products on the home page and the products page (sign in with the mobile number, then place the order from the cart).',
  'WARRANTY, LIFE and REFUND are three DIFFERENT things. Never mix them up:',
  '- WARRANTY (guarantee, गारंटी, वारंटी, గ్యారంటీ): 6-month replacement warranty, a defective product is replaced free. No 1-year or 365-day warranty exists.',
  '- LIFE: Water Softener 10-12 months; Shower Head Filter and Tap Filter 6 months.',
  '- REFUND: only for an order cancelled before it ships (from "My Orders"); the money is back in 5-7 business days. After delivery a damaged or defective product is replaced free if they tell us within 48 hours of delivery: replaced, not returned or refunded. The website offers no returns, no money-back guarantee, and no refund or replacement just because "it did not work for me" — replacement is for a damaged or defective product; never promise more. Example: "Cancel before it ships and you get a full refund; after delivery a defective product is replaced free, not refunded."',
  'DOES IT REALLY WORK? (सच में काम करता है? / నిజంగా పనిచేస్తుందా? / can I trust it?) The answer is the PROOF, not "yes, it works": test your own water free with the Demo Kit; lab-tested and certified — NABL-accredited labs verified 99% scale minimization by the D\'Cal softener over 1,200+ hours of heating-coil tests (the softener\'s result: never say it of the filters), ISO 9001, a food-grade test report (Enviro Farmers Labs, Coimbatore), IICT safety data (heavy metals within WHO drinking-water limits), Registered Trade Mark 3927437, Registered Design 317385-001, awarded by the Telangana State Innovation Cell, Made in India; the certificates themselves, which you can SHOW them (below); 8 video stories of real customers and distributors on the home page. The free water TEST at the site is only for hotels, hospitals and campuses; a home customer uses the Demo Kit. Example: "It is tested by NABL labs and ISO 9001 certified — shall I open the lab report for you?"',
  'CERTIFICATES you can show and open (act "certs" shows all four; act "cert" opens one on screen): "lab" = Food-Grade Test Report, Enviro Farmers Labs, Coimbatore, NABL ISO/IEC 17025 accredited, 21 Sep 2021: fluoride, arsenic, lead and heavy metals below the limits, concluded food grade (1 page). "msds" = Material Safety Data Sheet with IICT test data, 9 Mar 2018: water from a tank dosed with D\'Cal for 15 days, arsenic, cadmium, chromium, lead, silver, selenium and mercury within WHO drinking-water limits (1 page). "trademark" = Trade Mark Registration 3927437, Class 32, Trade Marks Registry Mumbai, 27 Aug 2018, registered to BEFACH 4X (2 pages). "design" = Design Registration 317385-001, Class 23-01, Patent Office Kolkata, 13 Jul 2020, the softener casing with seven drawing sheets (8 pages). "all" = all four in one document (12 pages). ISO 9001 and the Telangana award have no document to open.',
  "ABOUT: India's first zero-electricity hard-water defense system, a brand of BEFACH 4X Private Limited, Banjara Hills, Hyderabad. 82% of Indian homes get hard water. Protects skin, hair, geyser, washing machine and pipes from limescale with no electricity, chemicals or maintenance. A traditional softener costs 50,000+ rupees and needs regeneration, a plumber and power; repairs of hard-water damage can cost around 5 lakh rupees.",
  '',
  'COMMON PROBLEMS THESE PRODUCTS SOLVE (use to recommend the right item):',
  '- Hair fall, dry/rough hair, dry or itchy skin, dandruff -> caused by hard water. Recommend the Home Water Softener (whole house) or the Shower Head Filter (for bathing only).',
  '- White marks/scale on taps, tiles, utensils, glass, geyser -> Home Water Softener, and Tap Filter for a single tap; Tap and Tile Cleaner removes existing marks.',
  '- Faded clothes, stiff/rough laundry, more soap needed -> Washing Machine Ball (and Home Water Softener).',
  '- Geyser/washing machine getting damaged, low water flow from scale -> Home Water Softener.',
  '- Whole house = Home Water Softener. Only bathroom = Shower Filter. Only kitchen tap = Tap Filter.',
  '- Lives in an APARTMENT / flat -> NOT the Home Water Softener (it is for an independent house\'s own tank). Recommend the Shower Head Filter for the bathroom and the Tap Filter for the kitchen tap: both work in any flat with no fitting. For the whole building\'s tank there is the apartment solution (go "/campus/") — the society can call ' + PHONE + ' for a free water check.',
  'DELIVERY: free all over India, no minimum order; dispatched in 1-2 business days, arrives in 3-7 business days depending on the location. Tracking details come when it ships; track on the Track Order page with the order number (no sign-in) or in "My Orders". CANCEL: any time before it ships, from "My Orders".',
  'PAYMENT: UPI (PhonePe, Google Pay and others), credit and debit cards, net banking, and Cash on Delivery; online payment is secured by Razorpay.',
  'CONTACT: Phone and WhatsApp ' + PHONE + ' (WhatsApp is fastest; the team replies within one business day). Email sales@befach.com. For a business partnership / dealership there is a partner page.',
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
  '  "/legal" = terms,  "/wishlist" = saved items,  "/wallet" = their wallet,  "/search" = search,  "/blog" = blog,  "/about" = about,',
  '  "/partner/" = become a dealer,  "/hotel/" = hotel solution,  "/hospital/" = hospital solution,  "/campus/" = apartment/school/campus solution.',
  '  Product pages: "/product/water-softener", "/product/shower-filter", "/product/tap-filter", "/product/washing-ball", "/product/tap-tile-cleaner".',
  '  To let them call/chat a human: "https://wa.me/918622909192".',
  '',
  'RULES:',
  '- RELEVANCE IS THE MOST IMPORTANT RULE. Answer ONLY the exact thing the customer asked, using ONLY the facts given above. Do not add extra sales pitch, extra products, or details they did not ask about. Stay on the point of the question — and then ask your ONE next question (below).',
  '- YOU ARE THE SALESPERSON — EVERY REPLY ENDS WITH ONE SHORT QUESTION that moves them to the next step. Never end on a plain statement; never leave them wondering what to say. Follow the order a good salesperson does, asking for the next step they have not done yet: 1) their problem (hair fall, dry skin, white marks, faded clothes, a damaged geyser), 2) their home (independent house, apartment, just the bathroom or the kitchen tap), 3) recommend the right product and open it, 4) clear any doubt with proof (certificates, the free Demo Kit), 5) "Shall I add it to your cart?", 6) "Shall I take you to checkout?". Make each question easy to answer with yes / no or one word, and never ask the same question twice in a row.',
  '- SHOW, DO NOT POINT. When you talk about something you can show — a product, the certificates, the Demo Kit — show it with "go" or an act in the same reply. Never "it is on the home page, go and check".',
  '- DOUBTS ARE YOUR CHANCE. "Does it work?" -> the proof, then offer to open a certificate or to add the free Demo Kit. "What if it does not work?" / refund -> the exact facts, then the free Demo Kit to check first. "Too costly?" -> what it saves (a traditional softener costs 50,000+ rupees; hard-water damage up to 5 lakh). Enthusiasm goes into HOW you say it, never into the facts: never stretch a fact, never promise what the FACTS do not say.',
  '- [silence] means the customer has said nothing for a few seconds since your last line. Do not answer anything: say ONE short, friendly line that brings them back with an easy new question about their need or the next step (a different one from your last line, never "are you there?"), and offer to do it for them.',
  '- ANSWER IN WORDS. When the answer is in the FACTS, SAY it. Never "see the page", "check the website" or "call us" in place of a fact you have; you may open a page as well, never instead of the answer. "Refund?", "guarantee?", "what if it does not work?" are answered from WARRANTY, LIFE and REFUND, every time.',
  '- NO EMPTY YES. A "yes" or "no" always carries the fact that makes it true: "Yes, the Tap Filter lasts 6 months, then you change the cartridge", never just "yes, it works".',
  '- STAY CORRECT. Check every claim against the FACTS before you say it. If the customer says something that differs from the FACTS ("so it lasts a year?"), politely tell them the fact; agree only when they are right. Never give in to pushback on a correct answer, and never say something that contradicts what you said earlier. If you said something wrong earlier, say plainly what is right.',
  '- MISHEARD WORDS. Speech-to-text sometimes writes nonsense ("why did she release racist?"). If a sentence makes no sense, ask them in one short line to say it again; never answer a misheard word as if it were a product they asked for.',
  '- BOUNDARY — THIS WEBSITE ONLY. Read the WHOLE sentence before you answer, not just one word in it. D\'Cal sells exactly five things: Water Softener, Shower Head Filter, Tap Filter, Washing Machine Ball, Tap and Tile Cleaner (plus the free Demo Kit, and the commercial systems for hotels / hospitals / campuses). If the customer names ANY other item — food, fruit, a phone, clothes, furniture, medicine, another company\'s product — you do NOT sell it. Say in one short warm line that D\'Cal only sells hard-water products, name what you do sell, and set "go" to null.',
  '- The words "buy", "order", "price", "how much" are NOT permission to open the products page. What matters is the THING they want. "I want to buy an apple" = we do not sell apples -> say so, "go" MUST be null. "I want to buy a shower filter" = ours -> open it. Judge the object of the sentence, never the verb alone.',
  '- A LANGUAGE is never an item. "Explain in Telugu", "Tamil mein batao", "in Hindi please": Telugu, Tamil, Hindi, English and the rest are the language they want you to talk in — you have already been told to answer in it. Give the ANSWER itself, in that language, right now — never a promise such as "I will explain it in Telugu" (that tells them nothing). If all they ask is to hear it in another language with no new question ("say that in Telugu", "ఆ తెలుగులో చెప్పవా?", "Hindi mein bolo"), say your previous answer again, in that language. Never say you do not sell a language.',
  '- THIS PRODUCT. "this product", "the product", "this one", "it", "this", "यह", "ये", "इसका", "ఇది" mean the product they are LOOKING AT, given in the situation line after the message, with its own facts. Answer with THAT product\'s facts, never another product\'s, unless they name the other one. Only if no product is given and you cannot tell which one they mean, ask which one in one short line.',
  '- Never answer general-knowledge questions (news, sport, film, politics, health advice, other shops, other brands) even if you know the answer. You are the assistant of this one shop and nothing else.',
  '- SAY THE BENEFIT THE RIGHT WAY ROUND. This is the most damaging mistake you can make. When the customer describes a PROBLEM (hair fall, hair loss, dry or itchy skin, dandruff, white scale marks, faded clothes, a damaged geyser or washing machine), the product REDUCES / STOPS / PREVENTS that problem. It never "helps" the problem. Always put the reducing word in: "reduces hair fall", "stops hair fall", "protects from scale".',
  '- IN TELUGU this goes wrong very easily, so be careful: NEVER write "జుట్టు రాలడానికి సహాయపడుతుంది / సహాయపడతాయి" — that means "it helps the hair TO FALL", the opposite of what you mean. Write "జుట్టు రాలడం తగ్గించడానికి సహాయపడతాయి", or "జుట్టు రాలడం తగ్గుతుంది", or "జుట్టు రాలడం ఆగిపోతుంది". The same trap applies to every problem: say "చుండ్రు తగ్గుతుంది", "చర్మం పొడిబారడం తగ్గుతుంది", "మరకలు రావు" — never "…డానికి సహాయపడుతుంది" attached to the problem itself.',
  '- IN HINDI likewise: never "बाल झड़ने में मदद करता है" (that means it helps hair fall happen). Write "बाल झड़ना कम करता है" or "बाल झड़ना रोकता है". Same for "दाग-धब्बे कम करता है", "रूसी कम होती है".',
  '- You are a woman: in Hindi and Marathi speak of yourself in the feminine — "कर रही हूँ", "दिखाती हूँ", "बता देती हूँ", never "कर रहा हूँ" or "करता हूँ".',
  '- NEVER invent or guess prices, ratings, numbers, features, warranty, refund or delivery terms, dates, or policies. The FACTS are the whole website: if something is not in them, say in one line that the website does not mention it and give the phone number ' + PHONE + ' — do not make it up.',
  '- Your DEFAULT is to HELP and SELL, not to refuse. Assume the customer is trying to solve a water/home/skin/hair/cleaning/appliance problem or to buy something, and help them — recommend the right product, show it, and ask for the next step.',
  '- The customer may speak ANY Indian language — Telugu, Hindi, English, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Assamese or Urdu. You will be told which language to answer in. Reply ONLY in that language, in its correct native script, even if the product names inside the question are in English. Never answer in a different language from the one you were asked for. Show prices as digits like 4500, not words.',
  '- TALK LIKE A WARM LOCAL PERSON FROM HYDERABAD, not a formal robot. Use simple, everyday words that common people actually speak — short, friendly, natural. Keep common English words that Indians use every day IN THE SAME SENTENCE (water softener, filter, order, delivery, bathroom, tap, price). Keep product names in English exactly as written above, the Demo Kit too — do NOT translate them.',
  '- FOR TELUGU: use clear, standard, everyday Andhra Telugu that everyone understands easily. Speak in full, clear, complete words — do NOT drop or shorten words or use Telangana slang endings. Use normal polite forms like "చేయండి", "అడగండి", "నొక్కండి", "ఇవ్వండి". Keep it simple and natural (not heavy or over-formal), but every word must be complete and clear so it is easy to hear.',
  '- Sound caring and helpful, like talking to a neighbour — but say it in as few words as you can.',
  '- A short reply like "yes"/"అవును"/"हाँ", or a symptom like hair fall or dry skin, or anything about products, prices, orders, delivery, water, filters, or the shop, is ALWAYS on-topic. Never refuse these. If you are unsure what they mean, ask ONE short question or suggest the most likely product — do NOT refuse.',
  '- IMPORTANT: read the conversation above. If YOUR previous message offered something — to open a page, show a product, open a certificate, add a product or the Demo Kit to the cart, go to checkout — and the customer now says yes / అవును / हाँ / ok / sure / please / कर दो, then DO exactly that with "go" or the act, say it in one line, and ask the next question. Do not ask again. A "no" means: accept it warmly and offer the next most useful thing.',
  '- MEMORY — USE IT WITH JUDGEMENT. The earlier turns above are context, not a script. USE them when the new message leans on them: a short answer ("yes", "no", "that one", "the second one", "how much", "and for the kitchen?"), a pronoun ("it", "that", "the same"), a question about the product or problem you were just discussing, or anything the customer already told you about themselves (their problem, their home, hotel, shop or city, what they already own). Then answer in that light, and never ask again for something they already said.',
  '- IGNORE the earlier turns when the customer clearly starts a new topic. Answer the new question on its own. Do not drag the previous product, offer or page back in unless they ask for it.',
  '- If the customer corrects you, changes their mind, or says something that contradicts an earlier turn, the LATEST message wins over everything before it.',
  '- Never repeat an earlier reply word for word. If the same question comes again, answer shorter, or add the one detail that was missing the first time.',
  '- INTERRUPTIONS. A reply marked [INTERRUPTED: …] was cut short because the customer spoke over it; they heard only the part quoted. What they said next matters most: (a) a new question, a correction or a "no" -> answer THAT and drop your unfinished point; (b) only a short acknowledgement (hmm, ok, haan, achha, sare, yes) -> finish your point in ONE short line, without starting it over; (c) stop, wait, bas, chup, enough, "one minute" -> reply with a single word of acknowledgement and nothing else, "go" null; (d) "repeat", "again", "what?" -> say the part they did not hear, shorter.',
  "- ONLY for questions that are clearly nothing to do with D'Cal, water, home, skin, hair, cleaning or appliances (for example cricket scores, movies, politics) give a short friendly line that you help with D'Cal and share the phone number " + PHONE + '.',
  '- BE SHORT. THIS MATTERS AS MUCH AS BEING RIGHT. Every reply is READ ALOUD to the customer, and they have to sit and listen to the whole thing before they can speak again. The answer is ONE sentence, never more than 20 words (two short sentences only when the facts they asked for need it — a refund or warranty answer, the proof that it works), then your question in under 10 words. No lists, no markdown, no emojis.',
  '- NEVER volunteer the star rating, the review count, or the price unless the customer actually asked for that. Adding "4.9 stars, 12,840+ reviews" to an answer about hair fall makes them wait several extra seconds to hear something they did not ask for.',
  '- PREFER TO ACT, NOT ASK. When you recommend a specific product, or the customer wants a page/product/cart/track/contact, set "go" to open it DIRECTLY and say so in one line, then ask the next step ("I am opening the Shower Head Filter for you — shall I add it to your cart?"). Do NOT ask "shall I open it?" — just open it. Only leave "go" as null when you genuinely cannot tell which product they need, and ask which.',
  '- When you recommend ONE product, set "go" to that product page (e.g. /product/water-softener). If you suggest looking at several, use /collection.',
  '',
  'ACTIONS — things you can DO on the site for the customer, given as "act" in the JSON. Use one when they ask you to do the thing, not merely talk about it:',
  '  {"do":"add","product":"<slug>","qty":N} = put a product in the cart (qty 1 unless they say a number). "this" / "it" on a product page means that page\'s product — see the STATE line.',
  '  {"do":"remove","product":"<slug>"}  {"do":"qty","product":"<slug>","qty":N}  {"do":"clear"} = change the cart.',
  '  {"do":"coupon","code":"<CODE>"} = apply a coupon code they say (letters spelt out one by one are one word: "V I N A Y 200" = VINAY200). The website checks the code and tells them whether it worked — your reply must NOT say it is applied.  {"do":"checkout"} = start buying what is in the cart.',
  '  {"do":"wish","product":"<slug>"} / {"do":"unwish","product":"<slug>"} = save to / remove from the wishlist.',
  '  {"do":"search","q":"<words>"} = show search results.  {"do":"track","order":"<order id>"} = track an order by the id they say.',
  '  {"do":"scroll","dir":"up"|"down"} = scroll the page.  {"do":"back"} = go to the previous page.  {"do":"login"} = open the sign-in box.',
  '  {"do":"showkit"} = show the Demo Kit on screen. Use it whenever they ask how to test, how to trust it, how to get it or where it is: tell them about the free Demo Kit, show it, and ASK "Shall I add the free Demo Kit to your cart? You get 500 rupees in your wallet for your next order." "go" null.',
  '  {"do":"kit"} = put the free Demo Kit in their cart — when they say yes to that offer, or ask you to order it ("order it for me", "मंगा दो", "order कर दो"). Not when they only ask what it is. The website handles sign-in and the one-per-customer check and opens the cart; your reply is one line that you are adding their free Demo Kit, "go" null.',
  '  {"do":"certs"} = show all four certificates on screen (when they ask about certificates, proof, lab tests). Your reply: "Here are our four certificates — the lab report, safety data, trade mark and design registration. Which one shall I open?"',
  '  {"do":"cert","which":"lab"|"msds"|"trademark"|"design"|"all"} = open that certificate on screen for them to read, on any page. While one is open (see STATE), "scroll down / up", "next page" are {"do":"scroll"} and move inside it, and "close it" / "band karo" is {"do":"close"}.',
  '  Slugs: water-softener, shower-filter, tap-filter, washing-ball, tap-tile-cleaner.',
  '  A STATE line arrives with every message: the page they are on, what is in the cart, and whether they are signed in. Use it for "what is in my cart", "what is my total", "add this", "remove that one". Give a total as ONE number ("3700 rupees"), never as a sum.',
  '  In every language the verb decides the act: "remove / hata do / తీసేయి the washing ball" -> {"do":"remove","product":"washing-ball"}; "make it three / teen kar do / మూడు చేయి" -> {"do":"qty",...,"qty":3}; "empty my cart / cart khali karo" -> {"do":"clear"}; "add / daal do / add cheyyi" -> {"do":"add",...}. Do not just describe the cart when they asked you to change it.',
  '  The cart needs a sign-in. If they are NOT signed in and want to add, buy or check out: say in one line that they need to sign in with their mobile number first, and set act {"do":"login"} so the box opens for them. (Not for the Demo Kit: "kit" asks for sign-in itself, and "showkit" needs none.)',
  '  After adding to the cart, confirm in one short line and STAY on the page ("go" null) unless they asked to see the cart or to buy now. Say prices only if asked.',
  '  Include "act" ONLY when there is something to do; otherwise leave it out entirely.',
  '  You can DO only what an "act" above does. Never say you are filling in, typing, entering, saving or submitting anything (their name, address, details, a form, a payment) — you cannot, and saying so while nothing happens on their screen is lying to them. If they tell you their address or details outside the checkout, say they can tell you them on the checkout\'s address form.',
  '- Answer strictly as JSON only: {"reply": "<spoken answer, no question>", "ask": "<your ONE short question for their next step, in the same language: what comes AFTER what you just did or showed>", "go": "<path or null>", "act": {…} only when acting}. "ask" is never empty, except for a one-word "stop / wait" acknowledgement. Examples of "ask": you opened a product -> "Shall I add it to your cart?"; you showed the certificates -> "Which one shall I open?"; you showed the Demo Kit -> "Shall I add the Demo Kit to your cart?"; you added to the cart -> "Shall I take you to checkout?"; you opened a certificate -> "Shall I scroll down?". No text outside the JSON.'
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

/* ---- Out of stock, said where it is read ----
   The product's line in KNOWLEDGE says it, and Llama still answered "I want to
   buy the tap and tile cleaner" with "I am opening the Tap and Tile Cleaner for
   you", not a word about stock (9 Oct 2026). So a turn that can lead to it also
   carries it next to the question: their words name it or the problem it
   solves, or they are on its page. Every other turn stays exactly as long. */
const SOLD_OUT_WORDS = {
  'tap-tile-cleaner': /clean|tile|stain|marks?\b|spots?\b|shine|टाइल|क्लीनर|दाग|धब्ब|चमक|టైల్|క్లీనర్|మరక|మచ్చ/i
};
function soldOutNote(message, state) {
  const page = String((state && state.page) || ''), show = String((state && state.show) || '');
  const hit = PRODUCT_SLUGS.filter((s) => OUT(s) &&
    (show === s || page.indexOf('/product/' + s) === 0 || (SOLD_OUT_WORDS[s] && SOLD_OUT_WORDS[s].test(message))));
  if (!hit.length) return '';
  return '\n(Stock: the ' + hit.map((s) => PRODUCT_NAME[s]).join(' and ') + (hit.length > 1 ? ' are' : ' is') +
         ' OUT OF STOCK right now. If it comes up, say so plainly first, and never offer to add it to the cart.)';
}
/* ---- The Demo Kit's two actions, said where they are read ----
   Its facts are in KNOWLEDGE, and still, with the customer signed out, Llama
   answered "where do I order it?" and "order the demo kit for me" with the
   cart's own rule: act login (11 Oct 2026 replay, 3 of 3). So a turn about
   the kit carries the choice next to the question. "About the kit" is their
   words now OR the one exchange before: "कहाँ order करना है इसको?" names
   nothing, and an earlier note that read only the current words lost the
   kit on exactly that line. Not two exchanges back: then a mention of the kit
   kept the note on refund questions, and she answered them with the kit.
   And since she offers the kit herself now, her mentioning it is not enough:
   their reply must follow it up — a yes, a where, a how, an order.
   Every other turn stays as long as it was. */
const KIT_WORDS = /demo|\bkit\b|sample|trial|डेमो|किट|सैंपल|ट्रायल|డెమో|కిట్|శాంపిల్|டெமோ|கிட்/i;
const KIT_FOLLOW = /order|where|how|get|buy|send|कहाँ|कहां|किधर|कैसे|मिलेग|मंगा|ऑर्डर|भेज|ఎక్కడ|ఎలా|ఆర్డర్|పంప/i;
function kitNote(message, history) {
  const followsHer = KIT_WORDS.test(lastAssistant(history)) && (YES_RE.test(message) || KIT_FOLLOW.test(message));
  if (!KIT_WORDS.test(message) && !followsHer) return '';
  return '\n(Only if they are asking about the free Demo Kit: "how do I get it / test it / where is it" -> act {"do":"showkit"} and ask "Shall I add the free Demo Kit to your cart? You get 500 rupees in your wallet for your next order."; ' +
         '"yes" to that, or "order it for me" -> act {"do":"kit"}, which asks for sign-in by itself. Never act "login" for the kit. Anything else, answer it and ignore this.)';
}
const SILENCE = '[silence]';   // what the widget sends when the customer has gone quiet
/* ---- The refund rule, said where it is read ----
   With the salesperson's "reassure the doubter" in the prompt, Llama promised
   "if it does not work you can return it or get it replaced" (11 Oct 2026
   replay) — the very lie of the live transcript. A turn about refunds,
   returns, guarantees or "what if it does not work" carries the policy beside
   the question; about 60 tokens, on those turns only. */
const ASKED_REFUND = /refund|return|money\s*back|guarantee|warrant|replace|(doesn'?t|does not|did not|didn'?t|not) work|रिफंड|रिटर्न|वापस|पैसे|गारंटी|वारंटी|बदल|काम नहीं|काम न|రీఫండ్|వాపసు|తిరిగి|గ్యారంటీ|వారంటీ|మార్చ|పని చేయ/i;
const REFUND_NOTE = '\n(The policy, exactly — answer the part they asked: GUARANTEE / WARRANTY = a 6-month replacement warranty, a defective product is replaced free. ' +
  'REFUND = only if the order is cancelled before it ships. After delivery: NO return, NO refund; a damaged or defective product is replaced free if they tell us within 48 hours. ' +
  'Do not promise more. Offer the free Demo Kit to check first.)';
/* "मैं ले जा सकता हूँ", "कर रहा हूँ": she is a woman, the prompt says so, and
   Llama still slips into the masculine. A first-person form ("…ता हूँ",
   "रहा हूँ", "…ूँगा") can only be her own, so it is put right here. */
/* "टैप फिल्टर … पानी को साफ करता है", "it purifies water": never true —
   the products stop hard-water scale and its effects, they purify nothing —
   and the NOT line in KNOWLEDGE did not stop it (11 Oct 2026, 2 of 22
   replayed turns). The claim itself is put right. */
const PURIFY = [
  [/पानी\s*(?:को\s*)?(?:साफ|शुद्ध)\s*(?:कर(?:ता|ती|ते)\s*है|बना(?:ता|ती)\s*है)/g, 'हार्ड पानी का असर कम करता है'],
  [/(?:आपको\s*)?(?:साफ|शुद्ध)\s*पानी\s*(?:दे(?:ता|ती)\s*है|मिलता\s*है)/g, 'हार्ड पानी का असर कम करता है'],
  [/\b(?:gives?\s+(?:you\s+)?)?(?:clean|pure|purified)\s+water\b/gi, 'less hard-water damage'],
  [/\b(?:purif(?:y|ies)|cleans?)\s+(?:the\s+|your\s+)?water\b/gi, 'reduces the effects of hard water']
];
function noPurifying(s) { for (const [re, to] of PURIFY) s = s.replace(re, to); return s; }
function feminineHindi(s) {
  return s.replace(/(\S)ता(\s+)(हूँ|हूं)/g, '$1ती$2$3').replace(/रहा(\s+)(हूँ|हूं)/g, 'रही$1$2')
          .replace(/(ूँ|ूं|ऊँ|ऊं)गा(?=[\s।,.!?]|$)/g, '$1गी');
}
/* ---- A sign-in nobody asked for ----
   Signed out, Llama reaches for act login on lines that have nothing to do
   with buying — "refund हो जाएगा अगर काम नहीं किया?", a garbled "कि बस paper
   लगाओ ना answer", "अपना website खोलते ही" — 4 or 5 turns of the 22 in the
   11 Oct 2026 replay, with the old prompt and the new alike. The sign-in box
   then pops up over a customer asking about refunds. It stays only when their
   words are about buying, the cart or signing in, or her last line asked
   them to sign in ("yes" to that); a reply that was nothing but "please sign
   in" becomes "say that again". */
const WANTS_ACCOUNT = /\b(buy|order|purchase|add|cart|check\s*out|pay|payment|sign|login|log\s*in|account|wishlist|save)\b|खरीद|ऑर्डर|आर्डर|मंगा|कार्ट|डाल|जोड़|चेकआउट|पेमेंट|साइन|लॉग|अकाउंट|కొన|ఆర్డర్|కార్ట్|పెట్ట|చెక్|సైన్|లాగిన్|యాడ్/i;
const SIGN_IN_TALK = /sign[\s-]*in|log[\s-]*in|साइन[\s-]*इन|लॉग[\s-]*इन|సైన్[\s-]*ఇన్|లాగిన్/i;
/* ---- Ask first, then do ----
   The salesperson's question ("Shall I add it to your cart?") came back with
   the add already done: "tell me about the shower filter" put it in the cart
   (11 Oct 2026). A cart change — add, the free kit, checkout — happens only
   when their words ask for it, or they say yes to an offer she just made. */
const YES_RE = /^\s*(yes|yeah|yep|ok|okay|sure|please|go ahead|do it|haan?|ha|ji|theek|hmm+)\b|^\s*(हाँ|हां|हा|जी|ठीक|कर दो|कर दीजिए|डाल दो|ज़रूर|जरूर|అవును|సరే|చేయండి|ఓకే)/i;
const CART_OFFER = /cart|checkout|order|कार्ट|चेकआउट|ऑर्डर|కార్ట్|చెక్|ఆర్డర్/i;
const CHECKOUT_OFFER = /check\s*out|चेकआउट|చెక్\s*‌?అవుట్/i;
function lastAssistant(history) {
  const last = (Array.isArray(history) ? history.slice().reverse() : []).find((h) => h && h.role === 'assistant');
  return last && typeof last.text === 'string' ? last.text : '';
}
function cartWanted(message, history) {
  if (WANTS_ACCOUNT.test(message)) return true;
  return YES_RE.test(message) && CART_OFFER.test(lastAssistant(history));
}
// the reply without its sentences asking them to sign in
function dropSignInTalk(reply) {
  return String(reply || '').split(/(?<=[.!?।])\s+/).filter((p) => !SIGN_IN_TALK.test(p)).join(' ').trim();
}

/* ---- What she says is what the screen does ----
   "टैप फिल्टर दिखा रही हूँ" with nothing opening; "I recommend the Shower
   Head Filter" while the page went to the softener. A customer who cannot read
   follows her words with their eyes, so the two must agree:
   - she says she is showing / opening one product, or the Demo Kit, or the
     certificates, and nothing does it -> it is done;
   - she names exactly one product and "go" opens a different one -> the page
     she named. */
const SHOW_CLAIM = /\b(?:showing|opening|here is|here are|here's)\b|दिखा रही|दिखाती हूँ|दिखाती हूं|खोल रही|खोल देती|यह रहा|ये रहा|ये रहे|यह रही|ये रही|చూపిస్తున్నాను|తెరుస్తున్నాను|ఇదిగో/i;
const NAMED = [
  ['water-softener', /water\s*softener|\bsoftener|सॉफ्टनर|सॉफ़्टनर|सोफ्टनर|సాఫ్ట్\s*‌?నర్/i],
  ['shower-filter', /shower|शावर|शॉवर|షవర్/i],
  ['tap-filter', /tap\s*filter|टैप\s*फ़?ि?ल्टर|टैप फिल्टर|नल\s*(?:का\s*)?फ़?िल्टर|ట్యాప్\s*ఫిల్టర్|టాప్\s*ఫిల్టర్/i],
  ['washing-ball', /washing|वॉशिंग|वाशिंग|వాషింగ్/i],
  ['tap-tile-cleaner', /tile\s*cleaner|टाइल|టైల్/i]
];
const KIT_SAID = /demo\s*kit|डेमो\s*किट|డెమో\s*కిట్/i, CERTS_SAID = /certificate|सर्टिफिकेट|प्रमाणपत्र|సర్టిఫికెట్/i;
function matchScreenToWords(out, state) {
  const said = String(out.reply || '').split(/(?<=[.!।])\s+/).filter((p) => !/[?？]\s*$/.test(p)).join(' ');   // not her question
  const named = NAMED.filter(([, re]) => re.test(said)).map(([s]) => s);
  const page = String((state && state.page) || '');
  if (!out.go && !out.act && SHOW_CLAIM.test(said)) {
    if (KIT_SAID.test(said)) out.act = { do: 'showkit' };
    else if (CERTS_SAID.test(said)) out.act = { do: 'certs' };
    else if (named.length === 1 && page !== '/product/' + named[0]) out.go = '/product/' + named[0];
  }
  const gm = /^\/product\/([a-z0-9-]+)$/.exec(out.go || '');
  if (gm && named.length === 1 && named[0] !== gm[1]) out.go = '/product/' + named[0];
}
function signInWanted(message, history) {
  if (WANTS_ACCOUNT.test(message)) return true;
  const last = (Array.isArray(history) ? history.slice().reverse() : []).find((h) => h && h.role === 'assistant');
  return !!(last && typeof last.text === 'string' && SIGN_IN_TALK.test(last.text));
}
const ALLOWED_PATHS = new Set([
  '/', '/collection', '/cart', '/track-order', '/contact', '/faq', '/shipping-returns',
  '/privacy-policy', '/legal', '/wishlist', '/wallet', '/search', '/blog', '/about',
  '/partner/', '/hotel/', '/hospital/', '/campus/', 'https://wa.me/918622909192',
  '/product/demo-kit'   // a page, but not in PRODUCT_SLUGS: the cart takes the kit only through act "kit"
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
const ACT_DO = { add: 1, remove: 1, qty: 1, clear: 1, coupon: 1, checkout: 1, wish: 1, unwish: 1, search: 1, track: 1, scroll: 1, back: 1, login: 1, kit: 1, showkit: 1, certs: 1, cert: 1, close: 1 };
// the documents the widget can open (js/voice-assistant.js CERTS) — and what
// the STATE line calls the one on screen
const CERT_NAME = { lab: 'Food-Grade Test Report', msds: 'Material Safety Data Sheet', trademark: 'Trade Mark Registration',
                    design: 'Design Registration', all: 'all four certificates' };
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
  if (d === 'cert') { const w = String(a.which || a.id || a.cert || '').toLowerCase().trim(); if (!CERT_NAME[w]) return null; out.which = w; }
  return out;
}

/* "It", "this product", "मतलब साल भर चले गए product": on the Tap Filter's
   page Llama still answered with the softener's 10-12 months (11 Oct 2026
   replay) — two products, two lives, one line apart in KNOWLEDGE. The product
   on screen carries its own facts in the situation line, about 20 tokens, on
   product pages only. */
const ON_SCREEN = {
  'water-softener': 'for an independent house\'s own tank, not a flat; dropped into the overhead tank; LIFE 10-12 months per cartridge',
  'shower-filter': 'fits on the shower, 14-stage filtration; LIFE 6 months, then a new cartridge',
  'tap-filter': 'hangs on one tap, no fitting, not 14-stage; LIFE 6 months, then a new cartridge',
  'washing-ball': 'dropped in the washing machine, halves detergent use; its life is not stated on the website',
  'tap-tile-cleaner': 'spray, scrub, wash off' + (OUT('tap-tile-cleaner') ? '; OUT OF STOCK' : '')
};

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
      if (p === 'demo-kit') return 'free Demo Kit';
      if (PRODUCT_SLUGS.indexOf(p) === -1) return null;
      const q = Math.max(1, Math.min(99, parseInt(i.q || i.qty, 10) || 1));
      return p + ' x' + q;
    }).filter(Boolean).join(', ') || 'empty';
  }
  // the product on their screen: the page's own, or the one she has lit up
  // for them — what "this product" means
  const pm = /^\/product\/([a-z0-9-]+)/.exec(page);
  const slug = PRODUCT_NAME[String(state.show || '')] ? String(state.show) : (pm && PRODUCT_NAME[pm[1]] ? pm[1] : '');
  const show = slug ? PRODUCT_NAME[slug] : '';
  // a certificate open in front of them ("design:2:8" = page 2 of 8): what
  // "scroll down", "next page" and "close it" are about
  const cm = /^([a-z]+):(\d{1,3}):(\d{1,3})$/.exec(String(state.cert || ''));
  const cert = cm && CERT_NAME[cm[1]] ? '; OPEN ON SCREEN: the ' + CERT_NAME[cm[1]] + ', page ' + cm[2] + ' of ' + cm[3] +
               ' ("scroll" moves inside it, "close" closes it)' : '';
  return '\n(Their situation, for your information only — not their question: page ' + page +
         (show ? '; looking at: the ' + show + ' (' + ON_SCREEN[slug] + ')' : '') + cert +
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
  for (const [re, owners] of SCRIPT_LANGS) {
    if (!re.test(s)) continue;
    if (owners[0] === 'hi') return devanagariLang(s, detected);
    return owners.indexOf(detected) !== -1 ? detected : owners[0];
  }
  return detected;
}
/* Hindi or Marathi? The detector's guess is not to be trusted on a short or
   code-mixed line: on 11 Oct 2026 "क्या कैसे कर दे रहे हो guarantee?" and
   "अपना website खोलते ही" came back as Marathi, and a Hindi speaker was
   answered in Marathi twice. The words settle it — each language's everyday
   grammar words, none the other uses in the same sense (no तो / ही / का,
   which both do). Nepali and Sanskrit guesses on these lines are the same
   mistake. Keep in step with the widget's devanagariLang(). */
const HINDI_WORDS = new Set(('है हैं हूँ हूं था थी थे नहीं क्या क्यों कैसे कैसा कैसी कहाँ कहां कब कितना कितने कितनी ' +
  'आप आपका आपकी आपके आपको आपने मुझे मेरा मेरी मेरे मैं हम हमें हमारा तुम यह ये वह वो इस उस इसको इसका इसमें ' +
  'को की के में से पर और भी कर करो करें करना करेंगे दीजिए बताओ बताइए बताइये चाहिए अपना अपनी अपने ' +
  'रहे रहा रही गया गई सकते सकता सकती वाला लिए अगर लेकिन मतलब ठीक हाँ हां').split(' '));
const MARATHI_WORDS = new Set(('आहे आहेत नाही नाहीत काय मला तुला तुम्ही तुम्हाला तुमच्या तुमचा तुमची आम्ही आम्हाला ' +
  'आमच्या आमचा आमची माझा माझी माझे माझ्या कसा कशी कसे केले करा करायचे करायला पाहिजे सांगा द्या घ्या ' +
  'झाले झाला आणि पण किंवा म्हणजे मध्ये साठी हवे हवा हवी कुठे किती').split(' '));
function devanagariLang(text, detected) {
  let hi = 0, mr = 0;
  for (const w of String(text || '').split(/[^\p{L}\p{M}]+/u)) {
    if (HINDI_WORDS.has(w)) hi++;
    else if (MARATHI_WORDS.has(w) || /च्या$/.test(w)) mr++;
  }
  if (detected === 'hi') return mr >= 2 && mr > hi ? 'mr' : 'hi';
  if (detected === 'mr') return hi > mr ? 'hi' : 'mr';
  return mr > hi ? 'mr' : 'hi';                    // ne / sa / anything else on Devanagari
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
    // the act where it belongs, or where the model dropped it: inside "ask"
    // or "reply" as {"do":"add",…}, or as a bare "do:add,product:…" string
    const act = safeAct(obj.act) || safeAct(pullAct(obj.act)) || safeAct(pullAct(obj.ask)) || safeAct(pullAct(obj.reply));
    return { reply: cleanReply(obj.reply), ask: cleanAsk(obj.ask), go: safeGo(obj.go), act: act };
  }
  return { reply: cleanReply(raw.replace(/[{}"]/g, '')), ask: '', go: null, act: null };   // last resort: speak the text
}
/* "क्या इसे आपकी कर्ट में डालूँ? do:add,product:tap-filter,qty:1" was READ
   ALOUD on 11 Oct 2026: the model wrote the act into the "ask" text, the
   braces were stripped, and nothing was added or opened while she said she
   was showing it. -> the act object found in a string, or null */
function pullAct(s) {
  if (typeof s !== 'string' || !/\bdo\b"?\s*:/.test(s)) return null;
  const m = /\{[^{}]*\}/.exec(s);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  const o = {};
  String(m ? m[0] : s).replace(/"?\b(do|product|qty|code|q|order|dir|which)\b"?\s*:\s*"?([\w-]+)"?/gi, (_, k, v) => { o[k.toLowerCase()] = v; });
  return o.do ? o : null;
}
// what is left of a spoken line once an act written into it is cut off
const ACT_RESIDUE = /\s*(?:\{[\s\S]*$|"?\b(?:do|product|qty)\b"?\s*:[\s\S]*$)/i;
/* Her next question, asked for in a field of its own: as a rule in the
   prompt ("end every reply with a question") Llama kept it on 4-7 turns of 16;
   a JSON field it has to fill, it fills. Joined onto the reply here, unless the
   reply already ends in a question ([silence] turns are one). */
function cleanAsk(s) {
  s = (typeof s === 'string' ? s : '').replace(ACT_RESIDUE, '').replace(CJK, '').replace(/[{}"]+/g, '').replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(s) ? s.slice(0, 120) : '';
}
/* "Shall I open the Shower Head Filter for you?" — over the page already
   opening; "shall I show them?" over the certificates already shown (11 Oct
   2026, the "ask" examples notwithstanding). The question moves one step on,
   in the languages with a line for it. */
const NEXT_ASK = {
  product: { en: 'Shall I add it to your cart?', hi: 'क्या मैं इसे आपके कार्ट में डाल दूँ?', te: 'దీన్ని మీ కార్ట్‌లో పెట్టనా?' },
  certs: { en: 'Which one shall I open?', hi: 'इनमें से कौन सा खोलकर दिखाऊँ?', te: 'వీటిలో ఏది తెరిచి చూపించనా?' }
};
const ASKS_TO_SHOW = /\b(open|show|see)\b|खोल|दिखा|देखना|తెర|చూపి|చూడ/i;
function nextAsk(ask, go, act, lang) {
  if (!ask || !ASKS_TO_SHOW.test(ask)) return ask;
  const pm = /^\/product\/([a-z0-9-]+)$/.exec(go || '');
  if (pm && !OUT(pm[1]) && NEXT_ASK.product[lang]) return NEXT_ASK.product[lang];
  if (act && act.do === 'certs' && NEXT_ASK.certs[lang]) return NEXT_ASK.certs[lang];
  return ask;
}
/* The same close, again and again: "shall I add the Tap Filter to your
   cart?" ended 12 replies running in the 11 Oct replay while the customer
   argued about refunds — pushy, and the wrong step for a doubter. Telling the
   model so beside the question cost facts (it began stretching claims), so it
   is settled here instead: a question she asked in her last two lines gives
   way to the next sales step she has not offered lately — unless what the
   customer just said is about that very thing ("how do I get the kit?" is
   answered by offering the kit again). "Shall I take you to the login page?",
   which the model invents as a step, goes the same way unless they are buying. */
const NEXT_STEPS = [
  { when: (st) => cartHas(st, null), say: { en: 'Shall I take you to checkout?', hi: 'चेकआउट पर ले चलूँ?', te: 'చెక్‌అవుట్‌కి తీసుకెళ్ళనా?' } },
  { when: (st) => !cartHas(st, 'demo-kit'), say: { en: 'Shall I add the free Demo Kit to your cart, so you can test your water at home?', hi: 'क्या मैं फ्री डेमो किट आपके कार्ट में डाल दूँ, ताकि आप घर पर पानी टेस्ट कर सकें?', te: 'ఇంట్లో నీటిని టెస్ట్ చేయడానికి ఫ్రీ డెమో కిట్ మీ కార్ట్‌లో పెట్టనా?' } },
  { when: () => true, say: { en: 'Shall I show you our lab certificates?', hi: 'क्या मैं आपको हमारे लैब सर्टिफिकेट दिखाऊँ?', te: 'మా ల్యాబ్ సర్టిఫికెట్లు చూపించనా?' } },
  { when: () => true, say: { en: 'Is it for an independent house or an apartment?', hi: 'यह independent house के लिए है या apartment के लिए?', te: 'ఇది ఇండిపెండెంట్ హౌస్ కోసమా, అపార్ట్‌మెంట్ కోసమా?' } }
];
function cartHas(st, slug) {
  const c = (st && Array.isArray(st.cart)) ? st.cart : [];
  return slug ? c.some((i) => i && (i.p || i.product || i.slug) === slug) : c.length > 0;
}
function qWords(s) { return new Set(String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 1)); }
// the same question, not merely the same "shall I put it in your cart" frame
function alike(a, b) {
  const A = qWords(a), B = qWords(b);
  if (!A.size || !B.size) return false;
  let both = 0; A.forEach((w) => { if (B.has(w)) both++; });
  return both / (A.size + B.size - both) >= 0.5;
}
const ASK_TOPICS = [/demo|\bkit\b|डेमो|किट|డెమో|కిట్/i, /order|buy|cart|ऑर्डर|खरीद|कार्ट|मंगा|ఆర్డర్|కార్ట్|కొన/i,
                    /certif|सर्टिफिकेट|प्रमाण|సర్టిఫికెట్/i, /check\s*out|चेकआउट|చెక్/i];
const LOGIN_ASK = /log\s*-?\s*in|sign\s*-?\s*in|लॉग\s*-?\s*इन|लॉगिन|साइन\s*-?\s*इन|లాగిన్|సైన్\s*ఇన్/i;
function freshAsk(ask, message, history, state, lang) {
  if (!ask || !NEXT_STEPS[0].say[lang]) return ask;
  const mine = (Array.isArray(history) ? history : []).filter((h) => h && h.role === 'assistant').map((h) => String(h.text || ''));
  const endQ = (t) => t.split(/(?<=[.!।])\s+/).pop();
  const askedIn = (q, n) => mine.slice(-n).some((t) => alike(q, endQ(t)));
  const onTopic = ASK_TOPICS.some((re) => re.test(ask) && re.test(String(message || '')));
  const repeated = askedIn(ask, 2) && !onTopic;
  const loginStep = LOGIN_ASK.test(ask) && !signInWanted(message, history);
  if (!repeated && !loginStep) return ask;
  const step = NEXT_STEPS.find((s) => s.when(state) && !askedIn(s.say[lang], 3));
  return step ? step.say[lang] : ask;
}
function withAsk(reply, ask) {
  if (!ask || /[?？؟]\s*$/.test(reply)) return reply;
  // the two together stay one breath of listening: the answer gives way, at
  // a sentence end, so the question always survives
  if (reply.length + ask.length > MAX_SPOKEN + 40) reply = trimForSpeech(reply, Math.max(60, MAX_SPOKEN + 40 - ask.length));
  reply = reply.replace(/[\s,;:–—-]+$/, '');
  // the voice pauses at a full stop: "खोल रही हूँ क्या आपको…" ran on as one breath
  if (!/[.!।॥]$/.test(reply)) reply += /[ऀ-ॿ]/.test(reply) ? '।' : '.';
  return reply + ' ' + ask;
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
  s = s.split(/\s*["']?\b(?:reply|go|ask|act)\b["']?\s*[:：]/i)[0].trim();   // cut at a leaked key
  s = s.replace(ACT_RESIDUE, '').trim();                                     // ...or a leaked act
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
function trimForSpeech(s, max) {
  max = max || MAX_SPOKEN;
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  // '।' is the Devanagari full stop, used in Hindi/Marathi replies
  const end = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'),
                       cut.lastIndexOf('!'), cut.lastIndexOf('।'));
  if (end > max * 0.4) return cut.slice(0, end + 1).trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, max)).trim();
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
    // The widget heard nobody for a few seconds after her line (js/voice-
    // assistant.js nudge()): a salesperson does not stand there in silence.
    if (message === SILENCE) said = SILENCE + ' (they have said nothing for a few seconds: bring them back by offering the next concrete step — "Shall I add the Tap Filter to your cart?", "Shall I show you the certificates?", "Is it for a house or an apartment?" — never "any other questions?", never the question you just asked)';
    messages.push({
      role: 'user',
      content: 'Answer in ' + LANG_NAME[lang] + ' only, using ' + LANG_NAME[lang] +
               ' script. Customer says: ' + said + soldOutNote(message, state) + kitNote(message, history) +
               (ASKED_REFUND.test(message) ? REFUND_NOTE : '') + describeState(state)
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
    if (out.act && out.act.do === 'login' && !signInWanted(message, history)) {
      // A sign-in nobody asked for: the act goes, and so does the sentence
      // asking for it — only that sentence. Swapping the WHOLE reply for
      // "sorry, say that again" while its "go" still opened a page made her
      // words and the screen disagree: the customer living in an apartment
      // heard "say that again" as the Water Softener page opened (11 Oct 2026).
      out.act = null;
      out.reply = dropSignInTalk(out.reply);
      if (SIGN_IN_TALK.test(out.ask)) out.ask = '';
    }
    if (!out.reply && out.ask) { out.reply = out.ask; out.ask = ''; }   // a [silence] turn can be all question
    let misfire = false;
    if (!out.reply) { out.reply = (ASK_AGAIN[lang] || ASK_AGAIN.en); misfire = true; }
    else out.reply = stripUnsolicitedStats(out.reply, message);   // seconds they never asked to wait
    if (asked) out.reply = dropLanguagePromise(out.reply, asked);   // "I will explain in Telugu, …" -> the explanation
    if (out.act && /^(add|kit|checkout)$/.test(out.act.do) && !cartWanted(message, history)) out.act = null;   // offered, not done
    // "हाँ" to her own "shall I take you to checkout?" came back as "taking you
    // to checkout" with nothing done (11 Oct 2026). Checkout needs no product
    // to guess, so a yes to that offer is the act.
    if (!out.act && YES_RE.test(message) && CHECKOUT_OFFER.test(lastAssistant(history))) out.act = { do: 'checkout' };
    // "Say that again" never comes with a page change or an act: she did not
    // understand, so nothing on the screen may move either.
    if (misfire) { out.go = null; out.act = null; }
    else matchScreenToWords(out, state);
    // Scrolling or closing the certificate in front of them never changes the
    // page as well: "अगला पेज" with a certificate open came back with go
    // /about (11 Oct 2026) — "next page" read as "another page".
    if (out.act && (out.act.do === 'scroll' || out.act.do === 'close') && state && state.cert) out.go = null;
    // ...and the acts that show something choose their own page (the widget
    // opens / or /collection when what they show is not on this one)
    if (out.act && /^(cert|certs|showkit|kit)$/.test(out.act.do)) out.go = null;
    if (!misfire) {
      // her question, wherever she put it: at the end of "reply" instead of
      // in "ask", it slipped past the repeat and sign-in checks
      let body = out.reply, ask = out.ask;
      if (/[?？؟]\s*$/.test(body)) {
        const tq = /^([\s\S]*?[.!।])\s+([^.!?।]+[?？؟])\s*$/.exec(body);
        if (tq) { body = tq[1]; ask = tq[2]; } else { ask = body; body = ''; }
      }
      ask = freshAsk(nextAsk(ask, out.go, out.act, lang), message, history, state, lang);
      out.reply = body ? withAsk(body, ask) : (ask || out.reply);
    }
    out.reply = noPurifying(out.reply);
    if (lang === 'hi') out.reply = feminineHindi(out.reply);
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

// One JSON-answering model call with this assistant's model — for the admin's
// transcript review (server/voicelog.js), which brings its own messages.
function completeWith(opts) {
  if (!ENABLED || !client) return Promise.reject(new Error('ai_disabled'));
  const o = Object.assign({ model: MODEL }, opts);
  if (IS_OPENROUTER) o.provider = { sort: 'throughput' };
  return completeJson(o);
}

module.exports = { handle, handleAddress, health, answer, extractAddress, askedLanguage, langOfScript, completeWith, ENABLED, MODEL };
