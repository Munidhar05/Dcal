/* =========================================================
   D'Cal Admin Dashboard  (client-side, localStorage)
   Reads the same data the storefront writes:
     dcal_users           -> { mobile: {name,email,...,logins,lastLogin,addresses} }
     dcal_orders:<mobile> -> [ {id,title,total,items,address,payment,date,status} ]
     dcal_cart:<mobile>   -> [ items ]
   Gated by a passcode (see ADMIN_PASSCODE). NOTE: because this is
   client-side only, it can only see data stored in THIS browser.
   ========================================================= */
(function () {
  'use strict';

  /* ---- Local-demo passcode (used only when there is NO backend).
         Once deployed with the server, the real password is the
         ADMIN_PASSWORD you set in Render's environment. ---- */
  var ADMIN_PASSCODE = 'dcal-admin-2026';

  var LS = window.localStorage;
  var K_USERS = 'dcal_users';
  var K_ADMIN = 'dcal_admin_session';
  var K_ADMIN_PW = 'dcal_admin_pw';
  var STATUSES = ['Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
  // status -> css-class-safe slug, e.g. "Out for Delivery" -> "out-for-delivery"
  function statusSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

  var API_BASE = (typeof window !== 'undefined' && window.DCAL_API_BASE) || '';
  var SERVER = false;          // true once we confirm a live backend with a database
  var serverOrders = [];        // cache of orders fetched from the server
  var serverCustomers = [];     // cache of customers fetched from the server
  var serverDealers = [];       // cache of dealership applications fetched from the server

  function api(method, p, body) {
    var headers = { 'Content-Type': 'application/json' };
    var pw = LS.getItem(K_ADMIN_PW);
    if (pw) headers['x-admin-password'] = pw;
    return fetch(API_BASE + p, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status)); return d; }); });
  }
  // is a real backend (with DB) available?
  function checkServer() {
    return api('GET', '/api/health').then(function (h) { return !!(h && h.db); }).catch(function () { return false; });
  }
  // load all data from the server into the caches
  function loadServerData() {
    return Promise.all([api('GET', '/api/admin/orders'), api('GET', '/api/admin/customers'), api('GET', '/api/admin/dealers')])
      .then(function (res) {
        serverOrders = (res[0] && res[0].orders) || [];
        serverCustomers = (res[1] && res[1].customers) || [];
        serverDealers = (res[2] && res[2].dealers) || [];
      });
  }

  function read(key, fb) { try { var v = LS.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function write(key, val) { try { LS.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function priceNum(s) { var n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; }
  // full date + exact time (to the second) — admins need the precise moment an order/login landed
  function fmtDate(t) { return t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' }) : '—'; }

  /* ---------- data access ---------- */
  function getUsers() { return read(K_USERS, {}); }
  function ordersOf(mobile) { return read('dcal_orders:' + mobile, []); }
  function saveOrdersOf(mobile, list) { write('dcal_orders:' + mobile, list); }
  function cartOf(mobile) { return read('dcal_cart:' + mobile, []); }

  // flat list of every order across all users, each tagged with its owner
  function allOrders() {
    if (SERVER) {
      return serverOrders.map(function (o) {
        return {
          o: { id: o.orderId, title: o.title, total: o.total, image: o.image, items: o.items || [],
               address: o.address || {}, payment: o.payment, paid: o.paid, paymentId: o.paymentId,
               coupon: o.coupon, discount: o.discount,
               status: o.status, date: o.date, cancelReason: o.cancelReason, refundStatus: o.refundStatus },
          mobile: o.mobile, idx: -1,
          user: { name: o.customerName || '—' }
        };
      });
    }
    var users = getUsers(), out = [];
    Object.keys(users).forEach(function (m) {
      ordersOf(m).forEach(function (o, idx) {
        out.push({ o: o, mobile: m, idx: idx, user: users[m] });
      });
    });
    out.sort(function (a, b) { return (b.o.date || 0) - (a.o.date || 0); });
    return out;
  }

  function customerRows() {
    if (SERVER) {
      return serverCustomers.map(function (u) {
        var ords = serverOrders.filter(function (o) { return o.mobile === u.mobile; });
        var spent = ords.reduce(function (s, o) { return s + (o.totalNum || priceNum(o.total)); }, 0);
        return {
          mobile: u.mobile, name: u.name || '—', email: u.email || '—',
          createdAt: u.createdAt, logins: u.logins || 0, lastLogin: u.lastLogin,
          orders: ords.length, spent: spent,
          addresses: (u.addresses || []).length, cart: 0, provider: u.provider || 'phone'
        };
      }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    }
    var users = getUsers();
    return Object.keys(users).map(function (m) {
      var u = users[m];
      var ords = ordersOf(m);
      var spent = ords.reduce(function (s, o) { return s + priceNum(o.total); }, 0);
      return {
        mobile: m, name: u.name || '—', email: u.email || '—',
        createdAt: u.createdAt, logins: u.logins || 0, lastLogin: u.lastLogin,
        orders: ords.length, spent: spent,
        addresses: (u.addresses || []).length, cart: cartOf(m).length,
        provider: u.provider || 'phone'
      };
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  // every dealership application (public form -> Dealer collection)
  function dealerRows() {
    if (SERVER) {
      return serverDealers.map(function (i) {
        return {
          id: i._id, fullName: i.fullName || '—', businessName: i.businessName || '',
          mobile: i.mobile || '—', email: i.email || '', pincode: i.pincode || '',
          city: i.city || '', state: i.state || '', businessType: i.businessType || '',
          currentProducts: i.currentProducts || '', experience: i.experience || '',
          message: i.message || '', appliedAt: i.createdAt
        };
      }).sort(function (a, b) { return (b.appliedAt || 0) - (a.appliedAt || 0); });
    }
    return [];   // dealership applications are a server feature; no localStorage fallback
  }

  /* The three B2B websites (campus / hotel / hospital) submit through the same
     /api/dealership endpoint as the Become-a-Partner page, so they all land in
     the Dealer collection. They are told apart by businessType, which the B2B
     pages tag as "Campus – …", "Hotel – …" or "Hospital – …". */
  function b2bVertical(businessType) {
    var m = String(businessType || '').match(/^(Campus|Hotel|Hospital)\b/i);
    return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : '';
  }
  // the type after the vertical prefix, e.g. "Campus – School" -> "School"
  function b2bSubType(businessType) {
    return String(businessType || '').replace(/^(Campus|Hotel|Hospital)\s*[–-]\s*/i, '').trim();
  }
  // dealership applications from the Become-a-Partner page only (excludes B2B sites)
  function partnerRows() { return dealerRows().filter(function (r) { return !b2bVertical(r.businessType); }); }
  // enquiries from the three B2B websites, tagged with vertical + sub-type
  function b2bRows() {
    return dealerRows().filter(function (r) { return b2bVertical(r.businessType); })
      .map(function (r) { r.vertical = b2bVertical(r.businessType); r.subType = b2bSubType(r.businessType); return r; });
  }

  function stats() {
    var custs = customerRows();
    var ords = allOrders();
    var revenue = 0, items = 0, logins = 0, activeCarts = 0;
    var byStatus = {};
    ords.forEach(function (r) {
      var st = r.o.status || 'Confirmed';
      if ((st !== 'Cancelled')) revenue += priceNum(r.o.total);
      (r.o.items || []).forEach(function (it) { items += (it.qty || 1); });
      byStatus[st] = (byStatus[st] || 0) + 1;
    });
    custs.forEach(function (c) { logins += c.logins; if (c.cart > 0) activeCarts++; });
    var paidCount = ords.filter(function (r) { return (r.o.status || '') !== 'Cancelled'; }).length;
    return {
      customers: custs.length, orders: ords.length, revenue: revenue,
      items: items, logins: logins, activeCarts: activeCarts, byStatus: byStatus,
      aov: paidCount ? revenue / paidCount : 0,
      dealers: partnerRows().length, b2b: b2bRows().length
    };
  }

  /* ---------- gate ---------- */
  var root;
  function isAdmin() { return LS.getItem(K_ADMIN) === '1'; }

  function renderGate(msg) {
    root.innerHTML =
      '<div class="adm-gate">' +
        '<div class="adm-gate-card">' +
          '<div class="adm-gate-logo">D’Cal <span>Admin</span></div>' +
          '<p class="adm-gate-sub">Enter the admin passcode to continue.</p>' +
          '<div class="adm-pass-wrap">' +
            '<input type="password" id="adm-pass" class="adm-input" placeholder="Passcode" autocomplete="off">' +
            '<button type="button" class="adm-eye" id="adm-eye" aria-label="Show password">' + EYE + '</button>' +
          '</div>' +
          (msg ? '<p class="adm-gate-err">' + esc(msg) + '</p>' : '') +
          '<button class="adm-btn adm-btn--full" id="adm-enter">Enter dashboard</button>' +
          '<p class="adm-gate-modeline">' + (SERVER
            ? '🟢 Connected to live database — shows all orders from every device.'
            : '🟡 Local demo mode (no server) — shows orders from this browser only.') + '</p>' +
          '<a class="adm-gate-back" href="../index.html">← Back to store</a>' +
        '</div>' +
      '</div>';
    var input = document.getElementById('adm-pass');
    function attempt() {
      var val = input.value;
      if (SERVER) {
        LS.setItem(K_ADMIN_PW, val);
        api('POST', '/api/admin/login', { password: val }).then(function () {
          LS.setItem(K_ADMIN, '1'); bootDash();
        }).catch(function () { LS.removeItem(K_ADMIN_PW); renderGate('Incorrect passcode. Try again.'); });
      } else {
        // kept for the server's own admin endpoints even without a database —
        // the voice-assistant transcripts are read from the server either way
        if (val === ADMIN_PASSCODE) { LS.setItem(K_ADMIN, '1'); LS.setItem(K_ADMIN_PW, val); renderDash('orders'); }
        else renderGate('Incorrect passcode. Try again.');
      }
    }
    document.getElementById('adm-enter').addEventListener('click', attempt);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
    var eye = document.getElementById('adm-eye');
    eye.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.innerHTML = show ? EYE_OFF : EYE;
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    });
    input.focus();
  }

  // load data (server mode) then show the dashboard
  function bootDash() {
    if (!SERVER) { renderDash('orders'); return; }
    loadServerData().then(function () { renderDash('orders'); })
      .catch(function () { LS.removeItem(K_ADMIN); LS.removeItem(K_ADMIN_PW); renderGate('Session expired — please sign in again.'); });
  }

  function logout() { LS.removeItem(K_ADMIN); LS.removeItem(K_ADMIN_PW); renderGate(); }

  /* ---------- dashboard ---------- */
  function kpiCard(label, value, sub, accent) {
    return '<div class="adm-kpi"' + (accent ? ' style="--accent:' + accent + '"' : '') + '>' +
      '<div class="adm-kpi-val">' + value + '</div>' +
      '<div class="adm-kpi-lbl">' + esc(label) + '</div>' +
      (sub ? '<div class="adm-kpi-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  function renderDash(tab) {
    var s = stats();
    root.innerHTML =
      '<header class="adm-top">' +
        '<div class="adm-brand">D’Cal <span>Admin</span></div>' +
        '<div class="adm-top-actions">' +
          '<button class="adm-btn adm-btn--ghost" id="adm-refresh">↻ Refresh</button>' +
          '<button class="adm-btn adm-btn--ghost" id="adm-export">↓ Export CSV</button>' +
          '<a class="adm-btn adm-btn--ghost" href="../index.html">View store</a>' +
          '<button class="adm-btn adm-btn--danger" id="adm-logout">Logout</button>' +
        '</div>' +
      '</header>' +
      '<div class="adm-wrap">' +
        '<div class="adm-kpis">' +
          kpiCard('Revenue', money(s.revenue), 'excl. cancelled', '#0B6E4F') +
          kpiCard('Orders', s.orders, (s.byStatus['Delivered'] || 0) + ' delivered', '#0077B6') +
          kpiCard('Customers', s.customers, s.activeCarts + ' with active cart', '#7C3AED') +
          kpiCard('Items sold', s.items, '', '#D97706') +
          kpiCard('Total logins', s.logins, '', '#0EA5E9') +
          kpiCard('Avg. order value', money(s.aov || 0), '', '#DB2777') +
        '</div>' +
        '<div class="adm-statusbar">' + STATUSES.map(function (st) {
          return '<span class="adm-chip adm-chip--' + statusSlug(st) + '">' + st + ': <b>' + (s.byStatus[st] || 0) + '</b></span>';
        }).join('') + '</div>' +
        '<div class="adm-tabs">' +
          '<button class="adm-tab' + (tab === 'orders' ? ' active' : '') + '" data-tab="orders">Orders (' + s.orders + ')</button>' +
          '<button class="adm-tab' + (tab === 'customers' ? ' active' : '') + '" data-tab="customers">Customers (' + s.customers + ')</button>' +
          '<button class="adm-tab' + (tab === 'dealers' ? ' active' : '') + '" data-tab="dealers">Dealers (' + s.dealers + ')</button>' +
          '<button class="adm-tab' + (tab === 'b2b' ? ' active' : '') + '" data-tab="b2b">B2B Sites (' + s.b2b + ')</button>' +
          '<button class="adm-tab' + (tab === 'voice' ? ' active' : '') + '" data-tab="voice">Voice assistant</button>' +
        '</div>' +
        '<div class="adm-panel" id="adm-panel"></div>' +
      '</div>';

    document.getElementById('adm-refresh').addEventListener('click', function () {
      if (SERVER) { loadServerData().then(function () { renderDash(tab); }).catch(function () { renderDash(tab); }); }
      else renderDash(tab);
    });
    document.getElementById('adm-logout').addEventListener('click', logout);
    document.getElementById('adm-export').addEventListener('click', function () { exportCSV(tab); });
    root.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { renderDash(b.getAttribute('data-tab')); });
    });
    if (tab === 'customers') renderCustomers();
    else if (tab === 'dealers') renderDealers();
    else if (tab === 'b2b') renderB2B();
    else if (tab === 'voice') renderVoice();
    else renderOrders();
  }

  /* ---------- voice assistant: every conversation, and what went wrong ----------
     Recorded by the voice assistant on the store (js/voice-assistant.js), kept
     on the server (server/voicelog.js) and readable only here. Problems are
     found by rules on every turn — slow, wrong language, not understood, a
     task that failed, a customer who had to repeat themselves — and, on
     request, by an AI review that reads the whole conversation. */
  var voiceData = null, voiceOpen = {}, voiceFilter = { problem: null, bad: false, q: '' };
  var LANG_NAME = { te: 'Telugu', hi: 'Hindi', en: 'English', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', or: 'Odia', as: 'Assamese', ur: 'Urdu' };
  var EV_TEXT = {
    fallback: 'Said she did not understand', heard_nothing: 'Heard nothing (silence or noise)',
    ai_unreachable: 'AI unreachable', ask_failed: 'Speech + AI request failed, retried in two steps',
    stt_failed: 'Speech-to-text failed', tts_failed: 'Natural voice failed, robotic voice used',
    barge: 'Customer talked over her', lang: 'Language', nav: 'Opened', act: 'Did',
    coupon_asked: 'Asked "did you mean"', coupon_applied: 'Coupon applied', coupon_invalid: 'Coupon invalid',
    coupon_rejected: 'Coupon not valid on this order', login_needed: 'Asked them to sign in', signin_ok: 'Signed in',
    otp_wrong: 'Wrong OTP', signin_failed: 'Sign-in failed', form_filled: 'Address form filled', form_error: 'Address form refused',
    checkout: 'Checkout step', order_place: 'Placed a cash-on-delivery order', payment_handoff: 'Handed over to Razorpay and switched off'
  };
  function secs(ms) { return ms == null ? '' : (ms / 1000).toFixed(1) + 's'; }
  function langs(list) { return (list || []).map(function (l) { return LANG_NAME[l] || l; }).join(', '); }
  function vChip(code, n) {
    var p = (voiceData && voiceData.problems[code]) || { label: code, sev: 'amber' };
    return '<span class="adm-vchip adm-vchip--' + p.sev + '">' + esc(p.label) + (n > 1 ? ' ×' + n : '') + '</span>';
  }
  function verdict(r) {
    if (!r) return '';
    var t = { yes: '✓ Got what they wanted', partly: '◐ Partly', no: '✗ Did not get it' }[r.achieved] || r.achieved;
    return '<span class="adm-vverdict adm-vverdict--' + esc(r.achieved) + '">' + t + (r.stale ? ' · new lines since' : '') + '</span>';
  }

  function renderVoice() {
    var panel = document.getElementById('adm-panel');
    panel.innerHTML = '<div class="adm-empty">Loading conversations…</div>';
    api('GET', '/api/admin/voice').then(function (d) { voiceData = d; drawVoice(); })
      .catch(function (e) { panel.innerHTML = '<div class="adm-empty">Could not load the transcripts: ' + esc(e.message) + '</div>'; });
  }

  function voiceRows() {
    var f = voiceFilter, q = f.q.toLowerCase();
    return voiceData.sessions.filter(function (s) {
      if (f.bad && !Object.keys(s.problems).length) return false;
      if (f.problem && !s.problems[f.problem]) return false;
      if (q && (s.firstSaid + ' ' + s.sid + ' ' + langs(s.langs) + ' ' + s.pages.join(' ')).toLowerCase().indexOf(q) === -1 &&
          !(voiceOpen[s.sid] && JSON.stringify(voiceOpen[s.sid].items).toLowerCase().indexOf(q) !== -1)) return false;
      return true;
    });
  }

  function drawVoice() {
    var panel = document.getElementById('adm-panel'), d = voiceData, st = d.stats;
    var bad = d.sessions.filter(function (s) { return Object.keys(s.problems).length; }).length;
    var toReview = d.sessions.filter(function (s) { return Object.keys(s.problems).length && (!s.review || s.review.stale); }).length;
    var tiles = Object.keys(d.counts).sort(function (a, b) {
      var A = d.problems[a] || {}, B = d.problems[b] || {};
      if (A.sev !== B.sev) return A.sev === 'red' ? -1 : 1;
      return d.counts[b].sessions - d.counts[a].sessions;
    });
    var rows = voiceRows();
    panel.innerHTML =
      '<div class="adm-vhead">' +
        '<div><h3 class="adm-vtitle">Voice assistant conversations</h3>' +
        '<p class="adm-muted">What customers said, what Saathi said back, how long they waited for her voice — and every turn that failed them. ' +
        'Phone numbers and emails are masked, one-time codes never recorded, kept 30 days.' + (d.db ? '' : ' <b>Stored locally on this server (no database connected).</b>') + '</p></div>' +
      '</div>' +
      '<div class="adm-vstats">' +
        kpiCard('Conversations', st.sessions, st.turns + ' customer turns', '#0077B6') +
        kpiCard('Typical wait', st.medianMs == null ? '—' : secs(st.medianMs), 'customer stops → her voice', '#0B6E4F') +
        kpiCard('9 in 10 under', st.p90Ms == null ? '—' : secs(st.p90Ms), Math.round(st.slowShare * 100) + '% over ' + secs(d.slowMs), '#D97706') +
        kpiCard('With problems', bad, st.withRed + ' with a red one', '#DC2626') +
        kpiCard('AI-reviewed', st.reviewed, st.achievedNo + ' did not get what they wanted', '#7C3AED') +
      '</div>' +
      (tiles.length ? '<div class="adm-vstuck"><div class="adm-vstuck-h">Where customers are getting stuck</div><div class="adm-vtiles">' +
        tiles.map(function (code) {
          var p = d.problems[code] || { label: code, sev: 'amber' }, c = d.counts[code];
          return '<button class="adm-vtile adm-vtile--' + p.sev + (voiceFilter.problem === code ? ' active' : '') + '" data-vproblem="' + esc(code) + '">' +
            '<b>' + esc(p.label) + '</b><span>' + c.turns + ' turn' + (c.turns === 1 ? '' : 's') + ' · ' + c.sessions + ' conversation' + (c.sessions === 1 ? '' : 's') + '</span></button>';
        }).join('') + '</div></div>' : '') +
      '<div class="adm-toolbar adm-vtools">' +
        '<button class="adm-vpill' + (!voiceFilter.bad && !voiceFilter.problem ? ' active' : '') + '" data-vall>All (' + d.sessions.length + ')</button>' +
        '<button class="adm-vpill' + (voiceFilter.bad ? ' active' : '') + '" data-vbad>Only the ones that went wrong (' + bad + ')</button>' +
        (voiceFilter.problem ? '<button class="adm-vpill active" data-vclear>' + esc((d.problems[voiceFilter.problem] || {}).label || voiceFilter.problem) + ' ✕</button>' : '') +
        '<input class="adm-input adm-search" id="adm-vsearch" placeholder="Search what was said, a page, a language…" value="' + esc(voiceFilter.q) + '">' +
        '<button class="adm-btn" id="adm-vreviewall"' + (toReview ? '' : ' disabled') + '>✨ Review ' + (toReview ? toReview + ' with problems' : 'all') + ' with AI</button>' +
      '</div>' +
      '<div class="adm-vlist">' + (rows.length ? rows.slice(0, 150).map(voiceCard).join('') :
        '<div class="adm-empty">' + (d.sessions.length ? 'Nothing matches that filter.' : 'No conversations recorded yet — talk to the voice assistant on the store and they appear here.') + '</div>') + '</div>';

    panel.querySelectorAll('[data-vproblem]').forEach(function (b) {
      b.addEventListener('click', function () { var c = b.getAttribute('data-vproblem'); voiceFilter.problem = voiceFilter.problem === c ? null : c; voiceFilter.bad = false; drawVoice(); });
    });
    var all = panel.querySelector('[data-vall]'); if (all) all.addEventListener('click', function () { voiceFilter = { problem: null, bad: false, q: voiceFilter.q }; drawVoice(); });
    var badb = panel.querySelector('[data-vbad]'); if (badb) badb.addEventListener('click', function () { voiceFilter.bad = !voiceFilter.bad; voiceFilter.problem = null; drawVoice(); });
    var clr = panel.querySelector('[data-vclear]'); if (clr) clr.addEventListener('click', function () { voiceFilter.problem = null; drawVoice(); });
    var search = document.getElementById('adm-vsearch');
    search.addEventListener('input', function () {
      voiceFilter.q = search.value;
      var list = panel.querySelector('.adm-vlist'), r = voiceRows();
      list.innerHTML = r.length ? r.slice(0, 150).map(voiceCard).join('') : '<div class="adm-empty">Nothing matches that filter.</div>';
      wireVoiceCards();
    });
    document.getElementById('adm-vreviewall').addEventListener('click', reviewAll);
    wireVoiceCards();
  }

  function voiceCard(s) {
    var dur = Math.max(0, Math.round((s.lastAt - s.startedAt) / 1000));
    var open = voiceOpen[s.sid];
    return '<div class="adm-vcard' + (s.red ? ' adm-vcard--red' : Object.keys(s.problems).length ? ' adm-vcard--amber' : '') + '" data-vsid="' + esc(s.sid) + '">' +
      '<button class="adm-vcard-h" data-vtoggle="' + esc(s.sid) + '">' +
        '<div class="adm-vcard-meta"><b>' + esc(fmtDate(s.startedAt)) + '</b>' +
          '<span>' + s.turns + ' turn' + (s.turns === 1 ? '' : 's') + ' · ' + (dur >= 60 ? Math.round(dur / 60) + ' min' : dur + 's') + ' · ' + esc(langs(s.langs) || '—') + ' · ' + esc(s.device || '') + (s.signedIn ? ' · signed in' : '') + '</span>' +
          '<i>“' + esc(s.firstSaid || '…') + '”</i></div>' +
        '<div class="adm-vcard-chips">' + verdict(s.review) + Object.keys(s.problems).map(function (p) { return vChip(p, s.problems[p]); }).join('') +
          (Object.keys(s.problems).length ? '' : '<span class="adm-vchip adm-vchip--ok">No problems found</span>') + '</div>' +
      '</button>' +
      (open ? '<div class="adm-vbody">' + voiceBody(s, open) + '</div>' : '') +
    '</div>';
  }

  function voiceBody(s, o) {
    var r = o.review, n = 0;
    var lines = o.items.map(function (it) {
      var chips = (it.problems || []).map(function (p) { return vChip(p, 1); }).join('');
      var bad = (it.problems || []).length ? ' adm-vline--bad' : '';
      var time = '<span class="adm-vtime">' + esc(new Date(it.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })) + '</span>';
      n++;
      if (it.t === 'ev') {
        var label = EV_TEXT[it.kind] || it.kind, det = it.detail || '';
        if (it.kind === 'barge') det = 'heard ' + Math.round(parseFloat(det) * 100) + '% of her line';
        return '<div class="adm-vline adm-vline--ev' + bad + '" data-vline="' + n + '"><span class="adm-vno">' + n + '</span>' + time + '<span>· ' + esc(label) + (det ? ': ' + esc(det) : '') + '</span>' + chips + '</div>';
      }
      var who = it.t === 'you' ? 'Customer' : 'Saathi';
      var meta = it.t === 'you'
        ? esc((LANG_NAME[it.lang] || it.lang || '') + (it.via && it.via !== 'voice' ? ' · ' + it.via : ''))
        : (it.voiceMs != null ? '<span class="adm-vwait adm-vwait--' + (it.voiceMs > voiceData.slowMs ? 'slow' : it.voiceMs > 2000 ? 'mid' : 'fast') + '">waited ' + secs(it.voiceMs) + '</span>'
           : it.ms != null ? '<span class="adm-vwait">reply ' + secs(it.ms) + ' · no voice</span>' : '');
      return '<div class="adm-vline adm-vline--' + it.t + bad + '" data-vline="' + n + '"><span class="adm-vno">' + n + '</span>' + time +
        '<div class="adm-vsay"><div class="adm-vwho">' + who + ' <small>' + meta + '</small>' + chips + '</div><div>' + esc(it.text) + '</div></div></div>';
    }).join('');
    var rev = r ? '<div class="adm-vreview">' +
        '<div class="adm-vreview-h">AI review ' + verdict(r) + '<span class="adm-muted"> · ' + esc(fmtDate(r.at)) + '</span></div>' +
        (r.wanted ? '<p><b>They wanted:</b> ' + esc(r.wanted) + '</p>' : '') +
        (r.summary ? '<p>' + esc(r.summary) + '</p>' : '') +
        (r.issues && r.issues.length ? '<ol class="adm-vissues">' + r.issues.map(function (x) {
          return '<li><b>' + esc(x.type.replace(/_/g, ' ')) + (x.line ? ' · line ' + x.line : '') + ':</b> ' + esc(x.what) +
            (x.fix ? '<br><span class="adm-vfix">Fix: ' + esc(x.fix) + '</span>' : '') + '</li>';
        }).join('') + '</ol>' : '<p class="adm-muted">No problems found by the review.</p>') +
      '</div>' : '';
    return rev + '<div class="adm-vlines">' + lines + '</div>' +
      '<div class="adm-vactions"><button class="adm-btn" data-vreview="' + esc(s.sid) + '">✨ ' + (r ? 'Review again' : 'Analyze with AI') + '</button>' +
      '<button class="adm-btn adm-btn--danger" data-vdelete="' + esc(s.sid) + '">Delete transcript</button>' +
      '<span class="adm-muted">Conversation ' + esc(s.sid) + '</span></div>';
  }

  function wireVoiceCards() {
    var panel = document.getElementById('adm-panel');
    panel.querySelectorAll('[data-vtoggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-vtoggle');
        if (voiceOpen[sid]) { delete voiceOpen[sid]; redrawCard(sid); return; }
        api('GET', '/api/admin/voice/' + encodeURIComponent(sid)).then(function (o) { voiceOpen[sid] = o; redrawCard(sid); })
          .catch(function (e) { toast('Could not open: ' + e.message); });
      });
    });
    panel.querySelectorAll('[data-vreview]').forEach(function (b) {
      b.addEventListener('click', function () { reviewOne(b.getAttribute('data-vreview'), b); });
    });
    panel.querySelectorAll('[data-vdelete]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-vdelete');
        if (!window.confirm('Delete this conversation for good?')) return;
        api('DELETE', '/api/admin/voice/' + encodeURIComponent(sid)).then(function () {
          voiceData.sessions = voiceData.sessions.filter(function (s) { return s.sid !== sid; });
          delete voiceOpen[sid]; drawVoice(); toast('Transcript deleted');
        }).catch(function (e) { toast('Could not delete: ' + e.message); });
      });
    });
  }
  function redrawCard(sid) {
    var el = document.querySelector('[data-vsid="' + sid + '"]'), s = voiceData.sessions.filter(function (x) { return x.sid === sid; })[0];
    if (!el || !s) return;
    var tmp = document.createElement('div'); tmp.innerHTML = voiceCard(s);
    el.parentNode.replaceChild(tmp.firstChild, el);
    wireVoiceCards();
  }
  function reviewOne(sid, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Reading the conversation…'; }
    return api('POST', '/api/admin/voice/' + encodeURIComponent(sid) + '/review').then(function (d) {
      var s = voiceData.sessions.filter(function (x) { return x.sid === sid; })[0];
      if (s) s.review = { achieved: d.review.achieved, summary: d.review.summary, stale: false };
      return api('GET', '/api/admin/voice/' + encodeURIComponent(sid)).then(function (o) { voiceOpen[sid] = o; redrawCard(sid); });
    }).catch(function (e) { toast('Review failed: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = '✨ Analyze with AI'; } });
  }
  // every conversation with problems that has no (fresh) review yet, one by one
  function reviewAll() {
    var btn = document.getElementById('adm-vreviewall');
    var todo = voiceData.sessions.filter(function (s) { return Object.keys(s.problems).length && (!s.review || s.review.stale); }).slice(0, 25);
    var done = 0;
    btn.disabled = true;
    (function next() {
      if (!todo.length) { toast('Reviewed ' + done + ' conversation' + (done === 1 ? '' : 's')); renderVoice(); return; }
      btn.textContent = 'Reviewing ' + (done + 1) + ' of ' + (done + todo.length) + '…';
      var s = todo.shift();
      api('POST', '/api/admin/voice/' + encodeURIComponent(s.sid) + '/review').then(function () { done++; next(); }).catch(function () { next(); });
    })();
  }

  /* ---------- orders panel ---------- */
  function renderOrders() {
    var panel = document.getElementById('adm-panel');
    var rows = allOrders();
    panel.innerHTML =
      '<div class="adm-toolbar"><input class="adm-input adm-search" id="adm-osearch" placeholder="Search by order #, customer, phone, status…"></div>' +
      '<div class="adm-tablewrap">' + ordersTable(rows) + '</div>';
    var search = document.getElementById('adm-osearch');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var filtered = !q ? rows : rows.filter(function (r) {
        return [r.o.id, r.o.title, r.user.name, r.mobile, r.o.status, r.o.payment]
          .join(' ').toLowerCase().indexOf(q) > -1;
      });
      panel.querySelector('.adm-tablewrap').innerHTML = ordersTable(filtered);
      wireOrderRows();
    });
    wireOrderRows();
  }

  function ordersTable(rows) {
    if (!rows.length) return '<div class="adm-empty">No orders found.</div>';
    return '<table class="adm-table"><thead><tr>' +
      '<th>Order #</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (r, i) {
        var o = r.o;
        var itemCount = (o.items || []).reduce(function (n, it) { return n + (it.qty || 1); }, 0);
        return '<tr class="adm-orow" data-row="' + i + '" data-mobile="' + esc(r.mobile) + '" data-idx="' + r.idx + '">' +
          '<td><b>#' + esc(o.id) + '</b></td>' +
          '<td style="white-space:nowrap">' + fmtDate(o.date) + '</td>' +
          '<td>' + esc(r.user.name || '—') + '<br><span class="adm-muted">+91 ' + esc(r.mobile) + '</span></td>' +
          '<td>' + itemCount + '</td>' +
          '<td><b>' + esc(o.total || '') + '</b></td>' +
          '<td>' + esc(o.payment || '—') + (o.paid ? ' <span class="adm-chip adm-chip--delivered" style="padding:1px 7px">Paid</span>' : '') + '</td>' +
          '<td>' + statusSelect(o.status || 'Confirmed', r.mobile, r.idx, o.id) + '</td>' +
          '<td style="white-space:nowrap"><button class="adm-link" data-edit="order" data-id="' + esc(o.id) + '" title="Edit" aria-label="Edit" style="' + IB + ';margin-right:6px">' + ICON_EDIT + '</button>' +
            '<button class="adm-link" data-del="order" data-id="' + esc(o.id) + '" title="Delete" aria-label="Delete" style="' + IB + ';color:#DC2626;margin-right:6px">' + ICON_DEL + '</button>' +
            '<button class="adm-link" data-toggle="' + i + '" title="Details" aria-label="Details" style="' + IB + '">' + ICON_INFO + '</button></td>' +
        '</tr>' +
        '<tr class="adm-detrow" data-det="' + i + '" hidden><td colspan="8">' + orderDetail(o) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function statusSelect(cur, mobile, idx, orderId) {
    return '<select class="adm-status adm-status--' + statusSlug(cur) + '" data-status data-mobile="' + esc(mobile) + '" data-idx="' + idx + '" data-oid="' + esc(orderId) + '">' +
      STATUSES.map(function (st) { return '<option' + (st === cur ? ' selected' : '') + '>' + st + '</option>'; }).join('') +
      '</select>';
  }

  function orderDetail(o) {
    var a = o.address || {};
    var items = (o.items || []).map(function (it) {
      return '<div class="adm-det-item"><span>' + esc(it.title) + ' × ' + (it.qty || 1) + '</span><b>' + money(priceNum(it.price) * (it.qty || 1)) + '</b></div>';
    }).join('') || '<span class="adm-muted">No item breakdown.</span>';
    var addr = a.line ? [a.name + (a.phone ? ' · ' + a.phone : ''), a.line,
      [a.city, a.state].filter(Boolean).join(', '), a.pincode, a.landmark ? 'Landmark: ' + a.landmark : '']
      .filter(Boolean).map(esc).join('<br>') : '<span class="adm-muted">No address captured.</span>';
    return '<div class="adm-det">' +
      '<div class="adm-det-col"><h4>Items</h4>' + items + '</div>' +
      '<div class="adm-det-col"><h4>Delivery address</h4><p>' + addr + '</p></div>' +
      '<div class="adm-det-col"><h4>Meta</h4><p class="adm-muted">Placed: ' + fmtDate(o.date) +
        '<br>Payment: ' + esc(o.payment || '—') + ' (' + (o.paid ? 'Paid' : 'Unpaid') + ')' +
        (o.discount > 0 ? '<br>Coupon: ' + esc(o.coupon || '—') + ' (−' + money(o.discount) + ')' : '') +
        (o.paymentId ? '<br>Txn: ' + esc(o.paymentId) : '') +
        ((o.status === 'Cancelled') ? '<br>Cancel reason: ' + esc(o.cancelReason || '—') + '<br>Refund: ' + esc(o.refundStatus || '—') : '') +
        '</p></div>' +
      '</div>';
  }

  function wireOrderRows() {
    var panel = document.getElementById('adm-panel');
    wireActions();
    panel.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var det = panel.querySelector('[data-det="' + b.getAttribute('data-toggle') + '"]');
        if (!det) return;
        if (det.hasAttribute('hidden')) { det.removeAttribute('hidden'); b.title = 'Hide'; }
        else { det.setAttribute('hidden', ''); b.title = 'Details'; }
      });
    });
    panel.querySelectorAll('[data-status]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var mobile = sel.getAttribute('data-mobile'), idx = +sel.getAttribute('data-idx');
        var oid = sel.getAttribute('data-oid');
        sel.className = 'adm-status adm-status--' + statusSlug(sel.value);
        if (SERVER) {
          api('PUT', '/api/admin/orders/' + encodeURIComponent(oid), { status: sel.value }).then(function () {
            serverOrders.forEach(function (o) { if (o.orderId === oid) o.status = sel.value; });
            toast('Order #' + oid + ' → ' + sel.value);
            renderDash('orders');
          }).catch(function (e) { toast('Update failed: ' + e.message); });
        } else {
          var list = ordersOf(mobile);
          if (list[idx]) { list[idx].status = sel.value; saveOrdersOf(mobile, list); }
          toast('Order #' + oid + ' → ' + sel.value);
          renderDash('orders');   // refresh KPIs + status counts
        }
      });
    });
  }

  /* ---------- customers panel ---------- */
  function renderCustomers() {
    var panel = document.getElementById('adm-panel');
    var rows = customerRows();
    panel.innerHTML =
      '<div class="adm-toolbar"><input class="adm-input adm-search" id="adm-csearch" placeholder="Search by name, phone, email…"></div>' +
      '<div class="adm-tablewrap">' + customersTable(rows) + '</div>';
    wireActions();
    var search = document.getElementById('adm-csearch');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var filtered = !q ? rows : rows.filter(function (r) {
        return [r.name, r.mobile, r.email].join(' ').toLowerCase().indexOf(q) > -1;
      });
      panel.querySelector('.adm-tablewrap').innerHTML = customersTable(filtered);
      wireActions();
    });
  }

  function customersTable(rows) {
    if (!rows.length) return '<div class="adm-empty">No customers yet.</div>';
    return '<table class="adm-table"><thead><tr>' +
      '<th>Customer</th><th>Contact</th><th>Joined</th><th>Logins</th><th>Last login</th><th>Orders</th><th>Spent</th><th>Addr.</th><th>Cart</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' +
          '<td><b>' + esc(r.name) + '</b><br><span class="adm-muted">' + esc(r.provider) + '</span></td>' +
          '<td>+91 ' + esc(r.mobile) + '<br><span class="adm-muted">' + esc(r.email) + '</span></td>' +
          '<td style="white-space:nowrap">' + fmtDate(r.createdAt) + '</td>' +
          '<td><b>' + r.logins + '</b></td>' +
          '<td>' + fmtDate(r.lastLogin) + '</td>' +
          '<td>' + r.orders + '</td>' +
          '<td><b>' + money(r.spent) + '</b></td>' +
          '<td>' + r.addresses + '</td>' +
          '<td>' + (r.cart > 0 ? '<span class="adm-chip adm-chip--processing">' + r.cart + '</span>' : '—') + '</td>' +
          actionCell('customer', r.mobile) +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- dealership applications panel (Become-a-Partner page) ---------- */
  function renderDealers() {
    var panel = document.getElementById('adm-panel');
    var rows = partnerRows();
    panel.innerHTML =
      '<div class="adm-toolbar"><input class="adm-input adm-search" id="adm-dlsearch" placeholder="Search by name, business, mobile, city, type…"></div>' +
      '<div class="adm-tablewrap">' + dealersTable(rows) + '</div>';
    wireActions();
    var search = document.getElementById('adm-dlsearch');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var filtered = !q ? rows : rows.filter(function (r) {
        return [r.fullName, r.businessName, r.mobile, r.email, r.city, r.state, r.pincode, r.businessType].join(' ').toLowerCase().indexOf(q) > -1;
      });
      panel.querySelector('.adm-tablewrap').innerHTML = dealersTable(filtered);
      wireActions();
    });
  }

  function dealersTable(rows) {
    if (!rows.length) return '<div class="adm-empty">No dealership applications yet.</div>';
    return '<table class="adm-table"><thead><tr>' +
      '<th>Name</th><th>Business</th><th>Mobile</th><th>City</th><th>State</th><th>PIN</th><th>Type</th><th>Experience</th><th>Applied</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' +
          '<td><b>' + esc(r.fullName) + '</b>' + (r.email ? '<br><span class="adm-muted">' + esc(r.email) + '</span>' : '') + '</td>' +
          '<td>' + esc(r.businessName || '—') + (r.currentProducts ? '<br><span class="adm-muted">' + esc(r.currentProducts) + '</span>' : '') + '</td>' +
          '<td>+91 ' + esc(r.mobile) + '</td>' +
          '<td>' + esc(r.city || '—') + '</td>' +
          '<td>' + esc(r.state || '—') + '</td>' +
          '<td>' + esc(r.pincode || '—') + '</td>' +
          '<td>' + esc(r.businessType || '—') + '</td>' +
          '<td>' + esc(r.experience || '—') + '</td>' +
          '<td style="white-space:nowrap">' + fmtDate(r.appliedAt) + '</td>' +
          actionCell('dealer', r.id) +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- B2B website enquiries panel (campus / hotel / hospital) ---------- */
  function renderB2B() {
    var panel = document.getElementById('adm-panel');
    var rows = b2bRows();
    panel.innerHTML =
      '<div class="adm-toolbar"><input class="adm-input adm-search" id="adm-bsearch" placeholder="Search by site, place, name, mobile, city, type…"></div>' +
      '<div class="adm-tablewrap">' + b2bTable(rows) + '</div>';
    wireActions();
    var search = document.getElementById('adm-bsearch');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var filtered = !q ? rows : rows.filter(function (r) {
        return [r.vertical, r.fullName, r.businessName, r.mobile, r.email, r.city, r.state, r.pincode, r.subType, r.businessType].join(' ').toLowerCase().indexOf(q) > -1;
      });
      panel.querySelector('.adm-tablewrap').innerHTML = b2bTable(filtered);
      wireActions();
    });
  }

  var B2B_BADGE = { Campus: '#7C3AED', Hotel: '#D97706', Hospital: '#0EA5E9' };
  function b2bBadge(vertical) {
    var col = B2B_BADGE[vertical] || '#0077B6';
    return '<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-weight:700;font-size:12px;background:' + col + '1a;color:' + col + '">' + esc(vertical || '—') + '</span>';
  }
  function b2bTable(rows) {
    if (!rows.length) return '<div class="adm-empty">No B2B website enquiries yet.</div>';
    return '<table class="adm-table"><thead><tr>' +
      '<th>Site</th><th>Place</th><th>Contact</th><th>Mobile</th><th>City</th><th>State</th><th>PIN</th><th>Type</th><th>Received</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' +
          '<td>' + b2bBadge(r.vertical) + '</td>' +
          '<td><b>' + esc(r.businessName || '—') + '</b></td>' +
          '<td>' + esc(r.fullName || '—') + (r.email ? '<br><span class="adm-muted">' + esc(r.email) + '</span>' : '') + '</td>' +
          '<td>+91 ' + esc(r.mobile) + '</td>' +
          '<td>' + esc(r.city || '—') + '</td>' +
          '<td>' + esc(r.state || '—') + '</td>' +
          '<td>' + esc(r.pincode || '—') + '</td>' +
          '<td>' + esc(r.subType || '—') + (r.currentProducts ? '<br><span class="adm-muted">' + esc(r.currentProducts) + '</span>' : '') + '</td>' +
          '<td style="white-space:nowrap">' + fmtDate(r.appliedAt) + '</td>' +
          actionCell('b2b', r.id) +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- edit modal + edit/delete actions ---------- */
  // generic edit dialog: fields = [{key,label,type?,options?}], values = {key:val}
  function editModal(title, fields, values, onSave) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(2,8,23,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;max-width:480px;width:100%;max-height:90vh;overflow:auto;padding:24px;box-shadow:0 30px 80px -20px rgba(2,8,23,.5)';
    var html = '<h3 style="margin:0 0 18px;font-size:19px;font-weight:800;color:#0B1220">' + esc(title) + '</h3>';
    fields.forEach(function (f) {
      var v = values[f.key] == null ? '' : values[f.key];
      html += '<label style="display:block;margin-bottom:12px"><span style="display:block;font-size:12px;font-weight:600;color:#64748B;margin-bottom:5px">' + esc(f.label) + '</span>';
      if (f.type === 'select') {
        html += '<select data-f="' + esc(f.key) + '" style="width:100%;padding:11px 12px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;box-sizing:border-box">' +
          f.options.map(function (o) { return '<option' + (String(o) === String(v) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      } else {
        html += '<input data-f="' + esc(f.key) + '" value="' + esc(v) + '" style="width:100%;padding:11px 12px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:14px;box-sizing:border-box">';
      }
      html += '</label>';
    });
    html += '<div style="display:flex;gap:10px;margin-top:20px">' +
      '<button data-cancel class="adm-btn adm-btn--ghost" style="flex:1;justify-content:center">Cancel</button>' +
      '<button data-save class="adm-btn" style="flex:1;justify-content:center;background:#0077B6;color:#fff;border-color:#0077B6">Save</button></div>';
    box.innerHTML = html;
    ov.appendChild(box); document.body.appendChild(ov);
    function close() { if (ov.parentNode) document.body.removeChild(ov); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    box.querySelector('[data-cancel]').addEventListener('click', close);
    box.querySelector('[data-save]').addEventListener('click', function () {
      var out = {};
      box.querySelectorAll('[data-f]').forEach(function (el) { out[el.getAttribute('data-f')] = el.value.trim(); });
      onSave(out, close);
    });
    var first = box.querySelector('[data-f]'); if (first) first.focus();
  }

  var ICON_EDIT = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var ICON_DEL = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>';
  var ICON_INFO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
  // shared style for compact icon-only buttons
  var IB = 'display:inline-flex;align-items:center;justify-content:center;padding:5px;line-height:0;border-radius:8px';

  function actionCell(kind, id) {
    return '<td style="white-space:nowrap">' +
      '<button class="adm-link" data-edit="' + kind + '" data-id="' + esc(id) + '" title="Edit" aria-label="Edit" style="' + IB + ';margin-right:6px">' + ICON_EDIT + '</button>' +
      '<button class="adm-link" data-del="' + kind + '" data-id="' + esc(id) + '" title="Delete" aria-label="Delete" style="' + IB + ';color:#DC2626">' + ICON_DEL + '</button></td>';
  }

  // wire Edit/Delete buttons inside the current panel
  function wireActions() {
    var panel = document.getElementById('adm-panel');
    if (!panel) return;
    panel.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { onEdit(b.getAttribute('data-edit'), b.getAttribute('data-id')); });
    });
    panel.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { onDelete(b.getAttribute('data-del'), b.getAttribute('data-id')); });
    });
  }

  function reloadAnd(tab, msg) {
    if (SERVER) loadServerData().then(function () { toast(msg); renderDash(tab); }).catch(function (e) { toast(e.message); });
    else { toast(msg); renderDash(tab); }
  }
  // like reloadAnd, but the toast carries an Undo button that runs onUndo
  function reloadAndUndo(tab, msg, onUndo) {
    if (SERVER) loadServerData().then(function () { renderDash(tab); undoToast(msg, onUndo); }).catch(function (e) { toast(e.message); });
    else { renderDash(tab); undoToast(msg, onUndo); }
  }
  function pathFor(kind, id) {
    return (kind === 'dealer' || kind === 'b2b') ? '/api/admin/dealers/' + encodeURIComponent(id)
      : kind === 'customer' ? '/api/admin/customers/' + encodeURIComponent(id)
        : '/api/admin/orders/' + encodeURIComponent(id);
  }
  function tabFor(kind) { return kind === 'b2b' ? 'b2b' : kind === 'dealer' ? 'dealers' : kind === 'customer' ? 'customers' : 'orders'; }

  // UNDO an edit: re-apply the captured previous values
  function editUndo(kind, id, before) {
    api('PUT', pathFor(kind, id), before).then(function () { reloadAnd(tabFor(kind), 'Reverted'); })
      .catch(function (e) { toast('Undo failed: ' + e.message); });
  }
  // UNDO a delete: re-insert the captured document
  function restoreDeleted(kind, doc) {
    if (!doc) { toast('Nothing to undo'); return; }
    api('POST', '/api/admin/' + ((kind === 'dealer' || kind === 'b2b') ? 'dealers' : kind === 'customer' ? 'customers' : 'orders') + '/restore', { doc: doc })
      .then(function () { reloadAnd(tabFor(kind), 'Restored'); })
      .catch(function (e) { toast('Undo failed: ' + e.message); });
  }
  function snapshotFor(kind, id) {
    if (kind === 'dealer' || kind === 'b2b') return serverDealers.filter(function (d) { return String(d._id) === String(id); })[0];
    if (kind === 'customer') return serverCustomers.filter(function (u) { return u.mobile === id; })[0];
    return serverOrders.filter(function (o) { return o.orderId === id; })[0];
  }

  function onEdit(kind, id) {
    if (kind === 'dealer' || kind === 'b2b') {
      var dr = dealerRows().filter(function (x) { return String(x.id) === String(id); })[0];
      if (!dr) return;
      var isB2B = kind === 'b2b';
      var df = isB2B ? [
        { key: 'businessName', label: 'Place Name' }, { key: 'fullName', label: 'Contact Person' },
        { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'Email' },
        { key: 'pincode', label: 'Pincode' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' },
        { key: 'businessType', label: 'Site / Type (e.g. Campus – School)' },
        { key: 'currentProducts', label: 'Size (students / rooms / beds)' }, { key: 'message', label: 'Message' }
      ] : [
        { key: 'fullName', label: 'Full Name' }, { key: 'businessName', label: 'Business Name' },
        { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'Email' },
        { key: 'pincode', label: 'Pincode' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' },
        { key: 'businessType', label: 'Business Type' }, { key: 'currentProducts', label: 'Current Products' },
        { key: 'experience', label: 'Experience' }, { key: 'message', label: 'Message' }
      ];
      var dbefore = {}; df.forEach(function (f) { dbefore[f.key] = dr[f.key] == null ? '' : dr[f.key]; });
      editModal(isB2B ? 'Edit B2B enquiry' : 'Edit dealership application', df, dr, function (out, close) {
        api('PUT', pathFor(kind, id), out)
          .then(function () { close(); reloadAndUndo(tabFor(kind), 'Saved', function () { editUndo(kind, id, dbefore); }); })
          .catch(function (e) { toast('Update failed: ' + e.message); });
      });
    } else if (kind === 'customer') {
      var c = customerRows().filter(function (x) { return String(x.mobile) === String(id); })[0];
      if (!c) return;
      var cb = { name: c.name === '—' ? '' : c.name, email: c.email === '—' ? '' : c.email };
      editModal('Edit customer', [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }], cb, function (out, close) {
        if (SERVER) {
          api('PUT', pathFor('customer', id), out)
            .then(function () { close(); reloadAndUndo('customers', 'Customer updated', function () { editUndo('customer', id, cb); }); })
            .catch(function (e) { toast('Update failed: ' + e.message); });
        } else {
          var users = getUsers(); if (users[id]) { users[id].name = out.name; users[id].email = out.email; write(K_USERS, users); }
          close(); reloadAnd('customers', 'Customer updated');
        }
      });
    } else if (kind === 'order') {
      var o = allOrders().filter(function (x) { return String(x.o.id) === String(id); })[0];
      if (!o) return;
      var a = o.o.address || {};
      var ob = { customerName: o.user.name === '—' ? '' : o.user.name, status: o.o.status || 'Confirmed', payment: o.o.payment || '', address: a };
      editModal('Edit order #' + id, [
        { key: 'customerName', label: 'Customer name' },
        { key: 'status', label: 'Status', type: 'select', options: STATUSES },
        { key: 'payment', label: 'Payment' },
        { key: 'a_name', label: 'Address — name' }, { key: 'a_phone', label: 'Address — phone' },
        { key: 'a_line', label: 'Address — line' }, { key: 'a_city', label: 'Address — city' },
        { key: 'a_state', label: 'Address — state' }, { key: 'a_pincode', label: 'Address — pincode' }
      ], {
        customerName: ob.customerName, status: ob.status, payment: ob.payment,
        a_name: a.name || '', a_phone: a.phone || '', a_line: a.line || '', a_city: a.city || '', a_state: a.state || '', a_pincode: a.pincode || ''
      }, function (out, close) {
        var address = { name: out.a_name, phone: out.a_phone, line: out.a_line, city: out.a_city, state: out.a_state, pincode: out.a_pincode, landmark: a.landmark || '' };
        if (SERVER) {
          api('PUT', pathFor('order', id), { customerName: out.customerName, status: out.status, payment: out.payment, address: address })
            .then(function () { close(); reloadAndUndo('orders', 'Order updated', function () { editUndo('order', id, ob); }); })
            .catch(function (e) { toast('Update failed: ' + e.message); });
        } else {
          var list = ordersOf(o.mobile); if (list[o.idx]) { list[o.idx].status = out.status; list[o.idx].payment = out.payment; list[o.idx].address = address; saveOrdersOf(o.mobile, list); }
          close(); reloadAnd('orders', 'Order updated');
        }
      });
    }
  }

  function onDelete(kind, id) {
    var label = kind === 'dealer' ? 'dealership application' : kind === 'b2b' ? 'B2B enquiry' : kind;
    if (!confirm('Delete this ' + label + '? You can Undo right after.')) return;
    var snap = SERVER ? snapshotFor(kind, id) : null;
    if (kind === 'dealer' || kind === 'b2b') {
      api('DELETE', pathFor(kind, id))
        .then(function () { serverDealers = serverDealers.filter(function (d) { return String(d._id) !== String(id); }); renderDash(tabFor(kind)); undoToast((kind === 'b2b' ? 'Enquiry' : 'Dealer') + ' deleted', function () { restoreDeleted(kind, snap); }); })
        .catch(function (e) { toast('Delete failed: ' + e.message); });
    } else if (kind === 'customer') {
      if (SERVER) {
        api('DELETE', pathFor('customer', id))
          .then(function () { serverCustomers = serverCustomers.filter(function (u) { return u.mobile !== id; }); renderDash('customers'); undoToast('Customer deleted', function () { restoreDeleted('customer', snap); }); })
          .catch(function (e) { toast('Delete failed: ' + e.message); });
      } else {
        var users = getUsers(); delete users[id]; write(K_USERS, users); toast('Customer deleted'); renderDash('customers');
      }
    } else if (kind === 'order') {
      if (SERVER) {
        api('DELETE', pathFor('order', id))
          .then(function () { serverOrders = serverOrders.filter(function (o) { return o.orderId !== id; }); renderDash('orders'); undoToast('Order deleted', function () { restoreDeleted('order', snap); }); })
          .catch(function (e) { toast('Delete failed: ' + e.message); });
      } else {
        var users2 = getUsers();
        Object.keys(users2).forEach(function (m) { var list = ordersOf(m); var ni = list.filter(function (o) { return String(o.id) !== String(id); }); if (ni.length !== list.length) saveOrdersOf(m, ni); });
        toast('Order deleted'); renderDash('orders');
      }
    }
  }

  /* ---------- CSV export ---------- */
  function toCSV(headers, rows) {
    var enc = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [headers.join(',')].concat(rows.map(function (r) { return r.map(enc).join(','); })).join('\n');
  }
  function download(name, csv) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  function exportCSV(tab) {
    if (tab === 'customers') {
      var rows = customerRows().map(function (r) {
        return [r.name, r.mobile, r.email, fmtDate(r.createdAt), r.logins, fmtDate(r.lastLogin), r.orders, r.spent.toFixed(2), r.addresses, r.cart];
      });
      download('dcal-customers.csv', toCSV(['Name', 'Mobile', 'Email', 'Joined', 'Logins', 'LastLogin', 'Orders', 'Spent', 'Addresses', 'CartItems'], rows));
    } else if (tab === 'dealers') {
      var dlrows = partnerRows().map(function (r) {
        return [r.fullName, r.businessName, r.mobile, r.email, r.pincode, r.city, r.state, r.businessType, r.currentProducts, r.experience, r.message, fmtDate(r.appliedAt)];
      });
      download('dcal-dealers.csv', toCSV(['Name', 'Business', 'Mobile', 'Email', 'Pincode', 'City', 'State', 'BusinessType', 'CurrentProducts', 'Experience', 'Message', 'AppliedAt'], dlrows));
    } else if (tab === 'b2b') {
      var brows = b2bRows().map(function (r) {
        return [r.vertical, r.businessName, r.fullName, r.mobile, r.email, r.pincode, r.city, r.state, r.subType, r.currentProducts, r.message, fmtDate(r.appliedAt)];
      });
      download('dcal-b2b-enquiries.csv', toCSV(['Site', 'Place', 'Contact', 'Mobile', 'Email', 'Pincode', 'City', 'State', 'Type', 'Size', 'Message', 'ReceivedAt'], brows));
    } else if (tab === 'voice') {
      if (!voiceData) return;
      var vrows = voiceRows().map(function (s) {
        return [s.sid, fmtDate(s.startedAt), s.turns, langs(s.langs), s.device, s.signedIn ? 'yes' : 'no', s.firstSaid,
          Object.keys(s.problems).map(function (p) { return ((voiceData.problems[p] || {}).label || p) + (s.problems[p] > 1 ? ' x' + s.problems[p] : ''); }).join(' | '),
          s.review ? s.review.achieved : '', s.review ? s.review.summary : ''];
      });
      download('dcal-voice-conversations.csv', toCSV(['Conversation', 'Started', 'Turns', 'Languages', 'Device', 'SignedIn', 'FirstSaid', 'Problems', 'AIVerdict', 'AISummary'], vrows));
    } else {
      var orows = allOrders().map(function (r) {
        var o = r.o, a = o.address || {};
        var items = (o.items || []).map(function (it) { return (it.qty || 1) + 'x ' + it.title; }).join(' | ');
        return [o.id, fmtDate(o.date), r.user.name, r.mobile, o.total, o.payment, o.status || 'Confirmed', items,
          [a.line, a.city, a.state, a.pincode].filter(Boolean).join(', ')];
      });
      download('dcal-orders.csv', toCSV(['OrderID', 'Date', 'Customer', 'Mobile', 'Total', 'Payment', 'Status', 'Items', 'Address'], orows));
    }
    toast('CSV exported');
  }

  /* ---------- toast ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'adm-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.style.pointerEvents = 'none'; toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  // toast with an Undo button; stays ~7s so the admin has time to react
  function undoToast(msg, onUndo) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'adm-toast'; document.body.appendChild(toastEl); }
    function hide() { toastEl.classList.remove('show'); toastEl.style.pointerEvents = 'none'; }
    toastEl.innerHTML = '';
    var span = document.createElement('span'); span.textContent = msg; toastEl.appendChild(span);
    var btn = document.createElement('button'); btn.textContent = 'Undo';
    btn.style.cssText = 'margin-left:16px;background:transparent;border:1px solid rgba(255,255,255,.45);color:#7DD3FC;font-weight:700;cursor:pointer;font-size:13px;padding:3px 12px;border-radius:7px;pointer-events:auto';
    btn.addEventListener('click', function () { clearTimeout(toast._t); hide(); onUndo(); });
    toastEl.appendChild(btn);
    toastEl.style.pointerEvents = 'auto';      // CSS sets the toast to pointer-events:none — re-enable so Undo is clickable
    toastEl.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(hide, 7000);
  }

  /* ---------- init ---------- */
  function init() {
    root = document.getElementById('dcal-admin-root');
    if (!root) return;
    root.innerHTML = '<div class="adm-gate"><div class="adm-gate-card"><div class="adm-gate-logo">D’Cal <span>Admin</span></div><p class="adm-gate-sub">Loading…</p></div></div>';
    checkServer().then(function (ok) {
      SERVER = ok;
      if (isAdmin()) bootDash(); else renderGate();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
