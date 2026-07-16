/* ============================================================================
   D'Cal Voice Assistant  —  "D'Cal Saathi"
   A microphone-based AI voice helper for EVERY page.
   Built for customers who cannot read: they tap the mic, ASK a question by
   voice (Telugu / Hindi / English) and hear the answer in a FEMALE voice.
   It can also NAVIGATE the site by voice ("take me to products", "open cart").

   Uses only the browser's free Web Speech API — no server, no API key, no cost:
     - window.SpeechRecognition / webkitSpeechRecognition  (listen)
     - window.speechSynthesis                              (female voice reply)

   Loaded on every page via  <script defer src="/js/voice-assistant.js"></script>
   Self-contained: injects its own CSS + DOM, so no other file needs changing.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__dcalVoiceLoaded) return;          // guard against double-load
  window.__dcalVoiceLoaded = true;

  /* ------------------------------------------------------------------ *
   *  1. LANGUAGES                                                       *
   * ------------------------------------------------------------------ */
  var LANGS = {
    te: { code: 'te-IN', label: 'తెలుగు',  short: 'తెలుగు' },
    hi: { code: 'hi-IN', label: 'हिंदी',    short: 'हिंदी'  },
    en: { code: 'en-IN', label: 'English',  short: 'EN'    }
  };
  // remembered choice, default Telugu (primary local language for Hyderabad/Telangana)
  var lang = localStorage.getItem('dcal_voice_lang') || 'te';
  if (!LANGS[lang]) lang = 'te';

  /* ------------------------------------------------------------------ *
   *  2. UI STRINGS  (per language)                                     *
   * ------------------------------------------------------------------ */
  var UI = {
    te: {
      title: 'డీకాల్ సహాయకురాలు',
      tagline: 'మైక్ నొక్కి మాట్లాడండి',
      listening: 'వింటున్నాను…',
      tapToSpeak: 'మాట్లాడటానికి మైక్ నొక్కండి',
      thinking: 'ఆలోచిస్తున్నాను…',
      greeting: 'నమస్తే! డిక్యాల్ కు స్వాగతము! నేను మీ వాయిస్ సహాయకు రాలిని. కొన డానికి, ధరలు, ఆర్డర్ ట్రాక్, లేదా ఏదైనా అడ గండి — మై కు నొ క్కి మాట్లాడండి.',
      noMic: 'క్షమించండి, మీ బ్రౌజర్‌లో మైక్ పని చేయడం లేదు. దయచేసి కింద ఉన్న బటన్లను నొక్కండి, లేదా Chrome ఉపయోగించండి.',
      micDenied: 'మైక్ అనుమతి ఇవ్వలేదు. దయచేసి మైక్ అనుమతి ఇవ్వండి లేదా కింద బటన్లను నొక్కండి.',
      quick: 'త్వరిత సహాయం',
      chips: [
        ['ఎలా కొనాలి?',      'how to buy'],
        ['ధరలు',            'price'],
        ['ఆర్డర్ ట్రాక్',    'track order'],
        ['మాతో మాట్లాడండి',  'contact']
      ]
    },
    hi: {
      title: 'डीकाल सहायक',
      tagline: 'माइक दबाकर बोलें',
      listening: 'सुन रही हूँ…',
      tapToSpeak: 'बोलने के लिए माइक दबाएँ',
      thinking: 'सोच रही हूँ…',
      greeting: 'नमस्ते! डीकाल में आपका स्वागत है! मैं आपकी वॉइस सहायक हूँ। खरीदना, दाम, ऑर्डर ट्रैक, या कुछ भी पूछें — माइक दबाकर बोलें।',
      noMic: 'माफ़ कीजिए, आपके ब्राउज़र में माइक काम नहीं कर रहा। कृपया नीचे दिए बटन दबाएँ, या Chrome इस्तेमाल करें।',
      micDenied: 'माइक की अनुमति नहीं मिली। कृपया माइक की अनुमति दें या नीचे बटन दबाएँ।',
      quick: 'तुरंत मदद',
      chips: [
        ['कैसे खरीदें?',     'how to buy'],
        ['दाम',            'price'],
        ['ऑर्डर ट्रैक',     'track order'],
        ['हमसे बात करें',   'contact']
      ]
    },
    en: {
      title: "D'Cal Assistant",
      tagline: 'Tap the mic and speak',
      listening: 'Listening…',
      tapToSpeak: 'Tap the mic to speak',
      thinking: 'Thinking…',
      greeting: "Hi! Welcome to D'Cal! I am your voice assistant. Ask me how to buy, prices, track your order, or anything about our products — just tap the mic and speak.",
      noMic: 'Sorry, the microphone is not working in your browser. Please tap the buttons below, or use Chrome.',
      micDenied: 'Microphone permission was blocked. Please allow the mic, or tap the buttons below.',
      quick: 'Quick help',
      chips: [
        ['How to buy?',   'how to buy'],
        ['Prices',        'price'],
        ['Track order',   'track order'],
        ['Contact us',    'contact']
      ]
    }
  };

  /* ------------------------------------------------------------------ *
   *  3. KNOWLEDGE BASE  (intents)                                      *
   *     Each intent: keywords per language (native script + romanized) *
   *     + a spoken/typed reply per language + optional navigation.     *
   *     Matched top-to-bottom, so put specific intents before general. *
   * ------------------------------------------------------------------ */
  var PHONE = '+91 86229 09192';
  var PHONE_TEL = '+918622909192';
  var WA = 'https://wa.me/918622909192';

  /* ---- PRODUCT CATALOG (drives per-product voice commands) ---- */
  var PRODUCTS = [
    {
      slug: 'water-softener', price: 4500, rating: 4.9,
      title: { te: 'ఇంటి వాటర్ సాఫ్ట్‌నర్', hi: 'घर का वाटर सॉफ्टनर', en: 'home Water Softener' },
      kw: ['water softener', 'softener', 'whole house', 'independent house', 'house softener', 'soft water', 'hard water machine',
           'వాటర్ సాఫ్ట్‌నర్', 'సాఫ్ట్‌నర్', 'ఇంటి సాఫ్ట్‌నర్', 'మృదు నీరు',
           'वाटर सॉफ्टनर', 'सॉफ्टनर', 'घर सॉफ्टनर', 'नरम पानी']
    },
    {
      slug: 'shower-filter', price: 2700, rating: 4.8,
      title: { te: 'షవర్ హెడ్ ఫిల్టర్', hi: 'शॉवर हेड फ़िल्टर', en: 'Shower Head Filter' },
      kw: ['shower head filter', 'shower filter', 'shower', 'bathing filter', 'bathroom filter', 'bath filter',
           'షవర్ ఫిల్టర్', 'షవర్', 'స్నానం ఫిల్టర్', 'తలస్నానం',
           'शॉवर फ़िल्टर', 'शॉवर', 'शावर', 'नहाने का फ़िल्टर']
    },
    {
      slug: 'tap-filter', price: 2700, rating: 4.8,
      title: { te: 'ట్యాప్ ఫిల్టర్', hi: 'टैप फ़िल्टर', en: 'Tap Filter' },
      kw: ['tap filter', 'faucet filter', 'tap water filter', 'kitchen filter', 'nal filter', 'sink filter',
           'ట్యాప్ ఫిల్టర్', 'కుళాయి ఫిల్టర్', 'నల్లా ఫిల్టర్',
           'नल फ़िल्टर', 'टैप फ़िल्टर', 'किचन फ़िल्टर', 'नल का फ़िल्टर']
    },
    {
      slug: 'washing-ball', price: 500, rating: 4.7,
      title: { te: 'వాషింగ్ మెషిన్ బాల్', hi: 'वॉशिंग मशीन बॉल', en: 'Washing Machine Ball' },
      kw: ['washing ball', 'washing machine ball', 'laundry ball', 'machine ball', 'washing', 'laundry',
           'వాషింగ్ బాల్', 'వాషింగ్ మెషిన్', 'బట్టలు ఉతకడం', 'లాండ్రీ',
           'वॉशिंग बॉल', 'वॉशिंग मशीन', 'कपड़े धोने', 'लॉन्ड्री बॉल']
    },
    {
      slug: 'tap-tile-cleaner', price: 300, rating: 4.6,
      title: { te: 'ట్యాప్ అండ్ టైల్ క్లీనర్', hi: 'टैप और टाइल क्लीनर', en: 'Tap and Tile Cleaner' },
      kw: ['tile cleaner', 'tap and tile', 'tap tile cleaner', 'bathroom cleaner', 'cleaner', 'cleaning liquid', 'descaler',
           'టైల్ క్లీనర్', 'క్లీనర్', 'శుభ్రం చేయడం', 'టైల్స్',
           'टाइल क्लीनर', 'क्लीनर', 'सफाई', 'बाथरूम क्लीनर']
    }
  ];

  // Build one navigation intent per product (open / show / price / buy that item)
  var PRODUCT_INTENTS = PRODUCTS.map(function (p) {
    return {
      id: 'product:' + p.slug,
      kw: p.kw,
      reply: {
        te: p.title.te + ' — రేటింగ్ ' + p.rating + ' స్టార్లు, ధర ' + p.price + ' రూపాయలు. నేను దీన్ని తెరుస్తున్నాను. కొనడానికి "Buy now" నొక్కండి.',
        hi: p.title.hi + ' — रेटिंग ' + p.rating + ' स्टार, दाम ' + p.price + ' रुपये। मैं इसे खोल रही हूँ। खरीदने के लिए "Buy now" दबाएँ।',
        en: 'The ' + p.title.en + ' is rated ' + p.rating + ' stars and costs ' + p.price + ' rupees. I am opening it now. Tap "Buy now" to purchase.'
      },
      go: '/product/' + p.slug, delay: 4600
    };
  });

  var INTENTS = PRODUCT_INTENTS.concat([
    /* ---- HOW TO BUY / PURCHASE ---- */
    {
      id: 'buy',
      kw: {
        te: ['ఎలా కొనాలి', 'కొనడం', 'కొనాలి', 'కొను', 'ఆర్డర్ చేయ', 'ఆర్డర్ ఎలా', 'buy', 'kondam', 'kanugolu', 'purchase'],
        hi: ['कैसे खरीद', 'खरीदना', 'खरीद', 'मंगाना', 'ऑर्डर कैसे', 'ऑर्डर करना', 'buy', 'kaise kharid', 'kharidna', 'purchase', 'order kaise'],
        en: ['how to buy', 'how do i buy', 'buy', 'purchase', 'how to order', 'place order', 'order it', 'checkout']
      },
      reply: {
        te: 'కొనడం చాలా సులభం. నేను ఉత్పత్తుల పేజీ తెరుస్తున్నాను. మీకు నచ్చిన వస్తువును నొక్కండి, తరువాత "Buy now" నొక్కండి, మీ చిరునామా, మొబైల్ నంబర్ ఇచ్చి, చెల్లించండి. సహాయం కావాలంటే ' + PHONE + ' కు కాల్ చేయండి.',
        hi: 'खरीदना बहुत आसान है। मैं उत्पाद पेज खोल रही हूँ। जो चीज़ पसंद हो उस पर दबाएँ, फिर "Buy now" दबाएँ, अपना पता और मोबाइल नंबर भरें और भुगतान करें। मदद चाहिए तो ' + PHONE + ' पर कॉल करें।',
        en: 'Buying is easy. I am opening the products page now. Tap the item you like, then tap "Buy now", enter your address and mobile number, and pay. If you need help, call ' + PHONE + '.'
      },
      go: '/collection', delay: 4200
    },

    /* ---- PRICES ---- */
    {
      id: 'price',
      kw: {
        te: ['ధర', 'ధరలు', 'ఖరీదు', 'రేటు', 'ఎంత', 'price', 'dara', 'rate', 'entha'],
        hi: ['दाम', 'कीमत', 'रेट', 'भाव', 'कितने का', 'कितना', 'price', 'daam', 'keemat', 'rate', 'kitne'],
        en: ['price', 'cost', 'how much', 'rate', 'rates', 'prices']
      },
      reply: {
        te: 'మా ధరలు: ఇంటి వాటర్ సాఫ్ట్‌నర్ ₹4500. షవర్ ఫిల్టర్ మరియు ట్యాప్ ఫిల్టర్ ఒక్కొక్కటి ₹2700. వాషింగ్ మెషిన్ బాల్ ₹500. ట్యాప్ అండ్ టైల్ క్లీనర్ ₹300. అన్నీ చూడటానికి పేజీ తెరుస్తున్నాను.',
        hi: 'हमारे दाम: घर का वाटर सॉफ्टनर ₹4500। शॉवर फ़िल्टर और टैप फ़िल्टर हर एक ₹2700। वॉशिंग मशीन बॉल ₹500। टैप और टाइल क्लीनर ₹300। सब देखने के लिए पेज खोल रही हूँ।',
        en: 'Our prices: the home Water Softener is ₹4500. The Shower Filter and Tap Filter are ₹2700 each. The Washing Machine Ball is ₹500. The Tap and Tile Cleaner is ₹300. I am opening the page so you can see all of them.'
      },
      go: '/collection', delay: 6500
    },

    /* ---- TRACK ORDER ---- */
    {
      id: 'track',
      kw: {
        te: ['ట్రాక్', 'ఆర్డర్ ఎక్కడ', 'నా ఆర్డర్', 'ఆర్డర్ స్థితి', 'ఎక్కడ ఉంది', 'track', 'order ekkada', 'delivery ekkada'],
        hi: ['ट्रैक', 'ऑर्डर कहाँ', 'मेरा ऑर्डर', 'ऑर्डर की स्थिति', 'सामान कहाँ', 'कहाँ पहुँचा', 'track', 'order kahan', 'status'],
        en: ['track', 'track order', 'where is my order', 'order status', 'my order', 'my parcel', 'delivery status']
      },
      reply: {
        te: 'మీ ఆర్డర్ ఎక్కడ ఉందో చూద్దాం. నేను ట్రాక్ ఆర్డర్ పేజీ తెరుస్తున్నాను. అక్కడ మీ ఆర్డర్ నంబర్ లేదా మొబైల్ నంబర్ ఇవ్వండి.',
        hi: 'चलिए देखते हैं आपका ऑर्डर कहाँ है। मैं ट्रैक ऑर्डर पेज खोल रही हूँ। वहाँ अपना ऑर्डर नंबर या मोबाइल नंबर डालें।',
        en: 'Let us find your order. I am opening the track order page. Enter your order number or mobile number there.'
      },
      go: '/track-order', delay: 3600
    },

    /* ---- CONTACT / CALL / WHATSAPP ---- */
    {
      id: 'contact',
      kw: {
        te: ['సంప్రదించ', 'కాల్', 'ఫోన్', 'నంబర్', 'వాట్సాప్', 'మాట్లాడ', 'contact', 'call', 'phone', 'number', 'whatsapp', 'matlada'],
        hi: ['संपर्क', 'कॉल', 'फोन', 'नंबर', 'व्हाट्सएप', 'बात', 'contact', 'call', 'phone', 'number', 'whatsapp'],
        en: ['contact', 'call', 'phone', 'number', 'whatsapp', 'talk to', 'customer care', 'support', 'help line', 'helpline']
      },
      reply: {
        te: 'మీరు మాతో నేరుగా మాట్లాడవచ్చు. ఫోన్ మరియు వాట్సాప్ నంబర్: ' + PHONE + '. నేను ఇప్పుడు వాట్సాప్ తెరుస్తున్నాను.',
        hi: 'आप हमसे सीधे बात कर सकते हैं। फोन और व्हाट्सएप नंबर: ' + PHONE + '। मैं अभी व्हाट्सएप खोल रही हूँ।',
        en: 'You can talk to us directly. Our phone and WhatsApp number is ' + PHONE + '. I am opening WhatsApp for you now.'
      },
      go: WA, delay: 4200, external: true
    },

    /* ---- CART ---- */
    {
      id: 'cart',
      kw: {
        te: ['కార్ట్', 'బండి', 'బుట్ట', 'cart', 'basket', 'bandi'],
        hi: ['कार्ट', 'टोकरी', 'बैग', 'cart', 'basket'],
        en: ['cart', 'my cart', 'basket', 'bag', 'shopping cart']
      },
      reply: {
        te: 'నేను మీ కార్ట్ తెరుస్తున్నాను. అక్కడ మీరు ఎంచుకున్న వస్తువులు కనిపిస్తాయి. కొనడానికి "Checkout" నొక్కండి.',
        hi: 'मैं आपका कार्ट खोल रही हूँ। वहाँ आपके चुने हुए सामान दिखेंगे। खरीदने के लिए "Checkout" दबाएँ।',
        en: 'I am opening your cart. You will see the items you chose there. Tap "Checkout" to buy.'
      },
      go: '/cart', delay: 3600
    },

    /* ---- PRODUCTS / WHAT DO YOU SELL ---- */
    {
      id: 'products',
      kw: {
        te: ['ఉత్పత్తులు', 'వస్తువులు', 'ఏం అమ్ముతారు', 'ఏమి అమ్ముతారు', 'ప్రొడక్ట్', 'products', 'items', 'saman', 'chupinchu'],
        hi: ['उत्पाद', 'सामान', 'क्या बेचते', 'प्रोडक्ट', 'दिखाओ', 'products', 'items', 'kya bechte'],
        en: ['products', 'what do you sell', 'items', 'show me', 'catalogue', 'catalog', 'collection', 'what do you have']
      },
      reply: {
        te: 'మేము గట్టి నీటి సమస్యలకు పరిష్కారాలు అమ్ముతాము: ఇంటి వాటర్ సాఫ్ట్‌నర్, షవర్ ఫిల్టర్, ట్యాప్ ఫిల్టర్, వాషింగ్ మెషిన్ బాల్, మరియు ట్యాప్ అండ్ టైల్ క్లీనర్. అన్నీ చూపిస్తున్నాను.',
        hi: 'हम कठोर पानी की समस्या के समाधान बेचते हैं: घर का वाटर सॉफ्टनर, शॉवर फ़िल्टर, टैप फ़िल्टर, वॉशिंग मशीन बॉल, और टैप एवं टाइल क्लीनर। सब दिखा रही हूँ।',
        en: 'We sell solutions for hard water problems: a home Water Softener, Shower Filter, Tap Filter, Washing Machine Ball, and a Tap and Tile Cleaner. I am showing you all of them.'
      },
      go: '/collection', delay: 5200
    },

    /* ---- SHIPPING / DELIVERY ---- */
    {
      id: 'shipping',
      kw: {
        te: ['డెలివరీ', 'షిప్పింగ్', 'ఎన్ని రోజులు', 'ఎప్పుడు వస్తుంది', 'పంపిస్తారా', 'delivery', 'shipping', 'enni rojulu'],
        hi: ['डिलीवरी', 'शिपिंग', 'कितने दिन', 'कब आएगा', 'भेजते', 'delivery', 'shipping', 'kitne din'],
        en: ['delivery', 'shipping', 'how many days', 'when will i get', 'deliver', 'courier']
      },
      reply: {
        te: 'భారతదేశం అంతటా ఉచిత డెలివరీ, కనీస ఆర్డర్ అవసరం లేదు. ఆర్డర్ ఒకటి రెండు రోజుల్లో పంపుతాము, మూడు నుండి ఏడు రోజుల్లో మీ ఇంటికి వస్తుంది. పంపిన తర్వాత ట్రాకింగ్ వివరాలు వస్తాయి.',
        hi: 'पूरे भारत में मुफ्त डिलीवरी, कोई न्यूनतम ऑर्डर नहीं। ऑर्डर एक-दो दिन में भेजते हैं, तीन से सात दिन में आपके घर आ जाता है। भेजने के बाद ट्रैकिंग जानकारी मिलती है।',
        en: 'Free delivery all over India, no minimum order. We dispatch in one to two days and it reaches your home in three to seven days. You get tracking details once it ships.'
      },
      go: '/shipping-returns', delay: 6500
    },

    /* ---- RETURNS / REFUND ---- */
    {
      id: 'returns',
      kw: {
        te: ['రిటర్న్', 'తిరిగి', 'వాపసు', 'రీఫండ్', 'డబ్బు వెనక్కి', 'return', 'refund', 'wapasu'],
        hi: ['रिटर्न', 'वापसी', 'वापस', 'रिफंड', 'पैसे वापस', 'return', 'refund'],
        en: ['return', 'refund', 'money back', 'send back', 'replace', 'replacement']
      },
      reply: {
        te: 'రిటర్న్ మరియు రీఫండ్ వివరాల కోసం నేను పేజీ తెరుస్తున్నాను. ఏదైనా సమస్య ఉంటే ' + PHONE + ' కు కాల్ చేయండి, మేము సహాయం చేస్తాము.',
        hi: 'रिटर्न और रिफंड की जानकारी के लिए मैं पेज खोल रही हूँ। कोई दिक्कत हो तो ' + PHONE + ' पर कॉल करें, हम मदद करेंगे।',
        en: 'I am opening the page for return and refund details. If there is any problem, call ' + PHONE + ' and we will help you.'
      },
      go: '/shipping-returns', delay: 4600
    },

    /* ---- HOME ---- */
    {
      id: 'home',
      kw: {
        te: ['హోమ్', 'మొదటి పేజీ', 'హోమ్ పేజీ', 'మెయిన్', 'home', 'modati'],
        hi: ['होम', 'मुख्य पेज', 'पहला पेज', 'होम पेज', 'home', 'mukhya'],
        en: ['home', 'home page', 'main page', 'start', 'front page', 'go back home']
      },
      reply: {
        te: 'హోమ్ పేజీకి తీసుకువెళ్తున్నాను.',
        hi: 'होम पेज पर ले जा रही हूँ।',
        en: 'Taking you to the home page.'
      },
      go: '/', delay: 2200
    },

    /* ---- WHAT IS DCAL / ABOUT / WATER SOFTENER ---- */
    {
      id: 'about',
      kw: {
        te: ['డీకాల్ అంటే', 'ఏమిటి', 'వాటర్ సాఫ్ట్‌నర్ అంటే', 'గట్టి నీరు', 'కఠిన నీరు', 'about', 'dcal ante', 'hard water'],
        hi: ['डीकाल क्या', 'क्या है', 'वाटर सॉफ्टनर क्या', 'कठोर पानी', 'खारा पानी', 'about', 'kya hai', 'hard water'],
        en: ['what is dcal', 'about', 'what is water softener', 'hard water', 'about you', 'who are you', 'what is this']
      },
      reply: {
        te: 'డీకాల్ గట్టి నీటి సమస్యలను పరిష్కరిస్తుంది. గట్టి నీరు చర్మం, జుట్టు, పంపులు మరియు వాషింగ్ మెషిన్‌లను పాడు చేస్తుంది. మా ఫిల్టర్లు మరియు సాఫ్ట్‌నర్ నీటిని మృదువుగా చేస్తాయి. మరింత తెలుసుకోవాలంటే ఉత్పత్తులు చూడండి.',
        hi: 'डीकाल कठोर पानी की समस्या हल करता है। कठोर पानी त्वचा, बाल, नल और वॉशिंग मशीन को खराब करता है। हमारे फ़िल्टर और सॉफ्टनर पानी को मुलायम बनाते हैं। और जानने के लिए उत्पाद देखें।',
        en: "D'Cal solves hard water problems. Hard water damages your skin, hair, taps and washing machine. Our filters and softener make the water soft. See our products to learn more."
      },
      go: '/collection', delay: 6000
    },

    /* ---- PAYMENT ---- */
    {
      id: 'payment',
      kw: {
        te: ['చెల్లింపు', 'పేమెంట్', 'డబ్బు ఎలా', 'యూపీఐ', 'ఫోన్ పే', 'గూగుల్ పే', 'కాష్', 'payment', 'upi', 'chellimpu'],
        hi: ['भुगतान', 'पेमेंट', 'पैसे कैसे', 'यूपीआई', 'फोन पे', 'गूगल पे', 'कैश', 'payment', 'upi', 'bhugtan'],
        en: ['payment', 'pay', 'how to pay', 'upi', 'phonepe', 'google pay', 'cash', 'card', 'cod', 'cash on delivery']
      },
      reply: {
        te: 'మీరు యూపీఐ, ఫోన్ పే, గూగుల్ పే, కార్డు లేదా నెట్ బ్యాంకింగ్ ద్వారా సురక్షితంగా చెల్లించవచ్చు. చెక్అవుట్ సమయంలో మీకు నచ్చిన పద్ధతిని ఎంచుకోండి.',
        hi: 'आप यूपीआई, फोन पे, गूगल पे, कार्ड या नेट बैंकिंग से सुरक्षित भुगतान कर सकते हैं। चेकआउट के समय अपनी पसंद का तरीका चुनें।',
        en: 'You can pay safely by UPI, PhonePe, Google Pay, card or net banking. Choose your preferred method at checkout.'
      }
    },

    /* ---- CASH ON DELIVERY ---- */
    {
      id: 'cod',
      kw: {
        te: ['క్యాష్ ఆన్ డెలివరీ', 'డెలివరీ సమయంలో డబ్బు', 'చేతికి వచ్చాక', 'సీఓడీ', 'cod', 'cash on delivery'],
        hi: ['कैश ऑन डिलीवरी', 'सामान मिलने पर पैसे', 'हाथ में आने पर', 'सीओडी', 'cod', 'cash on delivery'],
        en: ['cash on delivery', 'cod', 'pay on delivery', 'pay when i get', 'pay at door']
      },
      reply: {
        te: 'అవును, క్యాష్ ఆన్ డెలివరీ అందుబాటులో ఉంది — వస్తువు మీ ఇంటికి వచ్చాక డబ్బు చెల్లించవచ్చు. యూపీఐ, కార్డు, నెట్ బ్యాంకింగ్ కూడా ఉన్నాయి. చెక్అవుట్‌లో మీకు నచ్చినది ఎంచుకోండి.',
        hi: 'हाँ, कैश ऑन डिलीवरी उपलब्ध है — सामान घर आने पर पैसे दे सकते हैं। यूपीआई, कार्ड, नेट बैंकिंग भी हैं। चेकआउट पर अपनी पसंद चुनें।',
        en: 'Yes, Cash on Delivery is available — you can pay when the item reaches your home. UPI, card and net banking also work. Choose your option at checkout.'
      }
    },

    /* ---- WARRANTY / GUARANTEE ---- */
    {
      id: 'warranty',
      kw: {
        te: ['వారంటీ', 'గ్యారంటీ', 'హామీ', 'ఎన్ని సంవత్సరాలు', 'warranty', 'guarantee'],
        hi: ['वारंटी', 'गारंटी', 'कितने साल', 'guarantee', 'warranty'],
        en: ['warranty', 'guarantee', 'how many years', 'warranty period']
      },
      reply: {
        te: 'మా ఉత్పత్తులు నాణ్యమైనవి మరియు మన్నికైనవి. వారంటీ వివరాల కోసం ' + PHONE + ' కు కాల్ చేయండి లేదా వాట్సాప్ చేయండి.',
        hi: 'हमारे उत्पाद अच्छी गुणवत्ता और टिकाऊ हैं। वारंटी की जानकारी के लिए ' + PHONE + ' पर कॉल या व्हाट्सएप करें।',
        en: 'Our products are high quality and long lasting. For warranty details, please call or WhatsApp ' + PHONE + '.'
      }
    },

    /* ---- INSTALLATION / FITTING ---- */
    {
      id: 'installation',
      kw: {
        te: ['ఇన్‌స్టాల్', 'అమర్చడం', 'బిగించడం', 'ఫిట్టింగ్', 'ఎలా పెట్టాలి', 'install', 'fitting', 'setup'],
        hi: ['इंस्टॉल', 'लगाना', 'फिटिंग', 'कैसे लगाएं', 'install', 'fitting', 'setup'],
        en: ['install', 'installation', 'fitting', 'how to fit', 'set up', 'setup', 'fix it']
      },
      reply: {
        te: 'ఇది మీ ప్రధాన నీటి లైన్‌కు లేదా ఒక కుళాయికి కనెక్ట్ అవుతుంది. చాలా వరకు లోకల్ ప్లంబర్ త్వరగా అమర్చగలరు, వివరమైన సూచనలు బాక్స్‌లో ఉంటాయి. విద్యుత్తు అవసరం లేదు, నిర్వహణ అవసరం లేదు.',
        hi: 'यह आपकी मुख्य पानी लाइन या किसी एक नल से जुड़ता है। ज़्यादातर लोकल प्लंबर जल्दी लगा देते हैं, विस्तृत निर्देश डिब्बे में होते हैं। न बिजली चाहिए, न रखरखाव।',
        en: 'It connects to your main water line or a single outlet. A local plumber can fit it quickly and detailed instructions are included in the box. No electricity and no maintenance needed.'
      }
    },

    /* ---- OFFERS / DISCOUNT / COUPON ---- */
    {
      id: 'offers',
      kw: {
        te: ['ఆఫర్', 'తగ్గింపు', 'డిస్కౌంట్', 'కూపన్', 'తక్కువ ధర', 'offer', 'discount', 'coupon'],
        hi: ['ऑफर', 'छूट', 'डिस्काउंट', 'कूपन', 'सस्ता', 'offer', 'discount', 'coupon'],
        en: ['offer', 'offers', 'discount', 'coupon', 'deal', 'cheaper', 'sale']
      },
      reply: {
        te: 'మాకు మంచి ఆఫర్లు ఉన్నాయి. హోమ్ పేజీ మరియు ఉత్పత్తులు చూడండి. లేదా ' + PHONE + ' కు కాల్ చేసి అడగండి.',
        hi: 'हमारे पास अच्छे ऑफर हैं। होम पेज और उत्पाद देखें। या ' + PHONE + ' पर कॉल करके पूछें।',
        en: 'We have good offers. Check the home page and products, or call ' + PHONE + ' to ask.'
      },
      go: '/collection', delay: 4600
    },

    /* ---- LOCATION / WHERE ARE YOU ---- */
    {
      id: 'location',
      kw: {
        te: ['ఎక్కడ ఉన్నారు', 'షాప్ ఎక్కడ', 'చిరునామా', 'దుకాణం', 'ఆఫీస్', 'location', 'address', 'shop', 'where'],
        hi: ['कहाँ हैं', 'दुकान कहाँ', 'पता', 'ऑफिस', 'शोरूम', 'location', 'address', 'shop', 'where'],
        en: ['where are you', 'location', 'address', 'shop', 'showroom', 'office', 'store location']
      },
      reply: {
        te: 'మేము హైదరాబాద్, తెలంగాణ నుండి భారతదేశం అంతటా డెలివరీ చేస్తాము. మీరు ఇంటి నుండే ఆన్‌లైన్‌లో ఆర్డర్ చేయవచ్చు. వివరాలకు ' + PHONE + '.',
        hi: 'हम हैदराबाद, तेलंगाना से पूरे भारत में डिलीवरी करते हैं। आप घर बैठे ऑनलाइन ऑर्डर कर सकते हैं। जानकारी के लिए ' + PHONE + '।',
        en: 'We are based in Hyderabad, Telangana and deliver across India. You can order online from home. For details call ' + PHONE + '.'
      }
    },

    /* ---- DEALER / BULK / BUSINESS ---- */
    {
      id: 'dealer',
      kw: {
        te: ['డీలర్', 'హోల్‌సేల్', 'బల్క్', 'వ్యాపారం', 'పార్ట్‌నర్', 'ఏజెన్సీ', 'dealer', 'wholesale', 'bulk', 'business'],
        hi: ['डीलर', 'होलसेल', 'थोक', 'बिज़नेस', 'पार्टनर', 'एजेंसी', 'dealer', 'wholesale', 'bulk', 'business'],
        en: ['dealer', 'dealership', 'wholesale', 'bulk', 'business partner', 'partner', 'distributor', 'agency', 'franchise']
      },
      reply: {
        te: 'డీలర్ అవ్వడానికి 4 సులభమైన దశలు: ఒకటి, మీ పేరు, షాపు వివరాలు ఇవ్వండి. రెండు, మా టీమ్ మీ షాపు, ప్రాంతం చూస్తుంది. మూడు, ధర, మీ లాభం, మీ ప్రాంతం చెప్తాము. నాలుగు, స్టాక్ తీసుకొని అమ్మడం మొదలుపెట్టండి. అప్లై చేయడం ఉచితం. నేను పార్ట్‌నర్ పేజీ తెరుస్తున్నాను, లేదా ' + PHONE + ' కు కాల్ చేయండి.',
        hi: 'डीलर बनने के 4 आसान स्टेप: एक, अपना नाम और दुकान की जानकारी दें। दो, हमारी टीम आपकी दुकान और एरिया देखती है। तीन, हम आपको दाम, आपका मुनाफ़ा और एरिया बताते हैं। चार, स्टॉक लेकर बेचना शुरू करें। अप्लाई करना फ्री है। मैं पार्टनर पेज खोल रही हूँ, या ' + PHONE + ' पर कॉल करें।',
        en: 'To become a dealer there are 4 easy steps: one, give your name and shop details. Two, our team checks your shop and area. Three, we tell you the price, your profit and your area. Four, get stock and start selling. It is free to apply. I am opening the partner page, or call ' + PHONE + '.'
      },
      go: '/partner/', delay: 9000
    },

    /* ---- COMPLAINT / PROBLEM ---- */
    {
      id: 'complaint',
      kw: {
        te: ['ఫిర్యాదు', 'సమస్య', 'పని చేయడం లేదు', 'పాడైంది', 'విరిగింది', 'complaint', 'problem', 'not working', 'damaged'],
        hi: ['शिकायत', 'समस्या', 'काम नहीं कर रहा', 'खराब', 'टूटा', 'complaint', 'problem', 'not working', 'damaged'],
        en: ['complaint', 'problem', 'not working', 'damaged', 'broken', 'issue', 'defective', 'wrong item']
      },
      reply: {
        te: 'క్షమించండి, ఇబ్బంది కలిగింది. మేము వెంటనే సహాయం చేస్తాము. దయచేసి ' + PHONE + ' కు కాల్ చేయండి లేదా వాట్సాప్ చేయండి, నేను ఇప్పుడు వాట్సాప్ తెరుస్తున్నాను.',
        hi: 'माफ़ कीजिए, आपको परेशानी हुई। हम तुरंत मदद करेंगे। कृपया ' + PHONE + ' पर कॉल या व्हाट्सएप करें, मैं अभी व्हाट्सएप खोल रही हूँ।',
        en: 'I am sorry for the trouble. We will help you right away. Please call or WhatsApp ' + PHONE + '. I am opening WhatsApp now.'
      },
      go: WA, delay: 4600, external: true
    },

    /* ---- BENEFITS / WHY BUY / DOES IT WORK ---- */
    {
      id: 'benefits',
      kw: {
        te: ['ఎందుకు కొనాలి', 'ఉపయోగం', 'లాభం', 'పని చేస్తుందా', 'మంచిదా', 'ప్రయోజనం', 'benefit', 'why buy', 'does it work'],
        hi: ['क्यों खरीदें', 'फायदा', 'लाभ', 'काम करता है', 'अच्छा है', 'benefit', 'why buy', 'does it work'],
        en: ['benefit', 'benefits', 'why buy', 'why should i', 'does it work', 'is it good', 'advantage', 'useful']
      },
      reply: {
        te: 'డీకాల్ గట్టి నీటి వల్ల వచ్చే సమస్యలను తగ్గిస్తుంది: మెరుగైన చర్మం, మృదువైన జుట్టు, తెల్లటి మరకలు లేని పంపులు, మరియు ఎక్కువ కాలం మన్నే వాషింగ్ మెషిన్. లక్షలాది కుటుంబాలు నమ్ముతున్నాయి.',
        hi: 'डीकाल कठोर पानी से होने वाली परेशानियाँ कम करता है: बेहतर त्वचा, मुलायम बाल, सफेद दाग रहित नल, और लंबे समय तक चलने वाली वॉशिंग मशीन। लाखों परिवार भरोसा करते हैं।',
        en: "D'Cal reduces hard water problems: better skin, softer hair, taps free of white scale, and a washing machine that lasts longer. Trusted by many families."
      }
    },

    /* ---- GREETING ---- */
    {
      id: 'greeting',
      kw: {
        te: ['నమస్తే', 'నమస్కారం', 'హలో', 'హాయ్', 'ఎలా ఉన్నారు', 'hello', 'hi', 'namaste'],
        hi: ['नमस्ते', 'नमस्कार', 'हैलो', 'हाय', 'कैसे हो', 'hello', 'hi', 'namaste'],
        en: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'how are you']
      },
      reply: {
        te: 'నమస్తే! మీకు ఎలా సహాయం చేయగలను? కొనడం, ధరలు, ఆర్డర్ ట్రాక్ — ఏదైనా అడగండి.',
        hi: 'नमस्ते! मैं आपकी कैसे मदद कर सकती हूँ? खरीदना, दाम, ऑर्डर ट्रैक — कुछ भी पूछें।',
        en: 'Hello! How can I help you? Ask me about buying, prices, tracking your order, or anything else.'
      }
    },

    /* ---- THANKS ---- */
    {
      id: 'thanks',
      kw: {
        te: ['ధన్యవాదాలు', 'థాంక్స్', 'థాంక్ యూ', 'సంతోషం', 'thank', 'thanks'],
        hi: ['धन्यवाद', 'शुक्रिया', 'थैंक्स', 'थैंक यू', 'thank', 'thanks'],
        en: ['thank you', 'thanks', 'thank', 'great', 'good job']
      },
      reply: {
        te: 'మీకు స్వాగతం! ఇంకా ఏదైనా కావాలంటే అడగండి. డీకాల్ కొనుగోలుకు ధన్యవాదాలు.',
        hi: 'आपका स्वागत है! और कुछ चाहिए तो पूछें। डीकाल चुनने के लिए धन्यवाद।',
        en: 'You are welcome! Ask me anything else you need. Thank you for choosing D\'Cal.'
      }
    },

    /* ---- HELP / WHAT CAN YOU DO ---- */
    {
      id: 'help',
      kw: {
        te: ['సహాయం', 'ఏం చేయగలవు', 'నువ్వు ఏం చేస్తావ్', 'help', 'sahayam', 'what can you do'],
        hi: ['मदद', 'क्या कर सकती हो', 'तुम क्या करती हो', 'help', 'madad', 'what can you do'],
        en: ['help', 'what can you do', 'what do you do', 'how to use', 'guide me', 'options']
      },
      reply: {
        te: 'నేను మీకు ఇలా సహాయం చేయగలను: ఉత్పత్తులు మరియు ధరలు చెప్పడం, ఏదైనా వస్తువును తెరవడం, కొనడంలో సహాయం, ఆర్డర్ ట్రాక్ చేయడం, మరియు మీ ప్రశ్నలకు జవాబు. మైక్ నొక్కి అడగండి.',
        hi: 'मैं ऐसे मदद कर सकती हूँ: उत्पाद और दाम बताना, कोई भी चीज़ खोलना, खरीदने में मदद, ऑर्डर ट्रैक करना, और आपके सवालों के जवाब। माइक दबाकर पूछें।',
        en: 'I can help you: tell you products and prices, open any item, help you buy, track your order, and answer your questions. Tap the mic and ask.'
      }
    },

    /* ---- CHANGE LANGUAGE ---- */
    {
      id: 'lang',
      kw: {
        te: ['భాష మార్చు', 'తెలుగులో', 'హిందీలో', 'ఇంగ్లీష్', 'language', 'bhasha'],
        hi: ['भाषा बदलो', 'हिंदी में', 'तेलुगु में', 'इंग्लिश', 'language', 'bhasha'],
        en: ['change language', 'language', 'speak in', 'telugu', 'hindi', 'english']
      },
      reply: {
        te: 'పైన ఉన్న తెలుగు, హిందీ, English బటన్లతో మీకు నచ్చిన భాషను ఎంచుకోండి.',
        hi: 'ऊपर दिए తెలుగు, हिंदी, English बटनों से अपनी पसंद की భाषा चुनें।',
        en: 'Use the తెలుగు, हिंदी, English buttons at the top to choose your language.'
      }
    },

    /* ---- FAQ PAGE ---- */
    {
      id: 'faq',
      kw: {
        te: ['ఎఫ్ ఏ క్యూ', 'తరచుగా అడిగే ప్రశ్నలు', 'ప్రశ్నలు', 'సందేహాలు', 'డౌట్', 'faq', 'questions'],
        hi: ['एफ ए क्यू', 'सामान्य प्रश्न', 'सवाल', 'प्रश्न', 'डाउट', 'faq', 'questions'],
        en: ['faq', 'faqs', 'questions', 'common questions', 'frequently asked', 'doubts', 'q and a']
      },
      reply: {
        te: 'తరచుగా అడిగే ప్రశ్నల పేజీ తెరుస్తున్నాను. అక్కడ చాలా సాధారణ ప్రశ్నలకు జవాబులు ఉన్నాయి.',
        hi: 'सामान्य प्रश्न (FAQ) पेज खोल रही हूँ। वहाँ कई आम सवालों के जवाब हैं।',
        en: 'I am opening the FAQ page. It has answers to many common questions.'
      },
      go: '/faq', delay: 3600
    },

    /* ---- CERTIFICATION / QUALITY ---- */
    {
      id: 'certified',
      kw: {
        te: ['సర్టిఫికేట్', 'సర్టిఫైడ్', 'ప్రమాణపత్రం', 'ఐఎస్ఓ', 'నాబ్ల్', 'నాణ్యత', 'లాబ్ టెస్ట్', 'certified', 'iso', 'nabl', 'lab tested'],
        hi: ['सर्टिफिकेट', 'प्रमाणित', 'आईएसओ', 'नैबल', 'गुणवत्ता', 'लैब टेस्ट', 'certified', 'iso', 'nabl'],
        en: ['certified', 'certification', 'certificate', 'iso', 'nabl', 'lab tested', 'quality', 'genuine', 'tested', 'approved']
      },
      reply: {
        te: 'అవును, డీకాల్ ల్యాబ్‌లో పరీక్షించబడి ధృవీకరించబడింది — నాబ్ల్ మరియు ఐఎస్ఓ 9001 సర్టిఫికేషన్ ఉంది. ఇది నమ్మదగినది మరియు నాణ్యమైనది.',
        hi: 'हाँ, डीकाल लैब में टेस्ट किया गया और प्रमाणित है — NABL और ISO 9001 सर्टिफिकेशन है। यह भरोसेमंद और अच्छी गुणवत्ता का है।',
        en: 'Yes, D\'Cal is lab-tested and certified — it has NABL and ISO 9001 certification. It is trusted and high quality.'
      }
    },

    /* ---- REVIEWS / RATINGS ---- */
    {
      id: 'reviews',
      kw: {
        te: ['రివ్యూ', 'రివ్యూలు', 'రేటింగ్', 'రేటింగ్స్', 'స్టార్', 'స్టార్లు', 'సమీక్ష', 'అభిప్రాయాలు', 'ఎన్ని రివ్యూలు', 'ఎన్ని స్టార్లు', 'reviews', 'rating'],
        hi: ['रिव्यू', 'रिव्यूज', 'रेटिंग', 'स्टार', 'समीक्षा', 'प्रतिक्रिया', 'कितने रिव्यू', 'कितने स्टार', 'कितने लोग', 'reviews', 'rating'],
        en: ['review', 'reviews', 'rating', 'ratings', 'star', 'stars', 'how many reviews', 'how many stars', 'customer reviews', 'product reviews', 'feedback', 'testimonial', 'testimonials', 'how many people bought']
      },
      reply: {
        te: 'మా ఉత్పత్తులకు చాలా మంచి రేటింగ్ ఉంది — వాటర్ సాఫ్ట్‌నర్ 4.9 స్టార్లు, మిగతా అన్నీ 4.6 నుండి 4.8 స్టార్లు, 12,840+ రివ్యూలు. ప్రతి ఉత్పత్తి పేజీలో రేటింగ్ చూడవచ్చు.',
        hi: 'हमारे उत्पादों की बहुत अच्छी रेटिंग है — वाटर सॉफ्टनर 4.9 स्टार, बाकी सभी 4.6 से 4.8 स्टार, 12,840+ रिव्यू। हर उत्पाद पेज पर रेटिंग देख सकते हैं।',
        en: 'Our products are rated very highly — the Water Softener is 4.9 stars, and the others are 4.6 to 4.8 stars, with 12,840+ reviews. You can see the rating on each product page.'
      },
      go: '/collection', delay: 6500
    },

    /* ---- ELECTRICITY / MAINTENANCE ---- */
    {
      id: 'maintenance',
      kw: {
        te: ['విద్యుత్తు', 'కరెంట్', 'నిర్వహణ', 'మెయింటెనెన్స్', 'కెమికల్', 'రసాయనం', 'ఎంత కాలం', 'ఎన్ని రోజులు పని', 'electricity', 'maintenance', 'chemical'],
        hi: ['बिजली', 'करंट', 'रखरखाव', 'मेंटेनेंस', 'केमिकल', 'रसायन', 'कितने दिन चलता', 'electricity', 'maintenance', 'chemical'],
        en: ['electricity', 'power', 'maintenance', 'chemical', 'chemicals', 'how long does it last', 'lifespan', 'servicing', 'no power']
      },
      reply: {
        te: 'డిక్యాల్ కు విద్యుత్తు అవసరం లేదు, రసాయనాలు అవసరం లేదు, నిర్వహణ అవసరం లేదు. ఇది ఏడాది పొడవునా — దాదాపు 365 రోజులు — నిరంతరం పని చేస్తుంది.',
        hi: 'डीकाल को न बिजली चाहिए, न केमिकल, न रखरखाव। यह पूरे साल — लगभग 365 दिन — लगातार काम करता है।',
        en: 'D\'Cal needs no electricity, no chemicals and no maintenance. It works continuously for a full year — up to 365 days.'
      }
    },

    /* ---- CANCEL ORDER / REFUND ---- */
    {
      id: 'cancel',
      kw: {
        te: ['ఆర్డర్ రద్దు', 'ఆర్డర్ క్యాన్సిల్', 'రద్దు చేయ', 'క్యాన్సిల్', 'డబ్బు వాపసు', 'రీఫండ్', 'cancel', 'refund', 'raddu'],
        hi: ['ऑर्डर रद्द', 'ऑर्डर कैंसिल', 'रद्द करना', 'कैंसिल', 'पैसे वापसी', 'रिफंड', 'cancel', 'refund', 'radd'],
        en: ['cancel my order', 'cancel order', 'cancel my', 'cancel', 'cancellation', 'get refund', 'want refund', 'my refund', 'refund', 'money back']
      },
      reply: {
        te: 'వస్తువు పంపే ముందు మీరు "My Orders" నుండి ఆర్డర్‌ను రద్దు చేయవచ్చు. చెల్లించిన డబ్బు ఐదు నుండి ఏడు పని దినాల్లో తిరిగి వస్తుంది. వస్తువు పాడైతే 48 గంటల్లో మాకు తెలియజేయండి.',
        hi: 'सामान भेजे जाने से पहले आप "My Orders" से ऑर्डर रद्द कर सकते हैं। भुगतान किया पैसा पाँच से सात कार्यदिवस में वापस आ जाता है। सामान खराब हो तो 48 घंटे में हमें बताएं।',
        en: 'You can cancel your order from "My Orders" before it ships. Paid money is refunded within five to seven business days. If an item arrives damaged, tell us within 48 hours.'
      }
    },

    /* ---- WISHLIST ---- */
    {
      id: 'wishlist',
      kw: {
        te: ['విష్‌లిస్ట్', 'ఇష్టమైనవి', 'సేవ్ చేసిన', 'wishlist', 'favourites', 'ishtam'],
        hi: ['विशलिस्ट', 'पसंदीदा', 'सेव किया', 'wishlist', 'favourites'],
        en: ['wishlist', 'wish list', 'favourites', 'favorites', 'saved items', 'liked items']
      },
      reply: {
        te: 'మీ విష్‌లిస్ట్ తెరుస్తున్నాను — మీరు ఇష్టపడి సేవ్ చేసిన వస్తువులు ఇక్కడ ఉంటాయి.',
        hi: 'आपकी विशलिस्ट खोल रही हूँ — आपके पसंद किए और सेव किए सामान यहाँ हैं।',
        en: 'I am opening your wishlist — the items you liked and saved are here.'
      },
      go: '/wishlist', delay: 3200
    },

    /* ---- SEARCH ---- */
    {
      id: 'search',
      kw: {
        te: ['వెతకడం', 'సెర్చ్', 'వెతుకు', 'search', 'find', 'vetaku'],
        hi: ['खोजना', 'सर्च', 'ढूंढना', 'search', 'find', 'khojna'],
        en: ['search', 'find a product', 'look for', 'search bar']
      },
      reply: {
        te: 'వెతికే పేజీ తెరుస్తున్నాను. అక్కడ మీకు కావలసిన వస్తువు పేరు టైప్ చేయండి, లేదా మైక్ నొక్కి ఉత్పత్తి పేరు చెప్పండి, నేను తెరుస్తాను.',
        hi: 'खोज पेज खोल रही हूँ। वहाँ अपनी चीज़ का नाम टाइप करें, या माइक दबाकर उत्पाद का नाम बोलें, मैं खोल दूँगी।',
        en: 'I am opening the search page. Type the item name there, or tap the mic and say the product name and I will open it.'
      },
      go: '/search', delay: 4200
    },

    /* ---- BLOG / ARTICLES ---- */
    {
      id: 'blog',
      kw: {
        te: ['బ్లాగ్', 'ఆర్టికల్', 'కథనాలు', 'సమాచారం', 'blog', 'articles'],
        hi: ['ब्लॉग', 'आर्टिकल', 'लेख', 'जानकारी', 'blog', 'articles'],
        en: ['blog', 'articles', 'news', 'read more', 'guides', 'tips']
      },
      reply: {
        te: 'మా బ్లాగ్ పేజీ తెరుస్తున్నాను — గట్టి నీరు మరియు డీకాల్ గురించి ఉపయోగకరమైన సమాచారం ఇక్కడ ఉంది.',
        hi: 'हमारा ब्लॉग पेज खोल रही हूँ — कठोर पानी और डीकाल के बारे में उपयोगी जानकारी यहाँ है।',
        en: 'I am opening our blog page — useful information about hard water and D\'Cal is here.'
      },
      go: '/blog', delay: 3600
    },

    /* ---- PRIVACY / POLICY ---- */
    {
      id: 'privacy',
      kw: {
        te: ['ప్రైవసీ', 'గోప్యత', 'పాలసీ', 'privacy', 'policy'],
        hi: ['प्राइवेसी', 'गोपनीयता', 'पॉलिसी', 'privacy', 'policy'],
        en: ['privacy', 'privacy policy', 'policy', 'data']
      },
      reply: {
        te: 'మా ప్రైవసీ పాలసీ పేజీ తెరుస్తున్నాను. మీ సమాచారం సురక్షితంగా ఉంటుంది.',
        hi: 'हमारी प्राइवेसी पॉलिसी पेज खोल रही हूँ। आपकी जानकारी सुरक्षित रहती है।',
        en: 'I am opening our privacy policy page. Your information is kept safe.'
      },
      go: '/privacy-policy', delay: 3600
    },

    /* ---- LEGAL / TERMS ---- */
    {
      id: 'legal',
      kw: {
        te: ['నిబంధనలు', 'చట్టపరమైన', 'లీగల్', 'టర్మ్స్', 'terms', 'legal', 'terms and conditions'],
        hi: ['नियम', 'कानूनी', 'शर्तें', 'टर्म्स', 'terms', 'legal', 'terms and conditions'],
        en: ['terms', 'terms and conditions', 'legal', 'conditions', 'agreement']
      },
      reply: {
        te: 'మా నిబంధనలు మరియు షరతుల పేజీ తెరుస్తున్నాను.',
        hi: 'हमारी नियम और शर्तें पेज खोल रही हूँ।',
        en: 'I am opening our terms and conditions page.'
      },
      go: '/legal', delay: 3200
    },

    /* ---- B2B: HOTEL ---- */
    {
      id: 'hotel',
      kw: {
        te: ['హోటల్', 'రిసార్ట్', 'లాడ్జ్', 'hotel', 'resort'],
        hi: ['होटल', 'रिसॉर्ट', 'लॉज', 'hotel', 'resort'],
        en: ['hotel', 'resort', 'lodge', 'hotel water softener']
      },
      reply: {
        te: 'హోటళ్లు, రిసార్ట్‌ల కోసం మా కమర్షియల్ వాటర్ సాఫ్ట్‌నర్ ప్రతి గది, బాత్రూం, బాయిలర్‌ను గట్టి నీటి నుండి కాపాడుతుంది, స్కేల్ దాదాపు 72 శాతం తగ్గిస్తుంది — తక్కువ ఖర్చు, సంతోషంగా ఉండే అతిథులు. మీ హోటల్‌లో ఉచిత వాటర్ టెస్ట్ చేస్తాము, విద్యుత్తు అవసరం లేదు. హోటల్ పేజీ తెరుస్తున్నాను, లేదా ' + PHONE + '.',
        hi: 'होटल और रिसॉर्ट के लिए हमारा कमर्शियल वाटर सॉफ्टनर हर कमरे, बाथरूम और बॉयलर को हार्ड वाटर से बचाता है, स्केल लगभग 72 प्रतिशत कम करता है — कम खर्च और खुश मेहमान। हम आपके होटल पर फ्री वाटर टेस्ट करते हैं, बिजली की ज़रूरत नहीं। होटल पेज खोल रही हूँ, या ' + PHONE + '।',
        en: 'For hotels and resorts we have a commercial water softener that protects every room, bathroom and boiler from hard water, cutting scale by about 72 percent — so lower running costs and happier guests. We give a free water test at your hotel and it needs no electricity. I am opening the hotel page, or call ' + PHONE + '.'
      },
      go: '/hotel/', delay: 9000
    },

    /* ---- B2B: HOSPITAL ---- */
    {
      id: 'hospital',
      kw: {
        te: ['హాస్పిటల్', 'ఆసుపత్రి', 'క్లినిక్', 'hospital', 'clinic'],
        hi: ['हॉस्पिटल', 'अस्पताल', 'क्लिनिक', 'hospital', 'clinic'],
        en: ['hospital', 'clinic', 'nursing home', 'hospital water softener']
      },
      reply: {
        te: 'ఆసుపత్రులు, మెడికల్ కాలేజీలు, నర్సింగ్ హోమ్‌ల కోసం మా కమర్షియల్ వాటర్ సాఫ్ట్‌నర్ ట్యాప్‌లు, పైపులు, బాయిలర్లు, లాండ్రీ, మెడికల్ మెషీన్లను గట్టి నీటి నుండి కాపాడుతుంది — దాదాపు 72 శాతం తక్కువ స్కేల్. మీ దగ్గర ఉచిత వాటర్ చెక్ చేస్తాము, విద్యుత్తు అవసరం లేదు. ఆసుపత్రి పేజీ తెరుస్తున్నాను, లేదా ' + PHONE + '.',
        hi: 'अस्पताल, मेडिकल कॉलेज और नर्सिंग होम के लिए हमारा कमर्शियल वाटर सॉफ्टनर नल, पाइप, बॉयलर, लॉन्ड्री और मेडिकल मशीनों को हार्ड वाटर से बचाता है — लगभग 72 प्रतिशत कम स्केल। हम आपके यहाँ फ्री वाटर चेक करते हैं, बिजली की ज़रूरत नहीं। अस्पताल पेज खोल रही हूँ, या ' + PHONE + '।',
        en: 'For hospitals, medical colleges and nursing homes we have a commercial water softener that protects taps, pipes, boilers, laundry and medical machines from hard water — about 72 percent less scale and damage. We give a free water check at your site and it needs no electricity. I am opening the hospital page, or call ' + PHONE + '.'
      },
      go: '/hospital/', delay: 9000
    },

    /* ---- B2B: CAMPUS / APARTMENT / SCHOOL ---- */
    {
      id: 'campus',
      kw: {
        te: ['క్యాంపస్', 'అపార్ట్‌మెంట్', 'పాఠశాల', 'కళాశాల', 'హాస్టల్', 'campus', 'apartment', 'school', 'college'],
        hi: ['कैंपस', 'अपार्टमेंट', 'स्कूल', 'कॉलेज', 'हॉस्टल', 'campus', 'apartment', 'school', 'college'],
        en: ['campus', 'apartment', 'apartments', 'school', 'college', 'hostel', 'building', 'society',
             // compound phrasings so B2B beats the individual product name
             'apartment water softener', 'school water softener', 'college water softener',
             'society water softener', 'building water softener', 'campus water softener',
             'water softener for apartment', 'water softener for building', 'water softener for school',
             'water softener for society', 'water softener for college']
      },
      reply: {
        te: 'పాఠశాలలు, కళాశాలలు, హాస్టళ్లు, అపార్ట్‌మెంట్లు, క్యాంపస్‌ల కోసం మా కమర్షియల్ వాటర్ సాఫ్ట్‌నర్ వాష్‌రూమ్‌లు, హాస్టళ్లు, వంటగదులు, పైపులను కాపాడుతుంది — స్కేల్, మరమ్మతులు దాదాపు 72 శాతం తగ్గిస్తుంది. మొత్తం క్యాంపస్‌కు ఒకే సిస్టమ్, ఉచిత వాటర్ చెక్, విద్యుత్తు అవసరం లేదు. క్యాంపస్ పేజీ తెరుస్తున్నాను, లేదా ' + PHONE + '.',
        hi: 'स्कूल, कॉलेज, हॉस्टल, अपार्टमेंट और कैंपस के लिए हमारा कमर्शियल वाटर सॉफ्टनर वॉशरूम, हॉस्टल, किचन और पाइप को बचाता है — स्केल और मरम्मत लगभग 72 प्रतिशत कम। पूरे कैंपस के लिए एक सिस्टम, फ्री वाटर चेक, बिजली की ज़रूरत नहीं। कैंपस पेज खोल रही हूँ, या ' + PHONE + '।',
        en: 'For schools, colleges, hostels, apartments and campuses we have a commercial water softener that protects washrooms, hostels, kitchens and pipes — cutting scale and repairs by about 72 percent. One system for the whole campus, a free water check, and no electricity needed. I am opening the campus page, or call ' + PHONE + '.'
      },
      go: '/campus/', delay: 9000
    },

    /* ---- WHICH PRODUCT SHOULD I BUY (guidance) ---- */
    {
      id: 'recommend',
      kw: {
        te: ['ఏది కొనాలి', 'ఏది మంచిది', 'ఏది సరైనది', 'సలహా', 'రికమెండ్', 'which one', 'which to buy', 'suggest', 'recommend'],
        hi: ['कौन सा खरीदें', 'कौन सा अच्छा', 'कौन सा सही', 'सलाह', 'रिकमेंड', 'which one', 'which to buy', 'suggest', 'recommend'],
        en: ['which one', 'which product', 'which to buy', 'what should i buy', 'suggest', 'recommend', 'best for me', 'help me choose']
      },
      reply: {
        te: 'పూర్తి ఇంటికి ఇంటి వాటర్ సాఫ్ట్‌నర్ మంచిది. కేవలం స్నానానికి షవర్ ఫిల్టర్, కుళాయి నీటికి ట్యాప్ ఫిల్టర్, బట్టలకు వాషింగ్ బాల్. ఏది కావాలో చెప్పండి, లేదా అన్నీ చూపిస్తాను.',
        hi: 'पूरे घर के लिए घर का वाटर सॉफ्टनर अच्छा है। सिर्फ नहाने के लिए शॉवर फ़िल्टर, नल के पानी के लिए टैप फ़िल्टर, कपड़ों के लिए वॉशिंग बॉल। बताइए किसकी ज़रूरत है, या मैं सब दिखाती हूँ।',
        en: 'For the whole house, the home Water Softener is best. For bathing only, the Shower Filter; for tap water, the Tap Filter; for laundry, the Washing Ball. Tell me your need, or I will show you all.'
      },
      go: '/collection', delay: 6500
    },

    /* ---- INVOICE / BILL ---- */
    {
      id: 'invoice',
      kw: {
        te: ['బిల్లు', 'ఇన్వాయిస్', 'రసీదు', 'జీఎస్టీ', 'bill', 'invoice', 'receipt', 'gst'],
        hi: ['बिल', 'इनवॉइस', 'रसीद', 'जीएसटी', 'bill', 'invoice', 'receipt', 'gst'],
        en: ['bill', 'invoice', 'receipt', 'gst', 'billing']
      },
      reply: {
        te: 'మీ ఆర్డర్‌తో పాటు బిల్లు వస్తుంది. జీఎస్టీ బిల్లు లేదా బిల్లు సంబంధిత సహాయం కోసం ' + PHONE + ' కు కాల్ చేయండి.',
        hi: 'आपके ऑर्डर के साथ बिल आता है। जीएसटी बिल या बिल संबंधी मदद के लिए ' + PHONE + ' पर कॉल करें।',
        en: 'You get a bill with your order. For a GST bill or any billing help, call ' + PHONE + '.'
      }
    }
  ]);

  // A friendly fallback when nothing matches. Escalates: repeated misses add a
  // stronger nudge to switch language or call a human.
  var FALLBACK = {
    te: 'క్షమించండి, నాకు అర్థం కాలేదు. మీరు ఇలా అడగవచ్చు: "ఎలా కొనాలి?", "ధరలు", "ఆర్డర్ ట్రాక్", లేదా "మాతో మాట్లాడండి". లేదా ' + PHONE + ' కు కాల్ చేయండి.',
    hi: 'माफ़ कीजिए, मुझे समझ नहीं आया। आप ऐसे पूछ सकते हैं: "कैसे खरीदें?", "दाम", "ऑर्डर ट्रैक", या "हमसे बात करें"। या ' + PHONE + ' पर कॉल करें।',
    en: 'Sorry, I did not understand. You can ask: "How to buy?", "Prices", "Track order", or "Contact us". Or call ' + PHONE + '.'
  };
  var FALLBACK2 = {
    te: 'ఇంకా అర్థం కావడం లేదు. దయచేసి పైన మీ భాషను ఎంచుకోండి, లేదా నేరుగా ' + PHONE + ' కు కాల్ చేయండి — మా టీమ్ సహాయం చేస్తుంది.',
    hi: 'अभी भी समझ नहीं पाई। कृपया ऊपर अपनी भाषा चुनें, या सीधे ' + PHONE + ' पर कॉल करें — हमारी टीम मदद करेगी।',
    en: 'I still did not catch that. Please pick your language above, or call ' + PHONE + ' directly — our team will help you.'
  };

  /* ------------------------------------------------------------------ *
   *  4. STYLES                                                          *
   * ------------------------------------------------------------------ */
  var CSS = ''
    + '.dcv-fab{position:fixed;right:24px;bottom:24px;z-index:9998;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;'
    +   'background:linear-gradient(135deg,#0077B6,#00B4D8);color:#fff;box-shadow:0 14px 34px -8px rgba(0,119,182,.7);'
    +   'display:flex;align-items:center;justify-content:center;transition:transform .2s ease;-webkit-tap-highlight-color:transparent}'
    + '.dcv-fab:hover{transform:translateY(-3px)}'
    + '.dcv-fab:active{transform:scale(.94)}'
    + '.dcv-fab svg{width:28px;height:28px}'
    + '.dcv-fab .dcv-ring{position:absolute;inset:-6px;border-radius:50%;border:3px solid rgba(0,180,216,.55);opacity:0;pointer-events:none}'
    + '.dcv-fab.dcv-live .dcv-ring{animation:dcvPulse 1.4s ease-out infinite}'
    + '@keyframes dcvPulse{0%{transform:scale(.85);opacity:.8}100%{transform:scale(1.5);opacity:0}}'
    // idle attention: gently blink a ripple + glow so customers notice the mic
    + '.dcv-fab:not(.dcv-live):not(.dcv-open) .dcv-ring{animation:dcvPulse 2.6s ease-out infinite}'
    + '.dcv-fab:not(.dcv-live):not(.dcv-open){animation:dcvGlow 2.6s ease-in-out infinite}'
    + '@keyframes dcvGlow{0%,100%{box-shadow:0 14px 34px -8px rgba(0,119,182,.7)}50%{box-shadow:0 16px 40px -6px rgba(0,119,182,.95),0 0 0 7px rgba(0,180,216,.22)}}'
    // one-shot "magic" burst that shoots out of the mic when it is tapped open
    + '.dcv-fab::before{content:"";position:absolute;inset:-4px;border-radius:50%;background:radial-gradient(circle,rgba(0,180,216,.55),rgba(0,180,216,0) 70%);opacity:0;pointer-events:none}'
    + '.dcv-fab.dcv-pop::before{animation:dcvBurst .6s ease-out}'
    + '.dcv-fab.dcv-pop svg{animation:dcvSpin .5s ease}'
    + '@keyframes dcvBurst{0%{transform:scale(.5);opacity:.8}100%{transform:scale(2.6);opacity:0}}'
    + '@keyframes dcvSpin{0%{transform:scale(.7) rotate(-25deg)}60%{transform:scale(1.15) rotate(8deg)}100%{transform:scale(1) rotate(0)}}'
    + '.dcv-fab .dcv-hint{position:absolute;right:72px;white-space:nowrap;background:#023047;color:#fff;font:600 13px/1 system-ui,sans-serif;'
    +   'padding:9px 13px;border-radius:10px;box-shadow:0 8px 20px -6px rgba(0,0,0,.4);opacity:0;transform:translateX(6px);transition:.25s;pointer-events:none}'
    + '.dcv-fab:hover .dcv-hint{opacity:1;transform:translateX(0)}'
    + '@media(max-width:600px){.dcv-fab{right:16px;bottom:16px;width:54px;height:54px}.dcv-fab .dcv-hint{display:none}}'

    + '.dcv-panel{position:fixed;right:24px;bottom:96px;z-index:9999;width:340px;max-width:calc(100vw - 32px);'
    +   'display:flex;flex-direction:column;height:min(70vh,470px);max-height:calc(100vh - 110px);'   // fixed height -> same size in every language
    +   'background:#fff;border-radius:20px;box-shadow:0 30px 70px -20px rgba(2,48,71,.55),0 0 0 1px rgba(2,48,71,.06);'
    +   'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden;transform-origin:bottom right;'
    // closed state (also the smooth fade-out when the panel is closing)
    +   'opacity:0;transform:translateY(16px) scale(.9);pointer-events:none;transition:opacity .2s ease,transform .25s ease}'
    // OPEN: a clear, bouncy pop-out animation (keyframe = always plays, very visible)
    + '.dcv-panel.dcv-open{opacity:1;transform:none;pointer-events:auto;animation:dcvPop .5s ease both}'
    + '@keyframes dcvPop{0%{opacity:0;transform:translateY(34px) scale(.4)}55%{opacity:1;transform:translateY(-8px) scale(1.05)}75%{transform:translateY(2px) scale(.985)}100%{opacity:1;transform:translateY(0) scale(1)}}'
    // inner sections cascade in one after another (the "magic reveal")
    + '.dcv-langs,.dcv-body,.dcv-chips,.dcv-foot{opacity:0;transform:translateY(9px);transition:opacity .3s ease,transform .35s ease}'
    + '.dcv-panel.dcv-open .dcv-langs{opacity:1;transform:none;transition-delay:.14s}'
    + '.dcv-panel.dcv-open .dcv-body{opacity:1;transform:none;transition-delay:.20s}'
    + '.dcv-panel.dcv-open .dcv-chips{opacity:1;transform:none;transition-delay:.26s}'
    + '.dcv-panel.dcv-open .dcv-foot{opacity:1;transform:none;transition-delay:.30s}'
    + '@media(max-width:600px){'
    +   '.dcv-panel{left:auto;right:12px;width:min(82vw,296px);max-width:none;box-sizing:border-box;bottom:78px;border-radius:16px}'
    +   '.dcv-head{padding:12px 12px;gap:9px}'
    +   '.dcv-h-title{font-size:14.5px}'
    +   '.dcv-langs{padding:8px 12px 4px}'
    +   '.dcv-body{padding:10px 12px 6px}'
    +   '.dcv-chips{padding:6px 12px 10px;gap:6px}'
    +   '.dcv-chip{padding:7px 11px;font-size:12.5px}'
    +   '.dcv-foot{padding:9px 12px}'
    +   '.dcv-min,.dcv-close{width:28px;height:28px}'
    + '}'

    + '.dcv-head{background:linear-gradient(135deg,#0077B6,#00B4D8);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:11px;flex:0 0 auto}'
    + '.dcv-head .dcv-av{width:38px;height:38px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.15)}'
    + '.dcv-head .dcv-av img{width:30px;height:30px;object-fit:contain}'
    + '.dcv-h-txt{flex:1;min-width:0}'
    + '.dcv-h-title{font-weight:700;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.dcv-h-sub{font-size:12px;opacity:.9;line-height:1.3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.dcv-ai{display:none;align-self:flex-start;font-size:10px;font-weight:800;background:rgba(255,255,255,.28);color:#fff;padding:2px 7px;border-radius:7px;letter-spacing:.6px;flex:0 0 auto}'
    + '.dcv-panel.dcv-ai-on .dcv-ai{display:inline-block}'
    + '.dcv-close{background:rgba(255,255,255,.18);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1;flex:0 0 auto}'
    + '.dcv-close:hover{background:rgba(255,255,255,.32)}'
    + '.dcv-min{background:rgba(255,255,255,.18);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;flex:0 0 auto;display:flex;align-items:center;justify-content:center;margin-right:3px}'
    + '.dcv-min:hover{background:rgba(255,255,255,.32)}'
    + '.dcv-min svg{width:16px;height:16px}'

    + '.dcv-langs{display:flex;gap:6px;padding:10px 14px 4px;background:#f2f9fc;flex:0 0 auto}'
    + '.dcv-lang{flex:1;border:1px solid #cfe6ef;background:#fff;color:#025a86;border-radius:9px;padding:7px 4px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s}'
    + '.dcv-lang.on{background:#0077B6;border-color:#0077B6;color:#fff}'

    + '.dcv-body{padding:12px 14px 6px;flex:1 1 auto;min-height:0;overflow-y:auto}'
    + '.dcv-msg{margin:8px 0;display:flex}'
    + '.dcv-msg.dcv-you{justify-content:flex-end}'
    + '.dcv-bub{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}'
    + '.dcv-bot .dcv-bub{background:#eef6fa;color:#08334a;border-bottom-left-radius:4px}'
    + '.dcv-you .dcv-bub{background:#0077B6;color:#fff;border-bottom-right-radius:4px}'
    + '.dcv-status{text-align:center;font-size:12.5px;color:#5a7d8c;padding:2px 0 6px;min-height:18px;flex:0 0 auto}'

    + '.dcv-chips{display:flex;flex-wrap:wrap;gap:7px;padding:6px 14px 12px;flex:0 0 auto}'
    + '.dcv-chip{border:1px solid #cfe6ef;background:#fff;color:#025a86;border-radius:999px;padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;white-space:nowrap;flex:0 0 auto}'
    + '.dcv-chip:hover{background:#e6f4fa;border-color:#0077B6}'

    + '.dcv-foot{display:flex;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid #eef2f4;background:#fafcfd;flex:0 0 auto}'
    + '.dcv-mic{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#0077B6,#00B4D8);'
    +   'color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto;position:relative;transition:.15s}'
    + '.dcv-mic:active{transform:scale(.93)}'
    + '.dcv-mic svg{width:24px;height:24px}'
    // talking-lady avatar: swaps in for the mic while she speaks, mouth animates
    + '.dcv-ic{display:flex;align-items:center;justify-content:center}'
    + '.dcv-ic-lady{display:none}'
    + '.dcv-speaking .dcv-ic-mic{display:none}'
    + '.dcv-speaking .dcv-ic-lady{display:flex}'
    + '.dcv-mouth{transform-box:fill-box;transform-origin:center}'
    + '.dcv-speaking .dcv-mouth{animation:dcvTalk .32s ease-in-out infinite}'
    + '@keyframes dcvTalk{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1.15)}}'
    + '.dcv-mic.dcv-live{background:linear-gradient(135deg,#e63946,#f77f8b)}'
    + '.dcv-mic.dcv-live::after{content:"";position:absolute;inset:-7px;border-radius:50%;border:3px solid rgba(230,57,70,.5);animation:dcvPulse 1.3s ease-out infinite}'
    + '.dcv-mic-label{flex:1;min-width:0;font-size:13.5px;color:#3a5c6b;font-weight:600;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
    + '.dcv-mic-label.dcv-live-txt{color:#08334a;font-weight:700}'   // live transcript style
    + '.dcv-stop{width:40px;height:40px;border-radius:50%;border:1px solid #d6e3e9;background:#fff;color:#0077B6;cursor:pointer;flex:0 0 auto;display:none;align-items:center;justify-content:center}'
    + '.dcv-stop.on{display:flex}'
    + '.dcv-stop svg{width:18px;height:18px}'

    + '.dcv-typing span{display:inline-block;width:6px;height:6px;margin:0 1px;border-radius:50%;background:#8fb4c4;animation:dcvBlink 1s infinite}'
    + '.dcv-typing span:nth-child(2){animation-delay:.2s}.dcv-typing span:nth-child(3){animation-delay:.4s}'
    + '@keyframes dcvBlink{0%,100%{opacity:.3}50%{opacity:1}}'
    + '@media(prefers-reduced-motion:reduce){.dcv-fab,.dcv-fab .dcv-ring,.dcv-fab.dcv-pop::before,.dcv-fab.dcv-pop svg,.dcv-mic.dcv-live::after,.dcv-speaking .dcv-mouth{animation:none}'
    +   '.dcv-panel.dcv-open{animation:none}.dcv-panel{transition:opacity .2s ease}.dcv-langs,.dcv-body,.dcv-chips,.dcv-foot{transition:none;transform:none}}';

  /* ------------------------------------------------------------------ *
   *  5. BUILD DOM                                                       *
   * ------------------------------------------------------------------ */
  var MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  var MIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
  // Female avatar shown IN PLACE of the mic while the assistant is speaking.
  // The mouth is its own element (.dcv-mouth) so CSS can animate it "talking".
  var LADY_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M4.5 20.5C3.6 13 4.2 3 12 3S20.4 13 19.5 20.5Z" fill="currentColor"/><circle cx="12" cy="9.5" r="4.7" fill="currentColor"/><circle cx="10.1" cy="9.2" r=".95" fill="#08334a"/><circle cx="13.9" cy="9.2" r=".95" fill="#08334a"/><ellipse class="dcv-mouth" cx="12" cy="12.1" rx="1.7" ry=".95" fill="#08334a"/></svg>';

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  var fab = document.createElement('button');
  fab.className = 'dcv-fab';
  fab.setAttribute('aria-label', 'Voice assistant');
  fab.innerHTML = '<span class="dcv-ring"></span><span class="dcv-ic dcv-ic-mic">' + MIC_SVG + '</span><span class="dcv-ic dcv-ic-lady">' + LADY_SVG + '</span><span class="dcv-hint"></span>';

  var panel = document.createElement('div');
  panel.className = 'dcv-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', "D'Cal voice assistant");
  panel.innerHTML =
      '<div class="dcv-head">'
    +   '<div class="dcv-av"><img src="/img/dcal-logo.png" alt="D\'Cal"></div>'
    +   '<div class="dcv-h-txt"><div class="dcv-h-title"></div><div class="dcv-h-sub"></div></div>'
    +   '<span class="dcv-ai" title="Smart AI answers on">AI</span>'
    +   '<button class="dcv-min" aria-label="Minimize" title="Minimize (keep chat)">' + MIN_SVG + '</button>'
    +   '<button class="dcv-close" aria-label="Close" title="Close (end chat)">&times;</button>'
    + '</div>'
    + '<div class="dcv-langs"></div>'
    + '<div class="dcv-body"></div>'
    + '<div class="dcv-status"></div>'
    + '<div class="dcv-chips"></div>'
    + '<div class="dcv-foot">'
    +   '<button class="dcv-mic" aria-label="Speak"><span class="dcv-ic dcv-ic-mic">' + MIC_SVG + '</span><span class="dcv-ic dcv-ic-lady">' + LADY_SVG + '</span></button>'
    +   '<span class="dcv-mic-label"></span>'
    +   '<button class="dcv-stop" aria-label="Stop">' + STOP_SVG + '</button>'
    + '</div>';

  function mount() {
    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  var el = {
    hintTxt:  fab.querySelector('.dcv-hint'),
    hTitle:   panel.querySelector('.dcv-h-title'),
    hSub:     panel.querySelector('.dcv-h-sub'),
    langs:    panel.querySelector('.dcv-langs'),
    body:     panel.querySelector('.dcv-body'),
    status:   panel.querySelector('.dcv-status'),
    chips:    panel.querySelector('.dcv-chips'),
    micBtn:   panel.querySelector('.dcv-mic'),
    micLabel: panel.querySelector('.dcv-mic-label'),
    stopBtn:  panel.querySelector('.dcv-stop'),
    minBtn:   panel.querySelector('.dcv-min'),
    closeBtn: panel.querySelector('.dcv-close')
  };

  /* ------------------------------------------------------------------ *
   *  6. SPEECH SYNTHESIS  (female voice)                                *
   * ------------------------------------------------------------------ */
  var synth = window.speechSynthesis || null;
  var voices = [];
  function loadVoices() { if (synth) voices = synth.getVoices() || []; }
  loadVoices();
  if (synth && typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = loadVoices;

  // Pick the best FEMALE, INDIAN-accent voice for a language.
  //  - Telugu -> te-IN (Telugu text can only be read by a Telugu engine).
  //  - Hindi  -> hi-IN.
  //  - English-> Indian English (en-IN) FIRST, so it "talks like an Indian",
  //             not American; then en-GB, then any English.
  var FEMALE_HINT = /(female|woman|zira|susan|heera|kalpana|swara|neerja|aditi|raveena|lekha|priya|geeta|sunita|deepa|shruti|veena|sangeeta|ananya|isha|pooja|kajal|meera|google\s?(हिन्दी|हिंदी|தமிழ்|తెలుగు|english\s?\(india\)))/i;
  var INDIAN_HINT = /(india|hindi|telugu|-in\b|_in\b|\bin\b)/i;
  function voiceLang(v) { return (v.lang || '').toLowerCase().replace(/_/g, '-'); }
  // best FEMALE, Indian-sounding voice whose lang starts with one of `prefixes`
  function bestVoice(prefixes) {
    for (var i = 0; i < prefixes.length; i++) {
      var pref = prefixes[i];
      var pool = voices.filter(function (v) { return voiceLang(v).indexOf(pref) === 0; });
      if (!pool.length) continue;
      var femIndian = pool.filter(function (v) { return FEMALE_HINT.test(v.name) && INDIAN_HINT.test(v.name + ' ' + v.lang); });
      var fem = pool.filter(function (v) { return FEMALE_HINT.test(v.name); });
      var indian = pool.filter(function (v) { return INDIAN_HINT.test(v.name + ' ' + v.lang); });
      return femIndian[0] || fem[0] || indian[0] || pool[0];
    }
    return null;
  }
  // Choose a voice for the language. For Telugu, if the phone has NO Telugu voice,
  // fall back to the Hindi female voice and mark the text to be transliterated to
  // Devanagari — so a lady voice still speaks the Telugu (Hindi-accented).
  function pickVoice(l) {
    if (l === 'te') {
      var te = bestVoice(['te-in', 'te']);
      if (te) return { voice: te, code: te.lang, xlit: false };
      var hi = bestVoice(['hi-in', 'hi']);
      if (hi) return { voice: hi, code: hi.lang, xlit: true };   // read Telugu via Hindi voice
      return { voice: null, code: 'te-IN', xlit: false };
    }
    if (l === 'hi') { var h = bestVoice(['hi-in', 'hi']); return { voice: h, code: h ? h.lang : 'hi-IN', xlit: false }; }
    var en = bestVoice(['en-in', 'en-gb', 'en']);
    return { voice: en, code: en ? en.lang : 'en-IN', xlit: false };
  }

  // Telugu -> Devanagari by Unicode offset (Brahmic scripts are laid out in
  // parallel, so 0x0C.. maps to 0x09.. by subtracting 0x0300). Non-Telugu
  // characters (English product names, digits, punctuation) pass through.
  function teluguToDevanagari(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      out += (c >= 0x0C00 && c <= 0x0C7F) ? String.fromCharCode(c - 0x0300) : s[i];
    }
    return out;
  }

  // speak(text[, onEnd]) — onEnd fires when the voice FINISHES (used so we only
  // navigate after the reply has been fully spoken, never cutting it off).
  var keepAlive = null, speakingU = null;
  function stopKeepAlive() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }
  function speak(text, onEnd) {
    if (!synth) return;                       // no TTS: caller's fallback timer handles onEnd
    try { synth.cancel(); } catch (e) {}
    stopKeepAlive();
    var sel = pickVoice(lang);
    var spoken = sel.xlit ? teluguToDevanagari(text) : text;   // Telugu-via-Hindi if needed
    var u = new SpeechSynthesisUtterance(spoken);
    if (sel.voice) { u.voice = sel.voice; u.lang = sel.voice.lang; }
    else u.lang = sel.code;
    u.rate = lang === 'en' ? 0.96 : lang === 'te' ? 0.84 : 0.9;   // Telugu slowest for clarity
    u.pitch = 1.05;                          // slightly higher -> warmer female tone
    u.volume = 1;
    function done() { stopKeepAlive(); if (speakingU === u) { setSpeaking(false); speakingU = null; } if (onEnd) onEnd(); }   // fire onEnd only when TRULY done
    u.onend = done;
    u.onerror = done;
    try {
      // (single utterance — a queued silent warm-up could hang Chrome's
      // speech queue and block the real reply from ever playing. The greeting
      // starts with a throwaway "నమస్తే!/नमस्ते!/Hi!" so any first-syllable
      // clip eats that word, not the brand name.
      // ("డీ" in "డిక్యాల్ కు స్వాగతం" ->       was clipped before this fix).' ');
      speakingU = u; setSpeaking(true);   // show the talking-lady avatar
      synth.speak(u);
      // Chrome silently STOPS speech after ~15s on long text; nudging resume()
      // keeps a long reply going so it finishes before we navigate.
      keepAlive = setInterval(function () {
        try { if (synth.speaking) { synth.pause(); synth.resume(); } else stopKeepAlive(); } catch (e) { stopKeepAlive(); }
      }, 9000);
    } catch (e) { done(); }
  }
  function stopSpeaking() { stopKeepAlive(); setSpeaking(false); speakingU = null; if (synth) { try { synth.cancel(); } catch (e) {} } }

  /* ------------------------------------------------------------------ *
   *  7. SPEECH RECOGNITION  (listen)                                    *
   * ------------------------------------------------------------------ */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var recog = null, listening = false, listenRetry = 0, userStopped = false;

  // Auto-correct the recognised text toward D'Cal website words, so common
  // mishearings ("the call", "shower filder", "soft ner") become the right term.
  // English-focused (Telugu/Hindi come back in native script and pass through).
  var CORRECTIONS = [
    [/\b(the\s*cal|the\s*call|dee?\s*cal|dycal|di\s*cal|deca[lr]|decal)\b/gi, "D'Cal"],
    [/\bwater\s*soft(?:e)?ner\b/gi, 'water softener'],
    [/\bsoft(?:e)?ner\b/gi, 'softener'],
    [/\bshower\s*(?:head\s*)?fil(?:t|d)er\b/gi, 'shower filter'],
    [/\btap\s*fil(?:t|d)er\b/gi, 'tap filter'],
    [/\bwashing\s*(?:machine\s*)?(?:ball|bowl|bal)\b/gi, 'washing machine ball'],
    [/\bt(?:i|y)le\s*cleaner\b/gi, 'tile cleaner'],
    [/\bhard\s*water\b/gi, 'hard water']
  ];
  function autoCorrect(text) {
    var s = String(text || '');
    for (var i = 0; i < CORRECTIONS.length; i++) s = s.replace(CORRECTIONS[i][0], CORRECTIONS[i][1]);
    return s.replace(/\s+/g, ' ').replace(/^\s+/, '');
  }

  function buildRecog() {
    if (!SR) return null;
    var r = new SR();
    r.lang = LANGS[lang].code;
    r.interimResults = true;      // live feedback while the user speaks
    r.maxAlternatives = 3;        // consider 3 guesses; pick the one we understand
    r.continuous = false;
    r.onstart = function () { listening = true; setLive(true); };
    r.onresult = function (ev) {
      var last = ev.results[ev.results.length - 1];
      if (!last) return;
      if (!last.isFinal) {                                  // LIVE: show what we hear, corrected
        var itxt = (last[0] && last[0].transcript) || '';
        el.micLabel.textContent = itxt ? autoCorrect(itxt) : UI[lang].listening;
        el.micLabel.classList.add('dcv-live-txt');
        return;
      }
      // FINAL: correct each guess, then pick the one that best matches an intent
      var alts = [];
      for (var j = 0; j < last.length; j++) { if (last[j] && last[j].transcript) alts.push(autoCorrect(last[j].transcript)); }
      if (!alts.length) return;
      var chosenText = alts[0], chosenIntent = null, bestScore = 0;
      for (var a = 0; a < alts.length; a++) {
        var res = scoreText(alts[a]);
        if (res.score > bestScore) { bestScore = res.score; chosenIntent = (res.score >= MATCH_MIN ? res.intent : null); chosenText = alts[a]; }
      }
      if (bestScore < MATCH_MIN) { chosenText = alts[0]; chosenIntent = null; }   // show the top guess
      listenRetry = 0;
      handleQuery(chosenText, chosenIntent);
    };
    r.onerror = function (ev) {
      listening = false; setLive(false);
      var err = ev && ev.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        addBot(UI[lang].micDenied); speak(UI[lang].micDenied);
      } else if ((err === 'no-speech' || err === 'aborted') && !userStopped && opened && listenRetry < 1) {
        // heard nothing — quietly listen once more instead of failing
        listenRetry++;
        setStatus(UI[lang].tapToSpeak);
        setTimeout(function () { if (opened && !listening) startListening(true); }, 250);
        return;
      }
      setStatus('');
    };
    r.onend = function () {
      listening = false; setLive(false);
      if (el.status.textContent === UI[lang].listening) setStatus('');
    };
    return r;
  }

  // start listening. `isRetry` keeps the retry counter across an auto-restart.
  function startListening(isRetry) {
    if (!SR) { addBot(UI[lang].noMic); speak(UI[lang].noMic); return; }
    stopSpeaking();
    userStopped = false;
    if (!isRetry) listenRetry = 0;
    if (listening && recog) { userStopped = true; try { recog.stop(); } catch (e) {} return; }
    recog = buildRecog();
    try { recog.start(); } catch (e) { /* already started — ignore */ }
  }

  /* ------------------------------------------------------------------ *
   *  8. LOCAL RETRIEVAL ENGINE  (intent scoring — no server, no LLM)    *
   *     Scores every knowledge entry against the spoken text and picks  *
   *     the best. Multi-word phrases win over single loose words, so    *
   *     "open shower head filter" reliably resolves to that product.    *
   * ------------------------------------------------------------------ */
  var MATCH_MIN = 2;   // minimum score to accept a match (else -> fallback)

  // Keep letters (\p{L}), numbers (\p{N}) AND combining marks (\p{M}) — the last is
  // essential: Telugu/Devanagari vowel signs (matras) are marks, not letters, so
  // stripping them would shred words like "కొనాలి" / "खरीदें" and break matching.
  function norm(s) { return (' ' + (s || '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ') + ' '); }

  // all keyword strings for an intent (products use a flat array; others {te,hi,en})
  function keywordsOf(intent) {
    if (Array.isArray(intent.kw)) return intent.kw;
    return (intent.kw.te || []).concat(intent.kw.hi || [], intent.kw.en || []);
  }

  // score one keyword against the normalized text `t` and its token list
  function scoreKw(t, tokens, kw) {
    kw = (kw || '').toLowerCase();
    if (!kw) return 0;
    var words = kw.split(' ').filter(Boolean);
    if (words.length > 1) {                       // multi-word phrase = specific
      return t.indexOf(kw) !== -1 ? words.length * 3 : 0;
    }
    if (tokens.indexOf(kw) !== -1) return 2;      // exact whole word
    if (kw.length >= 4 && t.indexOf(kw) !== -1) return 1;  // substring (avoid tiny words)
    return 0;
  }

  function scoreText(text) {
    var t = norm(text);
    var tokens = t.trim().split(' ').filter(Boolean);
    var best = null, bestScore = 0;
    for (var i = 0; i < INTENTS.length; i++) {
      var intent = INTENTS[i], kws = keywordsOf(intent), s = 0;
      for (var k = 0; k < kws.length; k++) s += scoreKw(t, tokens, kws[k]);
      if (s > bestScore) { bestScore = s; best = intent; }
    }
    return { intent: best, score: bestScore };
  }

  function findIntent(text) {
    var r = scoreText(text);
    return r.score >= MATCH_MIN ? r.intent : null;
  }

  // Speak the reply, THEN navigate — so the voice is never cut off mid-sentence.
  // Navigation fires on speech-end; a generous fallback timer covers devices with
  // no TTS or where the 'end' event doesn't fire. Whichever comes first wins (once).
  function speakThenGo(reply, url, external) {
    var isExternal = external || /^https?:/i.test(url);
    var done = false;
    function nav() {
      if (done) return; done = true;
      try { if (isExternal) window.open(url, '_blank'); else window.location.href = url; } catch (e) {}
    }
    speak(reply, nav);                         // navigate the moment the voice truly finishes
    // Backstop ONLY — must be longer than the real speaking time so it never cuts
    // the voice off. With TTS present, speech is the trigger; here we just guard
    // against a device where the 'end' event never fires. Scale with length.
    var len = reply ? reply.length : 0;
    var hasTTS = !!(window.speechSynthesis);
    var fallback = hasTTS
      ? Math.max(6000, Math.min(60000, len * 130 + 5000))   // TTS: long guard (~speaking time + buffer)
      : Math.max(3500, Math.min(12000, len * 70 + 2500));   // no TTS: reading-time delay
    setTimeout(nav, fallback);
  }

  function respondTo(intent) {
    var reply = (intent.reply[lang] || intent.reply.en);
    addBot(reply);
    if (intent.go) speakThenGo(reply, intent.go, intent.external);   // speak fully, then open
    else speak(reply);
  }

  /* ------------------------------------------------------------------ *
   *  8b. AI BRAIN  (server /api/assistant via OpenRouter)               *
   *      Tries the AI for open-ended answers; on any failure it falls   *
   *      back to the free offline engine below — so it never breaks.    *
   * ------------------------------------------------------------------ */
  var AI_URL = '/api/assistant';
  var aiState = 'unknown';        // 'unknown' | 'on' | 'off'

  // The AI's context = the real visible conversation (offline + AI turns alike),
  // so a follow-up like "yes" is understood in context. `transcript` already holds
  // every shown message and survives page changes; we send the recent turns
  // EXCLUDING the current user message (sent separately by the server).
  function aiContext() {
    return transcript.slice(0, -1).slice(-8).map(function (m) {
      return { role: m.who === 'you' ? 'user' : 'assistant', text: m.text };
    });
  }

  function checkAI() {
    try {
      fetch(AI_URL + '/health').then(function (r) { return r.json(); }).then(function (d) {
        aiState = (d && d.enabled) ? 'on' : 'off';
        panel.classList.toggle('dcv-ai-on', aiState === 'on');
      }).catch(function () { aiState = 'off'; });
    } catch (e) { aiState = 'off'; }
  }

  function askAI(text, priorHistory) {
    return fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, lang: lang, history: priorHistory || [] })
    }).then(function (r) {
      if (!r.ok) { if (r.status === 503) { aiState = 'off'; panel.classList.remove('dcv-ai-on'); } return null; }
      return r.json();
    }).then(function (d) { return (d && d.reply) ? d : null; })
      .catch(function () { return null; });     // network error -> offline fallback
  }

  var missCount = 0;   // consecutive not-understood answers -> escalate the hint
  function localAnswer(text, preMatched) {
    var intent = (preMatched !== undefined && preMatched !== null) ? preMatched : findIntent(text);
    if (intent) { missCount = 0; respondTo(intent); }
    else {
      missCount++;
      var fb = missCount >= 2 ? FALLBACK2[lang] : FALLBACK[lang];
      addBot(fb); speak(fb);
    }
  }

  // text = what the customer said; preMatched = offline intent hint;
  // localOnly = skip the AI (used by the instant quick-tap chips).
  // Strategy — OFFLINE-FIRST: if the free engine confidently knows the answer
  // (products, prices, navigation), use it (instant, free, reliable in every
  // language). Only send genuinely open-ended questions to the AI brain.
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // words that are just "open/show/buy/price + product" scaffolding (te/hi/en)
  var ACTION_STOP = /\b(open|show|see|view|display|buy|buying|purchase|order|price|cost|rate|rates|want|need|get|give|go|goto|take|me|us|the|a|an|to|of|for|is|it|this|that|please|my|your|i|we|d|cal|dcal|and|now|about|what|whats|hi|hello)\b/gi;
  var ACTION_STOP_NATIVE = /(తెరు|చూపించు|చూపు|కావాలి|కొను|కొనాలి|ధర|ఎంత|రూపాయలు|నాకు|ఈ|కావాలి|खोलो|खोलिए|दिखाओ|दिखाइए|चाहिए|खरीद|खरीदना|दाम|कीमत|कितना|मुझे|यह)/g;
  // TRUE when the query is basically just the intent's keywords + open/price
  // scaffolding. If extra meaningful words remain (a real question), we prefer the
  // AI so the answer is relevant instead of the generic canned reply.
  function isBareRequest(text, intent) {
    var t = ' ' + (text || '').toLowerCase() + ' ';
    var kws = keywordsOf(intent).slice().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < kws.length; i++) { t = t.replace(new RegExp(escapeRegex(kws[i].toLowerCase()), 'g'), ' '); }
    t = t.replace(ACTION_STOP, ' ').replace(ACTION_STOP_NATIVE, ' ');
    t = t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();      // strip punctuation/spaces
    return t.length < 3;                                 // nothing meaningful left -> bare
  }
  // Intents whose canned reply is GENERIC (dealer, benefits, about...): a specific
  // question about them should go to the AI for an exact answer. Products always
  // qualify. Pure page-navigation and complete-answer intents stay offline.
  var AI_ROUTE_IDS = { dealer: 1, benefits: 1, about: 1, recommend: 1, warranty: 1, installation: 1, complaint: 1, offers: 1, maintenance: 1, hotel: 1, hospital: 1, campus: 1 };

  function handleQuery(text, preMatched, localOnly) {
    addYou(text);
    setStatus(UI[lang].thinking);
    var typing = addTyping();
    var localHit = (preMatched !== undefined && preMatched !== null) ? preMatched : findIntent(text);
    var isProductHit = localHit && typeof localHit.id === 'string' && localHit.id.indexOf('product:') === 0;
    var routable = isProductHit || (localHit && AI_ROUTE_IDS[localHit.id]);

    // 0) matched a product/info intent, but the customer asked something MORE than
    //    "open/price it" -> let the AI answer relevantly (canned reply is fallback)
    if (routable && !localOnly && aiState !== 'off' && !isBareRequest(text, localHit)) {
      askAI(text, aiContext()).then(function (d) {
        removeEl(typing); setStatus('');
        missCount = 0;
        if (d) { addBot(d.reply); if (d.go) speakThenGo(d.reply, d.go, false); else speak(d.reply); }
        else respondTo(localHit);                 // AI failed -> canned reply
      });
      return;
    }

    // 1) confident offline match -> answer it (no AI cost, reliable Telugu/Hindi/English)
    if (localHit) {
      setTimeout(function () { removeEl(typing); setStatus(''); missCount = 0; respondTo(localHit); }, 250);
      return;
    }
    // 2) no offline match, AI available -> ask the AI (open-ended "answer anything")
    if (!localOnly && aiState !== 'off') {
      askAI(text, aiContext()).then(function (d) {   // full conversation as context
        removeEl(typing); setStatus('');
        if (d) {
          missCount = 0;
          addBot(d.reply);
          if (d.go) speakThenGo(d.reply, d.go, false); else speak(d.reply);
        } else {
          localAnswer(text, preMatched);          // AI failed -> offline fallback text
        }
      });
      return;
    }
    // 3) no match and no AI -> friendly fallback
    setTimeout(function () { removeEl(typing); setStatus(''); localAnswer(text, preMatched); }, 250);
  }

  /* ------------------------------------------------------------------ *
   *  9. UI HELPERS + conversation persistence                           *
   *     The chat survives page changes (sessionStorage = one browser    *
   *     tab). It is cleared only when the user closes the assistant, or  *
   *     closes the browser/tab.                                          *
   * ------------------------------------------------------------------ */
  var CHAT_KEY = 'dcal_voice_chat', OPEN_KEY = 'dcal_voice_open';
  var transcript = [];   // [{who,text}] — the saved conversation
  function saveChat() { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(transcript.slice(-40))); } catch (e) {} }
  function clearChat() { transcript = []; try { sessionStorage.removeItem(CHAT_KEY); } catch (e) {} }
  function setOpenFlag(v) { try { sessionStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch (e) {} }

  // addMsg(who, text[, restoring]) — when restoring from storage, don't re-save
  function addMsg(who, text, restoring) {
    var wrap = document.createElement('div');
    wrap.className = 'dcv-msg ' + (who === 'you' ? 'dcv-you' : 'dcv-bot');
    var b = document.createElement('div');
    b.className = 'dcv-bub';
    b.textContent = text;
    wrap.appendChild(b);
    el.body.appendChild(wrap);
    el.body.scrollTop = el.body.scrollHeight;
    if (!restoring) { transcript.push({ who: who, text: text }); saveChat(); }
    return wrap;
  }

  // rebuild the panel from the saved conversation (called once on page load)
  function restoreChat() {
    var arr;
    try { arr = JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); } catch (e) { arr = []; }
    if (!arr || !arr.length) return false;
    el.body.innerHTML = '';
    arr.forEach(function (m) { if (m && m.text) addMsg(m.who === 'you' ? 'you' : 'bot', m.text, true); });
    transcript = arr.slice();   // aiContext() reads this, so restored chats keep AI context too
    return true;
  }
  function addBot(t) { return addMsg('bot', t); }
  function addYou(t) { return addMsg('you', t); }
  function addTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'dcv-msg dcv-bot';
    wrap.innerHTML = '<div class="dcv-bub dcv-typing"><span></span><span></span><span></span></div>';
    el.body.appendChild(wrap);
    el.body.scrollTop = el.body.scrollHeight;
    return wrap;
  }
  function removeEl(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }
  function setStatus(t) { el.status.textContent = t || ''; }
  // show the talking-lady avatar (mouth animating) on the mic + FAB while speaking
  function setSpeaking(on) { fab.classList.toggle('dcv-speaking', on); el.micBtn.classList.toggle('dcv-speaking', on); }
  function setLive(on) {
    fab.classList.toggle('dcv-live', on);
    el.micBtn.classList.toggle('dcv-live', on);
    el.stopBtn.classList.toggle('on', on);
    el.micLabel.textContent = on ? UI[lang].listening : UI[lang].tapToSpeak;
    if (!on) el.micLabel.classList.remove('dcv-live-txt');   // stop showing live transcript
  }

  /* ------------------------------------------------------------------ *
   *  10. RENDER LANGUAGE-DEPENDENT TEXT                                 *
   * ------------------------------------------------------------------ */
  function renderChrome() {
    var t = UI[lang];
    el.hintTxt.textContent = t.tagline;
    el.hTitle.textContent = t.title;
    el.hSub.textContent = t.tagline;
    el.micLabel.textContent = t.tapToSpeak;
    fab.setAttribute('aria-label', t.title);
    // language buttons
    el.langs.innerHTML = '';
    ['te', 'hi', 'en'].forEach(function (l) {
      var b = document.createElement('button');
      b.className = 'dcv-lang' + (l === lang ? ' on' : '');
      b.textContent = LANGS[l].label;
      b.onclick = function () { setLang(l); };
      el.langs.appendChild(b);
    });
    // quick chips
    el.chips.innerHTML = '';
    t.chips.forEach(function (pair) {
      var c = document.createElement('button');
      c.className = 'dcv-chip';
      c.textContent = pair[0];
      c.onclick = function () { handleQuery(pair[1], null, true); };   // instant, offline
      el.chips.appendChild(c);
    });
  }

  function setLang(l) {
    if (!LANGS[l]) return;
    lang = l;
    localStorage.setItem('dcal_voice_lang', l);
    stopSpeaking();
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    renderChrome();
    // fresh greeting in the new language (reset the saved conversation too)
    el.body.innerHTML = '';
    clearChat();
    greeted = true;
    var g = UI[lang].greeting;
    addBot(g); speak(g);
  }

  /* ------------------------------------------------------------------ *
   *  11. OPEN / CLOSE                                                   *
   * ------------------------------------------------------------------ */
  var opened = false, greeted = false;
  // fromRestore: reopened after a page change (no burst, no speak).
  // noSpeak: open + show the greeting but don't speak yet (used for the auto-welcome,
  //          where the voice is played on the first user gesture instead).
  function openPanel(fromRestore, noSpeak) {
    panel.classList.add('dcv-open');
    fab.classList.add('dcv-open');      // stop the attention blink while open
    opened = true;
    if (!fromRestore) {                 // fire the magic burst from the mic (not on page-restore)
      setOpenFlag(true);                // remember open state across page changes
      fab.classList.remove('dcv-pop');
      void fab.offsetWidth;             // restart the animation
      fab.classList.add('dcv-pop');
      setTimeout(function () { fab.classList.remove('dcv-pop'); }, 650);
    }
    if (!greeted) {
      greeted = true;
      var g = UI[lang].greeting;
      addBot(g); if (!fromRestore && !noSpeak) speak(g);   // don't re-speak on restore / auto-welcome
    }
  }

  // Auto-welcome on the first visit: open the panel and show the welcome message.
  // Audio is blocked by browsers until the user interacts, so we speak the welcome
  // on the FIRST tap/scroll/key (skipping it if they go straight to the mic).
  function autoWelcome() {
    if (opened) return;
    openPanel(false, true);             // open + show welcome (no immediate speak)
    if (!synth) return;
    var fire = function (e) {
      document.removeEventListener('pointerdown', fire, true);
      document.removeEventListener('keydown', fire, true);
      document.removeEventListener('touchstart', fire, true);
      var t = e && e.target;
      // if they went straight to the assistant's own buttons, don't talk over them
      if (t && (fab.contains(t) || (el.micBtn && el.micBtn.contains(t)) || (el.stopBtn && el.stopBtn.contains(t)) ||
                (el.closeBtn && el.closeBtn.contains(t)) || (el.minBtn && el.minBtn.contains(t)))) return;
      // speak the welcome, THEN auto-open the mic so the customer can talk
      // right away. Both audio and mic are only allowed off a real user
      // gesture, which this first tap/scroll/key provides.
      if (opened && !listening) speak(UI[lang].greeting, function () {
        if (opened && !listening) startListening();
      });
    };
    document.addEventListener('pointerdown', fire, true);
    document.addEventListener('keydown', fire, true);
    document.addEventListener('touchstart', fire, true);
  }
  // Minimize: collapse to the mic button but KEEP the conversation, so the
  // customer can maximize again and continue. (Only the ✕ close clears it.)
  function minimizePanel() {
    panel.classList.remove('dcv-open');
    fab.classList.remove('dcv-open');   // resume the attention blink
    opened = false;
    stopSpeaking();
    userStopped = true;
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    setOpenFlag(false);                 // stays minimized across page changes; chat is kept
  }
  function closePanel() {
    minimizePanel();
    // user closed the assistant -> end the conversation (clear it)
    clearChat();
    el.body.innerHTML = '';
    greeted = false;
  }

  fab.addEventListener('click', function () {
    if (opened) minimizePanel();   // tapping the mic hides but KEEPS the chat
    else openPanel();
  });
  el.minBtn.addEventListener('click', minimizePanel);
  el.closeBtn.addEventListener('click', closePanel);
  // wrap so the click event isn't passed as the isRetry flag
  el.micBtn.addEventListener('click', function () { startListening(); });
  el.stopBtn.addEventListener('click', function () {
    userStopped = true;
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    stopSpeaking();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && opened) minimizePanel(); });

  /* ------------------------------------------------------------------ *
   *  12. PUBLIC API                                                     *
   *  Lets the rest of the site drive the assistant, e.g.               *
   *    DcalVoice.open();  DcalVoice.ask('how to buy');                 *
   *    DcalVoice.setLanguage('hi');                                    *
   * ------------------------------------------------------------------ */
  window.DcalVoice = {
    open: openPanel,
    close: closePanel,
    listen: startListening,
    ask: function (text) { openPanel(); handleQuery(text); },
    setLanguage: setLang,
    speak: speak,
    // exposed for diagnostics / automated checks
    _match: function (text) { var i = findIntent(text); return i ? i.id : null; },
    _correct: function (text) { return autoCorrect(text); },
    _bare: function (text) { var i = findIntent(text); return i ? isBareRequest(text, i) : null; }
  };

  /* ------------------------------------------------------------------ *
   *  13. INIT                                                           *
   * ------------------------------------------------------------------ */
  renderChrome();
  checkAI();      // ask the server whether the OpenRouter AI brain is available
  // bring back the conversation from before this page change (same browser tab)
  if (restoreChat()) greeted = true;
  // Decide how the assistant starts on this page:
  var openState = null;
  try { openState = sessionStorage.getItem(OPEN_KEY); } catch (e) {}
  if (openState === '1') {
    openPanel(true);                 // it was open before this page change -> keep it open
  } else if (openState === null) {
    setTimeout(autoWelcome, 1200);   // FIRST visit this session -> auto-open + welcome (after the page settles)
  }
  // openState === '0' means the user closed/minimized it earlier -> leave it closed
})();
