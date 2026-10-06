/* ============================================================================
   D'Cal Voice Assistant  —  "D'Cal Saathi"
   A microphone-based AI voice helper for EVERY page.
   Built for customers who cannot read: they tap the mic, ASK a question by
   voice (Telugu / Hindi / English) and hear the answer in a FEMALE voice.
   It can also NAVIGATE the site by voice ("take me to products", "open cart").

   Listens with the browser's free Web Speech API and SPEAKS the reply in a
   natural Indian female voice via ElevenLabs (proxied by our server so the key
   stays secret). With no ElevenLabs key she falls back to the browser's OWN
   speechSynthesis voice — robotic, but never silent.
     - window.SpeechRecognition / webkitSpeechRecognition  (listen)
     - POST /api/tts  ->  ElevenLabs                       (female voice reply)
     - window.speechSynthesis                              (free fallback voice)

   She can be TALKED OVER: while she speaks, the mic stays open and a small
   detector (section 7c) cuts her off the moment the customer starts talking —
   but not for a low voice, a bang, or music — with their first word already
   on tape. The brain is told she was interrupted and how far she had got.

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
  // Every language the assistant can be spoken to in. `code` is only used by the
  // browser's own recogniser (the fallback path); the normal path is server-side
  // speech-to-text, which DETECTS the language instead of being told it.
  var LANGS = {
    te: { code: 'te-IN', label: 'తెలుగు',    name: 'Telugu'    },
    hi: { code: 'hi-IN', label: 'हिंदी',      name: 'Hindi'     },
    en: { code: 'en-IN', label: 'English',   name: 'English'   },
    ta: { code: 'ta-IN', label: 'தமிழ்',     name: 'Tamil'     },
    kn: { code: 'kn-IN', label: 'ಕನ್ನಡ',      name: 'Kannada'   },
    ml: { code: 'ml-IN', label: 'മലയാളം',   name: 'Malayalam' },
    mr: { code: 'mr-IN', label: 'मराठी',      name: 'Marathi'   },
    bn: { code: 'bn-IN', label: 'বাংলা',      name: 'Bengali'   },
    gu: { code: 'gu-IN', label: 'ગુજરાતી',    name: 'Gujarati'  },
    pa: { code: 'pa-IN', label: 'ਪੰਜਾਬੀ',      name: 'Punjabi'   },
    or: { code: 'or-IN', label: 'ଓଡ଼ିଆ',       name: 'Odia'      },
    as: { code: 'as-IN', label: 'অসমীয়া',    name: 'Assamese'  },
    ur: { code: 'ur-IN', label: 'اردو',       name: 'Urdu'      }
  };
  // The languages the OFFLINE keyword engine has canned answers for. Anything else
  // is answered by the AI brain, which speaks all of them.
  var KB_LANGS = { te: 1, hi: 1, en: 1 };
  // remembered choice, default Hindi — the widest-understood language across
  // the customer base, and the one most devices actually ship a voice for.
  // From the second turn onward this is whatever the customer actually spoke.
  var lang = localStorage.getItem('dcal_voice_lang') || 'hi';
  if (!LANGS[lang]) lang = 'hi';

  /* ------------------------------------------------------------------ *
   *  2. UI STRINGS  (per language)                                     *
   * ------------------------------------------------------------------ */
  var UI = {
    te: {
      title: 'డీకాల్ సహాయకురాలు',
      tagline: 'మీ భాషలో మాట్లాడండి',
      listening: 'వింటున్నాను…',
      tapToSpeak: 'మా ప్రొడక్ట్స్ గురించి ఏదైనా అడగండి',
      thinking: 'ఆలోచిస్తున్నాను…',
      greeting: 'నమస్తే! డిక్యాల్ కు స్వాగతము! నేను సాథి, మీ షాపింగ్ సహాయకు రాలిని. ప్రొడక్ట్స్ చూపిస్తాను, ధరలు చెప్తాను, ఆర్డర్ చేయడానికి సహాయం చేస్తాను. చెప్పండి, ఈ రోజు నేను మీకు ఎలా సహాయం చేయగలను?',
      helpAsk: 'నమస్తే! చెప్పండి, ఈ రోజు నేను మీకు ఎలా సహాయం చేయగలను?',
      view: 'చూడండి',
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
      tagline: 'अपनी भाषा में बोलें',
      listening: 'सुन रही हूँ…',
      tapToSpeak: 'हमारे प्रोडक्ट्स के बारे में कुछ भी पूछें',
      thinking: 'सोच रही हूँ…',
      greeting: 'नमस्ते! डीकाल में आपका स्वागत है। मैं साथी हूँ, आपकी शॉपिंग सहायक। मैं प्रोडक्ट दिखाती हूँ, दाम बताती हूँ और ऑर्डर करने में मदद करती हूँ। बताइए, आज मैं आपकी क्या मदद करूँ?',
      helpAsk: 'नमस्ते! बताइए, आज मैं आपकी क्या मदद करूँ?',
      view: 'देखें',
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
      tagline: 'Talk in your language',
      listening: 'Listening…',
      tapToSpeak: 'Ask anything about our products',
      thinking: 'Thinking…',
      greeting: "Hello! Welcome to D'Cal. I am Saathi, your shopping assistant. I can show you our products, tell you prices and help you order. How can I help you today?",
      helpAsk: 'Hello! How can I help you today?',
      view: 'View',
      noMic: 'Sorry, the microphone is not working in your browser. Please tap the buttons below, or use Chrome.',
      micDenied: 'Microphone permission was blocked. Please allow the mic, or tap the buttons below.',
      quick: 'Quick help',
      chips: [
        ['How to buy?',   'how to buy'],
        ['Prices',        'price'],
        ['Track order',   'track order'],
        ['Contact us',    'contact']
      ]
    },

    /* ---- The other Indian languages the customer may speak. Only the few
       strings that are actually shown or spoken are translated; anything not
       listed here falls back to English via the fill pass below. ---- */
    ta: {
      title: "டி'கால் உதவியாளர்",
      tagline: 'உங்கள் மொழியில் பேசுங்கள்',
      listening: 'கேட்கிறேன்…',
      tapToSpeak: 'எங்கள் products பற்றி எதுவும் கேளுங்கள்',
      thinking: 'யோசிக்கிறேன்…',
      greeting: "வணக்கம்! டி'கால் வரவேற்கிறது! நான் உங்கள் குரல் உதவியாளர். products, விலை, ஆர்டர் — எல்லாவற்றிலும் உதவுவேன். இன்று நான் உங்களுக்கு எப்படி உதவலாம்?",
      noMic: 'மன்னிக்கவும், உங்கள் browser-ல் மைக் வேலை செய்யவில்லை. தயவுசெய்து Chrome பயன்படுத்துங்கள்.',
      micDenied: 'மைக் அனுமதி கிடைக்கவில்லை. தயவுசெய்து மைக் அனுமதி கொடுங்கள்.'
    },
    kn: {
      title: "ಡಿ'ಕಾಲ್ ಸಹಾಯಕಿ",
      tagline: 'ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಿ',
      listening: 'ಕೇಳುತ್ತಿದ್ದೇನೆ…',
      tapToSpeak: 'ನಮ್ಮ products ಬಗ್ಗೆ ಏನು ಬೇಕಾದರೂ ಕೇಳಿ',
      thinking: 'ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…',
      greeting: "ನಮಸ್ಕಾರ! ಡಿ'ಕಾಲ್‌ಗೆ ಸ್ವಾಗತ! ನಾನು ನಿಮ್ಮ ಧ್ವನಿ ಸಹಾಯಕಿ. products, ಬೆಲೆ, ಆರ್ಡರ್ — ಎಲ್ಲದರಲ್ಲೂ ಸಹಾಯ ಮಾಡುತ್ತೇನೆ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
      noMic: 'ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ browser ನಲ್ಲಿ ಮೈಕ್ ಕೆಲಸ ಮಾಡುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು Chrome ಬಳಸಿ.',
      micDenied: 'ಮೈಕ್ ಅನುಮತಿ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೈಕ್ ಅನುಮತಿ ಕೊಡಿ.'
    },
    ml: {
      title: "ഡി'കാൽ സഹായി",
      tagline: 'നിങ്ങളുടെ ഭാഷയിൽ സംസാരിക്കൂ',
      listening: 'കേൾക്കുന്നു…',
      tapToSpeak: 'ഞങ്ങളുടെ products നെക്കുറിച്ച് എന്തും ചോദിക്കൂ',
      thinking: 'ആലോചിക്കുന്നു…',
      greeting: "നമസ്കാരം! ഡി'കാലിലേക്ക് സ്വാഗതം! ഞാൻ നിങ്ങളുടെ വോയ്സ് അസിസ്റ്റന്റ്. products, വില, ഓർഡർ — എല്ലാത്തിലും സഹായിക്കാം. ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കട്ടെ?",
      noMic: 'ക്ഷമിക്കണം, നിങ്ങളുടെ browser-ൽ മൈക്ക് പ്രവർത്തിക്കുന്നില്ല. ദയവായി Chrome ഉപയോഗിക്കുക.',
      micDenied: 'മൈക്ക് അനുമതി ലഭിച്ചില്ല. ദയവായി മൈക്ക് അനുമതി നൽകുക.'
    },
    mr: {
      title: "डी'कॅल सहाय्यक",
      tagline: 'तुमच्या भाषेत बोला',
      listening: 'ऐकत आहे…',
      tapToSpeak: 'आमच्या products बद्दल काहीही विचारा',
      thinking: 'विचार करत आहे…',
      greeting: "नमस्कार! डी'कॅलमध्ये आपले स्वागत आहे! मी तुमची व्हॉइस सहाय्यक. products, किंमत, ऑर्डर — सगळ्यात मदत करते. आज मी तुमची कशी मदत करू?",
      noMic: 'माफ करा, तुमच्या browser मध्ये माइक काम करत नाही. कृपया Chrome वापरा.',
      micDenied: 'माइकची परवानगी मिळाली नाही. कृपया माइकला परवानगी द्या.'
    },
    bn: {
      title: "ডি'ক্যাল সহায়িকা",
      tagline: 'আপনার ভাষায় বলুন',
      listening: 'শুনছি…',
      tapToSpeak: 'আমাদের products সম্পর্কে যা খুশি জিজ্ঞাসা করুন',
      thinking: 'ভাবছি…',
      greeting: "নমস্কার! ডি'ক্যাল-এ স্বাগতম! আমি আপনার ভয়েস সহায়িকা। products, দাম, অর্ডার — সবেতে সাহায্য করি। আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
      noMic: 'দুঃখিত, আপনার browser-এ মাইক কাজ করছে না। অনুগ্রহ করে Chrome ব্যবহার করুন।',
      micDenied: 'মাইকের অনুমতি পাওয়া যায়নি। অনুগ্রহ করে মাইকের অনুমতি দিন।'
    },
    gu: {
      title: "ડી'કાલ સહાયક",
      tagline: 'તમારી ભાષામાં બોલો',
      listening: 'સાંભળી રહી છું…',
      tapToSpeak: 'અમારા products વિશે કંઈ પણ પૂછો',
      thinking: 'વિચારી રહી છું…',
      greeting: "નમસ્તે! ડી'કાલમાં આપનું સ્વાગત છે! હું તમારી વોઇસ સહાયક છું. products, ભાવ, ઓર્ડર — બધામાં મદદ કરું છું. આજે હું તમારી શું મદદ કરી શકું?",
      noMic: 'માફ કરશો, તમારા browser માં માઇક કામ કરતું નથી. કૃપા કરીને Chrome વાપરો.',
      micDenied: 'માઇકની પરવાનગી મળી નથી. કૃપા કરીને માઇકની પરવાનગી આપો.'
    },
    pa: {
      title: "ਡੀ'ਕਾਲ ਸਹਾਇਕ",
      tagline: 'ਆਪਣੀ ਭਾਸ਼ਾ ਵਿੱਚ ਬੋਲੋ',
      listening: 'ਸੁਣ ਰਹੀ ਹਾਂ…',
      tapToSpeak: 'ਸਾਡੇ products ਬਾਰੇ ਕੁਝ ਵੀ ਪੁੱਛੋ',
      thinking: 'ਸੋਚ ਰਹੀ ਹਾਂ…',
      greeting: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਡੀ'ਕਾਲ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ! ਮੈਂ ਤੁਹਾਡੀ ਵੌਇਸ ਸਹਾਇਕ ਹਾਂ। products, ਕੀਮਤ, ਆਰਡਰ — ਹਰ ਚੀਜ਼ ਵਿੱਚ ਮਦਦ ਕਰਦੀ ਹਾਂ। ਅੱਜ ਮੈਂ ਤੁਹਾਡੀ ਕੀ ਮਦਦ ਕਰ ਸਕਦੀ ਹਾਂ?",
      noMic: 'ਮਾਫ਼ ਕਰਨਾ, ਤੁਹਾਡੇ browser ਵਿੱਚ ਮਾਈਕ ਕੰਮ ਨਹੀਂ ਕਰ ਰਿਹਾ। ਕਿਰਪਾ ਕਰਕੇ Chrome ਵਰਤੋ।',
      micDenied: 'ਮਾਈਕ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ ਮਿਲੀ। ਕਿਰਪਾ ਕਰਕੇ ਮਾਈਕ ਦੀ ਇਜਾਜ਼ਤ ਦਿਓ।'
    },
    or: {
      title: "ଡି'କାଲ ସହାୟିକା",
      tagline: 'ଆପଣଙ୍କ ଭାଷାରେ କୁହନ୍ତୁ',
      listening: 'ଶୁଣୁଛି…',
      tapToSpeak: 'ଆମର products ବିଷୟରେ ଯାହା ବି ପଚାରନ୍ତୁ',
      thinking: 'ଭାବୁଛି…',
      greeting: "ନମସ୍କାର! ଡି'କାଲକୁ ସ୍ୱାଗତ! ମୁଁ ଆପଣଙ୍କ ଭଏସ ସହାୟିକା। products, ଦାମ, ଅର୍ଡର — ସବୁଥିରେ ସାହାଯ୍ୟ କରେ। ଆଜି ମୁଁ ଆପଣଙ୍କୁ କିପରି ସାହାଯ୍ୟ କରିପାରିବି?",
      noMic: 'କ୍ଷମା କରନ୍ତୁ, ଆପଣଙ୍କ browser ରେ ମାଇକ କାମ କରୁନାହିଁ। ଦୟାକରି Chrome ବ୍ୟବହାର କରନ୍ତୁ।',
      micDenied: 'ମାଇକ ଅନୁମତି ମିଳିଲା ନାହିଁ। ଦୟାକରି ମାଇକ ଅନୁମତି ଦିଅନ୍ତୁ।'
    },
    as: {
      title: "ডি'কেল সহায়িকা",
      tagline: 'আপোনাৰ ভাষাত কওক',
      listening: 'শুনি আছোঁ…',
      tapToSpeak: 'আমাৰ products সম্পৰ্কে যিকোনো সোধক',
      thinking: 'ভাবি আছোঁ…',
      greeting: "নমস্কাৰ! ডি'কেললৈ স্বাগতম! মই আপোনাৰ ভইচ সহায়িকা। products, দাম, অৰ্ডাৰ — সকলোতে সহায় কৰোঁ। আজি মই আপোনাক কেনেকৈ সহায় কৰিব পাৰোঁ?",
      noMic: 'ক্ষমা কৰিব, আপোনাৰ browser ত মাইক কাম কৰা নাই। অনুগ্ৰহ কৰি Chrome ব্যৱহাৰ কৰক।',
      micDenied: 'মাইকৰ অনুমতি পোৱা নাযায়। অনুগ্ৰহ কৰি মাইকৰ অনুমতি দিয়ক।'
    },
    ur: {
      title: 'ڈی کال اسسٹنٹ',
      tagline: 'اپنی زبان میں بولیں',
      listening: 'سن رہی ہوں…',
      tapToSpeak: 'ہمارے products کے بارے میں کچھ بھی پوچھیں',
      thinking: 'سوچ رہی ہوں…',
      greeting: 'السلام علیکم! ڈی کال میں خوش آمدید! میں آپ کی وائس اسسٹنٹ ہوں۔ products، قیمت، آرڈر — ہر چیز میں مدد کرتی ہوں۔ آج میں آپ کی کیا مدد کر سکتی ہوں؟',
      noMic: 'معذرت، آپ کے browser میں مائیک کام نہیں کر رہا۔ براہ کرم Chrome استعمال کریں۔',
      micDenied: 'مائیک کی اجازت نہیں ملی۔ براہ کرم مائیک کی اجازت دیں۔'
    }
  };

  /* ---- THE FIRST HELLO ---------------------------------------------------
     The very first thing she says, before anyone has told us anything. It
     cannot come out of the UI table above, because every entry in there is
     already ONE language — and at this moment we do not yet know which one the
     customer speaks. So she greets in all of them at once and invites a reply.

     The customer answering "Namaste" / "Vanakkam" / "Kem Cho" is what tells us:
     the speech-to-text hears the language in their voice, and from that word on
     the whole conversation follows them. She then introduces herself properly
     in THEIR language (UI[lang].greeting) — see maybeIntroduce(). */
  /* Like a good shop assistant: who she is, what she can do for them, and
     then a polite question — never an instruction. Because it already
     introduces her, a customer who only greets back gets UI[lang].helpAsk,
     the question again in their language, not the whole introduction twice. */
  var WELCOME = "Namaste! Vanakkam! Hello! I am Saathi, your D'Cal shopping assistant. I can show you our products, tell you prices and help you order, in your own language. How can I help you today?";

  // Fill pass: guarantee UI[<any language>] answers every lookup, falling back to
  // English. Without this a Kannada turn would hit `undefined.tapToSpeak`.
  (function fillUI() {
    for (var code in LANGS) {
      if (!UI[code]) UI[code] = {};
      for (var key in UI.en) { if (UI[code][key] === undefined) UI[code][key] = UI.en[key]; }
    }
  })();

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
      slug: 'water-softener', price: 3960, rating: 4.9,
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
        te: 'మా ధరలు: ఇంటి వాటర్ సాఫ్ట్‌నర్ ₹3960. షవర్ ఫిల్టర్ మరియు ట్యాప్ ఫిల్టర్ ఒక్కొక్కటి ₹2700. వాషింగ్ మెషిన్ బాల్ ₹500. ట్యాప్ అండ్ టైల్ క్లీనర్ ₹300. అన్నీ చూడటానికి పేజీ తెరుస్తున్నాను.',
        hi: 'हमारे दाम: घर का वाटर सॉफ्टनर ₹3960। शॉवर फ़िल्टर और टैप फ़िल्टर हर एक ₹2700। वॉशिंग मशीन बॉल ₹500। टैप और टाइल क्लीनर ₹300। सब देखने के लिए पेज खोल रही हूँ।',
        en: 'Our prices: the home Water Softener is ₹3960. The Shower Filter and Tap Filter are ₹2700 each. The Washing Machine Ball is ₹500. The Tap and Tile Cleaner is ₹300. I am opening the page so you can see all of them.'
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
        // Every greeting the opening WELCOME line invites them to say back, in
        // native script and romanised — this is how "Vanakkam" is understood as
        // a hello rather than as an unknown word.
        en: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'how are you',
             'namaste', 'namaskar', 'namaskara', 'namaskaram', 'vanakkam', 'kem cho',
             'nomoshkar', 'nomoskar', 'sat sri akal', 'satsriakal', 'adaab', 'salaam',
             'assalamu alaikum', 'namaskaara',
             'வணக்கம்', 'ನಮಸ್ಕಾರ', 'നമസ്കാരം', 'नमस्कार', 'নমস্কার', 'કેમ છો',
             'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'ନମସ୍କାର', 'নমস্কাৰ', 'السلام علیکم']
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
  // These MUST exist in every language the assistant can be spoken to. A customer
  // who just spoke Kannada and was not understood has to hear "I did not
  // understand" in Kannada — an English apology is the one reply that guarantees
  // they give up. (They no longer mention the quick-tap chips or the language
  // buttons: both were removed from the panel.)
  var FALLBACK = {
    te: 'క్షమించండి, నాకు అర్థం కాలేదు. ధరలు, ఎలా కొనాలి, లేదా ఆర్డర్ ట్రాక్ గురించి అడగండి. లేదా ' + PHONE + ' కు కాల్ చేయండి.',
    hi: 'माफ़ कीजिए, मुझे समझ नहीं आया। आप दाम, कैसे खरीदें, या ऑर्डर ट्रैक के बारे में पूछ सकते हैं। या ' + PHONE + ' पर कॉल करें।',
    en: 'Sorry, I did not understand. You can ask about prices, how to buy, or tracking your order. Or call ' + PHONE + '.',
    ta: 'மன்னிக்கவும், எனக்கு புரியவில்லை. விலை, எப்படி வாங்குவது, அல்லது ஆர்டர் டிராக் பற்றி கேளுங்கள். அல்லது ' + PHONE + ' ஐ அழைக்கவும்.',
    kn: 'ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಬೆಲೆ, ಹೇಗೆ ಖರೀದಿಸುವುದು, ಅಥವಾ ಆರ್ಡರ್ ಟ್ರ್ಯಾಕ್ ಬಗ್ಗೆ ಕೇಳಿ. ಅಥವಾ ' + PHONE + ' ಗೆ ಕರೆ ಮಾಡಿ.',
    ml: 'ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല. വില, എങ്ങനെ വാങ്ങാം, അല്ലെങ്കിൽ ഓർഡർ ട്രാക്ക് എന്നിവയെക്കുറിച്ച് ചോദിക്കൂ. അല്ലെങ്കിൽ ' + PHONE + ' ൽ വിളിക്കൂ.',
    mr: 'माफ करा, मला समजले नाही. किंमत, कसे खरेदी करावे, किंवा ऑर्डर ट्रॅक बद्दल विचारा. किंवा ' + PHONE + ' वर कॉल करा.',
    bn: 'দুঃখিত, আমি বুঝতে পারিনি। দাম, কীভাবে কিনবেন, বা অর্ডার ট্র্যাক সম্পর্কে জিজ্ঞাসা করুন। অথবা ' + PHONE + ' নম্বরে কল করুন।',
    gu: 'માફ કરશો, મને સમજાયું નહીં. ભાવ, કેવી રીતે ખરીદવું, અથવા ઓર્ડર ટ્રેક વિશે પૂછો. અથવા ' + PHONE + ' પર કૉલ કરો.',
    pa: 'ਮਾਫ਼ ਕਰਨਾ, ਮੈਨੂੰ ਸਮਝ ਨਹੀਂ ਆਇਆ। ਕੀਮਤ, ਕਿਵੇਂ ਖਰੀਦਣਾ ਹੈ, ਜਾਂ ਆਰਡਰ ਟ੍ਰੈਕ ਬਾਰੇ ਪੁੱਛੋ। ਜਾਂ ' + PHONE + ' ਤੇ ਕਾਲ ਕਰੋ।',
    or: 'କ୍ଷମା କରନ୍ତୁ, ମୁଁ ବୁଝି ପାରିଲି ନାହିଁ। ଦାମ, କିପରି କିଣିବେ, କିମ୍ବା ଅର୍ଡର ଟ୍ରାକ ବିଷୟରେ ପଚାରନ୍ତୁ। କିମ୍ବା ' + PHONE + ' କୁ କଲ କରନ୍ତୁ।',
    as: 'ক্ষমা কৰিব, মই বুজি নাপালোঁ। দাম, কেনেকৈ কিনিব, বা অৰ্ডাৰ ট্ৰেক সম্পৰ্কে সোধক। বা ' + PHONE + ' লৈ কল কৰক।',
    ur: 'معذرت، مجھے سمجھ نہیں آیا۔ آپ قیمت، کیسے خریدیں، یا آرڈر ٹریک کے بارے میں پوچھ سکتے ہیں۔ یا ' + PHONE + ' پر کال کریں۔'
  };
  var FALLBACK2 = {
    te: 'ఇంకా అర్థం కావడం లేదు. దయచేసి మెల్లగా మళ్ళీ చెప్పండి, లేదా ' + PHONE + ' కు కాల్ చేయండి — మా టీమ్ సహాయం చేస్తుంది.',
    hi: 'अभी भी समझ नहीं पाई। कृपया धीरे से फिर कहिए, या ' + PHONE + ' पर कॉल करें — हमारी टीम मदद करेगी।',
    en: 'I still did not catch that. Please say it once more slowly, or call ' + PHONE + ' — our team will help you.',
    ta: 'இன்னும் புரியவில்லை. தயவுசெய்து மெதுவாக மீண்டும் சொல்லுங்கள், அல்லது ' + PHONE + ' ஐ அழைக்கவும் — எங்கள் டீம் உதவும்.',
    kn: 'ಇನ್ನೂ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಧಾನವಾಗಿ ಮತ್ತೆ ಹೇಳಿ, ಅಥವಾ ' + PHONE + ' ಗೆ ಕರೆ ಮಾಡಿ — ನಮ್ಮ ಟೀಮ್ ಸಹಾಯ ಮಾಡುತ್ತದೆ.',
    ml: 'ഇപ്പോഴും മനസ്സിലായില്ല. ദയവായി പതുക്കെ ഒന്നുകൂടി പറയൂ, അല്ലെങ്കിൽ ' + PHONE + ' ൽ വിളിക്കൂ — ഞങ്ങളുടെ ടീം സഹായിക്കും.',
    mr: 'अजूनही समजले नाही. कृपया हळू पुन्हा सांगा, किंवा ' + PHONE + ' वर कॉल करा — आमची टीम मदत करेल.',
    bn: 'এখনও বুঝতে পারিনি। অনুগ্রহ করে ধীরে আবার বলুন, অথবা ' + PHONE + ' নম্বরে কল করুন — আমাদের টিম সাহায্য করবে।',
    gu: 'હજુ પણ સમજાયું નહીં. કૃપા કરીને ધીમેથી ફરી કહો, અથવા ' + PHONE + ' પર કૉલ કરો — અમારી ટીમ મદદ કરશે.',
    pa: 'ਹਾਲੇ ਵੀ ਸਮਝ ਨਹੀਂ ਆਇਆ। ਕਿਰਪਾ ਕਰਕੇ ਹੌਲੀ ਦੁਬਾਰਾ ਕਹੋ, ਜਾਂ ' + PHONE + ' ਤੇ ਕਾਲ ਕਰੋ — ਸਾਡੀ ਟੀਮ ਮਦਦ ਕਰੇਗੀ।',
    or: 'ଏବେ ବି ବୁଝି ପାରିଲି ନାହିଁ। ଦୟାକରି ଧୀରେ ପୁଣି କୁହନ୍ତୁ, କିମ୍ବା ' + PHONE + ' କୁ କଲ କରନ୍ତୁ — ଆମ ଟିମ ସାହାଯ୍ୟ କରିବ।',
    as: 'এতিয়াও বুজি নাপালোঁ। অনুগ্ৰহ কৰি লাহে লাহে পুনৰ কওক, বা ' + PHONE + ' লৈ কল কৰক — আমাৰ টীমে সহায় কৰিব।',
    ur: 'اب بھی سمجھ نہیں آیا۔ براہ کرم آہستہ سے دوبارہ کہیں، یا ' + PHONE + ' پر کال کریں — ہماری ٹیم مدد کرے گی۔'
  };
  // safety net only — every language above is translated, so this should never
  // actually fire; it exists so a newly added LANGS entry cannot crash a reply.
  (function fillFallbacks() {
    for (var code in LANGS) {
      if (!FALLBACK[code]) FALLBACK[code] = FALLBACK.en;
      if (!FALLBACK2[code]) FALLBACK2[code] = FALLBACK2.en;
    }
  })();

  /* ------------------------------------------------------------------ *
   *  4. STYLES                                                          *
   * ------------------------------------------------------------------ */
  // Her photo and her video both live in /images. We resolve them from THIS
  // script's own URL (/js/voice-assistant.js) rather than hard-coding "/images/...",
  // so they keep working from any page depth (root, /html/, /hotel-*) and under any
  // hosting sub-path.
  function asset(name) {
    var s = document.currentScript, src = s && s.src;
    return src ? src.replace(/js\/[^\/]*$/, 'images/' + name) : '/images/' + name;
  }
  // AI_Lady-head.jpg is a head-and-shoulders crop of images/AI_Lady.jpeg. The full
  // photo is a standing namaste shot, so its centre is her hands — cropping to the
  // face is what makes her readable in the 52-60px avatar circles.
  var LADY_IMG   = asset('AI_Lady-head.jpg');
  // The full standing namaste photo. This is her resting pose: once the customer
  // taps the mic she stops bowing and simply STANDS here for the rest of the chat.
  var LADY_STAND = asset('AI_Lady.jpeg');
  var LADY_VIDEO = asset('Lady.mp4');                        // namaskaram — the welcome
  var LADY_TALK  = asset('AI_Lady_conversation.mp4');        // 6s of her talking, upright throughout

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
    + '.dcv-stage,.dcv-foot{opacity:0;transform:translateY(9px);transition:opacity .3s ease,transform .35s ease}'
    + '.dcv-panel.dcv-open .dcv-stage{opacity:1;transform:none;transition-delay:.14s}'
    + '.dcv-panel.dcv-open .dcv-foot{opacity:1;transform:none;transition-delay:.30s}'
    + '@media(max-width:600px){'
    +   '.dcv-panel{left:auto;right:12px;width:min(82vw,296px);max-width:none;box-sizing:border-box;bottom:78px;border-radius:16px}'
    +   '.dcv-head{padding:12px 12px;gap:9px}'
    +   '.dcv-h-title{font-size:14.5px}'
    +   '.dcv-chat .dcv-body{padding:8px 12px 24px}'
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

    // The stage is split in two and nothing overlaps: SHE gets the top half, the
    // conversation gets the bottom half. Bubbles can never climb onto her face
    // however long the chat runs, because they are not on the same layer at all.
    + '.dcv-stage{position:relative;flex:1 1 auto;min-height:0;overflow:hidden;'
    +   'display:flex;flex-direction:column;background:#fff}'
    // Top half — her. The standing photo sits UNDER the video, framed identically
    // (object-position 50% 15% == "center 15%"), so when the video is taken away
    // she does not jump or resize — she simply stops moving. The clip is square
    // (960x960) in a wide box, so the crop is chosen to hold her FACE.
    // Before anyone has spoken to her she gets the WHOLE stage — a full standing
    // welcome, with no empty white box under her. She shrinks to the top half
    // only once the conversation actually starts and there is text to show.
    + '.dcv-face{position:relative;flex:0 0 100%;min-height:0;overflow:hidden;'
    +   'background:#fff url("' + LADY_STAND + '") no-repeat center 15%/cover;'
    +   'transition:flex-basis .35s ease}'
    + '.dcv-chat .dcv-face{flex-basis:50%}'
    // In the split view her box is about twice as wide as it is tall, but she is
    // a SQUARE 960x960 — filling that box means slicing her off at the chest.
    // So while chatting she is fitted whole instead of cropped. Her own
    // background is white and so is the panel, so the fit is invisible: she
    // simply stands there complete, rather than being cut in half.
    + '.dcv-chat .dcv-face{background-size:contain;background-position:center}'
    + '.dcv-chat .dcv-face .dcv-vid{object-fit:contain;object-position:center}'
    + '.dcv-face .dcv-vid{position:absolute;inset:0;width:100%;height:100%;'
    +   'object-fit:cover;object-position:50% 15%;background:#fff;display:none}'
    // Exactly one of the three faces is on at a time, set by setFace():
    //   is-greet -> the namaskaram clip   (waiting to be spoken to)
    //   is-talk  -> the conversation clip (she is saying a reply, lips moving)
    //   neither  -> the standing photo    (engaged, but silent)
    + '.dcv-face.is-greet .dcv-vid-greet{display:block}'
    + '.dcv-face.is-talk .dcv-vid-talk{display:block}'

    // Bottom half — the conversation. A real area of its own, on white, so the
    // text is always readable and never sits over her sari.
    // Hidden entirely until the conversation starts, so the waiting screen is
    // all her rather than her plus an empty white panel.
    + '.dcv-body{display:none}'
    + '.dcv-chat .dcv-body{flex:1 1 auto;min-height:0;padding:10px 14px 26px;overflow-y:auto;'
    +   'display:flex;flex-direction:column;background:#fff;'
    // Fade the top edge, so a message scrolling up under her does not leave a
    // hard-sliced sliver of a bubble sitting on the join. Fades to white, which
    // is what is behind it, so it simply disappears.
    +   '-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 12px);'
    +   'mask-image:linear-gradient(to bottom,transparent 0,#000 12px)}'
    + '.dcv-body>.dcv-msg{flex:0 0 auto}'
    // Sit the conversation on the BOTTOM of its half while it is still short.
    // Done with margin-top:auto, not justify-content:flex-end — the latter pushes
    // overflow off the top where no browser will let you scroll back to it.
    + '.dcv-body>.dcv-msg:first-child{margin-top:auto}'
    + '.dcv-msg{margin:8px 0;display:flex}'
    + '.dcv-msg.dcv-you{justify-content:flex-end}'
    + '.dcv-bub{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}'
    + '.dcv-bot .dcv-bub{background:#eef6fa;color:#08334a;border-bottom-left-radius:4px}'
    + '.dcv-you .dcv-bub{background:#0077B6;color:#fff;border-bottom-right-radius:4px}'
    // status ("Listening…") sits along the bottom of the video on a soft white fade
    // so it reads over her; when there is nothing to say it disappears entirely.
    + '.dcv-status{position:absolute;left:0;right:0;bottom:0;text-align:center;font-size:12.5px;font-weight:600;color:#08334a;padding:14px 10px 7px;'
    +   'background:linear-gradient(to top,rgba(255,255,255,.95),rgba(255,255,255,0));pointer-events:none}'
    + '.dcv-status:empty{display:none}'


    + '.dcv-foot{display:flex;align-items:center;gap:10px;padding:11px 14px;border-top:1px solid #eef2f4;background:#fafcfd;flex:0 0 auto}'
    + '.dcv-mic{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,#0077B6,#00B4D8);'
    +   'color:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto;position:relative;transition:.15s}'
    + '.dcv-mic:active{transform:scale(.93)}'
    + '.dcv-mic svg{width:24px;height:24px}'
    // talking-lady avatar: her photo swaps in for the mic while she speaks
    + '.dcv-ic{display:flex;align-items:center;justify-content:center}'
    + '.dcv-ic-lady{display:none;position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#fff}'
    // the floating bubble IS her face: show the photo, hide the mic there always
    + '.dcv-fab .dcv-ic-mic{display:none}'
    + '.dcv-fab .dcv-ic-lady{display:block}'
    // the footer button stays a mic ("press to speak"), swapping to her face only while she speaks
    + '.dcv-speaking .dcv-ic-mic{display:none}'
    + '.dcv-speaking .dcv-ic-lady{display:block}'
    // her photo is already cropped to head + shoulders, so it reads at 52-60px
    + '.dcv-lady{position:relative;display:block;width:100%;height:100%;background:#fff url("' + LADY_IMG + '") no-repeat center/cover}'
    // the old fake "open mouth" is gone: this photo is a smile with teeth, so a dark
    // blob over her lips read as a smudge — and the panel video now does the real
    // talking. While she speaks the small avatar just breathes gently instead.
    + '.dcv-speaking .dcv-lady{animation:dcvTalk 1s ease-in-out infinite}'
    + '@keyframes dcvTalk{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}'
    + '.dcv-mic.dcv-live{background:linear-gradient(135deg,#e63946,#f77f8b)}'
    + '.dcv-mic.dcv-live::after{content:"";position:absolute;inset:-7px;border-radius:50%;border:3px solid rgba(230,57,70,.5);animation:dcvPulse 1.3s ease-out infinite}'
    + '.dcv-mic-label{flex:1;min-width:0;font-size:13.5px;color:#3a5c6b;font-weight:600;line-height:1.25;overflow:hidden}'
    // line 1 — the invitation, up to two lines then ellipsis
    + '.dcv-mic-label b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:700}'
    // line 2 — the language scripts, smaller and lighter, always one line
    + '.dcv-mic-label i{display:block;margin-top:2px;font-style:normal;font-weight:600;font-size:10.5px;letter-spacing:.1px;'
    +   'color:#6d93a4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    // while listening the label is plain text (transcript), so clamp it there instead
    + '.dcv-mic-label.dcv-live-txt{color:#08334a;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '.dcv-stop{width:40px;height:40px;border-radius:50%;border:1px solid #d6e3e9;background:#fff;color:#0077B6;cursor:pointer;flex:0 0 auto;display:none;align-items:center;justify-content:center}'
    + '.dcv-stop.on{display:flex}'
    + '.dcv-stop svg{width:18px;height:18px}'

    + '.dcv-typing span{display:inline-block;width:6px;height:6px;margin:0 1px;border-radius:50%;background:#8fb4c4;animation:dcvBlink 1s infinite}'
    + '.dcv-typing span:nth-child(2){animation-delay:.2s}.dcv-typing span:nth-child(3){animation-delay:.4s}'
    + '@keyframes dcvBlink{0%,100%{opacity:.3}50%{opacity:1}}'

    // SPOTLIGHT (section 8c). The hole: a ring around the product card, and —
    // while she talks about it — the rest of the page dimmed by its own shadow.
    // Under the panel and the mic (9990 < 9998), never over them. display is
    // forced because the theme hides every empty div (base.css div:empty).
    + '.dcv-spot-hole{display:block!important;position:absolute;left:0;top:0;width:0;height:0;z-index:9990;pointer-events:none;border-radius:18px;opacity:0;'
    +   'box-shadow:0 0 0 3px #00B4D8,0 0 24px 6px rgba(0,180,216,.5);transition:opacity .2s ease,box-shadow .35s ease}'
    + '.dcv-spot-hole.on{opacity:1}'
    + '.dcv-spot-hole.dim{box-shadow:0 0 0 3px #00B4D8,0 0 24px 6px rgba(0,180,216,.5),0 0 0 200vmax rgba(2,30,46,.45)}'
    + '.dcv-spot-hole.dcv-glide{transition:opacity .2s ease,box-shadow .35s ease,left .35s ease,top .35s ease,width .35s ease,height .35s ease}'
    + '.dcv-spot-hole::after,.dcv-spot-card::after{content:"";position:absolute;inset:0;border-radius:inherit;border:3px solid #00B4D8;pointer-events:none;animation:dcvSpot 1.4s ease-out infinite}'
    + '@keyframes dcvSpot{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.05);opacity:0}}'
    // The card: the product shown beside her when it is not on this page, or
    // she would be standing in front of it (a phone; the grid column under her).
    + '.dcv-spot-card{position:fixed;z-index:9999;right:380px;bottom:96px;width:280px;box-sizing:border-box;display:flex;align-items:center;gap:12px;'
    +   'padding:10px 12px 10px 10px;background:#fff;border-radius:16px;text-decoration:none;color:#023047;'
    +   'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
    +   'box-shadow:0 0 0 3px #00B4D8,0 0 26px 4px rgba(0,180,216,.45),0 24px 50px -18px rgba(2,48,71,.55);'
    +   'opacity:0;transform:translateY(12px) scale(.95);transition:opacity .2s ease,transform .25s ease;pointer-events:none}'
    + '.dcv-spot-card.on{opacity:1;transform:none;pointer-events:auto}'
    + '.dcv-spot-card img{width:76px;height:76px;flex:0 0 auto;border-radius:12px;object-fit:cover;background:#ECF9FF}'
    + '.dcv-sc-txt{min-width:0;flex:1}'
    + '.dcv-sc-t{font-weight:700;font-size:14px;line-height:1.25}'
    + '.dcv-sc-m{margin-top:5px;font-size:12.5px;font-weight:600;color:#4b6b7a}'
    + '.dcv-sc-p{color:#0077B6;font-weight:800;font-size:15px;margin-right:6px}'
    + '.dcv-sc-go{display:inline-block;margin-top:7px;font-size:12px;font-weight:700;color:#fff;background:#0077B6;border-radius:8px;padding:5px 10px}'
    + '@media(max-width:700px){.dcv-spot-card{right:12px;width:min(82vw,296px)}}'
    // Signing in by voice: on a wide screen she stays visible ABOVE the sign-in
    // box (html.dcal-lock is set while it is open; the box is centred, she is at
    // the side). On a phone the box is a bottom sheet she would cover, so not there.
    + '@media(min-width:900px){html.dcal-lock .dcv-panel,html.dcal-lock .dcv-fab{z-index:10001}}'
    + '@media(prefers-reduced-motion:reduce){.dcv-spot-hole::after,.dcv-spot-card::after{animation:none}.dcv-spot-hole.dcv-glide{transition:opacity .2s ease}}'
    + '@media(prefers-reduced-motion:reduce){.dcv-fab,.dcv-fab .dcv-ring,.dcv-fab.dcv-pop::before,.dcv-fab.dcv-pop svg,.dcv-mic.dcv-live::after,.dcv-speaking .dcv-lady{animation:none}'
    +   '.dcv-panel.dcv-open{animation:none}.dcv-panel{transition:opacity .2s ease}.dcv-stage,.dcv-foot{transition:none;transform:none}}';

  /* ------------------------------------------------------------------ *
   *  5. BUILD DOM                                                       *
   * ------------------------------------------------------------------ */
  var MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  var MIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>';
  // Female avatar shown IN PLACE of the mic while the assistant is speaking.
  // It is a real photo (LADY_IMG) painted as a background so CSS can crop it to
  // the face and give it a gentle "talking" pulse.
  var LADY_AV = '<span class="dcv-lady"></span>';

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  var fab = document.createElement('button');
  fab.className = 'dcv-fab';
  fab.setAttribute('aria-label', 'Voice assistant');
  fab.innerHTML = '<span class="dcv-ring"></span><span class="dcv-ic dcv-ic-mic">' + MIC_SVG + '</span><span class="dcv-ic dcv-ic-lady">' + LADY_AV + '</span><span class="dcv-hint"></span>';

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
    // her video replaces the language buttons + the welcome bubble. It loops for as
    // long as the panel is open, so she is always "there" — not only while talking.
    // muted: the real voice comes from ElevenLabs, so the clip must stay silent
    //        (it is also what lets browsers autoplay it at all).
    // poster: her photo, so the box shows her face instead of black while it loads.
    // preload=none and NO autoplay attribute: with autoplay the browser would fetch
    //        all 6MB on every page load even while the assistant sits closed. Instead
    //        openPanel() calls play(), which starts the download only when she is
    //        actually shown. A muted video is allowed to play without a user gesture.
    // the stage fills everything between the header and the mic bar: the video IS
    // the panel. Replies and the status line float on top of her rather than
    // taking space away from her.
    + '<div class="dcv-stage">'
    // Two clips, two elements — NOT one element whose src is swapped. Swapping
    // src throws away everything the browser had buffered and starts the 5MB
    // download again, which is exactly the delay we are trying to remove. Kept
    // apart, each holds its own buffer and resumes instantly.
    +   '<div class="dcv-face is-greet">'
    +     '<video class="dcv-vid dcv-vid-greet" playsinline muted loop preload="none" '
    +            'poster="' + LADY_STAND + '" src="' + LADY_VIDEO + '"></video>'
    +     '<video class="dcv-vid dcv-vid-talk" playsinline muted loop preload="none" '
    +            'src="' + LADY_TALK + '"></video>'
    +   '</div>'
    +   '<div class="dcv-body"></div>'
    +   '<div class="dcv-status"></div>'
    + '</div>'
    + '<div class="dcv-foot">'
    +   '<button class="dcv-mic" aria-label="Speak"><span class="dcv-ic dcv-ic-mic">' + MIC_SVG + '</span><span class="dcv-ic dcv-ic-lady">' + LADY_AV + '</span></button>'
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
    face:     panel.querySelector('.dcv-face'),
    vidGreet: panel.querySelector('.dcv-vid-greet'),
    vidTalk:  panel.querySelector('.dcv-vid-talk'),
    body:     panel.querySelector('.dcv-body'),
    status:   panel.querySelector('.dcv-status'),
    micBtn:   panel.querySelector('.dcv-mic'),
    micLabel: panel.querySelector('.dcv-mic-label'),
    stopBtn:  panel.querySelector('.dcv-stop'),
    minBtn:   panel.querySelector('.dcv-min'),
    closeBtn: panel.querySelector('.dcv-close')
  };

  /* ------------------------------------------------------------------ *
   *  6. VOICE  (ElevenLabs — natural Indian female voice)               *
   * ------------------------------------------------------------------ */
  // Two voices, in order of preference. ElevenLabs is the one we want: real
  // Telugu/Hindi in a natural voice. The server proxies the call and keeps the
  // API key secret; the widget probes /api/tts/health once in INIT.
  // If ElevenLabs is not configured or a call fails, she drops to the browser's
  // free speechSynthesis voice rather than going silent — for a customer who
  // cannot read, a silent assistant is a broken one. onEnd fires either way, so
  // navigation and follow-ups continue exactly as before.
  var TTS_URL = '/api/tts';
  var ttsReady = false;        // true once the server reports ElevenLabs is on
  var ttsAudio = null;         // the currently-playing ElevenLabs <audio>, if any
  var ttsUtter = null;         // the currently-speaking browser utterance, if any
  var speakSeq = 0;            // bumped whenever we start or stop — cancels older speaks
  var TTS_URL_MAX = 4000;      // keep the GET comfortably inside every proxy's URL limit
  // Where she is in the line she is saying — so that when the customer talks
  // over her we can tell the brain how much of it they actually heard.
  var speakingText = '';       // the line being spoken right now
  var voiceStartedAt = 0;      // when her audio really began playing (0 = not yet)
  var utterCharIndex = 0;      // browser voice: the character it has reached
  var navTimer = null;         // speakThenGo's backstop — cancelled when she is interrupted

  function stopTtsAudio() {
    speakSeq++;                                   // anything already in flight is now stale
    // Interrupted = the page she was about to open is no longer wanted either.
    if (navTimer) { clearTimeout(navTimer); navTimer = null; }
    vadStop();                                    // stop listening FOR an interruption: there is nothing left to interrupt
    voicePaused = false;
    stopBrowserVoice();                           // whichever voice is talking, stop it
    var a = ttsAudio; ttsAudio = null;
    if (!a) return;
    a.onended = null; a.onerror = null;           // being interrupted must NOT fire onEnd
    try { a.pause(); } catch (e) {}
    if (a.__objUrl) { try { URL.revokeObjectURL(a.__objUrl); } catch (e) {} a.__objUrl = null; }
    try { a.removeAttribute('src'); a.load(); } catch (e) {}   // also aborts the download
  }

  function ttsGetUrl(text) {
    return TTS_URL + '?lang=' + encodeURIComponent(lang) + '&text=' + encodeURIComponent(text);
  }

  /* ---- FREE BROWSER VOICE (the fallback) -------------------------------
     No key, no cost, no network. It is plainly robotic next to ElevenLabs and
     its Indian-language coverage depends entirely on the device — good on
     Android, patchy on a Windows desktop — but it means the assistant TALKS
     without a paid key, and every path below is skipped the moment one exists. */
  var SPEECH = window.speechSynthesis || null;
  // BCP-47 tag per widget language, so the browser can pick a matching voice.
  var VOICE_TAG = {
    te: 'te-IN', hi: 'hi-IN', en: 'en-IN', ta: 'ta-IN', kn: 'kn-IN',
    ml: 'ml-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN',
    or: 'or-IN', as: 'as-IN', ur: 'ur-IN'
  };
  /* She is female, and a voice's NAME is all the browser gives us to judge by.
     MALE_RE exists only to rule voices OUT. Note it is written \bmale\b on
     purpose: a bare /male/ also matches every voice called "female". */
  var FEMALE_RE = /female|woman|\b(heera|kalpana|swara|veena|raveena|zira|susan|samantha|karen|moira)\b/i;
  var MALE_RE   = /\bmale\b|\bman\b|\b(hemant|ravi|madhur|prabhat|kumar|rishi|david|mark|guy|alex|daniel|george|fred)\b/i;

  function pickVoice(tag) {
    if (!SPEECH || !SPEECH.getVoices) return null;
    var all = SPEECH.getVoices() || [];
    if (!all.length) return null;
    var want = String(tag || 'en-IN').toLowerCase();
    var base = want.split('-')[0];
    var norm = function (v) { return String(v.lang || '').toLowerCase().replace('_', '-'); };
    // Everything that speaks this LANGUAGE, with the exact region sorted to the
    // front (hi-IN ahead of any other hi-*). One pool rather than "exact, else
    // widen": if the only en-IN voice is a man, we still want to reach the
    // en-US woman below him instead of stopping at him.
    var pool = all.filter(function (v) { return norm(v).indexOf(base) === 0; });
    if (!pool.length) return null;
    pool.sort(function (a, b) {                   // stable: ties keep their order
      return (norm(b) === want ? 1 : 0) - (norm(a) === want ? 1 : 0);
    });
    var i;
    for (i = 0; i < pool.length; i++) {
      if (FEMALE_RE.test(pool[i].name || '')) return pool[i];      // a named female voice
    }
    for (i = 0; i < pool.length; i++) {
      if (!MALE_RE.test(pool[i].name || '')) return pool[i];       // at least not a male one
    }
    return pool[0];
  }

  // Chrome fills getVoices() asynchronously and returns [] on the first call, so
  // warm it early — otherwise her very first line picks no voice at all.
  if (SPEECH) {
    try {
      SPEECH.getVoices();
      if ('onvoiceschanged' in SPEECH) {
        SPEECH.addEventListener('voiceschanged', function () { try { SPEECH.getVoices(); } catch (e) {} });
      }
    } catch (e) {}
  }

  /* Indic (Devanagari … Malayalam) and Arabic/Urdu. If a line contains any of
     these, only a voice for that language can say it — see speakBrowser(). */
  var NON_LATIN = /[\u0900-\u0DFF\u0600-\u06FF]/;

  /* Every line she can say, mapped to its own English wording. Built once from
     the same tables the replies come from, so it stays correct automatically as
     those tables change. This is what lets a device with no Telugu voice say the
     line in ENGLISH instead of reading digits at the customer. */
  var EN_OF = (function () {
    var m = {}, i, k, f;
    function pair(o) {                              // {te:…, hi:…, en:…} -> te->en, hi->en
      if (!o || typeof o.en !== 'string') return;
      for (var c in o) if (c !== 'en' && typeof o[c] === 'string') m[o[c]] = o.en;
    }
    for (i = 0; i < INTENTS.length; i++) pair(INTENTS[i].reply);
    pair(FALLBACK);
    pair(FALLBACK2);
    for (k in UI) {                                 // UI is {lang: {field: text}}
      if (k === 'en') continue;
      for (f in UI[k]) {
        if (typeof UI[k][f] === 'string' && typeof UI.en[f] === 'string') m[UI[k][f]] = UI.en[f];
      }
    }
    return m;
  })();

  function stopBrowserVoice() {
    if (!SPEECH) return;
    var u = ttsUtter; ttsUtter = null;
    // Being interrupted must NOT fire onEnd — same rule as the ElevenLabs path,
    // or cancelling a reply would trigger the navigation it was going to do.
    if (u) { u.onend = null; u.onerror = null; }
    try { SPEECH.cancel(); } catch (e) {}
  }

  // Same contract as the ElevenLabs path: finish() runs exactly once, and never
  // at all if this speak was superseded before it ended.
  function speakBrowser(text, mine, finish) {
    if (!SPEECH || !window.SpeechSynthesisUtterance || mine !== speakSeq) { finish(); return; }
    var s = String(text || '');
    var tag = VOICE_TAG[lang] || 'en-IN';
    var v = pickVoice(tag);

    /* THE IMPORTANT BIT. A voice that cannot read this script does not politely
       decline — Windows voices pronounce the Unicode code points, so a Telugu
       greeting comes out as a long string of NUMBERS. Most desktops ship no
       Telugu/Tamil/Kannada voice at all, so this is the common case, not the
       rare one.
       So: no voice for this language + a non-Latin line => say the English
       wording instead. English she can always pronounce, and being understood in
       the wrong language beats digits in the right one. If there is no English
       wording for this particular line, say NOTHING — onEnd still fires, so the
       conversation carries on exactly as if she had spoken. */
    if (!v && NON_LATIN.test(s)) {
      var en = EN_OF[s];
      if (!en) { finish(); return; }
      s = en;
      tag = 'en-IN';
      v = pickVoice(tag);
    }

    var u;
    try { u = new SpeechSynthesisUtterance(s); } catch (e) { finish(); return; }
    u.lang = tag;
    if (v) u.voice = v;
    // If we could not find a voice the browser itself calls female, lift the
    // pitch a little so she at least reads as the woman on screen.
    u.pitch = (v && FEMALE_RE.test(v.name || '')) ? 1 : 1.15;
    u.rate = 1.02;

    var done = false, tick = null;
    function end() {
      if (done) return;
      done = true;
      if (tick) { clearInterval(tick); tick = null; }
      if (ttsUtter === u) ttsUtter = null;
      if (mine !== speakSeq) return;              // superseded -> stay quiet about it
      finish();
    }
    u.onend = end;
    u.onerror = end;
    u.onstart = function () { voiceStartedAt = Date.now(); vlogVoice(); };
    u.onboundary = function (ev) { if (ev && typeof ev.charIndex === 'number') utterCharIndex = ev.charIndex; };
    ttsUtter = u;
    setSpeaking(true);                            // talking-lady avatar on
    try { SPEECH.speak(u); } catch (e) { end(); return; }

    /* Some browsers simply never fire 'end'. Poll instead of trusting it, and
       only give up once the engine says it has stopped — or once even a generous
       estimate of the speaking time has passed, so a wedged engine cannot leave
       the turn hanging forever. */
    var started = Date.now();
    var maxMs = Math.max(4000, s.length * 120 + 3000);   // s, not text: she may be saying the English line
    tick = setInterval(function () {
      if (done) { clearInterval(tick); tick = null; return; }
      if (mine !== speakSeq) { clearInterval(tick); tick = null; return; }
      if (!SPEECH.speaking && !SPEECH.pending) { end(); return; }
      if (Date.now() - started > maxMs) { try { SPEECH.cancel(); } catch (e) {} end(); }
    }, 400);
  }

  // speak(text[, onEnd]) — play the reply in the ElevenLabs voice. onEnd fires
  // exactly once, when the voice truly finishes (or immediately when there is no
  // voice to play), so callers can navigate only after the reply is spoken.
  //
  // The fast path hands the URL straight to an <audio> element: the browser then
  // streams it and starts playing the first chunk while the server is still
  // pulling the rest out of ElevenLabs. Fetching a blob instead — what we used to
  // do — cannot make a sound until the entire clip has been generated AND
  // downloaded, which is most of the delay before she starts talking.
  function speak(text, onEnd) {
    stopTtsAudio();
    var mine = speakSeq;                          // stale as soon as anyone speaks/stops again
    var handled = false;
    function finish() {
      if (handled) return; handled = true;
      // Superseded — the customer talked over her, tapped the mic, or another
      // line replaced this one. Whoever did that owns what happens next; the
      // page this reply was going to open, the mic it was going to reopen, are
      // not wanted any more.
      if (mine !== speakSeq) return;
      setSpeaking(false);
      onVoiceDone();
      if (onEnd) onEnd();
    }
    var s = String(text || '');
    if (!s.trim()) { finish(); return; }
    speakingText = s; voiceStartedAt = 0; utterCharIndex = 0;
    // No ElevenLabs key -> her free browser voice rather than silence. No
    // barge-in on this path: the browser voice is not echo-cancelled, so through
    // the mic she would sound exactly like a customer talking over her.
    if (!ttsReady) { speakBrowser(s, mine, finish); return; }
    armBargeIn(mine);                             // from here on, the customer can talk over her

    var url = ttsGetUrl(s);
    if (url.length <= TTS_URL_MAX) {              // stream it
      playAudio(url, mine, finish, function () { speakViaPost(s, mine, finish); });
      return;
    }
    speakViaPost(s, mine, finish);                // reply too long for a URL
  }

  // Play one source and report back. `onFail` runs only when nothing was ever
  // heard, so the caller can try another route; once a single note has played we
  // just finish normally.
  function playAudio(url, mine, finish, onFail, objUrl) {
    if (mine !== speakSeq) {
      if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) {} }
      finish(); return;
    }
    var a = new Audio(); ttsAudio = a;
    a.preload = 'auto';
    if (objUrl) a.__objUrl = objUrl;
    var started = false, settled = false, endGuard = null;
    function release() {
      if (endGuard) { clearTimeout(endGuard); endGuard = null; }
      if (a.__objUrl) { try { URL.revokeObjectURL(a.__objUrl); } catch (e) {} a.__objUrl = null; }
      if (ttsAudio === a) ttsAudio = null;
    }
    function ok()  { if (settled) return; settled = true; release(); finish(); }
    function bad() {
      if (settled) return; settled = true; release();
      if (!started && onFail && mine === speakSeq) onFail(); else finish();
    }
    a.onplaying = function () { started = true; if (!voiceStartedAt) voiceStartedAt = Date.now(); vlogVoice(); };
    a.onended = ok;
    a.onerror = bad;
    // A streamed reply has no Content-Length, so the browser only learns how long
    // it is once the stream closes. Don't stake the end of the turn — which is
    // what triggers navigation — purely on the 'ended' event firing for such a
    // clip: as soon as a real duration is known, watch the clock ourselves and
    // finish on time even if the event never comes.
    a.ondurationchange = function () {
      if (settled || !isFinite(a.duration) || a.duration <= 0) return;
      if (endGuard) clearTimeout(endGuard);
      (function arm() {
        var left = (a.duration - (a.currentTime || 0)) * 1000 + 400;
        endGuard = setTimeout(function () {
          if (settled) return;
          // still genuinely playing (buffering made it run late) -> wait some more
          if (!a.ended && isFinite(a.duration) && a.currentTime < a.duration - 0.25) { arm(); return; }
          ok();
        }, Math.max(400, left));
      })();
    };
    a.src = url;
    setSpeaking(true);                            // talking-lady avatar on
    var p = a.play();
    if (p && p.catch) p.catch(function (err) {
      if (err && err.name === 'NotAllowedError') ok();   // autoplay blocked -> silent, but carry on
      // We paused or stopped it ourselves (the barge-in probe, or an
      // interruption) before it had started: not a failure, nothing to retry.
      else if (err && err.name === 'AbortError' && (voicePaused || mine !== speakSeq)) { /* ours */ }
      else bad();                                        // could not load -> let the caller retry
    });
  }

  // Fallback: POST the text and play the finished clip. Slower — nothing is heard
  // until the whole file exists — but it survives a proxy that mangles the GET,
  // carries replies too long for a URL, and is the only path that can read the
  // HTTP status, which is how we notice ElevenLabs has been switched off.
  function speakViaPost(text, mine, finish) {
    if (mine !== speakSeq) { finish(); return; }
    fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, lang: lang })
    }).then(function (r) {
      if (!r.ok) { if (r.status === 503) ttsReady = false; throw new Error('tts ' + r.status); }
      return r.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      playAudio(url, mine, finish, null, url);
    }).catch(function () { if (!vlogLeaving && mine === speakSeq) vlogEv('tts_failed'); speakBrowser(text, mine, finish); });   // API down -> browser voice
  }

  // Pull a line she is about to say into the caches ahead of time. The server
  // keeps the generated audio and answers with `max-age`, so the browser has it
  // too — the real play then starts instantly instead of waiting on ElevenLabs.
  function prefetchTts(text) {
    if (!ttsReady) return;
    var s = String(text || '');
    if (!s.trim()) return;
    var url = ttsGetUrl(s);
    if (url.length > TTS_URL_MAX) return;
    try {
      fetch(url, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .catch(function () {});
    } catch (e) {}
  }

  function stopSpeaking() { stopTtsAudio(); setSpeaking(false); }

  /* ------------------------------------------------------------------ *
   *  7. SPEECH RECOGNITION  (listen)                                    *
   * ------------------------------------------------------------------ */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var recog = null, listening = false, listenRetry = 0, userStopped = false;

  /* ---- FOLLOW THE CUSTOMER'S LANGUAGE — without the server ----------------
     The normal path (7b) records the audio and the server's recogniser tells
     us which language it was. When that is unavailable, the browser's own
     recogniser has to be TOLD a language in advance — and it used to be told
     whatever the reply language happened to be, so a customer who switched
     from Hindi to English was heard as Hindi gibberish, and answered in Hindi.

     What CAN be done without the server:
       1. The language we LISTEN in (`hearLang`) is the one the customer last
          actually spoke, separate from the reply language, which the widget
          may switch for other reasons.
       2. The SCRIPT of what came back says what they spoke. Devanagari is
          Hindi, Telugu script is Telugu, Latin letters are English. The reply
          follows that, turn by turn, as it does with the server — and the
          recogniser follows them too. An Indian-language model also hears the
          English words Indians mix into every sentence, so a Hindi speaker who
          switches to English is understood and answered in English.
     What cannot: an English model hears no Hindi at all, so a customer who
     switches from English INTO Hindi is misheard until they tap and try
     again. Only the server's recogniser, which listens to the sound itself,
     truly detects the language — that is the path to keep configured. */
  var hearLang = lang;
  var SCRIPTS = [
    [/[ఀ-౿]/, ['te']], [/[ऀ-ॿ]/, ['hi', 'mr']], [/[஀-௿]/, ['ta']],
    [/[ಀ-೿]/, ['kn']], [/[ഀ-ൿ]/, ['ml']], [/[ঀ-৿]/, ['bn', 'as']],
    [/[઀-૿]/, ['gu']], [/[਀-੿]/, ['pa']], [/[଀-୿]/, ['or']],
    [/[؀-ۿ]/, ['ur']]
  ];
  // The language a piece of recognised text was spoken in, judged by its
  // script; null if there is no way to tell. A script shared by two languages
  // (Devanagari: Hindi and Marathi) is read as the one we were listening in,
  // if that is one of them — the recogniser will not have heard the other.
  function scriptLang(text) {
    var s = String(text || '');
    for (var i = 0; i < SCRIPTS.length; i++) {
      if (!SCRIPTS[i][0].test(s)) continue;
      var owners = SCRIPTS[i][1];
      return owners.indexOf(hearLang) !== -1 ? hearLang : owners[0];
    }
    return /[A-Za-z]/.test(s) ? 'en' : null;
  }

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
    r.lang = LANGS[hearLang].code;   // listen in the language they last spoke
    r.interimResults = true;      // live feedback while the user speaks
    r.maxAlternatives = 3;        // consider 3 guesses; pick the one we understand
    r.continuous = false;
    r.onstart = function () {
      listening = true; setLive(true);
      // The recogniser only starts once the mic is allowed — so from her next
      // line on, she may open it quietly herself and be talked over (7c).
      micGranted = true;
      try { localStorage.setItem(MIC_KEY, '1'); } catch (e) {}
    };
    r.onresult = function (ev) {
      var last = ev.results[ev.results.length - 1];
      if (!last) return;
      if (!last.isFinal) {                                  // LIVE: show what we hear, corrected
        var itxt = (last[0] && last[0].transcript) || '';
        setMicText(itxt ? autoCorrect(itxt) : UI[lang].listening);
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
      // FOLLOW THE CUSTOMER: what script did they speak in? English -> answer
      // in English; Hindi -> Hindi; and listen in that language next time.
      var heard = scriptLang(chosenText);
      if (heard && LANGS[heard]) {
        hearLang = heard;
        if (heard !== lang) { applyLang(heard); chosenIntent = null; }   // re-match in the right language
      }
      vlogTurn('recogniser', Date.now());
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

  /* ------------------------------------------------------------------ *
   *  7b. RECORD + DETECT LANGUAGE  (server /api/stt via ElevenLabs)      *
   *      The browser's own recogniser has to be TOLD the language up     *
   *      front, which is exactly what we don't know — a customer just    *
   *      presses the mic and talks. So we record the audio instead and   *
   *      let the server tell us BOTH what they said and which language   *
   *      they said it in; the whole conversation then follows them.      *
   *      If this is unavailable we fall back to the browser recogniser.  *
   * ------------------------------------------------------------------ */
  var STT_URL = '/api/stt';
  var ASK_URL = '/api/ask';        // transcribe + answer + start the voice, in one request
  var MR = window.MediaRecorder || null;
  var canRecord = !!(MR && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.Blob);
  var sttReady = false;                      // server has speech-to-text configured
  var rec = null, recChunks = [], recCapTimer = null;
  var recHeardMs = 0;                        // how much of the current clip had someone talking
  var askSeq = 0;                            // the turn being answered; bumped when the customer speaks again
  var sttChecked = false;                    // the /api/stt/health probe has answered (either way)

  /* ---- HANDS-FREE: the conversation carries across pages ----------------
     When she opens a page for the customer, the page reloads and this whole
     script starts again — and until now the mic came back OFF, so a customer
     who cannot read was stranded on a page they could only leave by tapping.
     `handsFree` remembers (per tab) that a voice conversation is in progress;
     the next page reads it and simply starts listening again, no tap needed.
     While nobody is talking she keeps the mic open and listens quietly: an
     empty clip is thrown away, never uploaded, never answered with "sorry". */
  var LIVE_KEY = 'dcal_voice_live';
  var handsFree = false;
  try { handsFree = sessionStorage.getItem(LIVE_KEY) === '1'; } catch (e) {}
  function setHandsFree(on) {
    handsFree = !!on;
    try { sessionStorage.setItem(LIVE_KEY, on ? '1' : '0'); } catch (e) {}
  }
  var SILENT_MAX_MS = 10 * 60 * 1000;        // ten minutes of nobody talking -> she lets the mic go
  var silentSince = 0;
  // A clip with nobody on it. Say nothing, send nothing; just listen again.
  function keepListeningQuietly() {
    if (!handsFree || !opened || userStopped) return;
    if (!silentSince) silentSince = Date.now();
    if (Date.now() - silentSince > SILENT_MAX_MS) { silentSince = 0; closeMic(); return; }
    listenAgain();
  }
  // The page was opened BY her, mid-conversation: pick the conversation up
  // where it was — once we know whether the server recogniser is available,
  // so the first turn on this page listens the same way the last one did.
  function resumeHandsFree() {
    var t0 = Date.now();
    (function wait() {
      if (!opened || listening || userStopped) return;
      if (!sttChecked && Date.now() - t0 < 2500) { setTimeout(wait, 100); return; }
      startListening();
    })();
  }

  /* A health check that FAILS is not a server saying "switched off": it is a
     server restarting, a deploy, a network blip. Taking that as "off" used to
     leave the page without its ears, brain or voice until it was reloaded —
     the customer spoke Telugu and got the offline "sorry" in the language of
     the turn before. So: off only when the server SAYS so; unreachable means
     look again shortly, in the background, costing no turn any time. */
  function recheck(fn, tries) { if (tries < 6) setTimeout(function () { fn(tries + 1); }, 3000); }
  function checkSTT(tries) {
    tries = tries || 0;
    if (!canRecord) { sttChecked = true; return; }   // old browser -> browser recogniser only
    try {
      fetch(STT_URL + '/health').then(function (r) { return r.json(); }).then(function (d) {
        sttReady = !!(d && d.enabled); sttChecked = true;
      }).catch(function () { sttReady = false; sttChecked = true; recheck(checkSTT, tries); });
    } catch (e) { sttReady = false; sttChecked = true; }
  }

  // pick a container this browser can actually record (Chrome/Firefox: webm,
  // Safari: mp4). Scribe reads the format from the file itself.
  function recMime() {
    var want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < want.length; i++) {
      if (MR.isTypeSupported && MR.isTypeSupported(want[i])) return want[i];
    }
    return '';
  }

  // The turn's recording is over. The mic itself stays warm for the next turn
  // (and for talking over her reply) — see the mic session in 7c — and lets go
  // by itself once nobody has spoken either way for a while.
  function releaseMic() {
    if (recCapTimer) { clearTimeout(recCapTimer); recCapTimer = null; }
    scheduleMicIdle();
  }

  function stopRecording() {
    if (rec && rec.state === 'recording') { try { rec.stop(); } catch (e) {} }   // -> onstop -> sendRecording
  }

  // Stop as soon as they finish talking, the same way the browser recogniser
  // would: watch the live level and end after a short silence. Also gives up if
  // they never say anything, and hard-caps the clip so nothing runs away.
  // `thr` is the level that counts as noise rather than speech, in the raw
  // 0..128 units below. When the customer talked over her with music or a TV
  // in the background, the detector measured that background BETWEEN their
  // syllables and passes it here — so the song does not keep the recording
  // open for the full 20 s after they have finished.
  function watchSilence(stream, thr) {
    var an = (stream === micStream) ? micAn : null;
    if (!an) return;
    var buf = new Uint8Array(an.fftSize);
    var spoke = false, quietAt = 0;
    // How long we wait after they stop making noise before deciding they are
    // done. Pure dead time — the customer hears it as "she is slow to answer" —
    // so it is kept as short as it can be without cutting off a normal pause
    // mid-sentence. Raise it if customers report being interrupted.
    var SILENCE_AFTER_SPEECH = 550;    // ms of quiet that means "they finished"
    var GIVE_UP_IF_SILENT = 7000;      // ms of nothing at all -> stop waiting
    var THR = Math.max(8, Math.min(40, thr || 0));   // 8 ≈ 3% of full scale; never above ~30%
    (function tick() {
      if (!rec || rec.state !== 'recording') return;
      an.getByteTimeDomainData(buf);
      var peak = 0;
      for (var i = 0; i < buf.length; i++) { var v = Math.abs(buf[i] - 128); if (v > peak) peak = v; }
      var now = Date.now();
      if (peak > THR) { spoke = true; quietAt = 0; recHeardMs += 60; }
      else if (!quietAt) { quietAt = now; }
      else if (now - quietAt > (spoke ? SILENCE_AFTER_SPEECH : GIVE_UP_IF_SILENT)) { stopRecording(); return; }
      setTimeout(tick, 60);            // check twice as often: up to 60ms less lag on the cut-off
    })();
  }

  // `thr`: see watchSilence. Only the barge-in path knows one.
  function startRecording(thr) {
    acquireMic()
      .then(function (stream) {
        recChunks = []; recHeardMs = 0;
        // If she was speaking (or has just finished), the last second is
        // already on tape — the customer's first word included. That recorder
        // simply carries on as the recording of this turn.
        var r = prerollPromote();
        if (!r) r = newRecorder(stream);
        rec = r;
        rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
        rec.onstop = sendRecording;
        if (rec.state !== 'recording') rec.start();
        listening = true; setLive(true);
        // Never record forever — but on the address form a customer reading out
        // name, email, mobile, address and pincode in one go takes 20s and more;
        // a 20s cap cut them off mid-pincode. The silence check still ends the
        // clip the moment they stop; the cap is only for a room that never goes quiet.
        recCapTimer = setTimeout(stopRecording, coStep() === 'form' ? 35000 : 20000);
        watchSilence(stream, thr);
      })
      .catch(function () {
        listening = false; setLive(false); closeMic();
        addBot(UI[lang].micDenied); speak(UI[lang].micDenied);
      });
  }

  function sendRecording() {
    listening = false; setLive(false);
    releaseMic();
    var blob = recChunks.length ? new Blob(recChunks, { type: recChunks[0].type || 'audio/webm' }) : null;
    recChunks = [];
    if (userStopped) { setStatus(''); return; }                    // they cancelled
    if (recDiscard) { recDiscard = false; setStatus(''); return; }   // an empty clip she cut short to speak first
    // Nothing was said — the clip is silence, or a quarter-second of noise.
    // Never upload it (a paid transcription of nothing) and never answer it:
    // "sorry, I did not understand" every ten seconds to an empty room is
    // exactly how a hands-free assistant becomes unbearable. Just listen on.
    if (!blob || blob.size < 600 || recHeardMs < 250) { setStatus(''); keepListeningQuietly(); return; }
    silentSince = 0;                                               // someone is talking
    setStatus(UI[lang].thinking);
    var myAsk = ++askSeq;            // this turn — superseded if they speak again before it is answered
    vlogTurn('voice', Date.now() - 550);   // they stopped speaking 550ms ago: the silence that ended the clip
    armThinking();                   // keep watching the mic while the server thinks
    // The sign-in box is open, so this is a number, a code or a name for it:
    // only the words are needed. Speech-to-text alone — no brain to pay for
    // or wait on — and handleQuery() puts them into the box.
    if (signWaiting()) { sendViaStt(blob, myAsk); return; }

    // ONE request for the whole turn: the server transcribes, answers, and
    // starts making the voice. The old path sent the audio, waited, read the
    // text, then sent the text back — a full network round trip of silence in
    // the middle of every question. Falls back to that path if this one fails.
    var headers = { 'Content-Type': blob.type || 'audio/webm' };
    // The whole recent conversation, her last reply INCLUDED — the customer's
    // new words are on the tape, not in the transcript yet, so nothing is cut
    // off the end. (It used to drop her last line, which is exactly the one a
    // "yes" or "how much?" refers to.) base64 so the header is plain ASCII
    // whatever script they spoke in; Telugu and Hindi are three bytes a
    // character, so if it will not fit we drop the OLDEST turns one at a time
    // rather than throwing the whole memory away.
    var hist = aiContext(true);
    while (hist.length) {
      try {
        var packed = btoa(unescape(encodeURIComponent(JSON.stringify(hist))));
        if (packed.length < 6000) { headers['X-Dcal-History'] = packed; break; }
      } catch (e) { break; }
      hist = hist.slice(1);
    }
    // ...and their situation — page, cart, signed in — so "add this" and
    // "what is in my cart" are answered in this same round trip.
    try { headers['X-Dcal-State'] = btoa(unescape(encodeURIComponent(JSON.stringify(storeState())))); } catch (e) {}

    // The server sends their words the moment speech-to-text has them, then the
    // reply: the product they named is lit while the brain is still thinking.
    headers['Accept'] = 'application/x-ndjson, application/json';
    // The checkout's address form is on screen: the server pulls its fields
    // out of what they said, in this same request, instead of chatting.
    if (coStep() === 'form') headers['X-Dcal-Form'] = 'address';
    if (askedLang) headers['X-Dcal-Lang-Pref'] = askedLang.want + ':' + askedLang.spoke;
    fetch(ASK_URL, { method: 'POST', headers: headers, body: blob })
      .then(function (r) {
        return r.ok ? readAsk(r, function (h) {
          if (myAsk === askSeq && h.text) spotWords(autoCorrect(h.text));
        }) : null;
      })
      .then(function (d) {
        if (myAsk !== askSeq) { keepWords(d); return; }   // they went on talking: their words stay, this reply goes
        if (!d) throw new Error('ask failed');
        setStatus('');
        var said = d.text ? autoCorrect(d.text) : '';
        if (!said) { localMiss(); return; }
        followLang(d.spoke || d.lang, d.asked, d.lang);
        vlogYouLang = d.spoke || d.lang;
        listenRetry = 0;
        if (!introduced) {
          markIntroduced();
          if (isGreetingBack(said)) {
            addYou(said);
            var hello = welcomeSaid ? UI[lang].helpAsk : UI[lang].greeting;   // introduced already? just ask again
            addBot(hello);
            speak(hello, function () { if (opened && !listening) startListening(); });
            return;
          }
        }
        // The checkout is on screen: their words may be for it — fields for the
        // address form, a "yes", "cash on delivery". Only if not, the answer.
        if (coStep() || couponWanted(said)) {
          markIntroduced(); addYou(said);
          if (couponByVoice(said) || checkoutByVoice(said, d.form || null)) return;
          if (d.reply) deliverAI(d, said);
          else handleQuery(said, undefined, false, true);
          return;
        }
        if (!d.reply) { handleQuery(said); return; }     // AI had nothing -> normal routing
        addYou(said);
        deliverAI(d, said);
      })
      .catch(function () { if (myAsk === askSeq) { vlogEv('ask_failed'); sendViaStt(blob, myAsk); } });   // one-shot path unavailable
  }

  // /api/ask's answer: one JSON object, or — when the server can — two lines,
  // {text, lang} as soon as they are heard and then the whole answer.
  // onHeard(first line) runs the moment the first line lands. -> the answer.
  function readAsk(r, onHeard) {
    var type = (r.headers && r.headers.get('Content-Type')) || '';
    if (type.indexOf('ndjson') === -1) return r.json();
    var last = null, buf = '';
    function line(s) {
      if (!s.trim()) return;
      var o = JSON.parse(s);
      if (o && o.error) throw new Error(o.error);
      if (o && !('reply' in o) && onHeard) { try { onHeard(o); } catch (e) {} }
      last = o;
    }
    if (!r.body || !r.body.getReader || !window.TextDecoder) {
      return r.text().then(function (t) { t.split('\n').forEach(line); return last; });
    }
    var reader = r.body.getReader(), dec = new TextDecoder();
    return (function pump() {
      return reader.read().then(function (c) {
        buf += c.done ? dec.decode() : dec.decode(c.value, { stream: true });
        var i;
        while ((i = buf.indexOf('\n')) !== -1) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
        if (c.done) { line(buf); return last; }
        return pump();
      });
    })();
  }

  // A turn the customer talked over before it was answered: keep what they
  // said on screen and in the memory, so the next answer covers both, but do
  // not speak a reply to half of what they meant.
  function keepWords(d) {
    var w = (d && d.text) ? autoCorrect(d.text) : '';
    if (w) addYou(w);
  }
  // The server is thinking. Keep the mic watched meanwhile — a customer who
  // goes on talking ("...and the shower filter too") must not be ignored for
  // the three seconds it takes. If they do, that turn's reply is dropped
  // unspoken (see keepWords) and the new words start a fresh turn.
  function armThinking() {
    if (!canRecord || !micAlive() || listening) return;
    voiceStartedAt = 0;                        // nothing of hers is playing: no warm-up needed
    prerollStart();
    vadStart();
  }

  // The original two-step path, kept as the fallback: transcribe, then ask.
  function sendViaStt(blob, myAsk) {
    fetch(STT_URL, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (myAsk !== undefined && myAsk !== askSeq) { keepWords(d); return; }
        setStatus('');
        var text = (d && d.text) ? autoCorrect(d.text) : '';
        if (!text) { localMiss(); return; }                        // heard only noise
        // FOLLOW THE CUSTOMER: they spoke Tamil -> everything from here is Tamil.
        followLang(spokeIn(d.lang, text));
        vlogYouLang = spokeIn(d.lang, text);
        listenRetry = 0;
        // Their FIRST words back to the opening hello. We now know their
        // language, so introduce ourselves in it. If all they said was
        // "Namaste" there is no question to answer — the introduction IS the
        // answer, and the mic reopens so they can ask what they came for.
        if (!introduced) {
          markIntroduced();
          if (isGreetingBack(text)) {
            addYou(text);
            var hello = welcomeSaid ? UI[lang].helpAsk : UI[lang].greeting;   // introduced already? just ask again
            addBot(hello);
            speak(hello, function () { if (opened && !listening) startListening(); });
            return;
          }
        }
        turnSpoke = spokeIn(d.lang, text) || null;   // what they spoke, for askAI if they name another language
        handleQuery(text);
      })
      .catch(function () {
        setStatus('');
        vlogEv('stt_failed');
        sttReady = false;                    // server unhappy -> use the browser recogniser
        recheck(checkSTT, 0);                // ...until it is back
        if (SR && opened) startListening();
      });
  }

  // nothing intelligible came back — same gentle nudge the recogniser gives,
  // then listen again so they can simply repeat themselves without tapping
  function localMiss() {
    vlogEv('heard_nothing');
    missCount++;
    var fb = missCount >= 2 ? FALLBACK2[lang] : FALLBACK[lang];
    addBot(fb); speak(fb, listenAgain);
  }

  // start listening. `isRetry` keeps the retry counter across an auto-restart.
  // Prefers server-side recording (detects the language); falls back to the
  // browser's recogniser, which can only hear the currently selected language.
  function startListening(isRetry) {
    payQuiet = false;
    stopSpeaking();
    stopBowing();               // they have engaged — the greeting bow is finished
    if (!isRetry) listenRetry = 0;
    // already live -> this tap means "stop"
    if (listening) {
      userStopped = true;
      if (rec && rec.state === 'recording') { stopRecording(); return; }
      if (recog) { try { recog.stop(); } catch (e) {} }
      return;
    }
    userStopped = false;
    setHandsFree(true);         // a voice conversation is on: it survives the pages she opens
    if (sttReady && canRecord) { startRecording(); return; }
    if (!SR) { addBot(UI[lang].noMic); speak(UI[lang].noMic); return; }
    closeMic();                 // the browser's recogniser wants the mic to itself
    recog = buildRecog();
    try { recog.start(); } catch (e) { /* already started — ignore */ }
  }

  /* ------------------------------------------------------------------ *
   *  7c. BARGE-IN  (she stops the moment the customer talks over her)   *
   *                                                                      *
   *  Until now the mic only opened AFTER she finished a reply, so there  *
   *  was nothing to interrupt her with except the mic button. Now the    *
   *  mic stays warm for the whole conversation, and while she speaks a   *
   *  small detector watches it for the customer's voice. It must pass:   *
   *                                                                      *
   *   1. LOUD ENOUGH — above an absolute minimum (a low voice, someone in *
   *      the next room, is not talking to her) AND clearly above the      *
   *      background it has been hearing. A fan, traffic, a song that was  *
   *      already playing all raise that floor, so they cannot trigger.    *
   *   2. VOICE-SHAPED — most of the energy where speech lives (150–3800   *
   *      Hz). Bass and cymbals do not qualify.                            *
   *   3. SUSTAINED — 160 ms without a break. A door, a cup, a click is    *
   *      over long before that.                                          *
   *   4. THE PROBE — she is PAUSED, not stopped, and we listen for half a *
   *      second more. If the sound dies with her, it was her own voice    *
   *      coming back through the mic: she carries on as if nothing        *
   *      happened. If it keeps going, it is not her. Then:                *
   *   5. SPEECH, NOT MUSIC — a voice rises and falls with every syllable; *
   *      a song or a TV holds its level. No dip, or the wrong shape ->    *
   *      she resumes, and that level becomes the new floor so the same    *
   *      music cannot nag her every half second.                          *
   *                                                                      *
   *  Only then is she cut off. The customer's first word is NOT lost:     *
   *  two overlapping "pre-roll" recorders keep the last half-second on   *
   *  tape, and the older one simply becomes the recording of the turn.   *
   *  The brain is told she was interrupted and how far she had got, so   *
   *  "hmm" and "no, the tap filter" get different answers.                *
   * ------------------------------------------------------------------ */

  /* ---- The mic session: one mic for the whole conversation --------------
     Opened on the first turn, reused by every turn after it, closed when she
     is minimised, stopped, or nobody has spoken either way for a while.
     Reusing it is also why the next turn starts faster — getUserMedia is a
     permission check plus a device open, every single time. */
  var MIC_KEY = 'dcal_voice_mic';
  var micStream = null, micCtx = null, micSrc = null, micAn = null, micIdleTimer = null;
  var MIC_IDLE_MS = 8000;          // nobody talking either way for this long -> let the mic go
  // They have allowed the mic before, so opening it quietly while she speaks
  // will not throw a permission prompt in their face mid-sentence. Until the
  // first tap of the mic button, she can only be interrupted by that button.
  var micGranted = false;
  try { micGranted = localStorage.getItem(MIC_KEY) === '1'; } catch (e) {}
  function probeMicPermission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return;
      navigator.permissions.query({ name: 'microphone' }).then(function (st) {
        micGranted = st.state === 'granted';
        try { st.onchange = function () { micGranted = st.state === 'granted'; }; } catch (e) {}
      }).catch(function () {});        // Firefox: not a permission it will describe
    } catch (e) {}
  }

  function micAlive() {
    if (!micStream || !micStream.active) return false;
    var t = micStream.getAudioTracks();
    return !!(t.length && t[0].readyState === 'live');
  }
  function newRecorder(stream) {
    var mime = recMime();
    // 24 kbps Opus. Speech stays perfectly clear for the recogniser at this
    // rate, and the clip is a fraction of the default size — which is time
    // saved twice over: uploading it from the phone, and our server posting
    // it on to the recogniser.
    var recOpts = mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 };
    var r;
    try { r = new MR(stream, recOpts); }
    catch (e) {
      try { r = mime ? new MR(stream, { mimeType: mime }) : new MR(stream); }
      catch (e2) { r = new MR(stream); }
    }
    return r;
  }
  /* The AudioContext is made ONCE, on a tap, and kept for the life of the page.
     iOS will only run one that was created inside a user gesture; a mic that is
     reopened later from a network callback (her reply arriving) would otherwise
     get a context that never produces a sample — and with it neither the
     interruption detector nor the end-of-speech detector would ever hear a thing. */
  function attachAnalyser(stream) {
    var AC = window.AudioContext || window.webkitAudioContext;
    micAn = null;
    if (!AC) return;
    try {
      if (!micCtx) micCtx = new AC();
      if (micCtx.state !== 'running' && micCtx.resume) micCtx.resume().catch(function () {});
      var an = micCtx.createAnalyser();
      an.fftSize = 2048;                       // ~43 ms of audio per look at 48 kHz
      an.smoothingTimeConstant = 0.2;
      micSrc = micCtx.createMediaStreamSource(stream);
      micSrc.connect(an);
      micAn = an;
    } catch (e) { micAn = null; }
  }
  function acquireMic() {
    if (micAlive()) return Promise.resolve(micStream);
    closeMic();
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (stream) {
        micStream = stream;
        micGranted = true;
        try { localStorage.setItem(MIC_KEY, '1'); } catch (e) {}
        attachAnalyser(stream);
        return stream;
      });
  }
  function closeMic() {
    if (micIdleTimer) { clearTimeout(micIdleTimer); micIdleTimer = null; }
    prerollStop();
    vadStop();
    var s = micStream; micStream = null;
    if (s) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    if (micSrc) { try { micSrc.disconnect(); } catch (e) {} micSrc = null; }
    micAn = null;
  }
  function scheduleMicIdle() {
    if (micIdleTimer) clearTimeout(micIdleTimer);
    micIdleTimer = setTimeout(function () {
      micIdleTimer = null;
      if (!listening && !speakingNow && !vadOn) closeMic();
      else scheduleMicIdle();
    }, MIC_IDLE_MS);
  }
  // A backgrounded phone suspends the context; the next touch wakes it.
  document.addEventListener('pointerdown', function () {
    if (micCtx && micCtx.state !== 'running' && micCtx.resume) { try { micCtx.resume().catch(function () {}); } catch (e) {} }
  }, true);

  /* ---- PRE-ROLL: the last second and more is always already on tape --------
     A recorder started the moment we decide the customer is talking would
     miss their first words — the deciding takes up to a second: a quarter of
     a second to notice, and the half-second probe below. So two recorders
     take turns: a new one starts every PREROLL_STEP ms and the oldest is
     dropped, so at any instant the older of the two holds between one and two
     steps of audio. When the turn begins, that older recorder IS the
     recording; it just keeps going. While the probe runs the rotation is
     FROZEN, so what was on tape when the customer began is still there when
     we commit. (MediaRecorder cannot be spliced — only the first chunk of a
     WebM carries the header — so two whole recorders it is.) */
  var PREROLL_STEP = 700;
  var preroll = [], prerollTimer = null, prerollFrozen = false;
  function discardRecorder(r) {
    if (!r) return;
    try { r.ondataavailable = null; r.onstop = null; r.onerror = null; } catch (e) {}
    try { if (r.state !== 'inactive') r.stop(); } catch (e) {}
  }
  function prerollTick() {
    if (!micAlive() || listening) { prerollStop(); return; }
    if (prerollFrozen) return;                    // the probe is on: keep exactly what we have
    var r;
    try { r = newRecorder(micStream); r.start(); } catch (e) { return; }
    preroll.push(r);
    while (preroll.length > 2) discardRecorder(preroll.shift());
  }
  function prerollStart() {
    if (prerollTimer || !micAlive() || listening) return;
    prerollFrozen = false;
    prerollTick();
    prerollTimer = setInterval(prerollTick, PREROLL_STEP);
  }
  function prerollStop() {
    if (prerollTimer) { clearInterval(prerollTimer); prerollTimer = null; }
    prerollFrozen = false;
    while (preroll.length) discardRecorder(preroll.shift());
  }
  function prerollRestart() { prerollStop(); prerollStart(); }
  function prerollFreeze() { prerollFrozen = true; }
  function prerollThaw() { prerollFrozen = false; }
  // Hand over the older recorder — it keeps recording — and drop the rest.
  function prerollPromote() {
    var r = null;
    while (preroll.length && !r) {
      var c = preroll.shift();
      if (c && c.state === 'recording') r = c; else discardRecorder(c);
    }
    prerollStop();
    return r;
  }

  /* ---- THE DETECTOR ------------------------------------------------------
     Pure arithmetic on three numbers per 40 ms frame — loudness (rms, 0..1),
     the raw peak (0..128, the unit watchSilence already thinks in) and the
     share of energy in the voice band — so it can be tested without a mic
     (DcalVoice._vad). Every number below is a knob; the comment says what
     turning it does.

     THE BACKGROUND FLOOR is what the room sounds like BETWEEN the customer's
     syllables: it climbs slowly toward anything louder and drops at once to
     anything quieter. It must never learn the customer's own voice — an
     earlier version jumped up to whatever it heard, so a customer who was
     already talking when she began had their own voice set as "background"
     and then had to shout to get over it. A voice has gaps every syllable;
     those gaps keep this floor down. Steady sounds (a fan, a song) have none,
     and are learned within a second. */
  var VAD = {
    FRAME_MS: 40,
    ABS_MIN: 0.025,      // quieter than this (≈ −32 dBFS) is never "talking to her": low voices, the next room
    RATIO: 2.2,          // ...and it must be this many times the background (≈ +7 dB)
    FRAC_MIN: 0.5,       // at least half the energy in the voice band, or it is not a voice
    ON_FRAMES: 4,        // this many voice-like frames out of the last ON_WINDOW before we react at all
    ON_WINDOW: 6,        // (160 ms of the last 240 ms: a syllable gap is allowed, a click or a bang is not)
    WARMUP_MS: 300,      // her audio has just started: give its echo a moment before trusting anything
    SKIP_FRAMES: 3,      // after pausing her, ignore this long — her echo takes ~100 ms to die away
    CONFIRM_MS: 480,     // how long she stays paused while we make up our mind (room for one syllable gap)
    PERSIST_FRAMES: 2,   // sound still there after she went quiet, for at least this many frames
    DIP_RATIO: 0.55,     // a syllable boundary: the level must fall to about half its peak (−5 dB)
    ATTACK: 0.05,        // floor: share of the way it climbs toward a louder frame (≈ 1 s to settle)
    RELEASE: 0.5,        // ...and toward a quieter one (two or three frames)
    MUSIC_HOLD: 0.6,     // a rejected sound that outlived her pause holds the bar at this share of its level...
    MUSIC_HOLD_MS: 1500, // ...for this long — a bridge until the floor has learned the sound itself
    ECHO_HOLD: 0.8,      // a rejected sound that died with her was her own echo: hold the bar at this share of it...
    ECHO_HOLD_MS: 2500,  // ...so she does not stumble over herself at every phrase
    COOLDOWN_MS: 1000    // no new probe for this long after a false alarm
  };
  function newVadState(prev) {
    return { floor: prev ? prev.floor : 0, hold: prev ? prev.hold : 0, holdUntil: prev ? prev.holdUntil : 0,
             recent: 0, onsetMax: 0, cand: null, coolUntil: 0, probeMinPeak: 0 };
  }
  function bitCount(x) { var n = 0; while (x) { n += x & 1; x >>= 1; } return n; }
  // One frame in -> null | 'pause' | 'resume' | 'commit' out.
  // voiceAge = ms since her audio began playing, or -1 if it has not yet.
  function vadStep(st, rms, peak, frac, now, voiceAge) {
    var c = st.cand, i;
    if (c) {
      // She is paused. Whatever we hear from here on is NOT her.
      c.n++;
      if (c.n > VAD.SKIP_FRAMES) {
        c.levels.push(rms); c.fracs.push(frac);
        if (rms >= c.thr) c.loud++;
        if (c.minPeak < 0 || peak < c.minPeak) c.minPeak = peak;
      }
      if (now - c.start < VAD.CONFIRM_MS) return null;
      st.cand = null;
      st.recent = 0;
      // A voice has a gap somewhere in every third of a second — between
      // syllables, between words. A song or a fan does not. So: is the quietest
      // frame of the window well below the loudest? Order does not matter: a
      // sentence that swells toward the end of the window is still a voice.
      var mx = 0, mn = Infinity;
      for (i = 0; i < c.levels.length; i++) { if (c.levels[i] > mx) mx = c.levels[i]; if (c.levels[i] < mn) mn = c.levels[i]; }
      var dip = c.levels.length > 0 && mn < mx * VAD.DIP_RATIO;
      var fsum = 0, fn = 0;                                  // was the loud part voice-shaped?
      for (i = 0; i < c.levels.length; i++) if (c.levels[i] >= c.thr) { fsum += c.fracs[i]; fn++; }
      var voicey = fn > 0 && (fsum / fn) >= VAD.FRAC_MIN;
      var persisted = c.loud >= VAD.PERSIST_FRAMES;          // outlived her pause: not her echo
      if (persisted && dip && voicey) { st.probeMinPeak = Math.max(0, c.minPeak); return 'commit'; }
      if (persisted) {
        // Background — music, a TV. Hold the bar just above it for a moment;
        // being below the bar, the sound is then learned into the floor by
        // itself, and stays out of the way for as long as it goes on. (The
        // floor itself is NOT lifted: if this was in fact a voice we misjudged,
        // it must be able to get through again the moment the hold lapses.)
        st.hold = Math.max(st.hold, mx * VAD.MUSIC_HOLD); st.holdUntil = now + VAD.MUSIC_HOLD_MS;
      } else {
        // It died when she did: her own voice coming back through the mic.
        // Raise the bar just over it so she is not probed at every phrase.
        st.hold = Math.max(st.hold, c.onset * VAD.ECHO_HOLD); st.holdUntil = now + VAD.ECHO_HOLD_MS;
      }
      st.coolUntil = now + VAD.COOLDOWN_MS;
      return 'resume';
    }
    var bar = st.floor;
    if (now < st.holdUntil) { if (st.hold > bar) bar = st.hold; } else st.hold = 0;
    var thr = Math.max(VAD.ABS_MIN, bar * VAD.RATIO);
    // Learn the background only from what is BELOW the bar. Anything above it
    // may be the customer, and the customer's own voice must never become
    // "background" — not even while a warm-up or cooldown is ignoring it.
    if (rms > st.floor) { if (rms < thr) st.floor += (rms - st.floor) * VAD.ATTACK; }
    else st.floor += (rms - st.floor) * VAD.RELEASE;
    var hot = rms >= thr && frac >= VAD.FRAC_MIN;
    if (voiceAge >= 0 && voiceAge < VAD.WARMUP_MS) hot = false;   // her audio just started: not yet
    if (now < st.coolUntil) hot = false;
    // The last ON_WINDOW frames as bits, newest lowest. Enough of them voice-like
    // — a syllable gap or two allowed — and the probe begins.
    st.recent = ((st.recent << 1) | (hot ? 1 : 0)) & ((1 << VAD.ON_WINDOW) - 1);
    if (!st.recent) st.onsetMax = 0;
    if (hot) {
      if (rms > st.onsetMax) st.onsetMax = rms;              // the loudest of this run, for the echo hold
      if (bitCount(st.recent) >= VAD.ON_FRAMES) {
        st.cand = { start: now, thr: thr, n: 0, loud: 0, levels: [], fracs: [], minPeak: -1, onset: st.onsetMax };
        st.recent = 0; st.onsetMax = 0;
        return 'pause';
      }
    }
    return null;
  }

  var vadOn = false, vadSt = null, vadTimer = null, vadTd = null, vadFd = null;
  // Share of the energy between 50 Hz and 8 kHz that sits in the voice band.
  // `fd` is dB per bin, so back to power first — decibels do not add up.
  function voiceFraction(fd, binHz) {
    var lo = Math.max(1, Math.round(50 / binHz)), v0 = Math.round(150 / binHz);
    var v1 = Math.round(3800 / binHz), hi = Math.min(fd.length - 1, Math.round(8000 / binHz));
    var tot = 0, voice = 0, i, p;
    for (i = lo; i <= hi; i++) {
      p = fd[i];
      if (!(p > -160)) continue;              // -Infinity / NaN: nothing in this bin
      p = Math.pow(10, p / 10);
      tot += p;
      if (i >= v0 && i <= v1) voice += p;
    }
    return tot > 0 ? voice / tot : 0;
  }
  function vadFrame() {
    if (!vadOn || !micAn || !micCtx) return;
    try { micAn.getByteTimeDomainData(vadTd); micAn.getFloatFrequencyData(vadFd); } catch (e) { return; }
    var sum = 0, peak = 0, i, v, av;
    for (i = 0; i < vadTd.length; i++) {
      v = vadTd[i] - 128; av = v < 0 ? -v : v;
      if (av > peak) peak = av;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / vadTd.length) / 128;
    var frac = voiceFraction(vadFd, (micCtx.sampleRate || 48000) / micAn.fftSize);
    var now = Date.now();
    var d = vadStep(vadSt, rms, peak, frac, now, voiceStartedAt ? now - voiceStartedAt : -1);
    if (d === 'pause') { pauseVoice(); prerollFreeze(); }      // hold her, and hold the tape
    else if (d === 'resume') { resumeVoice(); prerollThaw(); }
    else if (d === 'commit') bargeCommit();
  }
  function vadStart() {
    if (vadOn || !micAn) return;
    vadOn = true;
    vadSt = newVadState(vadSt);              // the floor carries over from her last line
    vadTd = new Uint8Array(micAn.fftSize);
    vadFd = new Float32Array(micAn.frequencyBinCount);
    (function loop() {
      if (!vadOn) return;
      vadTimer = setTimeout(loop, VAD.FRAME_MS);
      vadFrame();
    })();
  }
  function vadStop() {
    vadOn = false;
    if (vadTimer) { clearTimeout(vadTimer); vadTimer = null; }
    if (vadSt) vadSt.cand = null;
  }

  // The probe: hold her mid-word, then let her go on as if nothing happened.
  var voicePaused = false;
  function pauseVoice() {
    voicePaused = true;
    if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} }
    else if (ttsUtter && SPEECH) { try { SPEECH.pause(); } catch (e) {} }
  }
  function resumeVoice() {
    if (!voicePaused) return;
    voicePaused = false;
    if (ttsAudio) { try { var p = ttsAudio.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
    else if (ttsUtter && SPEECH) { try { SPEECH.resume(); } catch (e) {} }
  }

  // How much of the current line she had actually said. The audio knows its
  // position; failing that, the clock and the measured speaking rate.
  var CHARS_PER_SEC = 14;          // measured on this voice for Telugu; English is a touch faster
  function spokenSoFar() {
    var s = speakingText || '';
    if (!s) return '';
    var n = 0, a = ttsAudio;
    if (a && isFinite(a.duration) && a.duration > 0) n = s.length * Math.min(1, (a.currentTime || 0) / a.duration);
    else if (ttsUtter) n = utterCharIndex;
    else if (voiceStartedAt) n = (Date.now() - voiceStartedAt) / 1000 * CHARS_PER_SEC;
    n = Math.max(0, Math.min(s.length, Math.round(n)));
    var sp = s.indexOf(' ', n);                    // finish the word she was on
    if (sp !== -1 && sp - n < 12) n = sp;
    return s.slice(0, n).trim();
  }

  // Called from speak(): open the mic (if they have ever allowed it) and start
  // watching for the customer, for as long as THIS line is the one being said.
  function armBargeIn(mine) {
    if (payQuiet || !canRecord || !micGranted || !opened || listening) return;
    acquireMic().then(function () {
      if (mine !== speakSeq || listening) return;    // she has moved on, or the mic is already in use
      prerollStart();
      vadStart();
      scheduleMicIdle();
    }).catch(function () { micGranted = false; });   // permission gone: back to the button only
  }
  // She finished a line of her own accord. Fresh pre-roll from here, so the
  // clip of the next turn starts after her voice, not under it.
  function onVoiceDone() {
    vadStop();
    voicePaused = false;
    if (micAlive()) { prerollRestart(); scheduleMicIdle(); }
  }
  // The customer is talking over her. Her turn is over; theirs has begun —
  // with their first word already on tape.
  function bargeCommit() {
    var said = spokenSoFar();
    vlogEv('barge', speakingText ? (said.length / speakingText.length).toFixed(2) : '0');   // how much of her line they heard
    var thr = vadSt ? vadSt.probeMinPeak * 1.5 : 0;     // the background under their voice
    vadStop();
    voicePaused = false;
    askSeq++;                       // a reply still being worked out for the last turn is no longer wanted
    markInterrupted(said);
    stopSpeaking();                 // and with it the page change this reply was leading to
    stopBowing();                   // interrupting the welcome counts as engaging
    userStopped = false; listenRetry = 0;
    setHandsFree(true);
    setStatus('');
    if (sttReady && canRecord && micAlive()) { startRecording(thr); return; }
    // No server recogniser: the browser's own, which wants the mic to itself.
    closeMic();
    if (SR && opened) { recog = buildRecog(); try { recog.start(); } catch (e) {} }
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
  /* ---- HANDS FREE ---------------------------------------------------------
     Customers were having to tap the mic before every single question, which
     is exactly the thing a voice assistant is supposed to save them. Now, the
     moment she finishes answering, she listens again by herself — so it is a
     conversation, not a series of separate commands.

     It ends on its own: if they say nothing, the recorder gives up after a few
     seconds of silence and the mic closes with no reply, so nothing reopens it.
     It also never fires if they closed or minimized the panel, pressed stop, or
     if the answer is taking them to another page. */
  function listenAgain() {
    if (!opened || listening || userStopped) return;
    // a short beat first: opening the mic the instant her voice stops feels
    // like being interrupted, and risks catching the tail of her own audio
    setTimeout(function () {
      if (opened && !listening && !userStopped) startListening();
    }, 300);
  }

  // Say a reply and then do the right thing after it: open the page it points
  // at, or go back to listening. Every answer goes through here — so this is
  // also where the product it is about lights up, BEFORE the first word.
  // `slug` = the product the turn acted on (cart add/remove), if any.
  function sayReply(text, go, external, slug) {
    var marks = spotReply(text, go, slug);
    if (go) speakThenGo(text, go, external);   // navigating: the page changes
    else speak(text, listenAgain);
    spotTrack(text, marks);                     // ...and the light follows her through the names
  }

  function speakThenGo(reply, url, external) {
    var isExternal = external || /^https?:/i.test(url);
    var done = false;
    function nav() {
      if (done) return; done = true;
      vlogEv('nav', url);
      if (!isExternal) closeMic();             // the page is going away; let the mic go cleanly
      // Opening a product she was showing: light it again when it arrives (INIT).
      var ps = /^\/product\/([a-z0-9-]+)$/.exec(url);
      if (ps) { try { sessionStorage.setItem(SPOT_KEY, ps[1]); } catch (e) {} }
      try {
        if (url === 'back') history.back();    // "go back" — the previous page, hands-free
        else if (isExternal) window.open(url, '_blank');
        else window.location.href = url;
      } catch (e) {}
    }
    speak(reply, nav);                         // navigate the moment the voice truly finishes
    // Backstop ONLY — must be longer than the real speaking time so it never cuts
    // the voice off. With TTS present, speech is the trigger; here we just guard
    // against a device where the 'end' event never fires. Scale with length.
    // Kept in navTimer so that if the customer talks over her ("no, not that
    // one") the page does NOT still change under them a few seconds later.
    var len = reply ? reply.length : 0;
    var hasTTS = ttsReady || !!SPEECH;            // either voice takes real time to speak
    var fallback = hasTTS
      ? Math.max(6000, Math.min(60000, len * 130 + 5000))   // TTS: long guard (~speaking time + buffer)
      : Math.max(3500, Math.min(12000, len * 70 + 2500));   // no TTS: reading-time delay
    navTimer = setTimeout(nav, fallback);
  }

  function respondTo(intent) {
    var reply = (intent.reply[lang] || intent.reply.en);
    addBot(reply);
    sayReply(reply, intent.go, intent.external);   // speak fully, then open the page or listen again
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
  // every shown message and survives page changes. By default the LAST entry is
  // left out, because the callers in handleQuery have just added the customer's
  // new message and the server sends that one separately; the recording path
  // passes includeLast, because there the new message is still on the tape.
  // A reply she was cut off in carries `cut` and how far she got (`said`), so
  // the brain knows the customer never heard the rest of it.
  function aiContext(includeLast) {
    var turns = includeLast ? transcript.slice(-12) : transcript.slice(0, -1).slice(-12);
    return turns.map(function (m) {
      var o = { role: m.who === 'you' ? 'user' : 'assistant', text: String(m.text || '').slice(0, 300) };
      if (m.cut) { o.cut = true; o.said = String(m.said || '').slice(0, 200); }
      return o;
    });
  }

  function checkAI(tries) {
    tries = tries || 0;
    try {
      fetch(AI_URL + '/health').then(function (r) { return r.json(); }).then(function (d) {
        aiState = (d && d.enabled) ? 'on' : 'off';
        panel.classList.toggle('dcv-ai-on', aiState === 'on');
      }).catch(function () {
        // unreachable, not off: keep asking the brain (a failed ask still
        // falls back offline) and look again
        if (aiState !== 'on') aiState = 'unknown';
        recheck(checkAI, tries);
      });
    } catch (e) { aiState = 'unknown'; }
  }

  // Ask the server whether the ElevenLabs natural voice is configured. If yes,
  // speak() plays it; if not, the assistant simply stays silent.
  function checkTTS(tries) {
    tries = tries || 0;
    try {
      fetch(TTS_URL + '/health').then(function (r) { return r.json(); }).then(function (d) {
        ttsReady = !!(d && d.enabled);
        // The welcome is the one line we KNOW she will say, and it is the one the
        // customer judges her speed by. Fetch it now, while they are still
        // reading the page, so it plays the moment they first tap.
        if (ttsReady) prefetchTts(introduced ? UI[lang].greeting : WELCOME);
      }).catch(function () { ttsReady = false; recheck(checkTTS, tries); });
    } catch (e) { ttsReady = false; }
  }

  /* ---- DOING things, not just saying them ----------------------------------
     The brain may answer with an "act" — put this in the cart, apply that
     coupon, search for those words — which the widget carries out here through
     window.DcalStore (js/auth.js). The action runs the moment the reply
     arrives, BEFORE she starts speaking, so the cart bubble is already right
     while she says "added". Anything that changes the page (search, track an
     order, checkout from elsewhere, back) is deferred until she has finished
     the sentence, exactly like "go". Nothing here takes a network round trip. */
  function storeState() {
    var S = window.DcalStore, st = { page: location.pathname };
    var show = spotFocus || pageProductSlug();       // "this product" = the one being talked about, else the page's
    if (show) st.show = show;
    try {
      if (S) {
        st.login = !!S.loggedIn();
        st.cart = S.cart().map(function (i) { return { p: i.slug || i.id, q: i.qty || 1 }; }).slice(0, 10);
      }
    } catch (e) {}
    return st;
  }
  // -> a URL to open once she has spoken, or null
  function runAction(act) {
    if (!act || !act.do) return null;
    vlogEv('act', act.do + (act.product ? ' ' + act.product : '') + (act.code ? ' ' + act.code : ''));
    var S = window.DcalStore;
    try {
      switch (act.do) {
        case 'add':      if (S) S.add(act.product, act.qty || 1); return null;
        case 'remove':   if (S) S.remove(act.product); return null;
        case 'qty':      if (S) S.setQty(act.product, act.qty || 1); return null;
        case 'clear':    if (S) S.clear(); return null;
        case 'coupon':   if (S) S.coupon(act.code); return null;
        case 'checkout': return S ? S.checkout() : '/cart';          // starts it here, or says where to go
        case 'wish':     if (S) S.wish(act.product, true); return null;
        case 'unwish':   if (S) S.wish(act.product, false); return null;
        case 'search':   return '/search?q=' + encodeURIComponent(act.q || '');
        case 'track':    return '/track-order?order=' + encodeURIComponent(act.order || '');
        case 'scroll':   try { window.scrollBy({ top: (act.dir === 'up' ? -0.8 : 0.8) * window.innerHeight, behavior: 'smooth' }); } catch (e) { window.scrollBy(0, (act.dir === 'up' ? -0.8 : 0.8) * window.innerHeight); } return null;
        case 'back':     return 'back';
        case 'login':    if (window.DcalAuth && window.DcalAuth.open) window.DcalAuth.open(); return null;
      }
    } catch (e) {}
    return null;
  }
  /* ---- Cart commands understood HERE, in the customer's own language ------
     "వాషింగ్ బాల్ తీసేయి", "टैप फ़िल्टर डाल दो", "make it three", "empty my
     cart". A verb plus a product is all these need, and the offline product
     matcher already knows every product in Telugu, Hindi and English. Two
     reasons to do it here rather than leave it to the brain:
       1. LATENCY. On the typed / browser-recogniser path this answers with no
          server call at all.
       2. RELIABILITY. The brain sometimes describes the cart when asked to
          change it, especially in Hindi and Telugu. If it answered without
          an act and the words were plainly a command, the command wins.
     Conservative on purpose: any "don't / नहीं / వద్దు" and it stands aside. */
  var CMD = {
    neg:      /\b(don'?t|do not|never|not)\b|नहीं|मत|వద్దు|కాదు|లేదు/i,
    add:      /\b(add|put|daal|dal|jodo)\b|डाल|जोड़|ऐड|జోడించ|పెట్ట|వేయి|యాడ్/i,
    remove:   /\b(remove|delete|take (it |that )?(out|off))\b|हटा|निकाल|తీసేయ|తీసివేయ|తొలగించ/i,
    clear:    /\b(clear|empty)\b|खाली|ख़ाली|ఖాళీ/i,
    cartWord: /\bcart\b|कार्ट|कार्ट|కార్ట్/i,
    qty:      /\b(make|set|quantity|qty|change)\b|कर दो|कर दीजिए|చేయి|చేయ్|చేయండి/i,
    checkout: /\b(check ?out|buy now|pay now|place (my |the )?order|order now)\b|अभी खरीद|ऑर्डर कर|चेकआउट|భుగతం|కొనుగోలు చేయ|ఆర్డర్ చేయ|చెక్ ?అవుట్/i,
    coupon:   /\b(coupon|promo|code)\b|कूपन|कोड|కూపన్|కోడ్/i
  };
  var NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6,
                    'ఒకటి': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6 };
  function numberIn(text) {
    // Hindi "दो" is also the imperative in "डाल दो / कर दो / हटा दो" — "do it".
    // Only a "दो" that is not glued to such a verb is the number two.
    // (no \b here: JavaScript's \b knows only ASCII letters, so it never
    // matches at the edge of a Devanagari word)
    var s = String(text).replace(/(डाल|कर|हटा|लगा|निकाल|खाली|दिखा|खोल|बता|भेज)\s*दो(?=\s|$|[,.!?।])/g, '$1');
    var m = /(\d{1,2})/.exec(s);
    if (m) return parseInt(m[1], 10);
    var t = ' ' + s.toLowerCase() + ' ';
    for (var w in NUM_WORDS) if (t.indexOf(' ' + w + ' ') !== -1 || (w.length > 2 && t.indexOf(w) !== -1)) return NUM_WORDS[w];
    return 0;
  }
  var SHORT_NAME = { 'water-softener': 'Water Softener', 'shower-filter': 'Shower Filter', 'tap-filter': 'Tap Filter', 'washing-ball': 'Washing Machine Ball', 'tap-tile-cleaner': 'Tap & Tile Cleaner' };
  /* Which product a sentence names — by its own aliases, in all three scripts
     and with the spellings speech-to-text actually produces (वाशिंग and
     वॉशिंग, సాఫ్ట్‌నర్ with and without the joiner). The LONGEST alias found
     wins, which is what keeps "tap and tile cleaner" from being read as the
     tap filter. Deliberately not the intent scorer: a sentence with "cart" in
     it makes that scorer pick the cart page, not the product. */
  var PRODUCT_ALIAS = {
    'tap-tile-cleaner': ['tap and tile cleaner', 'tap & tile cleaner', 'tile cleaner', 'tap tile', 'cleaner', 'टाइल क्लीनर', 'क्लीनर', 'टाइल', 'టైల్ క్లీనర్', 'క్లీనర్', 'టైల్'],
    'water-softener':   ['water softener', 'softener', 'softner', 'वॉटर सॉफ्टनर', 'वाटर सॉफ्टनर', 'सॉफ्टनर', 'सॉफ़्टनर', 'वॉटर सॉफ़्टनर', 'వాటర్ సాఫ్ట్‌నర్', 'వాటర్ సాఫ్ట్నర్', 'సాఫ్ట్‌నర్', 'సాఫ్ట్నర్', 'సాఫ్టనర్'],
    'shower-filter':    ['shower head filter', 'shower filter', 'shower', 'शावर फ़िल्टर', 'शावर फिल्टर', 'शावर', 'షవర్ ఫిల్టర్', 'షవర్'],
    'washing-ball':     ['washing machine ball', 'washing ball', 'washing machine', 'washing', 'वॉशिंग मशीन बॉल', 'वाशिंग मशीन बॉल', 'वॉशिंग बॉल', 'वाशिंग बॉल', 'वॉशिंग', 'वाशिंग', 'बॉल', 'వాషింగ్ మెషిన్ బాల్', 'వాషింగ్ బాల్', 'వాషింగ్', 'బాల్'],
    'tap-filter':       ['tap filter', 'tap', 'टैप फ़िल्टर', 'टैप फिल्टर', 'नल का फ़िल्टर', 'टैप', 'नल', 'ట్యాప్ ఫిల్టర్', 'టాప్ ఫిల్టర్', 'ట్యాప్', 'టాప్']
  };
  function productIn(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/‌/g, '').replace(/\s+/g, ' ') + ' ';
    var best = null, bestLen = 0;
    for (var slug in PRODUCT_ALIAS) {
      var al = PRODUCT_ALIAS[slug];
      for (var i = 0; i < al.length; i++) {
        var a = al[i].toLowerCase().replace(/‌/g, '');
        var hit = /^[a-z& ]+$/.test(a) ? t.indexOf(' ' + a + ' ') !== -1 || t.indexOf(' ' + a + 's ') !== -1 : t.indexOf(a) !== -1;
        if (hit && a.length > bestLen) { best = slug; bestLen = a.length; }
      }
    }
    return best;
  }
  // -> {do, product, qty, code} or null
  function parseCommand(text) {
    var s = String(text || '');
    if (!s || CMD.neg.test(s)) return null;
    // "Does the tile cleaner REMOVE old marks?" is a question about the
    // product, not an order to take it out of the cart. ("Can you add…" is a
    // polite request, so can/could stay commands.)
    if (/^\s*(does|do|did|is|are|was|will|would|should|which|what|why|how)\b/i.test(s)) return null;
    var slug = productIn(s), n = numberIn(s);
    if (CMD.clear.test(s) && CMD.cartWord.test(s)) return { do: 'clear' };
    if (CMD.coupon.test(s)) {
      // the code is the token that looks like one: letters+digits first, else
      // the first long all-caps word that is not "COUPON" / "APPLY" itself
      var toks = s.toUpperCase().match(/\b[A-Z][A-Z0-9]{3,15}\b/g) || [], c = null, k;
      for (k = 0; k < toks.length && !c; k++) if (/\d/.test(toks[k])) c = toks[k];
      for (k = 0; k < toks.length && !c; k++) if (toks[k].length >= 5 && !/^(COUPON|PROMO|CODE|APPLY|PLEASE|CHECK)$/.test(toks[k])) c = toks[k];
      if (c) return { do: 'coupon', code: c };
    }
    if (CMD.checkout.test(s)) return { do: 'checkout' };
    if (!slug) return null;
    if (CMD.remove.test(s)) return { do: 'remove', product: slug, cart: CMD.cartWord.test(s) };
    if (CMD.add.test(s)) return { do: 'add', product: slug, qty: n || 1 };
    if (n && CMD.qty.test(s)) return { do: 'qty', product: slug, qty: n };
    return null;
  }
  // What she says once it is done — in the three languages the offline
  // engine speaks; every other language goes to the brain instead.
  var CMD_SAY = {
    en: { add: 'Added the {p} to your cart.', remove: 'Removed the {p} from your cart.', qty: 'Done, {n} {p} in your cart.', clear: 'Your cart is empty now.', checkout: 'Opening checkout for you.', coupon: 'Applying coupon {c}.', login: 'Please sign in with your mobile number first. I have opened the sign-in box.', notin: 'The {p} is not in your cart.', emptycart: 'Your cart is empty.' },
    hi: { add: '{p} आपके कार्ट में डाल दिया।', remove: '{p} कार्ट से हटा दिया।', qty: 'ठीक है, कार्ट में {p} {n} कर दिया।', clear: 'आपका कार्ट खाली कर दिया।', checkout: 'चेकआउट खोल रही हूँ।', coupon: 'कूपन {c} लगा रही हूँ।', login: 'पहले अपने मोबाइल नंबर से साइन इन करें। मैंने साइन-इन बॉक्स खोल दिया है।', notin: '{p} आपके कार्ट में नहीं है।', emptycart: 'आपका कार्ट खाली है।' },
    te: { add: '{p} మీ కార్ట్‌లో పెట్టాను.', remove: '{p} కార్ట్ నుండి తీసేశాను.', qty: 'సరే, కార్ట్‌లో {p} {n} చేశాను.', clear: 'మీ కార్ట్ ఖాళీ చేశాను.', checkout: 'చెక్‌అవుట్ తెరుస్తున్నాను.', coupon: 'కూపన్ {c} వేస్తున్నాను.', login: 'ముందు మీ మొబైల్ నంబర్‌తో సైన్ ఇన్ చేయండి. సైన్-ఇన్ బాక్స్ తెరిచాను.', notin: '{p} మీ కార్ట్‌లో లేదు.', emptycart: 'మీ కార్ట్ ఖాళీగా ఉంది.' }
  };
  // Carry a parsed command out and say so. -> true if it was handled here.
  function runCommand(cmd) {
    var S = window.DcalStore, T = CMD_SAY[lang];
    if (!cmd || !S || !T) return false;
    if (cmd.do === 'checkout' && coStep()) { missCount = 0; return coPress(); }
    if (cmd.do === 'coupon') { missCount = 0; return couponByVoice('', cmd.code); }
    var p = SHORT_NAME[cmd.product] || '', say = null, nav = null, inCart = false;
    try { inCart = !!cmd.product && S.cart().some(function (i) { return (i.slug || i.id) === cmd.product; }); } catch (e) {}
    switch (cmd.do) {
      case 'add':
        // Not signed in: the box opens, she asks for the number, and the add
        // completes by itself once they are in (DcalStore.add waits for it).
        if (!S.loggedIn()) { S.add(cmd.product, cmd.qty); signThen = T.add.replace('{p}', p); say = signInAsk(); break; }
        S.add(cmd.product, cmd.qty); say = T.add; break;
      case 'remove':
        // Not in the cart: unless they said "cart", "remove" was most likely
        // about something else (a stain, scale) — the brain, which reads the
        // whole sentence, answers that.
        if (!inCart) { if (!cmd.cart) return false; say = T.notin; break; }
        S.remove(cmd.product); say = T.remove; break;
      case 'qty':
        if (!inCart) { if (!S.loggedIn()) { S.add(cmd.product, cmd.qty); signThen = T.add.replace('{p}', p); say = signInAsk(); break; } S.add(cmd.product, cmd.qty); say = T.add; break; }
        S.setQty(cmd.product, cmd.qty); say = T.qty; break;
      case 'clear':    S.clear(); say = T.clear; break;
      case 'checkout':
        if (!S.cart().length) { say = T.emptycart; break; }
        if (!S.loggedIn()) { S.login(); signThen = T.checkout; signThenCheckout = true; say = signInAsk(); break; }
        nav = S.checkout(); say = T.checkout; break;
      case 'coupon':   S.coupon(cmd.code); say = T.coupon; break;
      default: return false;
    }
    say = say.replace('{p}', p).replace('{n}', String(cmd.qty || '')).replace('{c}', cmd.code || '');
    missCount = 0;
    addBot(say);
    vlogEv('act', cmd.do + (cmd.product ? ' ' + cmd.product : ''));
    sayReply(say, nav, false, cmd.product);
    return true;
  }

  /* ---- SIGNING IN BY VOICE -------------------------------------------------
     "Add the shower filter" opens the sign-in box, and the box wants a mobile
     number, then a code — typed. For a customer who cannot type, that was the
     end of the road. Now, while the box is open, what they SAY goes into it
     (window.DcalAuth.fill, js/auth.js): the digits of "my number is 98765
     43210", "नौ आठ सात…", "double nine…", in any script.
     A number is read back and she ASKS before pressing Continue — one wrong
     digit and their orders belong to somebody else's phone. A code goes
     straight in and is checked; the box's own checks decide, not hers. */
  var NATIVE_DIGIT = /[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g;
  var DIGIT_WORD = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    'शून्य': '0', 'जीरो': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'छे': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
    'సున్నా': '0', 'జీరో': '0', 'ఒకటి': '1', 'రెండు': '2', 'మూడు': '3', 'నాలుగు': '4', 'ఐదు': '5', 'ఆరు': '6', 'ఏడు': '7', 'ఎనిమిది': '8', 'తొమ్మిది': '9'
  };
  var REPEAT_WORD = { double: 2, triple: 3, 'डबल': 2, 'ट्रिपल': 3, 'డబుల్': 2, 'ట్రిపుల్': 3 };
  // -> every digit they said, in order ("double 9" -> "99")
  function spokenDigits(text) {
    var s = String(text || '').toLowerCase().replace(/[‌‍़]/g, '')
      .replace(NATIVE_DIGIT, function (c) { return String((c.charCodeAt(0) & 15) - 6); });   // every Indic zero sits at ...6
    var toks = s.split(/[^\p{L}\p{M}\p{N}]+/u), out = '', times = 1;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (/^\d+$/.test(t)) { out += new Array(times).join(t.charAt(0)) + t; times = 1; }
      else if (DIGIT_WORD[t]) { out += new Array(times + 1).join(DIGIT_WORD[t]); times = 1; }
      else if (REPEAT_WORD[t]) times = REPEAT_WORD[t];
    }
    return out;
  }
  // "uday dot nadiwade at gmail dot com" -> "uday.nadiwade@gmail.com", or ''
  function spokenEmail(text) {
    var s = ' ' + String(text || '').toLowerCase() + ' ';
    s = s.replace(/\s(at the rate of|at the rate|at)\s/g, '@').replace(/\s(dot|period)\s/g, '.')
         .replace(/\sunderscore\s/g, '_').replace(/\s(dash|hyphen)\s/g, '-').replace(/\s*@\s*/g, '@');
    var m = s.match(/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/);
    return m ? m[0] : '';
  }
  // "my name is Ravi Kumar" -> "Ravi Kumar"
  function spokenName(text) {
    var s = String(text || '').trim().replace(/[.!?।]+$/, '')
      .replace(/^(my name is|my name's|name is|i am|i'm|this is|it's|it is)\s+/i, '')
      .replace(/^(मेरा नाम|मेरा नाम है|नाम)\s*/, '').replace(/\s*(है|हूँ|हूं)$/, '')
      .replace(/^(నా పేరు|పేరు)\s*/, '').trim();
    return s.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).slice(0, 60);
  }
  var YES_WORDS = ['yes', 'yeah', 'yep', 'ok', 'okay', 'correct', 'right', 'sure', 'continue', 'proceed', 'haan', 'han', 'ji',
                   'हाँ', 'हां', 'जी', 'ठीक', 'सही', 'अवश्य', 'అవును', 'సరే', 'ఓకే', 'కరెక్ట్', 'ఔను'];
  var NO_WORDS = ['no', 'nope', 'wrong', 'not', 'nahi', 'nahin', 'नहीं', 'नही', 'गलत', 'ग़लत', 'కాదు', 'లేదు', 'తప్పు', 'వద్దు'];
  function saidAny(text, words) {
    var t = norm(text);
    for (var i = 0; i < words.length; i++) if (t.indexOf(' ' + words[i] + ' ') !== -1) return true;
    return false;
  }
  // 9876543210 -> "9 8 7 6 5, 4 3 2 1 0": read digit by digit, never as one big number
  function spacedDigits(d) { return d.length > 5 ? d.slice(0, 5).split('').join(' ') + ', ' + d.slice(5).split('').join(' ') : d.split('').join(' '); }

  var SIGN_SAY = {
    en: { ask: 'Please sign in first. Just tell me your 10-digit mobile number.',
          askEmail: 'Please sign in first. Tap Continue with Google, or tell me your email address.',
          confirm: 'I have entered {n}. Shall I continue?', confirmEmail: 'I have entered {e}. Shall I continue?',
          more: 'Got {n}. Please say the remaining {k} digits.',
          bad: 'That does not look like a mobile number. Please say all 10 digits again.',
          again: 'Okay, please say your mobile number again.', againEmail: 'Okay, please say your email address again.',
          code: 'Now please tell me the 6-digit code shown on your screen.',
          codeEmail: 'I have sent a 6-digit code to your email. Please tell me the code.',
          codeShort: 'Please say all 6 digits of the code.', wrongCode: 'That code is not right. Please say it again.',
          name: 'Welcome to D\'Cal! What is your name?', email: 'Thank you, {m}. Now please tell me your email address.',
          confirmProfile: 'I have entered your name, {m}, and your email, {e}. Shall I continue?',
          failed: 'That did not work. Please say it again.', done: 'You are signed in.' },
    hi: { ask: 'पहले साइन इन कर लीजिए। बस अपना 10 अंकों का मोबाइल नंबर बोलिए।',
          askEmail: 'पहले साइन इन कर लीजिए। Continue with Google दबाइए, या अपना ईमेल बोलिए।',
          confirm: 'मैंने {n} भर दिया है। क्या आगे बढ़ूँ?', confirmEmail: 'मैंने {e} भर दिया है। क्या आगे बढ़ूँ?',
          more: '{n} लिख लिया। बाकी {k} अंक बोलिए।',
          bad: 'यह मोबाइल नंबर नहीं लग रहा। कृपया पूरे 10 अंक फिर से बोलिए।',
          again: 'ठीक है, अपना मोबाइल नंबर फिर से बोलिए।', againEmail: 'ठीक है, अपना ईमेल फिर से बोलिए।',
          code: 'अब स्क्रीन पर दिख रहा 6 अंकों का कोड बोलिए।',
          codeEmail: 'आपके ईमेल पर 6 अंकों का कोड भेजा है। कृपया वह कोड बोलिए।',
          codeShort: 'कृपया कोड के पूरे 6 अंक बोलिए।', wrongCode: 'यह कोड सही नहीं है। कृपया फिर से बोलिए।',
          name: 'डीकाल में आपका स्वागत है! आपका नाम क्या है?', email: 'धन्यवाद, {m}। अब अपना ईमेल बोलिए।',
          confirmProfile: 'मैंने आपका नाम {m} और ईमेल {e} भर दिया है। क्या आगे बढ़ूँ?',
          failed: 'यह नहीं हो पाया। कृपया फिर से बोलिए।', done: 'आप साइन इन हो गए हैं।' },
    te: { ask: 'ముందు సైన్ ఇన్ చేయండి. మీ 10 అంకెల మొబైల్ నంబర్ చెప్పండి.',
          askEmail: 'ముందు సైన్ ఇన్ చేయండి. Continue with Google నొక్కండి, లేదా మీ ఈమెయిల్ చెప్పండి.',
          confirm: 'నేను {n} నమోదు చేశాను. ముందుకు వెళ్ళనా?', confirmEmail: 'నేను {e} నమోదు చేశాను. ముందుకు వెళ్ళనా?',
          more: '{n} నమోదు చేశాను. మిగిలిన {k} అంకెలు చెప్పండి.',
          bad: 'ఇది మొబైల్ నంబర్ లాగా లేదు. దయచేసి 10 అంకెలు మళ్ళీ చెప్పండి.',
          again: 'సరే, మీ మొబైల్ నంబర్ మళ్ళీ చెప్పండి.', againEmail: 'సరే, మీ ఈమెయిల్ మళ్ళీ చెప్పండి.',
          code: 'ఇప్పుడు స్క్రీన్ మీద కనిపిస్తున్న 6 అంకెల కోడ్ చెప్పండి.',
          codeEmail: 'మీ ఈమెయిల్‌కు 6 అంకెల కోడ్ పంపాను. దయచేసి ఆ కోడ్ చెప్పండి.',
          codeShort: 'దయచేసి కోడ్ లోని 6 అంకెలు చెప్పండి.', wrongCode: 'ఈ కోడ్ సరైనది కాదు. దయచేసి మళ్ళీ చెప్పండి.',
          name: 'డిక్యాల్ కు స్వాగతము! మీ పేరు ఏమిటి?', email: 'ధన్యవాదాలు, {m}. ఇప్పుడు మీ ఈమెయిల్ చెప్పండి.',
          confirmProfile: 'నేను మీ పేరు {m}, ఈమెయిల్ {e} నమోదు చేశాను. ముందుకు వెళ్ళనా?',
          failed: 'అది కుదరలేదు. దయచేసి మళ్ళీ చెప్పండి.', done: 'మీరు సైన్ ఇన్ అయ్యారు.' }
  };
  var signConfirm = null;          // 'phone' | 'email': filled in, waiting for their "yes" to press the button
  var signPartial = '';            // the first digits of a number said in two goes
  var signThen = '';               // what she adds once they are in ("Added the Tap Filter to your cart.")
  var signThenCheckout = false;    // ...and whether checkout opens then
  function signSay() { return SIGN_SAY[lang] || SIGN_SAY.en; }
  function signWaiting() { var A = window.DcalAuth; return (A && A.waiting && A.waiting()) || null; }
  // What to say as the box opens: ask for whatever it is actually showing.
  function signInAsk() {
    vlogEv('login_needed');
    var k = signWaiting(), T = signSay();
    signConfirm = null; signPartial = '';
    return k === 'phone' ? T.ask : k === 'email' ? T.askEmail : (CMD_SAY[lang] || CMD_SAY.en).login;
  }
  function signAnswer(line) { missCount = 0; addBot(line); speak(line, listenAgain); return true; }

  // What they said, while the sign-in box is open. -> true if it was for the box.
  function signInByVoice(text) {
    var A = window.DcalAuth, kind = signWaiting(), T = signSay(), d, v;
    if (!kind) { signConfirm = null; signPartial = ''; return false; }
    d = spokenDigits(text);
    // Waiting for "yes" — a short answer, not a fresh number or address.
    if (signConfirm && d.length < 4 && !spokenEmail(text)) {
      if (saidAny(text, NO_WORDS)) {
        A.fill(''); var was = signConfirm; signConfirm = null;
        return signAnswer(was === 'email' ? T.againEmail : T.again);
      }
      if (saidAny(text, YES_WORDS)) { var k0 = signConfirm; signConfirm = null; if (A.submit()) signFollow(k0); return true; }
      return false;                                // something else entirely: answer it normally
    }
    // The new-account step: "my name is … and my email is …" in one breath —
    // each detail into its own box, not the whole sentence into the name.
    if ((kind === 'name' || kind === 'email') && A.inProfile && A.inProfile() &&
        (detailCount(text) >= 2 || (kind === 'name' && emailCue(text)))) {
      profileByVoice(text);
      return true;
    }
    if (kind === 'phone') {
      if (d.length < 4) return false;             // "एक मिनट" is not a number being dictated
      if (d.length > 12) d = phoneIn(text) || d;  // the number among others ("…and pincode 500081")
      if (d.length === 12 && d.slice(0, 2) === '91') d = d.slice(2);           // +91 98765 43210
      else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);       // 098765 43210
      if (d.length < 10 && signPartial && signPartial.length + d.length <= 10) d = signPartial + d;   // the rest of it
      signConfirm = null; signPartial = '';
      if (d.length > 10 || (d.length === 10 && !/^[6-9]/.test(d))) { A.fill(''); return signAnswer(T.bad); }
      A.fill(d);
      if (d.length < 10) { signPartial = d; return signAnswer(T.more.replace('{n}', spacedDigits(d)).replace('{k}', String(10 - d.length))); }
      signConfirm = 'phone';
      return signAnswer(T.confirm.replace('{n}', spacedDigits(d)));
    }
    if (kind === 'code') {
      if (d.length < 4) return false;
      if (d.length !== 6) return signAnswer(T.codeShort);
      A.fill(d);
      if (A.submit()) signFollow('code');
      return true;
    }
    if (kind === 'email') {
      v = spokenEmail(text);
      if (!v) return false;
      A.fill(v); signConfirm = 'email';
      return signAnswer(T.confirmEmail.replace('{e}', v));
    }
    if (kind === 'name') {
      if (saidAny(text, YES_WORDS) || saidAny(text, NO_WORDS) || d.length) return false;
      v = spokenName(text);
      if (v.length < 2) return false;
      A.fill(v);
      return signAnswer(T.email.replace('{m}', v.split(' ')[0]));
    }
    return false;
  }

  // How many different details one sentence carries: a name, an email, a number.
  function emailCue(text) { return !!spokenEmail(text) || /e-?mail|mail id|ईमेल|ई-मेल|ఈమెయిల్|ఇమెయిల్/i.test(text); }
  function detailCount(text) {
    var n = 0;
    if (/\b(name|i am|i'm|this is)\b|नाम|పేరు/i.test(text)) n++;
    if (emailCue(text)) n++;
    if (spokenDigits(text).length >= 6) n++;
    return n;
  }
  // The mobile number among several numbers said together: a run of digits
  // (spaces and dashes allowed inside it) that is ten long and starts 6-9.
  function phoneIn(text) {
    var runs = String(text || '').match(/\+?\d[\d\s-]*\d/g) || [];
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i].replace(/\D/g, '');
      if (r.length === 12 && r.slice(0, 2) === '91') r = r.slice(2);
      if (/^[6-9]\d{9}$/.test(r)) return r;
    }
    return null;
  }
  // Name and email said together, for the new-account step: the same server
  // reader the checkout uses pulls each one out; each goes into its own box.
  function profileByVoice(text) {
    var A = window.DcalAuth;
    setStatus(UI[lang].thinking);
    fetch(ADDR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && d.form) || {}; })
      .catch(function () { return {}; })
      .then(function (f) {
        setStatus('');
        var T = signSay();
        // the server unreachable: at least the email can be read here, and the name before it
        if (!f.name && !f.email) { f = { email: spokenEmail(text) || undefined }; }
        var v = A.fillProfile({ name: f.name, email: f.email });
        if (!v) return;
        signConfirm = null;
        if (!v.name) { signAnswer(T.name); return; }
        if (!v.email) { signAnswer(T.email.replace('{m}', v.name.split(' ')[0])); return; }
        signConfirm = 'email';
        signAnswer(T.confirmProfile.replace('{m}', v.name).replace('{e}', v.email));
      });
  }

  // She pressed the box's button. Wait for what the box does — the next step,
  // an error, or the customer being signed in — and say THAT, never a guess.
  function signFollow(prev) {
    var A = window.DcalAuth, S = window.DcalStore, T = signSay(), t0 = Date.now();
    setStatus(UI[lang].thinking);
    (function check() {
      var now = signWaiting(), err = A.error ? A.error() : '';
      if (A.isLoggedIn()) {
        vlogEv('signin_ok');
        setStatus('');
        var line = T.done + (signThen ? ' ' + signThen : ''), nav = null;
        if (signThenCheckout && S) nav = S.checkout();
        signThen = ''; signThenCheckout = false;
        addBot(line); sayReply(line, nav, false);
        return;
      }
      if (err) { vlogEv(prev === 'code' ? 'otp_wrong' : 'signin_failed', err); setStatus(''); signAnswer(prev === 'code' ? T.wrongCode : T.failed); return; }
      if (now && now !== prev) {
        setStatus('');
        signAnswer(now === 'code' ? (prev === 'email' ? T.codeEmail : T.code) : now === 'name' ? T.name : T.askEmail);
        return;
      }
      if (Date.now() - t0 > 10000) { setStatus(''); return; }   // nothing happened: the box is theirs to finish
      setTimeout(check, 150);
    })();
  }

  /* ---- COUPONS BY VOICE -----------------------------------------------------
     She used to say "I applied coupon VINA200" while the page said the code
     was invalid — the speech went out before the check came back. Now the
     page checks first (DcalStore.couponTry) and she says what HAPPENED.
     Speech-to-text mangles codes: "Vini 200", "V-I-N-A-Y 200", just "Vinay".
     So what she heard is compared with the codes that exist: one that SOUNDS
     like a real code (same consonant shape), is spelt almost the same, and
     carries the same number gets "Did you mean the VINAY200 coupon?". Anything
     else ("Abhiram 200") is tried exactly as heard, and she says it is invalid —
     never hinting at which codes do exist. */
  // Only words that can mean nothing else. A bare "code" (कोड, కోడ్) is also
  // the pinCODE, the OTP code, the zip code — "…पिनकोड 500081" was taken for a
  // coupon and "gmail.com" tried as one. "apply code X" still reaches the
  // brain, whose coupon act is handled the same way.
  var COUPON_WORD = /\b(coupons?|promo|voucher|discount code|promo code)\b|कूपन|వోచర్|కూపన్|கூப்பன்/i;
  var CP_SAY = {
    en: { ask: 'Did you mean the {c} coupon?', again: 'Okay, please tell me the coupon code again.',
          applied: 'Coupon {c} is applied. Your total is now {t} rupees.',
          invalid: 'I tried to apply {c}, but that coupon code is invalid.',
          cannot: 'I tried to apply {c}, but it cannot be used on this order.' },
    hi: { ask: 'क्या आप {c} कूपन की बात कर रहे हैं?', again: 'ठीक है, कृपया कूपन कोड फिर से बताइए।',
          applied: 'कूपन {c} लग गया है। अब आपका कुल {t} रुपये है।',
          invalid: 'मैंने {c} लगाने की कोशिश की, लेकिन यह कूपन कोड सही नहीं है।',
          cannot: 'मैंने {c} लगाने की कोशिश की, लेकिन यह इस ऑर्डर पर नहीं लग सकता।' },
    te: { ask: 'మీరు {c} కూపన్ గురించి అడుగుతున్నారా?', again: 'సరే, దయచేసి కూపన్ కోడ్ మళ్ళీ చెప్పండి.',
          applied: 'కూపన్ {c} అప్లై అయింది. ఇప్పుడు మీ మొత్తం {t} రూపాయలు.',
          invalid: 'నేను {c} అప్లై చేయడానికి ప్రయత్నించాను, కానీ ఈ కూపన్ కోడ్ చెల్లదు.',
          cannot: 'నేను {c} అప్లై చేయడానికి ప్రయత్నించాను, కానీ ఇది ఈ ఆర్డర్‌కు వర్తించదు.' }
  };
  function cpSay() { return CP_SAY[lang] || CP_SAY.en; }
  var couponAsk = null;      // the code she asked "did you mean …?" about
  var couponLast = 0;        // transcript length after her last coupon line: the NEXT words may correct it
  function couponRecent() { return couponLast > 0 && transcript.length - couponLast <= 1; }

  var CP_FILLER = {};
  ('COUPON COUPONS CODE PROMO VOUCHER APPLY PLEASE USE THE IT ITS SHOULD BE NOT NO MY IS A AN YES YEAH OK OKAY ' +
   'ADD THIS THAT I WANT TO CAN YOU ME WITH FOR ON AND SAY SAID CALLED NAMED TRY ENTER PUT HAVE GOT NOW SURE ' +
   'RIGHT CORRECT ALSO DISCOUNT OFFER ONE SORRY WRONG MEANT MEAN IT\'S').split(' ').forEach(function (w) { CP_FILLER[w] = 1; });
  var NUM_EN = { ZERO: 0, OH: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
                 TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50, SIXTY: 60, SEVENTY: 70, EIGHTY: 80, NINETY: 90 };
  // "two hundred" -> "200", "two zero zero" -> "200", "twenty five" -> "25"
  function numberRun(run) {
    var out = '', total = 0, cur = 0, hundred = run.indexOf('HUNDRED') !== -1;
    if (hundred) {
      run.forEach(function (w) { if (w === 'HUNDRED') { total += (cur || 1) * 100; cur = 0; } else cur += NUM_EN[w]; });
      return String(total + cur);
    }
    for (var i = 0; i < run.length; i++) {
      var v = NUM_EN[run[i]], next = NUM_EN[run[i + 1]];
      if (v >= 20 && next !== undefined && next < 10) { out += String(v + next); i++; }
      else out += String(v);
    }
    return out;
  }
  // -> the code in what they said ("Not Vini, it should be V-I-N-A-Y 200" -> "VINAY200"), or null
  function spokenCode(text) {
    var s = String(text || '').replace(/\S+@\S+/g, ' ').replace(/\bdot\s+com\b/gi, ' ');   // an email is never a code
    var toks = s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' '), joined = [], i, run;
    // spelt out letter by letter: "V I N A Y" -> "VINAY"
    for (i = 0; i < toks.length; i++) {
      if (/^[A-Z]$/.test(toks[i]) && /^[A-Z]$/.test(toks[i + 1] || '')) {
        var w = '';
        while (i < toks.length && /^[A-Z]$/.test(toks[i])) w += toks[i++];
        joined.push(w); i--;
      } else joined.push(toks[i]);
    }
    // numbers said as words
    toks = [];
    for (i = 0; i < joined.length; i++) {
      if (NUM_EN[joined[i]] !== undefined || joined[i] === 'HUNDRED') {
        run = [];
        while (i < joined.length && (NUM_EN[joined[i]] !== undefined || joined[i] === 'HUNDRED')) run.push(joined[i++]);
        toks.push(numberRun(run)); i--;
      } else toks.push(joined[i]);
    }
    toks = toks.filter(function (t) { return t && !CP_FILLER[t]; });
    for (i = 0; i < toks.length; i++) {
      if (/^[A-Z]+\d+$/.test(toks[i])) return toks[i];                                         // VINAY200
      if (/^[A-Z]{2,}$/.test(toks[i]) && /^\d{2,4}$/.test(toks[i + 1] || '')) return toks[i] + toks[i + 1];   // VINAY 200
    }
    var lone = toks.filter(function (t) { return /^[A-Z]{3,}$/.test(t); });           // just "Vinay"
    return lone.length ? lone[lone.length - 1] : null;
  }
  // The consonant shape of a word, by sound: VINAY, VINI, VINNIE, BINAY -> "15"
  var SOUND = { B: 1, F: 1, P: 1, V: 1, W: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  function skeleton(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) { var g = SOUND[s.charAt(i)]; if (g && String(g) !== out.slice(-1)) out += g; }
    return out;
  }
  function editDistance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // -> {code, exact} for a code that exists and is what they meant, or null
  function couponMatch(heard) {
    var S = window.DcalStore, known = (S && S.couponCodes) ? S.couponCodes() : [], said = String(heard || '').toUpperCase();
    if (known.indexOf(said) !== -1) return { code: said, exact: true };
    var m = /^([A-Z]+)(\d*)$/.exec(said);
    if (!m) return null;
    var best = null, bestD = 99;
    known.forEach(function (k) {
      var km = /^([A-Z]+)(\d*)$/.exec(k);
      if (!km || (m[2] && m[2] !== km[2])) return;                     // the number they said must be its number
      var d = editDistance(m[1], km[1]);
      var ok = skeleton(m[1]) === skeleton(km[1]) ? d <= Math.max(2, Math.ceil(km[1].length / 2)) : d <= 1;
      if (ok && d < bestD) { best = k; bestD = d; }
    });
    return best ? { code: best, exact: false } : null;
  }
  // Is this turn about a coupon at all?
  function couponWanted(text) { return !!(couponAsk || COUPON_WORD.test(text) || couponRecent()); }

  // -> true if the turn was a coupon turn and has been answered (maybe a moment later).
  // actCode: a code the brain or the command parser already picked out.
  function couponByVoice(text, actCode) {
    var S = window.DcalStore;
    if (!S || !S.couponTry) return false;
    var short = norm(text).trim().split(' ').length <= 4;
    if (couponAsk && !actCode && short) {
      if (saidAny(text, NO_WORDS)) { couponAsk = null; couponLast = transcript.length + 1; return signAnswer(cpSay().again); }
      if (saidAny(text, YES_WORDS)) { var c = couponAsk; couponAsk = null; couponApply(c); return true; }
    }
    if (!actCode && !couponWanted(text)) return false;
    var heard = actCode || spokenCode(text);
    if (!heard) return false;                                       // "do you have any coupons?" — the brain answers that
    var m = couponMatch(heard);
    if (m && m.exact) { couponApply(m.code); return true; }
    if (m) { couponAsk = m.code; couponLast = transcript.length + 1; vlogEv('coupon_asked', heard + ' -> ' + m.code); return signAnswer(cpSay().ask.replace('{c}', m.code)); }
    couponApply(String(heard).toUpperCase());                       // nothing like it exists: try it as heard
    return true;
  }
  function couponApply(code) {
    var S = window.DcalStore;
    couponAsk = null;
    setStatus(UI[lang].thinking);
    S.couponTry(code).then(function (r) {
      var T = cpSay();
      setStatus('');
      couponLast = transcript.length + 1;
      vlogEv(r.ok ? 'coupon_applied' : r.reason === 'invalid' ? 'coupon_invalid' : 'coupon_rejected', code);
      signAnswer(r.ok ? T.applied.replace('{c}', code).replace('{t}', String(S.total()))
               : (r.reason === 'invalid' ? T.invalid : T.cannot).replace('{c}', code));
    });
  }

  /* ---- CHECKOUT BY VOICE ----------------------------------------------------
     The address form wanted name, mobile, address and pincode — typed. A
     customer said all of it, and the brain, which can type nothing, answered
     "I am filling in your details" while every box stayed empty.
     Now, while the checkout is on screen, what they say becomes the form's
     fields (server: extractAddress — only what was actually said, never a
     guess) and the PAGE types them in (DcalStore.fillAddress), pincode lookup
     and all. She asks for what is still missing, one thing at a time, reads
     the whole address back, and only on their "yes" presses Save & continue.
     From there each next button — Continue to Payment, Place Order — is
     pressed the same way: she asks, they say yes. */
  var ADDR_URL = '/api/assistant/address';
  var FIELD_SAY = {
    en: { name: 'your full name', phone: 'your 10-digit mobile number', line: 'your house number, street and area',
          pincode: 'your 6-digit pincode', state: 'your state', city: 'your city or area' },
    hi: { name: 'अपना पूरा नाम', phone: 'अपना 10 अंकों का मोबाइल नंबर', line: 'अपना मकान नंबर, गली और इलाका',
          pincode: 'अपना 6 अंकों का पिनकोड', state: 'अपना राज्य', city: 'अपना शहर या इलाका' },
    te: { name: 'మీ పూర్తి పేరు', phone: 'మీ 10 అంకెల మొబైల్ నంబర్', line: 'మీ ఇంటి నంబర్, వీధి మరియు ఏరియా',
          pincode: 'మీ 6 అంకెల పిన్‌కోడ్', state: 'మీ రాష్ట్రం', city: 'మీ నగరం లేదా ఏరియా' }
  };
  var CO_SAY = {
    en: { start: 'Please tell me your name, mobile number and full address with pincode.',
          got: 'Done.', ask: 'Now please tell me {f}.',
          confirm: 'I have entered: {a}. Shall I save it and continue?',
          fix: 'Okay. Tell me what to change.', ok: 'Okay.', cant: 'The form says: {e}',
          summary: 'Your order total is {t} rupees. Shall I continue to payment?',
          how: 'How would you like to pay: cash on delivery, or online with UPI or card?',
          place: 'Shall I place your order for {t} rupees, {m}?',
          placing: 'Placing your order.',
          pick: 'Your saved address is selected. Shall I deliver there?',
          razorpay: "Opening Razorpay. I can't guide you through payment, please complete it yourself. Switching off now.",
          cod: 'cash on delivery', upi: 'paying with UPI', card: 'paying by card', netbanking: 'paying with net banking' },
    hi: { start: 'कृपया अपना नाम, मोबाइल नंबर और पिनकोड के साथ पूरा पता बताइए।',
          got: 'ठीक है।', ask: 'अब {f} बताइए।',
          confirm: 'मैंने भरा है: {a}। क्या सेव करके आगे बढ़ूँ?',
          fix: 'ठीक है। बताइए क्या बदलना है।', ok: 'ठीक है।', cant: 'फॉर्म में लिखा है: {e}',
          summary: 'आपका कुल ऑर्डर {t} रुपये का है। क्या पेमेंट पर आगे बढ़ूँ?',
          how: 'आप पेमेंट कैसे करना चाहेंगे: कैश ऑन डिलीवरी, या UPI या कार्ड से ऑनलाइन?',
          place: 'क्या {t} रुपये का ऑर्डर {m} प्लेस कर दूँ?',
          placing: 'आपका ऑर्डर प्लेस कर रही हूँ।',
          pick: 'आपका सेव किया हुआ पता चुना गया है। क्या वहीं डिलीवर करूँ?',
          razorpay: 'Razorpay खोल रही हूँ। पेमेंट में मैं मदद नहीं कर सकती, कृपया खुद पूरा करें। अब मैं बंद हो रही हूँ।',
          cod: 'कैश ऑन डिलीवरी से', upi: 'UPI से', card: 'कार्ड से', netbanking: 'नेट बैंकिंग से' },
    te: { start: 'దయచేసి మీ పేరు, మొబైల్ నంబర్ మరియు పిన్‌కోడ్‌తో పూర్తి చిరునామా చెప్పండి.',
          got: 'సరే.', ask: 'ఇప్పుడు {f} చెప్పండి.',
          confirm: 'నేను నమోదు చేశాను: {a}. సేవ్ చేసి ముందుకు వెళ్ళనా?',
          fix: 'సరే. ఏమి మార్చాలో చెప్పండి.', ok: 'సరే.', cant: 'ఫారమ్‌లో ఇలా ఉంది: {e}',
          summary: 'మీ మొత్తం ఆర్డర్ {t} రూపాయలు. పేమెంట్‌కు ముందుకు వెళ్ళనా?',
          how: 'మీరు పేమెంట్ ఎలా చేస్తారు: క్యాష్ ఆన్ డెలివరీ, లేదా UPI లేదా కార్డ్‌తో ఆన్‌లైన్?',
          place: '{t} రూపాయల ఆర్డర్‌ను {m} ప్లేస్ చేయనా?',
          placing: 'మీ ఆర్డర్ ప్లేస్ చేస్తున్నాను.',
          pick: 'మీరు సేవ్ చేసిన చిరునామా ఎంపికైంది. అక్కడికే డెలివరీ చేయనా?',
          razorpay: 'Razorpay తెరుస్తున్నాను. పేమెంట్‌లో నేను సహాయం చేయలేను, దయచేసి మీరే పూర్తి చేయండి. ఇప్పుడు ఆగిపోతున్నాను.',
          cod: 'క్యాష్ ఆన్ డెలివరీతో', upi: 'UPI తో', card: 'కార్డ్‌తో', netbanking: 'నెట్ బ్యాంకింగ్‌తో' }
  };
  // "continue", "next", "deliver here", "place the order", "save it" — the step's button
  var NEXT_WORDS = ['continue', 'next', 'proceed', 'deliver', 'place', 'save', 'aage', 'आगे', 'सेव', 'ముందుకు', 'సేవ్'];
  var coAsk = null;           // the question she asked — 'save' | 'pay' | 'place' — that a "yes" answers
  var coSeq = 0;              // the newest fill; an older one finishing late is ignored
  var coPrompted = false;     // she has asked for the address since this form appeared
  function coStep() { var S = window.DcalStore; return (S && S.checkoutStep && S.checkoutStep()) || null; }
  function coSay() { return CO_SAY[lang] || CO_SAY.en; }
  function fieldName(k) { return (FIELD_SAY[lang] || FIELD_SAY.en)[k] || k; }
  function hasKeys(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return true; return false; }
  function payMethodIn(text) {
    var t = String(text || '').toLowerCase();
    if (/cash|\bcod\b|कैश|नकद|नगद|క్యాష్|నగదు/.test(t)) return 'cod';
    if (/net ?banking|नेट बैंकिंग|నెట్ బ్యాంకింగ్/.test(t)) return 'netbanking';
    if (/card|कार्ड|కార్డ్/.test(t)) return 'card';
    if (/upi|यूपीआई|phone ?pe|google ?pay|gpay|paytm|फोन ?पे|गूगल पे|ఫోన్ ?పే|గూగుల్ పే|online|ऑनलाइन|ఆన్‌లైన్|ఆన్లైన్/.test(t)) return 'upi';
    return null;
  }
  // the whole address, as she reads it back: numbers digit by digit
  function readBack(v) {
    return [v.name, spacedDigits(v.phone), v.line, v.landmark, [v.city, v.state].filter(Boolean).join(', '),
            v.pincode.split('').join(' ')].filter(Boolean).join(', ');
  }

  // What they said, while the checkout is on screen. `fields` = what the
  // server already pulled out of it (the spoken path), or null to ask now.
  // -> true if the turn was for the checkout (it may finish a moment later).
  // "proceed with the payment", "go to checkout", "पेमेंट करो", "ముందుకు వెళ్ళు" —
  // whatever its length. These used to reach the brain, which answered with
  // "start checkout" or "open the cart" and threw the customer back to step one.
  var GO_RE = /\b(pay|paying|payment|proceed|continue|check ?out|next|place|buy|confirm|go ahead|deliver)\b|पेमेंट|भुगतान|आगे|चेकआउट|खरीद|ऑर्डर कर|పేమెంట్|చెల్లింపు|ముందుకు|చెక్ ?అవుట్|ఆర్డర్ చేయ/i;

  function checkoutByVoice(text, fields) {
    var S = window.DcalStore, step = coStep(), T = coSay(), m;
    if (!step) { coAsk = null; return false; }
    var short = norm(text).trim().split(' ').length <= 5 && !spokenDigits(text);
    var yes = short && (saidAny(text, YES_WORDS) || saidAny(text, NEXT_WORDS)), no = short && saidAny(text, NO_WORDS);
    // on the address form a sentence of details may well contain "continue";
    // there only a short "yes / save / continue" moves on
    var go = step !== 'form' && GO_RE.test(text) && !saidAny(text, NO_WORDS);
    // 1. her question answered
    if (coAsk && (yes || no || go)) {
      var asked = coAsk; coAsk = null;
      if (no) return signAnswer(asked === 'save' ? T.fix : T.ok);
      if (asked === 'place') return payNow(true);
      return coPress();
    }
    // 2. paying: "cash on delivery" / "UPI" / "card"
    if (step === 'payment' && (m = payMethodIn(text))) {
      if (!S.payWith(m)) return false;
      return payNow(false);
    }
    // 3. "continue" / "proceed with payment" / "deliver here" / "save it" — on
    //    from wherever the checkout is, never back to its start
    if (yes || go) return coPress();
    // 4. the address form: their details
    if (step === 'form') {
      if (fields && !hasKeys(fields)) return false;        // nothing for the form in it: answer it normally
      if (!fields && aiState === 'off') return false;
      coFill(text, fields);
      return true;
    }
    return false;
  }

  function coFill(text, fields) {
    var S = window.DcalStore, mine = ++coSeq;
    setStatus(UI[lang].thinking);
    var got = fields ? Promise.resolve(fields) :
      fetch(ADDR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return (d && d.form) || {}; })
        .catch(function () { return {}; });
    got.then(function (f) {
      if (mine !== coSeq) return;
      if (!hasKeys(f)) { setStatus(''); handleQuery(text, undefined, false, true); return; }   // not their details
      return S.fillAddress(f).then(function (r) {
        setStatus('');
        if (!r || mine !== coSeq) return;
        var T = coSay();
        coAsk = null;
        vlogEv('form_filled', Object.keys(f).join(',') + (r.missing.length ? ' / missing ' + r.missing.join(',') : ' / complete'));
        if (r.missing.length) { signAnswer(T.got + ' ' + T.ask.replace('{f}', fieldName(r.missing[0]))); return; }
        coAsk = 'save';
        signAnswer(T.confirm.replace('{a}', readBack(r.values)));
      });
    });
  }

  // One step on — the step's own button — then say what is on screen now.
  function coPress() {
    var S = window.DcalStore, before = coStep();
    if (before === 'cart') { S.checkout(); coAnnounce('cart'); return true; }   // start it
    if (before === 'payment') return payNow(false);
    var ready = before === 'form' ? S.fillAddress({}) : Promise.resolve(null);
    ready.then(function (r) {
      var T = coSay();
      if (r && r.missing.length) { signAnswer(T.ask.replace('{f}', fieldName(r.missing[0]))); return; }   // not complete yet
      if (!S.checkoutNext()) return;
      var now = coStep();
      if (before === 'form' && now === 'form') { var e = S.checkoutError(); vlogEv('form_error', e); signAnswer(e ? T.cant.replace('{e}', e) : T.fix); return; }
      if (before === 'form' && now === 'pick') S.checkoutNext();   // saved and selected: "continue" means deliver there
      coAnnounce(before);
    });
    return true;
  }
  // The checkout has moved on from `before`: say what it asks for now.
  function coAnnounce(before) {
    var S = window.DcalStore, t0 = Date.now();
    (function wait() {
      var now = coStep(), T = coSay();
      if (now === before && Date.now() - t0 < 4000) { setTimeout(wait, 100); return; }   // starting checkout is not instant
      if (now && now !== before) vlogEv('checkout', now);
      if (now === 'form') { if (!coPrompted) { coPrompted = true; coAsk = null; signAnswer(T.start); } return; }
      if (now === 'pick') { coAsk = 'deliver'; signAnswer(T.pick); return; }
      if (now === 'summary') { coAsk = 'pay'; signAnswer(T.summary.replace('{t}', String(S.total()))); return; }
      if (now === 'payment') { coAsk = null; prefetchTts(T.razorpay); signAnswer(T.how); }   // her Razorpay line, ready to play at once
    })();
  }

  /* ---- PAYING -------------------------------------------------------------
     Cash on delivery places a real order, so she asks first. Online payment
     happens inside Razorpay's own window — card numbers, UPI PINs, OTPs — and
     she has no business there: no guiding, and above all no microphone while
     those are said. So she switches her ears off FIRST, says so, closes
     herself, and only then is the payment window opened. She never touches it. */
  var payQuiet = false;       // switched off for a payment: her mic stays shut until they tap her again
  function goQuiet() {
    payQuiet = true;
    userStopped = true;
    if (rec && rec.state === 'recording') { recDiscard = true; stopRecording(); }
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    vadStop();
    closeMic();
    setHandsFree(false);
  }
  function payNow(confirmed) {
    var S = window.DcalStore, T = coSay();
    if (S.paymentMethod() === 'cod') {
      if (!confirmed) { coAsk = 'place'; return signAnswer(T.place.replace('{t}', String(S.total())).replace('{m}', T.cod)); }
      if (S.checkoutNext()) { vlogEv('order_place', 'cod ' + S.total()); signAnswer(T.placing); }
      return true;
    }
    vlogEv('payment_handoff', S.paymentMethod() + ' ' + S.total());
    goQuiet();
    var line = T.razorpay;
    addBot(line);
    speak(line, function () {
      minimizePanel();
      S.checkoutNext();                   // "Pay Securely" -> Razorpay, with her already gone
    });
    return true;
  }
  document.addEventListener('click', function (e) {
    var t = e.target, S = window.DcalStore;
    if (payQuiet || !t || !t.closest || !t.closest('.dcal-co-place') || !S || S.paymentMethod() === 'cod') return;
    goQuiet(); minimizePanel();        // they tapped Pay themselves: off before Razorpay is up
  }, true);
  // However Razorpay opens — her, or the customer's own tap — she goes quiet.
  (function watchRazorpay() {
    if (!window.MutationObserver || !document.body) return;
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        for (var j = 0; j < list[i].addedNodes.length; j++) {
          var n = list[i].addedNodes[j];
          if (n.nodeType !== 1) continue;
          if ((n.className && String(n.className).indexOf('razorpay') !== -1) || (n.querySelector && n.querySelector('iframe[src*="razorpay"]'))) {
            if (!payQuiet || opened) { goQuiet(); minimizePanel(); }
            return;
          }
        }
      }
    }).observe(document.body, { childList: true });
  })();

  // The empty address form has just appeared mid-conversation: she asks for
  // it, instead of the customer having to guess that they can just say it.
  var recDiscard = false;     // the clip being recorded is empty and unwanted: drop it, send nothing
  function coPromptForm() {
    if (coStep() !== 'form') { coPrompted = false; return; }   // ready for the next time it appears
    if (coPrompted || !opened || !handsFree || speakingNow) return;
    if (listening && (!rec || recHeardMs > 0)) return;          // they are already talking
    window.DcalStore.fillAddress({}).then(function (r) {
      if (!r || r.missing.length < 4 || coPrompted || coStep() !== 'form') return;   // an address being edited: no
      if (listening && (!rec || recHeardMs > 0)) return;
      coPrompted = true;
      if (listening) { recDiscard = true; stopRecording(); }   // nobody on it yet: she speaks first
      signAnswer(coSay().start);
    });
  }
  (function watchCheckout() {
    var root = document.getElementById('dcal-cart-root');
    if (!root || !window.MutationObserver) return;
    new MutationObserver(function () { setTimeout(coPromptForm, 0); }).observe(root, { childList: true });
  })();

  // Every AI answer lands here: do what it says, show it, say it, then move.
  // `said` = the customer's words, so a plain command the brain only talked
  // about is still carried out.
  function deliverAI(d, said) {
    missCount = 0;
    if (!d.act && said && KB_LANGS[lang] && runCommand(parseCommand(said))) return;
    // Mid-checkout, the brain's "checkout" means: on from here — starting it
    // again is what threw customers back to step one, round and round.
    if (d.act && d.act.do === 'checkout' && coStep()) { coPress(); return; }
    // A coupon: the page checks it first, then she says what happened — never
    // the brain's own "I applied it".
    if (d.act && d.act.do === 'coupon') { couponByVoice(said || '', d.act.code); return; }
    var nav = runAction(d.act);
    var to = nav || d.go;
    // ...and "open the cart" while already on it would reload the page and lose their place
    if (to && coStep() && String(to).split('?')[0] === location.pathname) to = null;
    addBot(d.reply);
    sayReply(d.reply, to, false, d.act && d.act.product);
  }

  function askAI(text, priorHistory) {
    var spoke = turnSpoke; turnSpoke = null;
    return fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, lang: lang, history: priorHistory || [], state: storeState() })
    }).then(function (r) {
      if (!r.ok) { if (r.status === 503) { aiState = 'off'; panel.classList.remove('dcv-ai-on'); } return null; }
      return r.json();
    }).then(function (d) {
      if (!d || !d.reply) return null;
      if (d.asked || (d.lang && d.lang !== lang)) followLang(spoke, d.asked, d.lang);   // "explain it in Telugu"
      return d;
    }).catch(function () { vlogEv('ai_unreachable', 'network'); return null; });     // network error -> offline fallback
  }

  var missCount = 0;   // consecutive not-understood answers -> escalate the hint
  // "Sorry, I did not understand — ask me about prices / how to buy / your
  // order." Said instead of guessing. Escalates if it happens twice running.
  function sayFallback() {
    vlogEv('fallback');
    missCount++;
    var fb = missCount >= 2 ? FALLBACK2[lang] : FALLBACK[lang];
    addBot(fb); speak(fb, listenAgain);      // stay open so they can just try again
  }
  function localAnswer(text, preMatched) {
    var intent = (preMatched !== undefined && preMatched !== null) ? preMatched : findIntent(text);
    if (intent) { missCount = 0; respondTo(intent); }
    else sayFallback();
  }

  // text = what the customer said; preMatched = offline intent hint;
  // localOnly = skip the AI (used by the instant quick-tap chips).
  // Strategy — OFFLINE-FIRST: if the free engine confidently knows the answer
  // (products, prices, navigation), use it (instant, free, reliable in every
  // language). Only send genuinely open-ended questions to the AI brain.
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // words that are just "open/show/buy/price + product" scaffolding (te/hi/en)
  var ACTION_STOP = /\b(open|show|see|view|display|buy|buying|purchase|order|price|cost|rate|rates|want|need|get|give|go|goto|take|me|us|the|a|an|to|of|for|is|it|this|that|please|my|your|i|we|d|cal|dcal|and|now|about|what|whats|hi|hello)\b/gi;
  // ...and the ordinary grammar that carries a request in Telugu / Hindi: verbs
  // of asking, plus the copulas and particles ("है", "ఉంది", "का", "లో") that
  // would otherwise be mistaken for a subject we do not sell.
  var ACTION_STOP_NATIVE = /(తెరు|చూపించు|చూపు|కావాలి|కొను|కొనాలి|ధర|ఎంత|రూపాయలు|నాకు|ఈ|కావాలి|ఉంది|ఉన్నాయి|చెప్పండి|గురించి|లో|కి|ను|నేను|మీ|खोलो|खोलिए|दिखाओ|दिखाइए|चाहिए|खरीद|खरीदना|दाम|कीमत|कितना|मुझे|यह|है|हैं|हूँ|का|की|के|को|में|से|एक|मैं|आप|बताओ|बताइए)/g;
  /* ---- SENTENCE BOUNDARY -------------------------------------------------
     The scorer above only ever asks "is a word I know in this sentence?".
     That is exactly why "I want to buy an apple" used to open the products
     page: it saw the word "buy" and stopped thinking.

     This asks the opposite and far more useful question — "is there anything
     in this sentence I do NOT know about?" Everything D'Cal legitimately
     talks about is taken out (every keyword of every intent, longest phrases
     first), then the ordinary scaffolding of a request ("i want to…", "నాకు…
     కావాలి"). Whatever is still standing is a SUBJECT this shop knows nothing
     about — an apple, a laptop, a cricket score — and no canned answer is
     safe, no matter how the keywords scored.

     D'Cal's vocabulary is kept in two shapes on purpose:
       KW_PHRASES — multi-word keywords ("shower head filter"), removed as
         substrings, because they are specific enough to be unambiguous;
       KW_WORDS   — every single word, removed only as a WHOLE word. Removing
         those as substrings is what turns "laptop" into "lap" (via "to") and
         "gold" into "ld" (via "go"), quietly letting a foreign subject pass. */
  var KW_PHRASES = [], KW_WORDS = {};
  (function buildVocabulary() {
    var seenPhrase = {};
    for (var i = 0; i < INTENTS.length; i++) {
      var kws = keywordsOf(INTENTS[i]);
      for (var k = 0; k < kws.length; k++) {
        // normalise with the SAME function the scorer uses, so invisible
        // characters (the ZWNJ inside "సాఫ్ట్‌నర్") cannot cause a silent miss
        var n = norm(kws[k]).trim();
        if (!n) continue;
        var parts = n.split(' ');
        // every word of a phrase counts as vocabulary on its own: "ఆర్డర్ ఎక్కడ"
        // teaches us that "ఆర్డర్" is an ordinary D'Cal word, so a customer
        // saying just "ఆర్డర్ ట్రాక్" is not naming something foreign.
        for (var w = 0; w < parts.length; w++) if (parts[w]) KW_WORDS[parts[w]] = 1;
        if (parts.length > 1 && !seenPhrase[n]) { seenPhrase[n] = 1; KW_PHRASES.push(n); }
      }
    }
    KW_PHRASES.sort(function (a, b) { return b.length - a.length; });   // longest first
  })();

  function leftoverSubject(text) {
    var t = norm(text);
    for (var i = 0; i < KW_PHRASES.length; i++) {           // 1) known phrases
      if (t.indexOf(KW_PHRASES[i]) !== -1) t = t.split(KW_PHRASES[i]).join(' ');
    }
    t = t.replace(ACTION_STOP, ' ').replace(ACTION_STOP_NATIVE, ' ');   // 2) scaffolding
    var toks = t.split(' '), out = [];                     // 3) known words, whole only
    for (var w = 0; w < toks.length; w++) {
      if (toks[w] && !KW_WORDS[toks[w]]) out.push(toks[w]);
    }
    return out.join(' ').trim();
  }
  // 3+ characters of unrecognised subject matter left over = they are talking
  // about something that is not ours.
  function hasForeignSubject(text) { return leftoverSubject(text).length >= 3; }

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

  // again: their words are already on screen and were not for the sign-in box
  // or the checkout — just answer them.
  function handleQuery(text, preMatched, localOnly, again) {
    if (!again) {
      // Once they have said anything at all, the all-languages hello has done its
      // job. (Also covers the old-browser path, which never reaches the
      // speech-to-text branch that normally marks this.)
      markIntroduced();
      addYou(text);
      // "ఆ తెలుగులో చెప్పవా?" — a language asked for by name is the language of
      // everything she says from here, this answer included, whichever path
      // answers it (the server spots it too, on the paths it answers).
      var named = namedLang(text);
      if (named && LANGS[named]) followLang(turnSpoke || scriptLang(text), named, named);
      // The sign-in box or the checkout is open: their number, code, address,
      // "yes" or "cash on delivery" is for it.
      if (!localOnly && (signInByVoice(text) || couponByVoice(text) || checkoutByVoice(text, null))) return;
    }
    spotWords(text);            // the product they named lights up before any answer
    // A cart command in Telugu / Hindi / English is done right here — no
    // server, no wait. (A quick-tap chip is never a command.)
    if (!localOnly && KB_LANGS[lang] && runCommand(parseCommand(text))) return;
    setStatus(UI[lang].thinking);
    var typing = addTyping();
    var localHit = (preMatched !== undefined && preMatched !== null) ? preMatched : findIntent(text);
    var isProductHit = localHit && typeof localHit.id === 'string' && localHit.id.indexOf('product:') === 0;
    var routable = isProductHit || (localHit && AI_ROUTE_IDS[localHit.id]);
    // "How much does it cost?" with a product on screen is the price of THAT
    // product — the brain knows which one; the canned list of all five does not.
    var priceOfThis = localHit && localHit.id === 'price' && !localOnly && !productIn(text) && !!(spotFocus || pageProductSlug());
    // Does the sentence name something D'Cal knows nothing about? A quick-tap
    // chip (localOnly) is our own wording, so it is trusted without asking.
    var foreign = !localOnly && hasForeignSubject(text);

    // The offline engine only has canned answers in Telugu/Hindi/English. If the
    // customer is speaking Tamil, Kannada, Marathi… its reply would come out in
    // English at them, so hand those turns to the AI, which answers in their
    // language. (The offline reply is still the safety net if the AI is down.)
    if (!KB_LANGS[lang] && !localOnly && aiState !== 'off') {
      askAI(text, aiContext()).then(function (d) {
        removeEl(typing); setStatus('');
        if (d) deliverAI(d);
        else if (localHit && !foreign) { missCount = 0; respondTo(localHit); }
        else if (foreign) { sayFallback(); }        // never guess at a subject we don't sell
        else { localAnswer(text, preMatched); }
      });
      return;
    }

    // 0a) THE BOUNDARY. The sentence names something outside this shop, so the
    //     keyword match — if there even was one — is a coincidence and must not
    //     be acted on. "I want to buy an apple" matched "buy"; opening the
    //     products page for it is exactly the bug this prevents.
    //     The AI reads the whole sentence and can answer or politely decline;
    //     with no AI reachable we say we did not understand rather than guess.
    if (foreign) {
      if (aiState !== 'off') {
        askAI(text, aiContext()).then(function (d) {
          removeEl(typing); setStatus('');
          if (d) deliverAI(d);
          else sayFallback();
        });
        return;
      }
      setTimeout(function () { removeEl(typing); setStatus(''); sayFallback(); }, 250);
      return;
    }

    // 0) matched a product/info intent, but the customer asked something MORE than
    //    "open/price it" -> let the AI answer relevantly (canned reply is fallback)
    if (((routable && !isBareRequest(text, localHit)) || priceOfThis) && !localOnly && aiState !== 'off') {
      askAI(text, aiContext()).then(function (d) {
        removeEl(typing); setStatus('');
        missCount = 0;
        if (d) deliverAI(d);
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
        if (d) deliverAI(d);
        else localAnswer(text, preMatched);       // AI failed -> offline fallback text
      });
      return;
    }
    // 3) no match and no AI -> friendly fallback
    setTimeout(function () { removeEl(typing); setStatus(''); localAnswer(text, preMatched); }, 250);
  }

  /* ------------------------------------------------------------------ *
   *  8c. SPOTLIGHT  (the product she is talking about, lit up on screen) *
   * ------------------------------------------------------------------ */
  /* A customer who cannot read follows her with their EYES. So the moment she
     knows which product a turn is about — from the customer's own words, or
     from her reply — that product lights up on the page and the rest dims,
     BEFORE she says a word about it. If her reply names several, the light
     moves from one to the next as her voice reaches each name.
     Where the product is not on this page (FAQ, cart…), or she would be
     standing in front of it (a phone; the grid column under the panel), a
     small card of it appears beside her instead. Nothing here touches the
     network: it is painted on the very next frame. */

  /* The names that can only mean one of ours. Stricter than PRODUCT_ALIAS on
     purpose: "tap", "shower" and "washing machine" are also just things in the
     customer's house ("it protects your washing machine"), and lighting up the
     wrong product is worse than lighting up none. Matched after spotNorm(), so
     written without the nukta (फ़ -> फ) and the zero-width joiners. */
  var SPOT_NAMES = {
    'tap-tile-cleaner': ['tap and tile cleaner', 'tap & tile cleaner', 'tap tile cleaner', 'tile cleaner',
                         'टैप और टाइल क्लीनर', 'टाइल क्लीनर', 'ట్యాప్ అండ్ టైల్ క్లీనర్', 'టైల్ క్లీనర్'],
    'water-softener':   ['water softener', 'softener', 'softner',
                         'वॉटर सॉफ्टनर', 'वाटर सॉफ्टनर', 'सॉफ्टनर', 'వాటర్ సాఫ్ట్నర్', 'సాఫ్ట్నర్', 'సాఫ్టనర్'],
    'shower-filter':    ['shower head filter', 'shower filter',
                         'शॉवर हेड फिल्टर', 'शावर हेड फिल्टर', 'शॉवर फिल्टर', 'शावर फिल्टर', 'షవర్ హెడ్ ఫిల్టర్', 'షవర్ ఫిల్టర్'],
    'tap-filter':       ['tap filter', 'faucet filter',
                         'टैप फिल्टर', 'नल का फिल्टर', 'नल फिल्टर', 'ట్యాప్ ఫిల్టర్', 'టాప్ ఫిల్టర్', 'కుళాయి ఫిల్టర్'],
    'washing-ball':     ['washing machine ball', 'washing ball', 'laundry ball',
                         'वॉशिंग मशीन बॉल', 'वाशिंग मशीन बॉल', 'वॉशिंग बॉल', 'वाशिंग बॉल', 'వాషింగ్ మెషిన్ బాల్', 'వాషింగ్ బాల్']
  };
  function spotNorm(s) { return String(s || '').toLowerCase().replace(/[‌‍़]/g, '').replace(/\s+/g, ' '); }
  var SPOT_LIST = [];                                    // [name, slug], longest name first
  (function () {
    for (var slug in SPOT_NAMES) for (var i = 0; i < SPOT_NAMES[slug].length; i++) SPOT_LIST.push([spotNorm(SPOT_NAMES[slug][i]), slug]);
    SPOT_LIST.sort(function (a, b) { return b[0].length - a[0].length; });
  })();
  var PRODUCT_OF = {};
  PRODUCTS.forEach(function (p) { PRODUCT_OF[p.slug] = p; });

  // -> [{at, slug}]: every product a sentence names, in the order it names
  //    them. `at` is the character where the name starts, which is what lets
  //    the light follow her voice through a reply that names several.
  function productMarks(text) {
    var t = spotNorm(text), taken = [], marks = [], i, k;
    for (i = 0; i < SPOT_LIST.length; i++) {
      var name = SPOT_LIST[i][0], latin = /^[a-z]/.test(name), from = 0, at;
      while ((at = t.indexOf(name, from)) !== -1) {
        var end = at + name.length;
        from = end;
        // whole words only for the English names: "softener" is not in "fabricsoftener"
        if (latin && (/[a-z]/.test(t.charAt(at - 1)) || /[a-rt-z]/.test(t.charAt(end)))) continue;
        for (k = 0; k < taken.length; k++) if (at < taken[k][1] && end > taken[k][0]) break;
        if (k < taken.length) continue;                  // part of a longer name already found
        taken.push([at, end]);
        marks.push({ at: at, slug: SPOT_LIST[i][1] });
      }
    }
    marks.sort(function (a, b) { return a.at - b.at; });
    var scale = t.length ? String(text).length / t.length : 1, out = [];
    for (k = 0; k < marks.length; k++) {
      if (out.length && out[out.length - 1].slug === marks[k].slug) continue;   // named twice running: one light
      out.push({ at: Math.round(marks[k].at * scale), slug: marks[k].slug });
    }
    return out;
  }

  // The catalog (/data/catalog.json, the same file the cart prices from) gives
  // the card its photo. Fetched when the panel first opens; until it lands the
  // card simply has no photo.
  var spotCatalog = null, spotCatalogWait = null;
  function loadSpotCatalog() {
    if (spotCatalog || spotCatalogWait) return;
    try {
      spotCatalogWait = fetch('/data/catalog.json', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (c) { spotCatalog = c || {}; if (spotSlug && spotCard && spotCard.classList.contains('on')) fillCard(spotSlug); })
        .catch(function () { spotCatalogWait = null; });
    } catch (e) {}
  }

  var spotSlug = null;        // the product lit up right now
  var spotEl = null;          // ...the element on the page it is lit on (null = the card)
  var spotHole = null, spotCard = null, spotRaf = 0, spotRestTimer = null, spotGlideTimer = null, spotTrackTimer = null;
  var spotFromWords = null;   // lit from the customer's words, before her reply arrived
  // The ONE product the conversation is about right now — what "this
  // product" / "it" means. Set by a turn about a single product; a turn that
  // names several (the price list) is about none of them in particular, and a
  // turn about no product leaves it as it was.
  var spotFocus = null;
  var spotLog = [];           // [{slug, mode, t}] — for the automated checks (DcalVoice._spot)
  var SPOT_KEY = 'dcal_voice_spot';  // sessionStorage: the product page she just opened for them
  var SPOT_LINGER = 8000;     // after she stops talking, the ring stays this long (the dim goes at once)
  var SPOT_LEAD = 6;          // characters: light the next product just BEFORE her voice reaches its name

  function pageProductSlug() {
    try { var m = location.pathname.match(/\/product\/([^\/?#]+)/i); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; }
  }
  function shown(n) { return !!(n && n.offsetWidth > 0 && n.offsetHeight > 0); }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // The product's own card on this page, if it is there and visible: the big
  // photo on its own product page, else a card in a grid / row / "More from".
  // (js/product.js has already pointed every card's link at /product/<slug>.)
  function spotTargetFor(slug) {
    if (pageProductSlug() === slug) {
      var main = document.querySelector('[data-pp-main]');
      var hero = main && (main.closest('.pp-image-wrap') || main);
      if (shown(hero)) return hero;
    }
    var links = document.querySelectorAll('a[href="/product/' + slug + '"]');
    for (var i = 0; i < links.length; i++) {
      var card = links[i].closest('.pc, .pp-row, .pp-more-card');
      if (card && shown(card)) return card;
    }
    return null;
  }
  // Would she be standing in front of it? Measured across, because scrolling
  // can fix up-and-down but not side-to-side.
  function hiddenByPanel(t) {
    if (!opened) return false;
    var p = panel.getBoundingClientRect(), r = t.getBoundingClientRect();
    var across = Math.min(r.right, p.right) - Math.max(r.left, p.left);
    return across > r.width * 0.35;
  }

  // Light up one product. -> 'page' (its card on the page) | 'card' | null
  function spotOn(slug, opts) {
    if (!slug || !PRODUCT_OF[slug]) return null;
    opts = opts || {};
    if (spotRestTimer) { clearTimeout(spotRestTimer); spotRestTimer = null; }
    var target = spotTargetFor(slug), mode;
    if (target && !hiddenByPanel(target)) {
      showHole(target, !opts.rest);
      hideCard();
      mode = 'page';
    } else if (!opts.noCard) {
      hideHole();
      showCard(slug);
      mode = 'card';
    } else return null;
    spotSlug = slug;
    spotLog.push({ slug: slug, mode: mode, t: (window.performance && performance.now) ? performance.now() : Date.now() });
    if (spotLog.length > 40) spotLog.shift();
    return mode;
  }

  function showHole(t, dim) {
    if (!spotHole) {
      spotHole = document.createElement('div');
      spotHole.className = 'dcv-spot-hole';
      spotHole.setAttribute('aria-hidden', 'true');
      document.body.appendChild(spotHole);
    }
    var wasOn = spotHole.classList.contains('on') && spotEl && spotEl !== t;
    spotEl = t;
    var willScroll = bringIntoView(t);
    // From one product to the next, the light glides — unless the page is
    // about to scroll under it, when gliding would only chase the scroll.
    if (wasOn && !willScroll && !reducedMotion()) {
      spotHole.classList.add('dcv-glide');
      clearTimeout(spotGlideTimer);
      spotGlideTimer = setTimeout(function () { if (spotHole) spotHole.classList.remove('dcv-glide'); }, 400);
    }
    placeHole();
    spotHole.classList.add('on');
    spotHole.classList.toggle('dim', !!dim);
    if (!spotRaf) spotRaf = requestAnimationFrame(followHole);
  }
  // In PAGE coordinates, not the screen's. The browser scrolls the page on a
  // thread of its own, and a fixed ring chasing it from here trailed the card
  // by ~90px mid-scroll; attached to the page, it moves with the card exactly.
  // (Every page scrolls the window and leaves <body> unpositioned.)
  function placeHole() {
    if (!spotEl || !spotHole) return;
    var r = spotEl.getBoundingClientRect(), pad = 8, s = spotHole.style;
    var x = window.pageXOffset || 0, y = window.pageYOffset || 0;
    s.left = (r.left + x - pad) + 'px'; s.top = (r.top + y - pad) + 'px';
    s.width = (r.width + pad * 2) + 'px'; s.height = (r.height + pad * 2) + 'px';
  }
  // Every frame while lit, so the ring stays on the card through the page's
  // reveal animations, images loading in, and the window being resized.
  function followHole() {
    spotRaf = 0;
    if (!spotEl || !spotHole || !spotHole.classList.contains('on')) return;
    placeHole();
    spotRaf = requestAnimationFrame(followHole);
  }
  function hideHole() {
    spotEl = null;
    if (spotHole) spotHole.classList.remove('on', 'dim', 'dcv-glide');
    if (spotRaf) { cancelAnimationFrame(spotRaf); spotRaf = 0; }
  }
  // Scroll the card into view only if it is not already; -> true if scrolling.
  function bringIntoView(t) {
    var r = t.getBoundingClientRect(), vh = window.innerHeight || 0, top = 72;
    if (r.top >= top && r.bottom <= vh - 8) return false;                        // already in full view
    if (r.height > vh - top && r.top < vh * 0.5 && r.bottom > vh * 0.5) return false;   // taller than the screen, and filling it
    try { t.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); }
    catch (e) { try { t.scrollIntoView(); } catch (e2) {} }
    return true;
  }

  function showCard(slug) {
    if (!spotCard) {
      spotCard = document.createElement('a');
      spotCard.className = 'dcv-spot-card';
      document.body.appendChild(spotCard);
    }
    fillCard(slug);
    spotCard.classList.add('on');
    placeCard();
  }
  function fillCard(slug) {
    var p = PRODUCT_OF[slug], c = spotCatalog && spotCatalog[slug];
    var title = (p.title[lang] || p.title.en || '').replace(/^\w/, function (ch) { return ch.toUpperCase(); });
    spotCard.href = '/product/' + slug;
    spotCard.setAttribute('aria-label', title);
    spotCard.innerHTML = '';
    if (c && c.img) {
      var img = document.createElement('img');
      img.src = '/images/' + c.img; img.alt = '';
      spotCard.appendChild(img);
    }
    var box = document.createElement('div'); box.className = 'dcv-sc-txt';
    var t = document.createElement('div'); t.className = 'dcv-sc-t'; t.textContent = title;
    var m = document.createElement('div'); m.className = 'dcv-sc-m';
    var pr = document.createElement('span'); pr.className = 'dcv-sc-p'; pr.textContent = '₹' + Number(p.price).toLocaleString('en-IN');
    m.appendChild(pr); m.appendChild(document.createTextNode('★ ' + p.rating));
    var go = document.createElement('span'); go.className = 'dcv-sc-go'; go.textContent = UI[lang].view + ' →';
    box.appendChild(t); box.appendChild(m); box.appendChild(go);
    spotCard.appendChild(box);
  }
  // Beside her on a wide screen (CSS); on a phone, just above her, because
  // there she takes up the whole width.
  function placeCard() {
    if (!spotCard) return;
    var s = spotCard.style;
    if ((window.innerWidth || 0) > 700 || !opened) { s.top = ''; s.bottom = ''; return; }
    var p = panel.getBoundingClientRect(), h = spotCard.offsetHeight || 96;
    s.top = Math.max(8, p.top - h - 10) + 'px'; s.bottom = 'auto';
  }
  function hideCard() { if (spotCard) spotCard.classList.remove('on'); }

  // She has stopped talking: the page comes back up at once, the ring stays a
  // little longer so the customer can still see what she meant.
  function spotRest() {
    stopSpotTrack();
    if (!spotSlug) return;
    if (spotHole) spotHole.classList.remove('dim');
    if (spotRestTimer) clearTimeout(spotRestTimer);
    spotRestTimer = setTimeout(spotOff, SPOT_LINGER);
  }
  function spotOff() {
    if (spotRestTimer) { clearTimeout(spotRestTimer); spotRestTimer = null; }
    stopSpotTrack();
    spotSlug = null; spotFromWords = null;
    hideHole();
    hideCard();
  }

  // The customer's own words name a product: light it now, while the brain is
  // still working out what to say about it.
  function spotWords(words) {
    var marks = productMarks(words);
    if (!marks.length) return;
    spotFocus = marks.length === 1 ? marks[0].slug : null;
    if (spotOn(marks[0].slug)) spotFromWords = marks[0].slug;
  }
  // Her reply is about to be spoken: light what it is about. -> its marks.
  // Order of evidence: the products the reply itself names; else the page it
  // opens or the product it acts on; else whatever the customer named — "how
  // much is it?" answered with "2700 rupees" is still about that product.
  function spotReply(text, go, slug) {
    var marks = productMarks(text);
    if (!marks.length) {
      var g = /^\/product\/([a-z0-9-]+)/.exec(go || '');
      var s = (g && g[1]) || slug;
      if (s && PRODUCT_OF[s]) marks = [{ at: 0, slug: s }];
    }
    var kept = spotFromWords && spotFromWords === spotSlug;
    spotFromWords = null;
    if (!marks.length) {
      if (kept) spotOn(spotSlug);                  // dim again: she is about to talk about it
      else if (spotSlug) spotOff();                // a new subject: last turn's product goes
      return [];
    }
    spotFocus = marks.length === 1 ? marks[0].slug : null;
    spotOn(marks[0].slug);
    return marks;
  }

  // Characters of the current line her voice has reached.
  function voicePos() {
    var a = ttsAudio, s = speakingText || '';
    if (a && isFinite(a.duration) && a.duration > 0) return s.length * Math.min(1, (a.currentTime || 0) / a.duration);
    if (a) return (a.currentTime || 0) * CHARS_PER_SEC;    // still streaming: no length yet, but the playhead is real
    if (ttsUtter) return utterCharIndex;
    return voiceStartedAt ? (Date.now() - voiceStartedAt) / 1000 * CHARS_PER_SEC : 0;
  }
  // Move the light along the products a reply names, in step with her voice.
  function spotTrack(text, marks) {
    stopSpotTrack();
    if (!marks || marks.length < 2) return;
    var i = 0;
    spotTrackTimer = setInterval(function () {
      if (speakingText !== text) { stopSpotTrack(); return; }
      var n = voicePos() + SPOT_LEAD, j = i;
      while (j + 1 < marks.length && n >= marks[j + 1].at) j++;
      if (j !== i) { i = j; spotOn(marks[i].slug); }
      if (i + 1 >= marks.length) stopSpotTrack();
    }, 80);
  }
  function stopSpotTrack() { if (spotTrackTimer) { clearInterval(spotTrackTimer); spotTrackTimer = null; } }
  window.addEventListener('resize', function () { if (spotCard && spotCard.classList.contains('on')) placeCard(); });

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

  /* Put the newest message in view. Called again on the next frame (and after
     the open transition) because a restored conversation is filled in while the
     panel is still closed and .dcv-body is display:none — scrollHeight is 0
     then, so setting scrollTop does nothing and the last line ends up hidden
     under the mic bar once it finally opens. */
  function scrollChatToEnd() {
    if (!el.body) return;
    try { el.body.scrollTop = el.body.scrollHeight; } catch (e) {}
  }
  function scrollChatToEndSoon() {
    scrollChatToEnd();
    if (window.requestAnimationFrame) requestAnimationFrame(scrollChatToEnd);
    setTimeout(scrollChatToEnd, 420);        // after the half-height transition settles
  }

  /* ---- THE CONVERSATION, FOR THE ADMIN --------------------------------------
     Every line of the conversation goes to the server (/api/voice/log) for
     the admin dashboard's "Voice assistant" tab, which works out what went
     wrong in it (server/voicelog.js): with how long the customer waited for
     her VOICE after they stopped speaking, and what happened around it — a
     fallback, the brain unreachable, a coupon checked, a page opened.
     Sent after the fact, batched, never waited on: it adds nothing to a
     reply. A one-time code said aloud is never sent; phone numbers and emails
     are masked again on the server. */
  var VLOG_URL = '/api/voice/log', VLOG_SID_KEY = 'dcal_voice_sid';
  var vlogQueue = [], vlogTimer = null;
  var vlogEnd = 0;          // when the customer stopped speaking, this turn
  var vlogVia = 'voice';    // how this turn reached her: voice / typed / recogniser
  var vlogYouLang = null;   // the language speech-to-text heard them speak
  var vlogBot = null;       // her line whose voice has not started yet
  var vlogLeaving = false;  // the page is going away: what stops now is not a failure
  function vlogSid(fresh) {
    var s = null;
    try { s = fresh ? null : sessionStorage.getItem(VLOG_SID_KEY); } catch (e) {}
    if (!s) {
      s = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { sessionStorage.setItem(VLOG_SID_KEY, s); } catch (e) {}
    }
    return s;
  }
  // A turn begins: the customer stopped speaking at `endedAt`.
  function vlogTurn(via, endedAt) { vlogVia = via; vlogEnd = endedAt || Date.now(); }
  function vlogPush(item) {
    item.at = Date.now(); item.page = location.pathname;
    vlogQueue.push(item);
    if (vlogQueue.length > 80) vlogQueue.shift();
    vlogSchedule(1500);
  }
  function vlogEv(kind, detail) { vlogPush({ t: 'ev', kind: kind, detail: detail == null ? undefined : String(detail) }); }
  // Her voice has just started: that is how long the customer waited.
  function vlogVoice() {
    var b = vlogBot;
    if (!b || speakingText !== b.text) return;
    vlogBot = null;
    if (vlogEnd) b.voiceMs = Date.now() - vlogEnd;
    vlogSchedule(300);
  }
  function vlogSchedule(ms) { if (!vlogTimer) vlogTimer = setTimeout(function () { vlogTimer = null; vlogFlush(false); }, ms); }
  function vlogFlush(leaving) {
    if (!vlogQueue.length) return;
    // a line whose voice has not started yet waits for it (up to 6s)
    if (!leaving && vlogBot && Date.now() - vlogBot.at < 6000) { vlogSchedule(800); return; }
    vlogBot = null;
    var S = window.DcalStore, signedIn = false;
    try { signedIn = !!(S && S.loggedIn && S.loggedIn()); } catch (e) {}
    while (vlogQueue.length) {
      var body;
      try { body = JSON.stringify({ sid: vlogSid(), signedIn: signedIn, items: vlogQueue.splice(0, 25) }); } catch (e) { return; }
      try {
        if (leaving && navigator.sendBeacon) navigator.sendBeacon(VLOG_URL, new Blob([body], { type: 'application/json' }));
        else fetch(VLOG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      } catch (e) {}
    }
  }
  window.addEventListener('pagehide', function () { vlogLeaving = true; vlogFlush(true); });
  window.addEventListener('beforeunload', function () { vlogLeaving = true; });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') vlogFlush(true); });

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
    if (!restoring) {
      transcript.push({ who: who, text: text }); saveChat();
      if (who === 'you') {
        // a one-time code said aloud is never recorded
        var heard = (signWaiting() === 'code' && spokenDigits(text).length >= 4) ? '[one-time code]' : text;
        vlogPush({ t: 'you', text: heard, lang: vlogYouLang || lang, via: vlogVia });
        vlogYouLang = null;
      } else {
        var bl = { t: 'bot', text: text, lang: lang, ms: vlogEnd ? Date.now() - vlogEnd : undefined };
        vlogPush(bl);
        vlogBot = bl;                    // how long they wait for its voice is filled in when it starts
      }
    }
    return wrap;
  }
  // The customer talked over her. The reply stays on screen in full, but the
  // saved turn now says she was cut off, and where — see aiContext(). Only the
  // line she was actually saying qualifies: the spoken-only welcome has no
  // bubble, so interrupting it must not mark some earlier reply instead.
  function markInterrupted(said) {
    var m = transcript.length ? transcript[transcript.length - 1] : null;
    if (!m || m.who !== 'bot' || m.text !== speakingText) return;
    m.cut = true; m.said = said || '';
    saveChat();
  }

  // The welcome bubble no longer exists in the UI, but a tab that was open BEFORE
  // it was removed still has it sitting in sessionStorage — and restoreChat() would
  // paint it back on every page load. Drop it while restoring so old tabs heal.
  function isWelcomeText(t) {
    return t === UI.te.greeting || t === UI.hi.greeting || t === UI.en.greeting;
  }

  // rebuild the panel from the saved conversation (called once on page load)
  function restoreChat() {
    var arr;
    try { arr = JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); } catch (e) { arr = []; }
    if (!arr || !arr.length) return false;
    var clean = arr.filter(function (m) { return m && m.text && !isWelcomeText(m.text); });
    if (!clean.length) { clearChat(); return false; }
    el.body.innerHTML = '';
    clean.forEach(function (m) { addMsg(m.who === 'you' ? 'you' : 'bot', m.text, true); });
    transcript = clean.slice();   // aiContext() reads this, so restored chats keep AI context too
    if (clean.length !== arr.length) saveChat();   // persist the cleanup
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

  /* ---- The mic label is also how customers LEARN they can use their own
     language. Line 1 invites them to ask; line 2 shows real scripts, which a
     customer recognises even when they cannot read the English line above.
     The count keeps itself honest if languages are added to LANGS. ---- */
  var STRIP_SHOW = ['te', 'hi', 'en', 'ta', 'kn'];
  function langStrip() {
    var shown = [], total = 0, c;
    for (c in LANGS) total++;
    for (var i = 0; i < STRIP_SHOW.length; i++) {
      if (LANGS[STRIP_SHOW[i]]) shown.push(LANGS[STRIP_SHOW[i]].label);
    }
    var rest = total - shown.length;
    return shown.join(' · ') + (rest > 0 ? ' +' + rest : '');
  }
  // idle: the two-line invitation. Built as nodes, never innerHTML.
  function setMicIdle() {
    el.micLabel.classList.remove('dcv-live-txt');
    el.micLabel.innerHTML = '';
    var line1 = document.createElement('b');
    line1.textContent = UI[lang].tapToSpeak;
    var line2 = document.createElement('i');
    line2.textContent = langStrip();
    el.micLabel.appendChild(line1);
    el.micLabel.appendChild(line2);
  }
  // busy: plain one-off text ("Listening…", or the live transcript)
  function setMicText(t) { el.micLabel.textContent = t; }
  // show the talking-lady avatar on the mic + FAB while speaking
  function setSpeaking(on) {
    fab.classList.toggle('dcv-speaking', on);
    el.micBtn.classList.toggle('dcv-speaking', on);
    // Move her lips while she talks. Before the customer has engaged she is
    // still mid-namaskaram, and interrupting that to mouth the welcome would
    // undo the greeting — so the talking loop only takes over once they have
    // tapped the mic and the bowing is finished.
    speakingNow = !!on;
    if (!on) spotRest();        // she has stopped talking: the page comes back up (the ring lingers)
    if (!bowed) return;
    if (on) playTalking();
    // Silent: stand still. PAUSE only — the buffer and the playhead survive, so
    // her next reply starts moving immediately instead of loading all over again.
    else { if (el.vidTalk) { try { el.vidTalk.pause(); } catch (e) {} } setFace('still'); }
  }

  /* ---- Namaskaram, then standing --------------------------------------
     She greets with the namaskaram ONLY while she is waiting to be spoken to.
     The moment the customer taps the mic, the greeting is over: she stands for
     the rest of the conversation instead of bowing again and again behind it.
     The flag lives in sessionStorage because navigating to a product page
     reloads this script mid-chat — without it she would start bowing again at
     every page she opens for them. */
  /* ---- Second stage of the welcome -------------------------------------
     WELCOME went out in every language at once. The customer answered — and
     the speech-to-text told us which language that answer was IN. Now, and only
     now, can she introduce herself properly, in their own language.
     Persisted for the same reason the bow is: opening a product page reloads
     this script, and she must not introduce herself all over again. */
  var INTRO_KEY = 'dcal_voice_introduced';
  var introduced = false;
  try { introduced = sessionStorage.getItem(INTRO_KEY) === '1'; } catch (e) {}
  function markIntroduced() {
    introduced = true;
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch (e) {}
  }
  // Was that first utterance simply them greeting back? If so it is not a
  // question to answer — it is our cue to introduce ourselves in their language.
  function isGreetingBack(text) {
    var hit = findIntent(text);
    return !!(hit && hit.id === 'greeting');
  }

  var BOW_KEY = 'dcal_voice_greeted';
  var bowed = false;
  try { bowed = sessionStorage.getItem(BOW_KEY) === '1'; } catch (e) {}

  /* Which of the three faces is showing: the namaskaram clip, the conversation
     clip, or the standing photo. Exactly one, always. */
  function setFace(mode) {
    if (!el.face) return;
    el.face.classList.toggle('is-greet', mode === 'greet');
    el.face.classList.toggle('is-talk', mode === 'talk');
  }
  // Full-height welcome vs. the split conversation view. Driven by the same
  // moment as the bow ending — the customer reaching for the mic — because that
  // is exactly when there starts being something to read underneath her.
  function setChatMode(on) {
    panel.classList.toggle('dcv-chat', !!on);
  }
  // Called the first time the customer reaches for the mic — and never undone
  // until the conversation itself is ended with the ✕.
  function stopBowing() {
    if (!bowed) { bowed = true; try { sessionStorage.setItem(BOW_KEY, '1'); } catch (e) {} }
    setFace('still');
    setChatMode(true);          // she moves up, the conversation opens beneath her
    pauseVideo();
    primeTalkVideo();           // fetch the talking clip NOW, not when she speaks
  }

  /* ---- Lip movement while she speaks -----------------------------------
     AI_Lady_conversation.mp4 is 6s of her talking, upright from first frame to
     last, so it simply loops — no seeking, no clamping to a sub-range.

     LATENCY. The clip is ~5MB, and the gap the customer notices is the wait
     between her voice starting and her lips moving. Three things close it:
       1. the download starts the moment they tap the mic, so it runs during
          speech-to-text + the AI + the voice, instead of after all of them;
       2. it is never re-fetched — its own element keeps the buffer, and
          stopping only PAUSES, so the next reply resumes on the same frame;
       3. we never seek. Setting currentTime forces the decoder to re-sync and
          shows a frozen frame while it does.
     If it still is not ready, she stays on the standing photo and switches the
     instant it can play — a still lady beats a stalled black rectangle. */
  var talkPrimed = false;
  var speakingNow = false;

  function primeTalkVideo() {
    var v = el.vidTalk;
    if (!v || talkPrimed) return;
    talkPrimed = true;
    try { v.muted = true; v.preload = 'auto'; v.load(); } catch (e) {}
  }

  function playTalking() {
    var v = el.vidTalk;
    if (!v) return;
    primeTalkVideo();
    v.muted = true;
    // readyState >= 2 (HAVE_CURRENT_DATA) means there is a frame to show
    setFace(v.readyState >= 2 ? 'talk' : 'still');
    var p = v.play();
    if (p && p.catch) p.catch(function () { setFace('still'); });
    if (v.readyState < 2) {
      v.oncanplay = function () {
        v.oncanplay = null;
        if (speakingNow) setFace('talk');        // she may have finished by now
      };
    }
  }

  // The namaskaram loops the whole time she is waiting, and stops when the panel
  // is closed so a minimized assistant costs no battery. muted is set in JS as
  // well as in the markup because that is what browsers require to autoplay.
  function playVideo() {
    var v = el.vidGreet;
    if (!v) return;
    if (bowed) { setFace('still'); primeTalkVideo(); return; }   // already engaged -> stand
    setFace('greet');
    v.muted = true;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});   // blocked autoplay -> poster stays, no error
  }
  // Pause, never unload: whatever is buffered stays buffered for the next reply.
  function pauseVideo() {
    if (el.vidGreet) { try { el.vidGreet.pause(); } catch (e) {} }
    if (el.vidTalk) { try { el.vidTalk.pause(); } catch (e) {} }
  }
  function setLive(on) {
    fab.classList.toggle('dcv-live', on);
    el.micBtn.classList.toggle('dcv-live', on);
    el.stopBtn.classList.toggle('on', on);
    if (on) setMicText(UI[lang].listening);
    else setMicIdle();                                       // back to the invitation
  }

  /* ------------------------------------------------------------------ *
   *  10. RENDER LANGUAGE-DEPENDENT TEXT                                 *
   * ------------------------------------------------------------------ */
  function renderChrome() {
    var t = UI[lang];
    el.hintTxt.textContent = t.tagline;
    el.hTitle.textContent = t.title;
    el.hSub.textContent = t.tagline;
    setMicIdle();
    fab.setAttribute('aria-label', t.title);
  }

  /* ---- THE LANGUAGE THEY ASKED FOR -------------------------------------
     Speech-to-text tells us the language they SPOKE, and she answers in it.
     But "explain this in Telugu", said in English, asks for Telugu — and
     goes on asking for it: their next English question still wants a Telugu
     answer. So a language named like that (the server spots it: `asked`) is
     kept for as long as they go on speaking the language they asked in. The
     moment they speak another one, she follows that instead. */
  var ASKED_KEY = 'dcal_voice_asked';
  var askedLang = null;      // {want, spoke}: answer in `want` while they speak `spoke`
  var turnSpoke = null;      // the language speech-to-text heard this turn (two-step path)
  try { askedLang = JSON.parse(sessionStorage.getItem(ASKED_KEY) || 'null'); } catch (e) { askedLang = null; }
  function setAsked(v) {
    askedLang = v;
    try { if (v) sessionStorage.setItem(ASKED_KEY, JSON.stringify(v)); else sessionStorage.removeItem(ASKED_KEY); } catch (e) {}
  }
  /* A language asked for BY NAME: "ఆ తెలుగులో చెప్పవా?", "explain it in Tamil".
     The server spots it as well (askedLanguage in server/assistant.js — keep
     the two lists alike); this copy is for every turn the server does not
     answer: typed, the browser's own recogniser, the brain unreachable. A
     name merely mentioned loses to one asked for ("I don't understand Hindi,
     say it in English"); a negated one does not count. Microseconds. */
  var NAMED_LANGS = [
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
  var NAMED_NOT_BEFORE = /(\bnot|\bno|\bdon'?t|नहीं|मत|కాదు|వద్దు)\s*$/i;
  var NAMED_NOT_AFTER = /^\s*(नहीं|मत|కాదు|వద్దు)/;
  var NAMED_ASK_BEFORE = /\b(in|into|speak|talk|use|say|explain|tell)\s*$/i;
  var NAMED_ASK_AFTER = /^\s*(mein|me|mai|lo|il|la|में|मे|लो|లో|ில்|இல்|ல|ದಲ್ಲಿ|ത്തിൽ|ਵਿੱਚ|ते|मध्ये|তে|માં|ରେ)/i;
  function namedLang(text) {
    var s = String(text || ''), best = null, at = -1, marked = false;
    for (var i = 0; i < NAMED_LANGS.length; i++) {
      var re = NAMED_LANGS[i][1], m;
      re.lastIndex = 0;
      while ((m = re.exec(s))) {
        var before = s.slice(Math.max(0, m.index - 12), m.index), after = s.slice(m.index + m[0].length, m.index + m[0].length + 8);
        if (NAMED_NOT_BEFORE.test(before) || NAMED_NOT_AFTER.test(after)) continue;
        var ask = NAMED_ASK_BEFORE.test(before) || NAMED_ASK_AFTER.test(after);
        if ((ask && !marked) || (ask === marked && m.index > at)) { best = NAMED_LANGS[i][0]; at = m.index; marked = ask; }
      }
    }
    return best;
  }
  // What speech-to-text said they spoke, checked against the letters it
  // wrote: Telugu letters are Telugu, whatever the detector guessed.
  // A script two languages share (Devanagari: Hindi, Marathi) keeps the detector's choice.
  function spokeIn(detected, text) {
    var s = String(text || '');
    for (var i = 0; i < SCRIPTS.length; i++) {
      if (!SCRIPTS[i][0].test(s)) continue;
      var owners = SCRIPTS[i][1];
      return owners.indexOf(detected) !== -1 ? detected : owners[0];
    }
    return detected;                 // Latin letters: English or romanised — the detector knows better
  }

  // spoke: heard this turn (may be unknown); asked: a language they named; reply: the answer's language
  function followLang(spoke, asked, reply) {
    if (asked && LANGS[asked]) {
      if (!askedLang || askedLang.want !== asked) vlogEv('lang', asked + ' asked');
      setAsked({ want: asked, spoke: (spoke && LANGS[spoke]) ? spoke : lang }); applyLang(asked); return;
    }
    if (!spoke || !LANGS[spoke]) { if (reply && LANGS[reply]) applyLang(reply); return; }
    if (askedLang && askedLang.spoke === spoke) { applyLang(askedLang.want); return; }
    if (askedLang) setAsked(null);              // a different language now: follow it
    if (spoke !== lang) vlogEv('lang', spoke + ' spoken');
    applyLang(spoke);
  }

  // Quiet switch, used when the customer's own speech tells us the language.
  // It must NOT clear the chat or greet — they are mid-conversation; the only
  // visible effect is that the assistant answers them in their language now.
  function applyLang(l) {
    if (!LANGS[l] || l === lang) return;
    lang = l;
    try { localStorage.setItem('dcal_voice_lang', l); } catch (e) {}
    renderChrome();
  }

  function setLang(l) {
    if (!LANGS[l]) return;
    setAsked(null);
    lang = l;
    hearLang = l;                       // and listen in it
    localStorage.setItem('dcal_voice_lang', l);
    stopSpeaking();
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    renderChrome();
    // fresh start in the new language (reset the saved conversation too). The
    // welcome is only SPOKEN now — its bubble was removed along with the
    // language buttons, the video sits there instead.
    el.body.innerHTML = '';
    clearChat();
    greeted = true;
    speak(UI[lang].greeting);
  }

  /* ------------------------------------------------------------------ *
   *  11. OPEN / CLOSE                                                   *
   * ------------------------------------------------------------------ */
  var opened = false, greeted = false;
  var welcomeSaid = false;            // the all-languages WELCOME (which introduces her) was spoken
  // fromRestore: reopened after a page change (no burst, no speak).
  // noSpeak: open + show the greeting but don't speak yet (used for the auto-welcome,
  //          where the voice is played on the first user gesture instead).
  function openPanel(fromRestore, noSpeak) {
    panel.classList.add('dcv-open');
    fab.classList.add('dcv-open');      // stop the attention blink while open
    opened = true;
    // A page change mid-conversation reloads this script: come back in the SAME
    // view they left, split with their chat under her, not the full-height welcome.
    setChatMode(bowed);
    scrollChatToEndSoon();              // a restored chat scrolls only once it has a size
    playVideo();                        // she starts looping as soon as she is on screen
    loadSpotCatalog();                  // the product photos the spotlight card shows
    if (!fromRestore) {                 // fire the magic burst from the mic (not on page-restore)
      setOpenFlag(true);                // remember open state across page changes
      fab.classList.remove('dcv-pop');
      void fab.offsetWidth;             // restart the animation
      fab.classList.add('dcv-pop');
      setTimeout(function () { fab.classList.remove('dcv-pop'); }, 650);
    }
    if (!greeted) {
      greeted = true;
      // welcome is spoken only — no text bubble (the video greets her visually)
      // the FIRST hello is the all-languages one; her proper introduction comes
      // after they answer and we know which language they speak
      if (!fromRestore && !noSpeak) { welcomeSaid = !introduced; speak(introduced ? UI[lang].greeting : WELCOME); }
    }
  }

  // Auto-welcome on the first visit: open the panel and show the welcome message.
  // Audio is blocked by browsers until the user interacts, so we speak the welcome
  // on the FIRST tap/scroll/key (skipping it if they go straight to the mic).
  function autoWelcome() {
    if (opened) return;
    openPanel(false, true);             // open + show welcome (no immediate speak)
    if (!ttsReady && !SPEECH) return;   // no voice of any kind -> skip the spoken welcome
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
      if (!opened || listening) return;
      welcomeSaid = !introduced;
      speak(introduced ? UI[lang].greeting : WELCOME, function () {
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
    pauseVideo();
    stopSpeaking();
    userStopped = true;
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    closeMic();                         // out of sight = not listening, visibly so
    spotOff();                          // ...and nothing left lit up on the page
    setHandsFree(false);                // ...and the next page does not switch it back on
    setOpenFlag(false);                 // stays minimized across page changes; chat is kept
  }
  function closePanel() {
    minimizePanel();
    // user closed the assistant -> end the conversation (clear it)
    vlogFlush(true); vlogSid(true);     // ...and its transcript: the next one starts afresh
    clearChat();
    el.body.innerHTML = '';
    greeted = false;
    // conversation over: the next person to open her starts from the beginning —
    // the namaskaram, and the all-languages hello that asks who they are
    bowed = false;
    introduced = false;
    welcomeSaid = false;
    setAsked(null);
    try { sessionStorage.removeItem(BOW_KEY); sessionStorage.removeItem(INTRO_KEY); } catch (e) {}
    setFace('greet');            // back to the namaskaram for the next customer
    setChatMode(false);          // ...at full height, with no chat panel under her
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
    if (rec && rec.state === 'recording') stopRecording();
    if (recog && listening) { try { recog.stop(); } catch (e) {} }
    stopSpeaking();
    spotOff();
    closeMic();                         // "stop" means the mic too
    setHandsFree(false);
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
    ask: function (text) { openPanel(); turnSpoke = null; vlogTurn('typed', Date.now()); handleQuery(text); },
    setLanguage: setLang,
    speak: speak,
    // exposed for diagnostics / automated checks
    _match: function (text) { var i = findIntent(text); return i ? i.id : null; },
    _correct: function (text) { return autoCorrect(text); },
    _bare: function (text) { var i = findIntent(text); return i ? isBareRequest(text, i) : null; },
    // what is left of the sentence once everything D'Cal knows about is removed
    _foreign: function (text) { return leftoverSubject(text); },
    // the barge-in detector, for tests that feed it numbers instead of a mic
    _vad: vadStep, _vadState: newVadState, _VAD: VAD,
    // the local cart-command parser: "వాషింగ్ బాల్ తీసేయి" -> {do:'remove', product:'washing-ball'}
    _cmd: parseCommand,
    // the spotlight: which products a line names, what is lit, and when each lit up
    _marks: productMarks,
    // signing in by voice: the digits / address heard in a sentence
    _digits: spokenDigits, _email: spokenEmail, _name: spokenName,
    // coupons by voice: the code heard, and the real code it may mean
    _code: spokenCode, _couponMatch: couponMatch,
    _spot: function () { return { slug: spotSlug, mode: spotSlug ? (spotEl ? 'page' : 'card') : null, log: spotLog.slice() }; },
    _debug: function () {
      return { vadOn: vadOn, mic: micAlive(), preroll: preroll.length, speaking: speakingNow,
               listening: listening, paused: voicePaused, floor: vadSt ? vadSt.floor : null,
               said: speakingText, transcript: transcript.slice() };
    }
  };

  /* ------------------------------------------------------------------ *
   *  13. INIT                                                           *
   * ------------------------------------------------------------------ */
  renderChrome();
  checkAI();      // ask the server whether the OpenRouter AI brain is available
  checkTTS();     // ask the server whether the ElevenLabs natural voice is available
  checkSTT();     // ...and whether it can hear + detect the customer's language
  probeMicPermission();   // may she open the mic quietly while speaking, or only on a tap?
  // bring back the conversation from before this page change (same browser tab)
  if (restoreChat()) greeted = true;
  // She opened this product page while showing the product: light it once more
  // on arrival, without the dim (she is not talking) and never as a card — a
  // card of the page they are already on would only be in the way.
  (function () {
    var s = null;
    try { s = sessionStorage.getItem(SPOT_KEY); sessionStorage.removeItem(SPOT_KEY); } catch (e) {}
    if (!s || s !== pageProductSlug()) return;
    setTimeout(function () { if (spotOn(s, { rest: true, noCard: true })) spotRest(); }, 350);
  })();
  // Decide how the assistant starts on this page:
  var openState = null;
  try { openState = sessionStorage.getItem(OPEN_KEY); } catch (e) {}
  if (openState === '1') {
    openPanel(true);                 // it was open before this page change -> keep it open
    if (handsFree) resumeHandsFree();   // she opened this page for them: keep listening, no tap
  } else if (openState === null) {
    setTimeout(autoWelcome, 1200);   // FIRST visit this session -> auto-open + welcome (after the page settles)
  }
  // openState === '0' means the user closed/minimized it earlier -> leave it closed
})();
