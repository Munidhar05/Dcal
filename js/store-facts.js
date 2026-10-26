/* =========================================================
   D'Cal store facts — what the shop already offers, said where a shopper looks.
   data/store.json holds the delivery days, the Demo Kit's delivery charge,
   COD, the warranty and the wallet; data/catalog.json holds prices and MRPs.
   This file only shows those numbers. It makes no offer of its own, so every
   line is as true as the two files (asked 26 Oct 2026: "nothing new, show
   what is there in a good way, nothing hyperactive").

   It paints four things:
     1. the blue top bar: its lines rotate, one at a time, calmly
     2. [data-fact] spans anywhere: the days, months and hours in running text
     3. a product page: "You save" by the price, delivery date + COD + damage
        cover under stock, two quiet "not sure?" links under the buttons, and
        the product's own points (store.json products) in place of the
        softener's, which the page used to carry for every product
     4. the cart: what they save on MRP, delivery, COD, one add-on suggestion
   (The wallet page, checkout and order confirmation say their lines in their
   own code: html/wallet.html, js/auth.js.)

   The lines are the "Ready" ones of the 200 offered on 26 Oct 2026 (artifact
   4QuQNDYZHHQXC227kfjFrZ): true today, with no new offer behind them.

   Delivery dates are counted in India's calendar (Asia/Kolkata) whatever the
   phone's clock says, in the courier's working days, and always from the
   SLOWEST end of the ranges: "get it by" is a promise, so it is the latest day.
   ========================================================= */
(function () {
  'use strict';

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var BAR_KEY = 'dcal_promo_store_lines_v2';   // the dismiss flag, shared with each page's inline bar script
  var me = document.currentScript;

  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }
  function rupees(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---- calendar: dates as UTC midnights, so adding days never drifts ---- */
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function todayInIndia() {
    var s = '';
    try { s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) {}
    return parseDay(s) || parseDay(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10));
  }
  function nextDay(d) { return new Date(d.getTime() + 864e5); }
  function working(d, F) { return F.work.indexOf(d.getUTCDay()) > -1 && F.holidays.indexOf(isoDay(d)) < 0; }
  function addWorkingDays(d, n, F) {
    var x = d, guard = 0;
    while (n > 0 && guard++ < 400) { x = nextDay(x); if (working(x, F)) n--; }
    return x;
  }
  function dayLabel(d) { return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  // the day an order placed on `d` arrives by, at the latest
  function arrivesBy(d, F) { return addWorkingDays(d, F.dispatch[1] + F.delivery[1], F); }
  // the last day an order can be placed and still arrive before `before`
  function lastOrderDay(before, F) {
    var today = todayInIndia(), last = null, d = today, guard = 0;
    while (d < before && guard++ < 120) { if (arrivesBy(d, F) < before) last = d; d = nextDay(d); }
    return last;
  }

  /* ---- data/store.json -> the facts, every value checked ---- */
  function range(a, fallback) {
    a = Array.isArray(a) ? a : [a];
    var lo = Number(a[0]), hi = Number(a.length > 1 ? a[1] : a[0]);
    return (isFinite(lo) && isFinite(hi) && lo >= 0 && hi >= lo) ? [lo, hi] : fallback;
  }
  function count(v, fallback) { var n = Number(v); return v !== '' && v != null && isFinite(n) && n >= 0 ? n : fallback; }
  function factsFrom(S, C) {
    var d = S.delivery || {}, w = S.wallet || {};
    var work = (Array.isArray(d.workingDays) ? d.workingDays : []).map(function (x) { return DAYS.indexOf(String(x).slice(0, 3)); })
      .filter(function (i) { return i > -1; });
    var F = {
      dispatch: range(d.dispatchDays, [1, 2]),
      delivery: range(d.deliveryDays, [3, 7]),
      work: work.length ? work : [1, 2, 3, 4, 5, 6],
      holidays: Array.isArray(d.holidays) ? d.holidays.map(String) : [],
      cod: S.cashOnDelivery !== false,
      warranty: count(S.warrantyMonths, 6),
      reportHours: count(S.damageReportHours, 48),
      walletCredit: count(w.credit, 500),
      catalog: C || {}
    };
    F.today = todayInIndia();
    F.deliverBy = arrivesBy(F.today, F);
    return F;
  }
  function span(r) { return r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1]; }
  // a line's dates: from / until are calendar days in India; before is a
  // delivery deadline, so the line goes once an order today would arrive late
  function inWindow(l, F) {
    var from = parseDay(l.from), until = parseDay(l.until), before = parseDay(l.before);
    if (from && F.today < from) return false;
    if (until && F.today > until) return false;
    if (before && !lastOrderDay(before, F)) return false;
    return true;
  }

  /* ---- catalog helpers ---- */
  function priceOf(p) { return Number(p && p.price) || 0; }
  function mrpOf(p) { return Math.max(Number(p && p.was) || 0, priceOf(p)); }
  function savePct(p) { var w = mrpOf(p); return w > 0 ? Math.round((w - priceOf(p)) / w * 100) : 0; }
  function shortName(p) { return String(p.title || '').replace(/^D['’]Cal\s+/i, '').replace(/^Independent House\s+/i, ''); }
  // the biggest real discount on something that can be bought today
  function bestDeal(C) {
    var best = null;
    Object.keys(C).forEach(function (slug) {
      var p = C[slug];
      if (!p || p.free || p.outOfStock || !(priceOf(p) > 0) || savePct(p) <= 0) return;
      if (!best || savePct(p) > savePct(best.p)) best = { slug: slug, p: p };
    });
    return best;
  }

  /* ---- {tokens} -> words; a token that can't be true today drops its line ---- */
  function fill(text, F, line) {
    var best = null, missing = false;
    var out = String(text || '').replace(/\{(\w+)\}/g, function (_, k) {
      var v = null;
      if (k === 'dispatch') v = span(F.dispatch);
      else if (k === 'delivery') v = span(F.delivery);
      else if (k === 'deliverBy') v = dayLabel(F.deliverBy);
      else if (k === 'walletCredit') v = rupees(F.walletCredit);
      else if (k === 'warrantyMonths') v = String(F.warranty);
      else if (k === 'reportHours') v = String(F.reportHours);
      else if (k === 'orderBy') {
        var before = parseDay(line && line.before), last = before && lastOrderDay(before, F);
        if (last) v = isoDay(last) === isoDay(F.today) ? 'tonight' : dayLabel(last);
      } else if (/^best/.test(k)) {
        best = best || bestDeal(F.catalog);
        if (best) v = { bestSave: String(savePct(best.p)), bestName: shortName(best.p), bestPrice: rupees(priceOf(best.p)), bestLink: '/product/' + best.slug }[k];
      }
      if (v == null) { missing = true; return ''; }
      return v;
    });
    return missing ? null : out;
  }

  /* ========== 1) THE TOP BAR ========== */
  var CSS =
    '#pp-promo-bar .pp-promo-msg{display:block;min-width:0;max-width:100%;overflow:hidden;line-height:1.3;transition:opacity .35s ease,transform .35s ease}' +
    '#pp-promo-bar .pp-promo-msg.is-out{opacity:0;transform:translateY(-4px)}' +
    '#pp-promo-bar .pp-promo-msg a{color:inherit;text-decoration:none}' +
    '#pp-promo-bar .pp-promo-msg a:hover,#pp-promo-bar .pp-promo-msg a:focus-visible{text-decoration:underline;text-underline-offset:3px}' +
    '#pp-promo-bar .pp-promo-msg a::after{content:" \\203A";opacity:.75}' +
    '@media(max-width:600px){#pp-promo-bar .pp-promo-msg{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}}' +
    '@media(prefers-reduced-motion:reduce){#pp-promo-bar .pp-promo-msg{transition:none}}' +
    /* product page */
    '.dcal-you-save{font-size:14px;font-weight:600;color:#0B6E4F}' +
    '.dcal-facts{list-style:none;margin:-8px 0 24px;padding:0;display:grid;gap:8px}' +
    '.dcal-facts li{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.45;color:#334155}' +
    '.dcal-facts svg{flex-shrink:0;margin-top:1px;color:#0077B6}' +
    '.dcal-facts b{color:#0B1220;font-weight:600}' +
    '.dcal-best{font-size:12px;font-weight:700;color:#0B6E4F;background:#E7F6EF;border-radius:999px;padding:2px 9px}' +
    '.dcal-help{display:grid;gap:6px;margin:16px 0 0;font-size:14px;line-height:1.45;color:#475569}' +
    '.dcal-help p{margin:0}' +
    '.dcal-help a,.dcal-help button,.dcal-proof a{color:#0077B6;font-weight:600;text-decoration:none}' +
    '.dcal-help button{background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left}' +
    '.dcal-help a:hover,.dcal-help button:hover,.dcal-proof a:hover{text-decoration:underline;text-underline-offset:3px}' +
    '.dcal-hook{margin:0 0 4px;font-size:16px;font-weight:600;line-height:1.45;color:#023E8A}' +
    '.dcal-point{display:flex;gap:12px;align-items:flex-start}' +
    '.dcal-point svg{flex-shrink:0;color:#00B4D8;margin-top:2px}' +
    '.dcal-point span{font-size:15px;line-height:1.5;color:#1F2937}' +
    '.dcal-proof{margin:2px 0 0;font-size:14px;line-height:1.45}' +
    // "Share with family" is longer than "Share": on a phone it takes its own
    // row, so the four buttons stay together on the next one
    '@media(max-width:600px){.pp-share>span:first-child{flex-basis:100%}}' +
    /* cart */
    '.dcal-cart-facts{display:grid;gap:4px;margin:4px 0 14px;padding:10px 12px;border-radius:10px;background:#F0F9FF;font-size:13.5px;line-height:1.45;color:#334155}' +
    '.dcal-cart-facts p{margin:0}' +
    '.dcal-cart-facts .is-save{color:#0B6E4F;font-weight:600}' +
    '.dcal-cart-notes{display:grid;gap:3px;margin:12px 0 0;font-size:12.5px;line-height:1.45;color:#64748B;text-align:center}' +
    '.dcal-cart-notes p{margin:0}' +
    '.dcal-xsell{display:flex;gap:12px;align-items:center;margin-top:12px;padding:12px 14px;border:1px dashed #9CD3EE;border-radius:14px;background:#F7FBFE}' +
    '.dcal-xsell img{width:52px;height:52px;flex-shrink:0;object-fit:contain;border-radius:10px;background:#fff}' +
    '.dcal-xsell p{margin:0;flex:1;min-width:0;font-size:14px;line-height:1.4;color:#1F2937}' +
    '.dcal-xsell button{flex-shrink:0;font:inherit;font-size:13.5px;font-weight:600;color:#0077B6;background:#fff;border:1.5px solid #CAF0F8;border-radius:999px;padding:7px 14px;cursor:pointer}' +
    '.dcal-xsell button:hover{border-color:#0077B6}' +
    '.dcal-xsell button:disabled{opacity:.6;cursor:default}';
  function addCSS() {
    if (document.getElementById('dcal-facts-css')) return;
    var st = document.createElement('style'); st.id = 'dcal-facts-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  var SPARKLE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
  var CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  /* Pages built on the shop theme carry the bar in their HTML (and an inline
     script that shows it or honours a dismissal). The plain info pages (FAQ,
     About, Shipping, Wallet...) don't; they ask for one by loading this file
     with data-inject-bar, and get the same bar, same look, same dismissal. */
  function injectBar() {
    try { if (localStorage.getItem(BAR_KEY) === '1') return null; } catch (e) {}
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="pp-promo-bar" data-promo-key="' + BAR_KEY + '" style="background:linear-gradient(90deg,#023E8A 0%,#0077B6 50%,#023E8A 100%);color:#fff;position:relative">' +
        '<div class="pp-promo-inner" style="max-width:1240px;margin:0 auto;padding:0 48px;display:flex;align-items:center;justify-content:center;gap:8px;text-align:center">' +
          '<span style="color:#90E0EF;display:inline-flex;flex-shrink:0">' + SPARKLE + '</span>' +
          '<span class="pp-promo-msg"></span>' +
          '<button type="button" id="pp-promo-close" aria-label="Dismiss announcement">' + CLOSE + '</button>' +
        '</div>' +
      '</div>' +
      '<style>' +
        '#pp-promo-bar .pp-promo-inner{height:44px}' +
        '#pp-promo-bar .pp-promo-msg{font-size:13px;font-weight:500;letter-spacing:.01em;color:#fff}' +
        '#pp-promo-close{position:absolute;right:16px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;padding:10px;color:rgba(255,255,255,.5);transition:color .2s}' +
        '#pp-promo-close:hover{color:#fff}' +
        '@media(max-width:600px){#pp-promo-bar .pp-promo-inner{height:40px;padding:0 40px}#pp-promo-bar .pp-promo-msg{font-size:11px}}' +
      '</style>';
    var bar = wrap.firstChild;
    document.body.insertBefore(wrap.lastChild, document.body.firstChild);
    document.body.insertBefore(bar, document.body.firstChild);
    bar.querySelector('#pp-promo-close').addEventListener('click', function () {
      bar.style.display = 'none';
      try { localStorage.setItem(BAR_KEY, '1'); } catch (e) {}
    });
    return bar;
  }

  function barLines(S, F) {
    var tb = S.topBar || {};
    var voice = !!window.DcalVoice || !!document.querySelector('script[src*="voice-assistant.js"]');
    return (Array.isArray(tb.lines) ? tb.lines : []).filter(function (l) {
      if (!l || l.show === false || !l.text || !inWindow(l, F)) return false;
      if (l.needs === 'cod' && !F.cod) return false;
      if (l.needs === 'no-cod' && F.cod) return false;
      if (l.needs === 'voice' && !voice) return false;
      return true;
    }).map(function (l) {
      var text = fill(l.text, F, l);
      if (text == null) return null;
      var link = l.link ? fill(l.link, F, l) : '';
      return { text: text, link: link || '' };
    }).filter(Boolean);
  }

  function runBar(bar, lines, seconds) {
    var msg = bar.querySelector('.pp-promo-msg');
    if (!msg || !lines.length) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var i = 0, paused = false;
    function html(l) { return l.link ? '<a href="' + esc(l.link) + '">' + esc(l.text) + '</a>' : esc(l.text); }
    function show(l) { msg.innerHTML = html(l); }
    // the bar's HTML already says line one: swap only if this one differs
    if (msg.textContent.trim() !== lines[0].text || lines[0].link) show(lines[0]);
    if (lines.length < 2) return;
    // reading or tapping a line holds it still
    ['mouseenter', 'focusin', 'touchstart'].forEach(function (ev) { bar.addEventListener(ev, function () { paused = true; }, { passive: true }); });
    ['mouseleave', 'focusout'].forEach(function (ev) { bar.addEventListener(ev, function () { paused = false; }); });
    setInterval(function () {
      if (paused || document.hidden || bar.style.display === 'none' || !bar.isConnected) return;
      i = (i + 1) % lines.length;
      if (reduce) { show(lines[i]); return; }
      msg.classList.add('is-out');
      setTimeout(function () { show(lines[i]); msg.classList.remove('is-out'); }, 350);
    }, Math.max(4, Number(seconds) || 6) * 1000);
  }

  /* ========== 2) [data-fact] SPANS IN RUNNING TEXT ========== */
  // "1–2 business days", "1 business day": the unit travels with the number so a one-day range still reads right
  function days(r, unit) { return span(r) + ' ' + unit + (r[1] === 1 ? '' : 's'); }
  function paintFacts(F) {
    var V = {
      'dispatch': days(F.dispatch, 'business day'),
      'delivery': days(F.delivery, 'business day'),
      'delivery-short': days(F.delivery, 'day'),
      'warranty-months': String(F.warranty),
      'report-hours': String(F.reportHours)
    };
    document.querySelectorAll('[data-fact]').forEach(function (el) {
      var v = V[el.getAttribute('data-fact')];
      if (v != null && el.textContent !== v) el.textContent = v;
    });
  }

  /* ========== 3) A PRODUCT PAGE ========== */
  var TRUCK = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';
  var CASH = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>';

  function pageSlug() {
    var m = location.pathname.match(/\/product\/([^\/?#]+)/i);
    if (m && m[1]) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    try { return new URLSearchParams(location.search).get('id') || ''; } catch (e) { return ''; }
  }
  var SHIELD = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>';
  var CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>';

  function stockLine(F) { return 'In stock · Ships in ' + days(F.dispatch, 'business day'); }
  // the price spread over the cartridge's life: "₹330 a month" for a year-long
  // cartridge, "under ₹8 a day" for a shorter one. Only the first cartridge
  // comes in the box, so this is the cost of that one, never a subscription.
  function costPoint(p, months) {
    var price = priceOf(p); months = Number(months);
    if (!(price > 0) || !(months > 0)) return null;
    var life = 'one cartridge lasts ' + months + ' months';
    if (months >= 12) {
      var m = price / months, r = Math.round(m);
      return { lead: (r === m ? '' : 'About ') + rupees(r) + ' a month', text: life };
    }
    // floor + 1, so "under" stays true even when the day works out to a whole rupee
    return { lead: 'Under ' + rupees(Math.floor(price / (months * 365 / 12)) + 1) + ' a day', text: life };
  }

  // [data-pp-benefits] is the softener's list in product.html, so until now the
  // Shower Filter's page promised "zero electricity, fits any tank". Each
  // product gets its own from store.json; the kit's is product.js markPageKit.
  // No gift / occasion lines here (Bhai Dooj, Diwali for parents, wedding,
  // housewarming were tried on 26 Oct 2026 and rejected as not suiting the
  // products): a product page says what the product does, nothing forced.
  function paintPoints(S, slug, p) {
    var box = document.querySelector('[data-pp-benefits]');
    var P = (S.products || {})[slug];
    if (!box || !P || p.free || box.hasAttribute('data-dcal-points')) return;
    var pts = (Array.isArray(P.points) ? P.points : []).filter(function (x) { return x && x.lead; });
    var cost = !p.outOfStock && costPoint(p, P.cartridgeMonths);
    if (cost) pts.unshift(cost);
    if (!pts.length && !P.hook) return;
    box.setAttribute('data-dcal-points', '');
    box.innerHTML = (P.hook ? '<p class="dcal-hook">' + esc(P.hook) + '</p>' : '') +
      pts.map(function (x) {
        return '<div class="dcal-point">' + CHECK + '<span><strong>' + esc(x.lead) + '</strong>' + (x.text ? ' — ' + esc(x.text) : '') + '</span></div>';
      }).join('') +
      '<p class="dcal-proof"><a href="/#video-stories">Watch real customers and distributors talk about D’Cal ›</a></p>';
  }

  // two quiet ways out for someone not ready to buy: test the water free, or ask
  function paintHelp(F, p) {
    var form = document.querySelector('form[data-local-form]');
    if (!form || p.free || p.outOfStock || document.querySelector('.dcal-help')) return;
    var kit = F.catalog['demo-kit'];
    var voice = !!window.DcalVoice || !!document.querySelector('script[src*="voice-assistant.js"]');
    var rows = [];
    if (kit && !kit.outOfStock) rows.push('<p>Not sure your water is hard? <a href="/product/demo-kit">Test it free before you spend a rupee ›</a></p>');
    if (voice) rows.push('<p>Have a question first? <button type="button" data-dcal-ask>Ask Saathi, any time, day or night ›</button></p>');
    if (!rows.length) return;
    form.insertAdjacentHTML('afterend', '<div class="dcal-help">' + rows.join('') + '</div>');
    var ask = document.querySelector('[data-dcal-ask]');
    if (ask) ask.addEventListener('click', function () { if (window.DcalVoice && DcalVoice.open) DcalVoice.open(); });
  }

  function paintProduct(F, S) {
    if (!document.querySelector('[data-pp-main]')) return;
    var C = F.catalog, slug = pageSlug();
    if (!C[slug]) slug = 'water-softener';               // product.js leaves an unknown slug on the default (softener) page
    var p = C[slug];
    if (!p) return;

    // by the price: the saving in rupees, which the struck MRP only implies,
    // and on the one product with the biggest discount, that it is
    var cmp = document.querySelector('[data-pp-compare]');
    if (cmp && !p.free && savePct(p) > 0 && !document.querySelector('.dcal-you-save')) {
      var best = !p.outOfStock && bestDeal(C);
      cmp.insertAdjacentHTML('afterend', '<span class="dcal-you-save">You save ' + rupees(mrpOf(p) - priceOf(p)) + ' (' + savePct(p) + '%)</span>' +
        (best && best.slug === slug ? '<span class="dcal-best">Our biggest discount right now</span>' : ''));
    }
    paintPoints(S, slug, p);
    var share = document.querySelector('.pp-share > span');
    if (share && share.textContent.trim() === 'Share') share.textContent = 'Share with family';
    if (p.outOfStock) return;                            // nothing to deliver: product.js already says so

    var stock = document.querySelector('[data-pp-stock-text]');
    if (stock) stock.textContent = stockLine(F);
    paintHelp(F, p);

    var pill = document.querySelector('[data-pp-stock]');
    if (!pill || document.querySelector('.dcal-facts')) return;
    // the kit alone ships for a fee that is said only once the address is
    // chosen (auth.js shippingShown), and it is prepaid: so no "Free delivery",
    // no COD and no damage line (it is free) on its page, only the date
    var items = [
      '<li>' + TRUCK + '<span>' + (p.free ? '' : '<b>Free delivery</b> · ') + 'Order today, get it by <b>' + dayLabel(F.deliverBy) + '</b></span></li>'
    ];
    if (F.cod && !p.free) items.push('<li>' + CASH + '<span>Pay when it arrives: <b>Cash on Delivery</b></span></li>');
    if (!p.free) items.push('<li>' + SHIELD + '<span>Damaged on arrival? We replace it free. Tell us within <b>' + F.reportHours + ' hours</b>.</span></li>');
    pill.insertAdjacentHTML('afterend', '<ul class="dcal-facts" aria-label="Delivery">' + items.join('') + '</ul>');
  }

  /* ========== 4) THE CART ========== */
  // auth.js redraws the whole cart on every change; the lines are added back each time
  function lineProduct(C, it) {
    if (C[it.slug]) return C[it.slug];
    if (C[it.id]) return C[it.id];
    var t = String(it.title || '').replace(/[’‘']/g, "'").replace(/\s+/g, ' ').trim().toLowerCase(), hit = null;
    Object.keys(C).forEach(function (s) { if (String(C[s].title || '').toLowerCase() === t) hit = C[s]; });
    return hit;
  }
  // One add-on, the one that fits what is already in the cart: a basin Tap
  // Filter beside a Shower Filter, else the Washing Ball beside any filter.
  // Never something out of stock, never something already there.
  var ADD_ONS = [
    { slug: 'tap-filter', when: ['shower-filter'], say: function (p) { return 'Complete the bathroom: add a Tap Filter for the wash basin, ' + rupees(priceOf(p)) + '.'; } },
    // its own catalog claims (less detergent, clothes that keep looking new),
    // not "soft water": the ball does not soften anything
    { slug: 'washing-ball', when: ['water-softener', 'shower-filter', 'tap-filter'], say: function (p) { return 'Add a Washing Ball for ' + rupees(priceOf(p)) + ': less detergent, and clothes that keep looking new.'; } }
  ];
  function addOnFor(F, slugs) {
    var hit = null;
    ADD_ONS.some(function (a) {
      var p = F.catalog[a.slug];
      if (!p || p.outOfStock || p.free || slugs.indexOf(a.slug) > -1) return false;
      if (!a.when.some(function (s) { return slugs.indexOf(s) > -1; })) return false;
      hit = { slug: a.slug, p: p, text: a.say(p) };
      return true;
    });
    return hit;
  }
  function paintCart(F, root) {
    var btn = root.querySelector('.dcal-cart-summary .dcal-cart-checkout');
    if (!btn || root.querySelector('.dcal-cart-facts') || !window.DcalStore || !DcalStore.cart) return;
    var cart = DcalStore.cart();
    if (!cart.length) return;
    var saved = 0, slugs = [], kitOnly = true;
    cart.forEach(function (it) {
      var p = lineProduct(F.catalog, it);
      if (p && !p.free) saved += (mrpOf(p) - priceOf(p)) * (Number(it.qty) || 1);
      if (!p || !p.free) kitOnly = false;
      var s = Object.keys(F.catalog).filter(function (k) { return F.catalog[k] === p; })[0];
      if (s) slugs.push(s);
    });
    // the kit alone: its delivery fee is said after the address and it is
    // prepaid (auth.js shippingShown, server KIT_PREPAID), so only the date
    var lines = [];
    if (saved > 0) lines.push('<p class="is-save">You save ' + rupees(saved) + ' on MRP</p>');
    lines.push(kitOnly ? '<p>Order today, get it by <b>' + dayLabel(F.deliverBy) + '</b></p>'
      : '<p>Free delivery on this order. Ships within ' + days(F.dispatch, 'business day') + ', arrives by <b>' + dayLabel(F.deliverBy) + '</b>.</p>');
    if (F.cod && !kitOnly) lines.push('<p>Prefer to pay later? Cash on Delivery works for this order.</p>');
    btn.insertAdjacentHTML('beforebegin', '<div class="dcal-cart-facts">' + lines.join('') + '</div>');

    var after = root.querySelector('.dcal-cart-summary .dcal-cart-continue') || btn;
    after.insertAdjacentHTML('afterend', '<div class="dcal-cart-notes"><p>Sending it as a gift? Add their address at checkout.</p>' +
      '<p>Your cart is saved on this device.</p></div>');

    var list = root.querySelector('.dcal-cart-items'), add = addOnFor(F, slugs);
    if (!list || !add || !DcalStore.add) return;
    list.insertAdjacentHTML('beforeend', '<div class="dcal-xsell">' +
      (add.p.img ? '<img src="/images/' + esc(add.p.img) + '" alt="" loading="lazy">' : '') +
      '<p>' + esc(add.text) + '</p><button type="button" data-dcal-addon="' + esc(add.slug) + '">Add</button></div>');
    var b = list.querySelector('[data-dcal-addon]');
    // signed out, add() opens the sign-in box and finishes after it; if they
    // close the box instead, the button must still work
    b.addEventListener('click', function () { b.disabled = true; if (!DcalStore.add(add.slug, 1)) b.disabled = false; });
  }
  function watchCart(F) {
    var root = document.getElementById('dcal-cart-root');
    if (!root) return;
    paintCart(F, root);
    if (window.MutationObserver) new MutationObserver(function () { paintCart(F, root); }).observe(root, { childList: true });
  }

  /* ========== start ========== */
  function start() {
    addCSS();
    Promise.all([getJSON('/data/store.json'), getJSON('/data/catalog.json')]).then(function (r) {
      var S = r[0] || {}, F = factsFrom(S, r[1]);
      // premium-custom.js reads stockLine when a variant comes back in stock; the rest is for the console and tests
      window.DcalFacts = { facts: F, deliverByLabel: dayLabel(F.deliverBy), stockLine: stockLine(F) };
      paintFacts(F);
      paintProduct(F, S);
      watchCart(F);
      var bar = document.getElementById('pp-promo-bar');
      if (!bar && me && me.hasAttribute('data-inject-bar')) bar = injectBar();
      window.DcalFacts.barLines = barLines(S, F);
      if (bar) runBar(bar, window.DcalFacts.barLines, (S.topBar || {}).secondsPerLine);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
