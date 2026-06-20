/* =========================================================
   D'Cal Auth System — Google sign-in (+ demo OTP fallback),
   profiles, cart + checkout gating.
   Client-side; sessions persist to localStorage.
   Set GOOGLE_CLIENT_ID below to enable real Google sign-in;
   while blank, the simulated phone OTP demo stays active.
   ========================================================= */
(function () {
  'use strict';

  /* =========================================================
     GOOGLE SIGN-IN CONFIG
     Paste your Google OAuth Client ID below to enable real
     "Sign in with Google". Get it from console.cloud.google.com
     (APIs & Services -> Credentials -> OAuth client ID -> Web).
     The Client ID is NOT a secret — safe to keep in client code.
     While this is left blank, the demo phone login stays active.
     NOTE: Google sign-in only works over http(s) (localhost or a
     deployed domain), NOT when opening the file directly (file://).
     ========================================================= */
  var GOOGLE_CLIENT_ID = ''; // e.g. '1234567890-abcd.apps.googleusercontent.com'

  /* ---------- storage helpers ---------- */
  var LS = window.localStorage;
  function read(key, fallback) {
    try { var v = LS.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) { try { LS.setItem(key, JSON.stringify(val)); } catch (e) {} }

  var K_USERS = 'dcal_users';
  var K_SESSION = 'dcal_session';

  function users() { return read(K_USERS, {}); }
  function saveUsers(u) { write(K_USERS, u); }
  function sessionMobile() { return read(K_SESSION, null); }
  function currentUser() { var m = sessionMobile(); return m ? (users()[m] || null) : null; }
  function isLoggedIn() { return !!currentUser(); }

  function ordKey(m) { return 'dcal_orders:' + m; }
  // cart is tied to the logged-in user; a guest has no cart (adding requires login)
  function cartKey() { var m = sessionMobile(); return m ? 'dcal_cart:' + m : null; }
  function cartGet() { var k = cartKey(); return k ? read(k, []) : []; }
  function cartSave(c) { var k = cartKey(); if (k) write(k, c); }
  function cartCount() { return cartGet().reduce(function (n, i) { return n + (i.qty || 1); }, 0); }
  function orders() { var m = sessionMobile(); return m ? read(ordKey(m), []) : []; }
  function saveOrders(list) { var m = sessionMobile(); if (m) write(ordKey(m), list); }

  /* =========================================================
     CENTRAL API  (optional)
     When the site is served by the Node backend, these calls
     keep one shared database in sync so the admin can see every
     customer's orders from any device. If the server is missing
     or unreachable, every call fails quietly and the site keeps
     working purely on localStorage (so it works before deploy).
     Override the base URL with window.DCAL_API_BASE if the API
     lives on a different domain than the frontend.
     ========================================================= */
  var API_BASE = (typeof window !== 'undefined' && window.DCAL_API_BASE) || '';
  function api(method, p, body) {
    return fetch(API_BASE + p, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  // copy a server user record into the local cache so currentUser() works
  function cacheServerUser(su) {
    if (!su || !su.mobile) return;
    var all = users();
    all[su.mobile] = {
      mobile: su.mobile, name: su.name || '', email: su.email || '', avatar: su.avatar || '',
      provider: su.provider || 'phone', addresses: su.addresses || [],
      defaultAddressId: su.defaultAddressId || null, logins: su.logins || 0,
      lastLogin: su.lastLogin || null, createdAt: su.createdAt || Date.now()
    };
    saveUsers(all);
  }
  function registerOnServer(u) {
    if (!u) return;
    api('POST', '/api/register', { mobile: u.mobile, name: u.name, email: u.email, avatar: u.avatar, provider: u.provider || 'phone' }).catch(function () {});
  }
  function syncProfile(mobile) {
    var u = users()[mobile]; if (!u) return;
    api('PUT', '/api/users/' + encodeURIComponent(mobile), { name: u.name, email: u.email, avatar: u.avatar }).catch(function () {});
  }
  function syncAddresses(mobile) {
    var u = users()[mobile]; if (!u) return;
    api('PUT', '/api/users/' + encodeURIComponent(mobile) + '/addresses', { addresses: u.addresses || [], defaultAddressId: u.defaultAddressId || null }).catch(function () {});
  }
  function pushOrder(order, mobile) {
    api('POST', '/api/orders', {
      orderId: order.id, mobile: mobile,
      customerName: (users()[mobile] || {}).name || (order.address || {}).name || '',
      title: order.title, total: order.total, image: order.image, items: order.items,
      address: order.address, payment: order.payment, paid: order.paid, paymentId: order.paymentId,
      coupon: order.coupon, discount: order.discount,
      status: order.status, date: order.date
    }).catch(function () {});
  }
  // pull this user's orders from the server so they appear on any device
  function pullOrders(mobile) {
    api('GET', '/api/orders?mobile=' + encodeURIComponent(mobile)).then(function (res) {
      if (res && res.orders) {
        saveOrders(res.orders.map(function (o) {
          return { id: o.orderId, title: o.title, total: o.total, image: o.image,
            items: o.items || [], address: o.address || {}, payment: o.payment,
            paid: o.paid, paymentId: o.paymentId, date: o.date, status: o.status,
            coupon: o.coupon, discount: o.discount,
            cancelReason: o.cancelReason, refundStatus: o.refundStatus, cancelledAt: o.cancelledAt };
        }));
      }
    }).catch(function () {});
  }
  // decide new-vs-returning using the server (with a localStorage fallback)
  function decideLogin(mobile) {
    api('POST', '/api/login', { mobile: mobile }).then(function (res) {
      if (res.isNew) {
        if (users()[mobile]) { registerOnServer(users()[mobile]); loginAs(mobile); }
        else gotoStep('profile');
      } else {
        cacheServerUser(res.user);
        loginAs(mobile);
      }
    }).catch(function () {
      // server unreachable -> original local behaviour
      if (users()[mobile]) loginAs(mobile); else gotoStep('profile');
    });
  }

  /* ---------- misc helpers ---------- */
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function initials(name) {
    if (!name) return 'U';
    var parts = name.trim().split(/\s+/);
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var pendingAction = null; // function to run after a successful login
  var genOtp = null;        // current demo OTP
  var lastOtpMode = 'login'; // 'login' | 'signup' — for re-showing the code popup
  var pendingMobile = null; // mobile awaiting verification

  /* ---------- toast ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = el('<div class="dcal-toast" role="status"></div>'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 3000);
  }

  /* ====================================================
     AUTH MODAL
     ==================================================== */
  var overlay, modal;
  var ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  function buildModal() {
    overlay = el('<div class="dcal-overlay" id="dcal-overlay" role="dialog" aria-modal="true" aria-label="Login or sign up"></div>');
    modal = el(
      '<div class="dcal-modal">' +
        '<button class="dcal-x" data-dcal-close aria-label="Close">' + ICON_X + '</button>' +
        '<div class="dcal-banner">' +
          '<p class="dcal-banner__brand">D’Cal</p>' +
          '<p class="dcal-banner__tag">Login or sign up to continue</p>' +
        '</div>' +
        '<div class="dcal-body">' +

          /* STEP 0 — Google sign-in (shown when a Client ID is configured) */
          '<div class="dcal-step" data-step="google">' +
            '<h3 class="dcal-h">Login or Sign up</h3>' +
            '<p class="dcal-sub">Continue with your Google account to access your orders, cart and profile.</p>' +
            '<div class="dcal-gbtn" data-gbtn></div>' +
            '<div class="dcal-gmsg" data-gmsg></div>' +
            '<p class="dcal-terms">By continuing you agree to D’Cal’s Terms of Use and Privacy Policy.</p>' +
          '</div>' +

          /* STEP 1 — phone */
          '<div class="dcal-step active" data-step="phone">' +
            '<h3 class="dcal-h">Enter your mobile number</h3>' +
            '<p class="dcal-sub">Use the OTP displayed below to verify your identity</p>' +
            '<label class="dcal-label">Mobile number</label>' +
            '<div class="dcal-phone"><span class="dcal-phone__cc">+91</span>' +
              '<input type="tel" id="dcal-phone-input" inputmode="numeric" maxlength="10" placeholder="98765 43210" autocomplete="tel"></div>' +
            '<div class="dcal-err" data-err="phone"></div>' +
            '<button class="dcal-btn" data-act="send-otp">Continue</button>' +
            '<p class="dcal-terms">By continuing you agree to D’Cal’s Terms of Use and Privacy Policy.</p>' +
          '</div>' +

          /* STEP 2 — otp */
          '<div class="dcal-step" data-step="otp">' +
            '<h3 class="dcal-h">Verify your number</h3>' +
            '<p class="dcal-sub">Enter the 6-digit code shown in the popup for <b data-otp-target>+91</b>. <button type="button" class="dcal-link" data-act="change-number">Change</button></p>' +
            '<div class="dcal-otp" data-otp-boxes>' +
              '<input inputmode="numeric" maxlength="1"><input inputmode="numeric" maxlength="1"><input inputmode="numeric" maxlength="1">' +
              '<input inputmode="numeric" maxlength="1"><input inputmode="numeric" maxlength="1"><input inputmode="numeric" maxlength="1">' +
            '</div>' +
            '<div class="dcal-err" data-err="otp"></div>' +
            '<button class="dcal-btn" data-act="verify-otp">Verify &amp; continue</button>' +
            '<p class="dcal-resend">Didn’t get it? <button data-act="resend" disabled>Resend in <span data-resend-timer>15</span>s</button></p>' +
          '</div>' +

          /* STEP 3 — profile (new users) */
          '<div class="dcal-step" data-step="profile">' +
            '<h3 class="dcal-h">Complete your profile</h3>' +
            '<p class="dcal-sub">Welcome to D’Cal! Tell us a bit about you.</p>' +
            '<div class="dcal-avwrap">' +
              '<div class="dcal-av" data-av-preview>U</div>' +
              '<label>Add profile photo (optional)<input type="file" accept="image/*" data-av-file></label>' +
            '</div>' +
            '<label class="dcal-label">Full name</label>' +
            '<input class="dcal-input" type="text" data-pf-name placeholder="Your full name" autocomplete="name">' +
            '<label class="dcal-label">Email address</label>' +
            '<input class="dcal-input" type="email" data-pf-email placeholder="you@example.com" autocomplete="email">' +
            '<div class="dcal-err" data-err="profile"></div>' +
            '<button class="dcal-btn" data-act="create-account">Create account</button>' +
          '</div>' +

        '</div>' +
      '</div>'
    );
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // close handlers
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('[data-dcal-close]')) closeAuth();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeAuth();
    });

    // action buttons
    modal.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'send-otp') sendOtp();
      else if (a === 'change-number') gotoStep('phone');
      else if (a === 'verify-otp') verifyOtp();
      else if (a === 'resend') sendOtp(true);
      else if (a === 'create-account') createAccount();
    });

    // phone input: digits only, Enter to submit
    var phoneInput = modal.querySelector('#dcal-phone-input');
    phoneInput.addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 10); });
    phoneInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendOtp(); });

    // OTP boxes: auto-advance + paste
    var boxes = [].slice.call(modal.querySelectorAll('[data-otp-boxes] input'));
    boxes.forEach(function (box, i) {
      box.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 1);
        if (this.value && boxes[i + 1]) boxes[i + 1].focus();
        if (boxes.every(function (b) { return b.value; })) verifyOtp();
      });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !this.value && boxes[i - 1]) boxes[i - 1].focus();
      });
      box.addEventListener('paste', function (e) {
        var d = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        if (d) { e.preventDefault(); boxes.forEach(function (b, j) { b.value = d[j] || ''; }); (boxes[d.length] || boxes[5]).focus(); if (d.length === 6) verifyOtp(); }
      });
    });

    // profile photo preview
    var fileInput = modal.querySelector('[data-av-file]');
    fileInput.addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { tmpAvatar = r.result; modal.querySelector('[data-av-preview]').innerHTML = '<img src="' + tmpAvatar + '" alt="">'; };
      r.readAsDataURL(f);
    });
  }

  var tmpAvatar = null;
  var resendTimer = null;

  function showErr(name, msg) {
    var e = modal.querySelector('[data-err="' + name + '"]');
    if (!e) return;
    e.textContent = msg || ''; e.classList.toggle('show', !!msg);
  }

  function gotoStep(name) {
    modal.querySelectorAll('.dcal-step').forEach(function (s) { s.classList.toggle('active', s.getAttribute('data-step') === name); });
    showErr('phone', ''); showErr('otp', ''); showErr('profile', '');
    if (name === 'phone') setTimeout(function () { modal.querySelector('#dcal-phone-input').focus(); }, 60);
    if (name === 'otp') setTimeout(function () { modal.querySelector('[data-otp-boxes] input').focus(); }, 60);
  }

  /* ---------- Google Identity Services ---------- */
  var gsiLoaded = false, gsiLoading = false, gsiCbs = [], gsiReady = false;

  function loadGsi(cb) {
    if (gsiLoaded) return cb();
    gsiCbs.push(cb);
    if (gsiLoading) return;
    gsiLoading = true;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = function () { gsiLoaded = true; gsiCbs.forEach(function (f) { f(); }); gsiCbs = []; };
    s.onerror = function () { gsiLoading = false; showGmsg('Could not load Google sign-in — check your internet connection.'); };
    document.head.appendChild(s);
  }

  function showGmsg(msg) { var e = modal && modal.querySelector('[data-gmsg]'); if (e) e.textContent = msg || ''; }

  function initGoogle() {
    if (!GOOGLE_CLIENT_ID) return;
    showGmsg('Loading…');
    loadGsi(function () {
      if (!window.google || !google.accounts || !google.accounts.id) { showGmsg('Google sign-in is unavailable here. Run the site on http://localhost or your domain.'); return; }
      try {
        if (!gsiReady) {
          google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential, auto_select: false });
          gsiReady = true;
        }
        var box = modal.querySelector('[data-gbtn]');
        box.innerHTML = '';
        google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center', width: 300 });
        showGmsg('');
      } catch (e) {
        showGmsg('Google sign-in needs to run on http(s) (localhost or a deployed site), not file://.');
      }
    });
  }

  function decodeJwt(token) {
    var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    var json = decodeURIComponent(atob(part).split('').map(function (c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(json);
  }

  function onGoogleCredential(resp) {
    try { loginWithGoogle(decodeJwt(resp.credential)); }
    catch (e) { showGmsg('Sign-in failed. Please try again.'); }
  }

  function loginWithGoogle(p) {
    var email = (p.email || '').toLowerCase();
    if (!email) { showGmsg('Could not read your Google account.'); return; }
    var all = users();
    if (!all[email]) {
      all[email] = { uid: email, name: p.name || email, email: email, avatar: p.picture || '', mobile: '', provider: 'google', createdAt: Date.now() };
    } else {
      if (p.name) all[email].name = p.name;
      if (p.picture) all[email].avatar = p.picture;
      all[email].provider = 'google';
    }
    saveUsers(all);
    loginAs(email);
  }

  function openAuth() {
    if (!overlay) buildModal();
    tmpAvatar = null;
    if (GOOGLE_CLIENT_ID) {
      gotoStep('google');
      initGoogle();
    } else {
      var pi = modal.querySelector('#dcal-phone-input'); if (pi) pi.value = '';
      gotoStep('phone');
      setTimeout(function () { var p = modal.querySelector('#dcal-phone-input'); if (p) p.focus(); }, 80);
    }
    overlay.classList.add('open');
    document.documentElement.classList.add('dcal-lock');
  }
  function closeAuth() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.documentElement.classList.remove('dcal-lock');
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
    removeOtpPopup();
    pendingAction = null;
  }

  function sendOtp(isResend) {
    var input = modal.querySelector('#dcal-phone-input');
    var num = input.value.replace(/\D/g, '');
    if (!isResend) {
      if (num.length !== 10) { showErr('phone', 'Please enter a valid 10-digit mobile number.'); return; }
      pendingMobile = num;
    }
    genOtp = String(Math.floor(100000 + Math.random() * 900000));
    modal.querySelector('[data-otp-target]').textContent = '+91 ' + pendingMobile;
    modal.querySelectorAll('[data-otp-boxes] input').forEach(function (b) { b.value = ''; });
    gotoStep('otp');
    startResendTimer();
    try { playDing(); } catch (e) {}   // fire inside the click gesture so the browser allows the sound
    // show the code notification IMMEDIATELY (never wait on the network)
    var syncMode = users()[pendingMobile] ? 'login' : 'signup';
    lastOtpMode = syncMode;
    try { showOtpPopup(genOtp, syncMode); } catch (e) {}
    // then refine the login/sign-up wording from the server if it's reachable
    detectMode(pendingMobile).then(function (mode) {
      var msg = document.querySelector('#dcal-otp-pop .dcal-otp-pop__msg');
      if (msg) msg.textContent = 'Code to ' + (mode === 'signup' ? 'sign up' : 'log in') + ' · Don’t share your OTP with anyone';
    });
    if (isResend) toast('New code sent');
  }

  // returning user -> 'login', brand-new phone -> 'signup' (cosmetic; real decision is after OTP)
  function detectMode(mobile) {
    if (users()[mobile]) return Promise.resolve('login');
    return api('GET', '/api/users/' + encodeURIComponent(mobile))
      .then(function () { return 'login'; })
      .catch(function () { return 'signup'; });
  }

  var otpPopTimer = null;   // auto-dismiss timer for the code notification
  function removeOtpPopup() {
    if (otpPopTimer) { clearTimeout(otpPopTimer); otpPopTimer = null; }
    var p = document.getElementById('dcal-otp-pop'); if (p) p.remove();
  }

  // short two-note "ding" chime (generated in code; no audio file needed)
  function playDing() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      [[880, 0], [1320, 0.12]].forEach(function (n) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        o.connect(g); g.connect(ctx.destination);
        var t = ctx.currentTime + n[1];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        o.start(t); o.stop(t + 0.3);
      });
      setTimeout(function () { ctx.close(); }, 800);
    } catch (e) {}
  }

  // Truecaller-style notification (top-right) showing the one-time code (demo — no SMS sent)
  function showOtpPopup(code, mode) {
    removeOtpPopup();
    var action = mode === 'signup' ? 'sign up' : 'log in';
    var pop = el(
      '<div id="dcal-otp-pop" class="dcal-otp-pop" role="dialog" aria-label="Your verification code">' +
        '<button type="button" class="dcal-otp-pop__x" data-otp-pop-x aria-label="Dismiss">&times;</button>' +
        '<div class="dcal-otp-pop__head">' +
          '<span class="dcal-otp-pop__logo"><img src="' + rel('img/dcal-logo.png') + '" alt=""></span>' +
          '<span class="dcal-otp-pop__brand">D’Cal</span>' +
        '</div>' +
        '<div class="dcal-otp-pop__body">' +
          '<div class="dcal-otp-pop__code">' + esc(code) + '</div>' +
          '<p class="dcal-otp-pop__msg">Code to ' + action + ' · Don’t share your OTP with anyone</p>' +
        '</div>' +
        '<button type="button" class="dcal-otp-pop__copy" data-otp-pop-copy>Copy OTP</button>' +
      '</div>'
    );
    document.body.appendChild(pop);
    requestAnimationFrame(function () { pop.classList.add('show'); });

    pop.querySelector('[data-otp-pop-x]').addEventListener('click', removeOtpPopup);
    pop.querySelector('[data-otp-pop-copy]').addEventListener('click', function () {
      var btn = this;
      var done = function () {
        btn.textContent = 'Copied ✓'; btn.classList.add('done');
        var boxes = modal.querySelectorAll('[data-otp-boxes] input');
        code.split('').forEach(function (d, i) { if (boxes[i]) boxes[i].value = d; });
        removeOtpPopup();
        setTimeout(verifyOtp, 200);   // auto-submit after filling
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, done);
      } else { done(); }
    });
    // auto-dismiss after 60s (tracked, so a resend's new popup isn't killed by an old timer)
    otpPopTimer = setTimeout(removeOtpPopup, 60000);
  }

  function startResendTimer() {
    var btn = modal.querySelector('[data-act="resend"]');
    var span = modal.querySelector('[data-resend-timer]');
    if (!btn || !span) return;   // never let a missing element break the OTP flow
    var left = 15; btn.disabled = true; span.textContent = left;
    btn.innerHTML = 'Resend in <span data-resend-timer>' + left + '</span>s';
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(resendTimer); resendTimer = null;
        btn.disabled = false; btn.textContent = 'Resend OTP';
      } else {
        var s = modal.querySelector('[data-resend-timer]'); if (s) s.textContent = left;
      }
    }, 1000);
  }

  function verifyOtp() {
    var entered = [].slice.call(modal.querySelectorAll('[data-otp-boxes] input')).map(function (b) { return b.value; }).join('');
    if (entered.length !== 6) { showErr('otp', 'Enter the 6-digit OTP.'); return; }
    if (entered !== genOtp) { showErr('otp', 'Incorrect OTP. Please try again.'); return; }
    showErr('otp', '');
    // ask the central server whether this phone is new or returning
    // (falls back to localStorage if the server isn't reachable)
    decideLogin(pendingMobile);
  }

  function createAccount() {
    var name = modal.querySelector('[data-pf-name]').value.trim();
    var email = modal.querySelector('[data-pf-email]').value.trim();
    if (name.length < 2) { showErr('profile', 'Please enter your full name.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showErr('profile', 'Please enter a valid email address.'); return; }
    var u = users();
    u[pendingMobile] = { mobile: pendingMobile, name: name, email: email, avatar: tmpAvatar || '', createdAt: Date.now() };
    saveUsers(u);
    registerOnServer(u[pendingMobile]);   // create in the central database too
    loginAs(pendingMobile);
  }

  function loginAs(mobile) {
    write(K_SESSION, mobile);
    // track login activity for the admin dashboard
    var all = users();
    if (all[mobile]) { all[mobile].logins = (all[mobile].logins || 0) + 1; all[mobile].lastLogin = Date.now(); saveUsers(all); }
    updateHeader();
    updateCartBubbles();
    pullOrders(mobile);   // bring this customer's orders from the central DB to this device
    var fn = pendingAction; pendingAction = null;   // capture before closeAuth() clears it
    closeAuth();
    var user = currentUser();
    toast('Welcome' + (user && user.name ? ', ' + user.name.split(' ')[0] : '') + '!');
    if (fn) setTimeout(fn, 350);
  }

  function logout() {
    LS.removeItem(K_SESSION);
    updateHeader();
    updateCartBubbles();   // guest -> empty cart -> bubble hidden
    closeDrawer();
    toast('Logged out');
  }

  /* ====================================================
     PROFILE DRAWER
     ==================================================== */
  var drawer, drawerBackdrop;
  var IC = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
    chev: '<svg class="dcal-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
  };

  function avatarMarkup(user, cls) {
    if (user && user.avatar) return '<span class="' + cls + '"><img src="' + user.avatar + '" alt=""></span>';
    return '<span class="' + cls + '">' + esc(initials(user && user.name)) + '</span>';
  }

  function buildDrawer() {
    drawerBackdrop = el('<div class="dcal-overlay" id="dcal-drawer-bd" style="background:rgba(3,4,94,.3);z-index:10000"></div>');
    drawer = el('<aside class="dcal-drawer" id="dcal-drawer" aria-label="Your account"></aside>');
    document.body.appendChild(drawerBackdrop);
    document.body.appendChild(drawer);
    drawerBackdrop.addEventListener('click', closeDrawer);
  }

  function renderDrawer() {
    var u = currentUser(); if (!u) return;
    drawer.innerHTML =
      '<div class="dcal-dhead">' +
        '<button class="dcal-x" data-dcal-dclose aria-label="Close" style="top:18px;right:18px">' + ICON_X + '</button>' +
        '<div class="dcal-dhead__av">' + (u.avatar ? '<img src="' + u.avatar + '" alt="">' : esc(initials(u.name))) + '</div>' +
        '<p class="dcal-dhead__name">' + esc(u.name) + '</p>' +
        '<p class="dcal-dhead__meta">' + (u.mobile ? '+91 ' + esc(u.mobile) : esc(u.email)) + '</p>' +
      '</div>' +
      '<div class="dcal-dbody" data-dbody>' +
        '<button class="dcal-mi" data-go="edit">' + IC.edit + ' Edit Profile ' + IC.chev + '</button>' +
        '<button class="dcal-mi" data-go="addresses">' + IC.pin + ' My Addresses ' + IC.chev + '</button>' +
        '<button class="dcal-mi" data-go="orders">' + IC.bag + ' My Orders ' + IC.chev + '</button>' +
        '<button class="dcal-mi dcal-mi--danger" data-act="logout">' + IC.logout + ' Logout</button>' +
      '</div>';
    drawer.querySelector('[data-dcal-dclose]').addEventListener('click', closeDrawer);
    drawer.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { openSub(b.getAttribute('data-go')); });
    });
    drawer.querySelector('[data-act="logout"]').addEventListener('click', logout);
  }

  function openProfile(sub) {
    if (!drawer) buildDrawer();
    renderDrawer();
    drawerBackdrop.classList.add('open');
    drawer.classList.add('open');
    document.documentElement.classList.add('dcal-lock');
    if (sub) setTimeout(function () { openSub(sub); }, 80);
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawerBackdrop.classList.remove('open');
    document.documentElement.classList.remove('dcal-lock');
  }

  function openSub(which) {
    var body = drawer.querySelector('[data-dbody]');
    var view = el('<div class="dcal-sub-view"></div>');
    var title = which === 'edit' ? 'Edit Profile' : which === 'addresses' ? 'My Addresses' : 'My Orders';
    view.innerHTML =
      '<div class="dcal-shead"><button class="dcal-sback" aria-label="Back">' + IC.back + '</button><h3 class="dcal-stitle">' + title + '</h3></div>' +
      '<div class="dcal-sbody" data-sbody></div>';
    body.appendChild(view);
    var sbody = view.querySelector('[data-sbody]');
    if (which === 'edit') renderEdit(sbody);
    else if (which === 'addresses') renderAddresses(sbody);
    else renderOrders(sbody);
    view.querySelector('.dcal-sback').addEventListener('click', function () {
      view.classList.remove('open');
      setTimeout(function () { view.remove(); }, 380);
    });
    requestAnimationFrame(function () { view.classList.add('open'); });
  }

  function renderEdit(box) {
    var u = currentUser();
    box.innerHTML =
      '<div class="dcal-avwrap">' +
        '<div class="dcal-av" data-e-av>' + (u.avatar ? '<img src="' + u.avatar + '" alt="">' : esc(initials(u.name))) + '</div>' +
        '<label>Change photo<input type="file" accept="image/*" data-e-file></label>' +
      '</div>' +
      '<label class="dcal-label">Full name</label><input class="dcal-input" data-e-name value="' + esc(u.name) + '">' +
      '<label class="dcal-label">Email address</label><input class="dcal-input" type="email" data-e-email value="' + esc(u.email) + '"' + (u.provider === 'google' ? ' disabled style="background:#F8FAFC;color:#94A3B8"' : '') + '>' +
      (u.mobile
        ? '<label class="dcal-label">Mobile number</label><input class="dcal-input" value="+91 ' + esc(u.mobile) + '" disabled style="background:#F8FAFC;color:#94A3B8">'
        : '<label class="dcal-label">Signed in with</label><input class="dcal-input" value="Google" disabled style="background:#F8FAFC;color:#94A3B8">') +
      '<div class="dcal-err" data-err-edit></div>' +
      '<button class="dcal-btn" data-e-save>Save changes</button>';
    var newAvatar = u.avatar || '';
    box.querySelector('[data-e-file]').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { newAvatar = r.result; box.querySelector('[data-e-av]').innerHTML = '<img src="' + newAvatar + '" alt="">'; };
      r.readAsDataURL(f);
    });
    box.querySelector('[data-e-save]').addEventListener('click', function () {
      var name = box.querySelector('[data-e-name]').value.trim();
      var email = box.querySelector('[data-e-email]').value.trim();
      var err = box.querySelector('[data-err-edit]');
      if (name.length < 2) { err.textContent = 'Please enter your name.'; err.classList.add('show'); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Please enter a valid email.'; err.classList.add('show'); return; }
      var all = users();
      all[u.mobile].name = name; all[u.mobile].email = email; all[u.mobile].avatar = newAvatar;
      saveUsers(all);
      syncProfile(u.mobile);   // mirror to the central database
      updateHeader(); renderDrawer(); toast('Profile updated');
    });
  }

  /* ---------- My Addresses (view / add / edit / delete / default) ---------- */
  function renderAddresses(box) {
    var list = getAddresses();
    if (!list.length) {
      box.innerHTML =
        '<div class="dcal-empty" style="padding-bottom:8px">' + IC.pin + '<p>No saved addresses yet.</p></div>' +
        '<button class="dcal-btn" data-addr-new style="margin-top:4px">+ Add a new address</button>';
      box.querySelector('[data-addr-new]').addEventListener('click', function () { renderAddressForm(box, null); });
      return;
    }
    box.innerHTML = list.map(function (a) {
      return '<div class="dcal-addr-row' + (isDefaultAddress(a.id) ? ' is-default' : '') + '">' +
        '<div class="dcal-addr-row__top">' +
          '<p class="dcal-addr-name" style="margin:0">' + esc(a.name) + ' · ' + esc(a.phone) +
            (isDefaultAddress(a.id) ? ' <span class="dcal-addr-tag">Default</span>' : '') + '</p>' +
        '</div>' +
        '<p class="dcal-addr-lines" style="margin:6px 0 10px">' + addressLines(a) + '</p>' +
        '<div class="dcal-addr-rowacts">' +
          (isDefaultAddress(a.id) ? '' : '<button class="dcal-link-btn" data-addr-default="' + esc(a.id) + '">Set as default</button>') +
          '<button class="dcal-link-btn" data-addr-edit="' + esc(a.id) + '">Edit</button>' +
          '<button class="dcal-link-btn dcal-link-btn--danger" data-addr-del="' + esc(a.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('') + '<button class="dcal-btn" data-addr-new style="margin-top:6px">+ Add a new address</button>';

    box.querySelector('[data-addr-new]').addEventListener('click', function () { renderAddressForm(box, null); });
    box.querySelectorAll('[data-addr-edit]').forEach(function (b) {
      b.addEventListener('click', function () { renderAddressForm(box, b.getAttribute('data-addr-edit')); });
    });
    box.querySelectorAll('[data-addr-default]').forEach(function (b) {
      b.addEventListener('click', function () { setDefaultAddress(b.getAttribute('data-addr-default')); renderAddresses(box); toast('Default address updated'); });
    });
    box.querySelectorAll('[data-addr-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('Delete this address?')) return;
        deleteAddress(b.getAttribute('data-addr-del')); renderAddresses(box); toast('Address removed');
      });
    });
  }

  function renderAddressForm(box, editId) {
    var existing = editId ? getAddressById(editId) : null;
    box.innerHTML =
      '<h4 class="dcal-co-h" style="font-size:16px;margin:0 0 14px">' + (existing ? 'Edit address' : 'Add a new address') + '</h4>' +
      addressFormHTML(existing, 'drawer') +
      '<div style="display:flex;gap:10px;margin-top:8px">' +
        '<button class="dcal-btn dcal-addr-save">Save address</button>' +
        '<button type="button" class="dcal-link-btn dcal-addr-cancel" style="white-space:nowrap">Cancel</button>' +
      '</div>';
    wireAddressForm('drawer');
    box.querySelector('.dcal-addr-cancel').addEventListener('click', function () { renderAddresses(box); });
    box.querySelector('.dcal-addr-save').addEventListener('click', function () {
      var addr = readAddressForm('drawer');
      var err = box.querySelector('[data-addr-err]');
      var msg = validateAddress(addr);
      if (msg) { err.textContent = msg; return; }
      saveAddress(addr);
      renderAddresses(box);
      toast(existing ? 'Address updated' : 'Address saved');
    });
  }

  function renderOrders(box) {
    var list = orders();
    if (!list.length) {
      box.innerHTML = '<div class="dcal-empty">' + IC.bag + '<p>You haven’t placed any orders yet.</p><a class="dcal-btn" href="' + rel('html/collection.html') + '" style="text-decoration:none">Start shopping</a></div>';
      return;
    }
    box.innerHTML = list.map(function (o, idx) {
      var st = o.status || 'Confirmed';
      return '<div class="dcal-order">' +
        '<button type="button" class="dcal-order__head" data-ord="' + idx + '">' +
          (o.image ? '<img src="' + esc(o.image) + '" alt="">' : '') +
          '<div class="dcal-order__main">' +
            '<p class="dcal-card__t">' + esc(o.title || ('Order #' + o.id)) + '</p>' +
            '<p class="dcal-card__s">Order #' + esc(o.id) + ' · ' + new Date(o.date).toLocaleDateString() + '</p>' +
            '<p class="dcal-card__s">' + esc(o.total || '') + ' · <span class="dcal-order__badge dcal-order__badge--' + st.toLowerCase() + '">' + esc(st) + '</span></p>' +
          '</div>' +
          '<span class="dcal-order__chev">' + IC.chev + '</span>' +
        '</button>' +
        '<div class="dcal-order__detail" data-ord-detail="' + idx + '" hidden>' + orderDetailHTML(o) + '</div>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-ord]').forEach(function (btn) {
      var idx = btn.getAttribute('data-ord');
      var detail = box.querySelector('[data-ord-detail="' + idx + '"]');
      if (!detail) return;
      btn.addEventListener('click', function () {
        var open = !detail.hasAttribute('hidden');
        if (open) { detail.setAttribute('hidden', ''); btn.classList.remove('open'); }
        else { detail.removeAttribute('hidden'); btn.classList.add('open'); }
      });
    });

    // ---- cancel-order wiring ----
    box.querySelectorAll('[data-cancel-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cancel-open');
        var panel = box.querySelector('[data-cancel-panel="' + id + '"]');
        if (panel) { panel.removeAttribute('hidden'); b.setAttribute('hidden', ''); }
      });
    });
    box.querySelectorAll('[data-cancel-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cancel-close');
        var panel = box.querySelector('[data-cancel-panel="' + id + '"]');
        var opener = box.querySelector('[data-cancel-open="' + id + '"]');
        if (panel) panel.setAttribute('hidden', '');
        if (opener) opener.removeAttribute('hidden');
      });
    });
    box.querySelectorAll('[data-cancel-confirm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cancel-confirm');
        var sel = box.querySelector('[data-cancel-reason="' + id + '"]');
        var reason = sel ? sel.value : '';
        if (!window.confirm('Are you sure you want to cancel this order? This cannot be undone.')) return;
        doCancelOrder(id, reason, box);
      });
    });
  }

  var CANCEL_REASONS = [
    'Ordered by mistake', 'Found a better price elsewhere', 'Delivery is taking too long',
    'Want to change address or payment', 'Item no longer needed', 'Other'
  ];
  function orderCancellable(o) { var s = o.status || 'Confirmed'; return s === 'Confirmed' || s === 'Processing'; }

  function cancelLocalOrder(orderId, reason) {
    var list = orders();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(orderId)) {
        list[i].status = 'Cancelled';
        list[i].cancelReason = reason;
        list[i].cancelledAt = Date.now();
        list[i].refundStatus = list[i].paid ? 'Refund initiated' : 'No payment taken';
        break;
      }
    }
    saveOrders(list);
  }
  function doCancelOrder(orderId, reason, box) {
    cancelLocalOrder(orderId, reason);              // update this device immediately
    toast('Order cancelled');
    api('PUT', '/api/orders/' + encodeURIComponent(orderId) + '/cancel',
      { mobile: sessionMobile(), reason: reason }).catch(function () {});   // sync to the central DB
    renderOrders(box);
  }

  function orderDetailHTML(o) {
    var html = '';
    if (o.items && o.items.length) {
      html += '<div class="dcal-order__sec"><h4 class="dcal-order__h4">Items</h4>' +
        o.items.map(function (it) {
          return '<div class="dcal-order__item"><span>' + esc(it.title) + ' × ' + (it.qty || 1) + '</span>' +
            '<b>' + money(priceNum(it.price) * (it.qty || 1)) + '</b></div>';
        }).join('') + '</div>';
    }
    if (o.address && o.address.line) {
      var a = o.address;
      html += '<div class="dcal-order__sec"><h4 class="dcal-order__h4">Delivery address</h4>' +
        '<p class="dcal-order__addr"><b>' + esc(a.name || '') + '</b>' + (a.phone ? ' · ' + esc(a.phone) : '') + '<br>' +
        [a.line, [a.city, a.state].filter(Boolean).join(', '), a.pincode, a.landmark ? 'Landmark: ' + a.landmark : '']
          .filter(Boolean).map(esc).join('<br>') + '</p></div>';
    }
    if (o.discount > 0) {
      html += '<div class="dcal-order__sec dcal-order__sec--row"><h4 class="dcal-order__h4" style="margin:0">Discount</h4>' +
        '<span class="dcal-order__pay" style="color:#0B6E4F">−' + money(o.discount) + (o.coupon ? ' (' + esc(o.coupon) + ')' : '') + '</span></div>';
    }
    if (o.payment) {
      html += '<div class="dcal-order__sec dcal-order__sec--row"><h4 class="dcal-order__h4" style="margin:0">Payment</h4>' +
        '<span class="dcal-order__pay">' + esc(o.payment) + (o.paid ? ' · Paid ✓' : '') + '</span></div>';
    }
    if ((o.status || '') === 'Cancelled') {
      html += '<div class="dcal-order__sec dcal-cancel-info"><h4 class="dcal-order__h4">Cancellation</h4>' +
        '<p class="dcal-order__addr">Status: <b style="color:#DC2626">Cancelled</b>' +
        (o.cancelReason ? '<br>Reason: ' + esc(o.cancelReason) : '') +
        (o.refundStatus ? '<br>Refund: <b>' + esc(o.refundStatus) + '</b>' : '') + '</p></div>';
    } else if (orderCancellable(o)) {
      html += '<div class="dcal-order__sec">' +
        '<button type="button" class="dcal-link-btn dcal-link-btn--danger" data-cancel-open="' + esc(o.id) + '">Cancel this order</button>' +
        '<div class="dcal-cancel-panel" data-cancel-panel="' + esc(o.id) + '" hidden>' +
          '<label class="dcal-label" style="margin:10px 0 6px">Why are you cancelling?</label>' +
          '<select class="dcal-input" style="margin-bottom:12px" data-cancel-reason="' + esc(o.id) + '">' +
            CANCEL_REASONS.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') +
          '</select>' +
          '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
            '<button type="button" class="dcal-btn dcal-btn--danger" data-cancel-confirm="' + esc(o.id) + '" style="width:auto;padding-left:22px;padding-right:22px">Confirm cancellation</button>' +
            '<button type="button" class="dcal-link-btn" data-cancel-close="' + esc(o.id) + '">Keep order</button>' +
          '</div>' +
          '<p class="dcal-cancel-note">' + (o.paid ? 'Your payment will be refunded in 5–7 business days.' : 'No payment was taken (Cash on Delivery).') + '</p>' +
        '</div></div>';
    }
    return html;
  }

  /* resolve a root-relative path from the current page depth */
  function rel(rootPath) {
    // pages live either at site root (index.html) or in /html/
    var inSub = /\/html\//.test(location.pathname);
    return (inSub ? '../' : '') + rootPath;
  }

  /* ====================================================
     HEADER INTEGRATION
     ==================================================== */
  var CARET = '<svg class="dcal-acct-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var PERSON_ICON = '<svg class="icon dcal-acct-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>';

  function renderAcctMenu(menu) {
    var u = currentUser();
    if (u) {
      menu.innerHTML =
        '<div class="dcal-acct-menu__greet"><b>' + esc(u.name) + '</b><span>+91 ' + esc(u.mobile) + '</span></div>' +
        '<button class="dcal-acct-item" data-ai="profile">' + IC.user + ' My Profile</button>' +
        '<button class="dcal-acct-item" data-ai="addresses">' + IC.pin + ' My Addresses</button>' +
        '<button class="dcal-acct-item" data-ai="orders">' + IC.bag + ' My Orders</button>' +
        '<button class="dcal-acct-item dcal-acct-item--danger" data-ai="logout">' + IC.logout + ' Logout</button>';
    } else {
      menu.innerHTML =
        '<div class="dcal-acct-menu__signup"><span>New customer?</span><button data-ai="signup">Sign Up</button></div>' +
        '<button class="dcal-acct-item" data-ai="login">' + IC.user + ' Login</button>' +
        '<button class="dcal-acct-item" data-ai="orders">' + IC.bag + ' My Orders</button>';
    }
  }

  function updateHeader() {
    var icons = document.querySelectorAll('.header__icon--account');
    var u = currentUser();
    icons.forEach(function (a) {
      var wrap = a.closest('.dcal-acct');
      // one-time: wrap icon in a flex trigger + build the dropdown
      if (!wrap) {
        wrap = document.createElement('div'); wrap.className = 'dcal-acct';
        a.parentNode.insertBefore(wrap, a);
        var trigger = document.createElement('div'); trigger.className = 'dcal-acct-trigger';
        wrap.appendChild(trigger);
        trigger.appendChild(a);                                  // icon anchor
        var label = document.createElement('span'); label.className = 'dcal-acct-label'; trigger.appendChild(label);
        trigger.appendChild(el(CARET));                          // caret as sibling
        var menu = document.createElement('div'); menu.className = 'dcal-acct-menu'; wrap.appendChild(menu);
        a._dcalLabel = label; a._dcalMenu = menu;

        var hideTimer;
        wrap.addEventListener('mouseenter', function () {
          if (window.innerWidth < 990) return;
          clearTimeout(hideTimer); renderAcctMenu(menu); wrap.classList.add('open');
        });
        wrap.addEventListener('mouseleave', function () {
          hideTimer = setTimeout(function () { wrap.classList.remove('open'); }, 160);
        });
        trigger.addEventListener('click', function (e) {
          e.preventDefault();
          if (window.innerWidth < 990) { isLoggedIn() ? openProfile() : openAuth(); return; }
          if (isLoggedIn()) { renderAcctMenu(menu); wrap.classList.toggle('open'); }
          else openAuth();
        });
        menu.addEventListener('click', function (e) {
          var it = e.target.closest('[data-ai]'); if (!it) return;
          wrap.classList.remove('open');
          var act = it.getAttribute('data-ai');
          if (act === 'logout') logout();
          else if (act === 'profile') openProfile();
          else if (act === 'addresses') isLoggedIn() ? openProfile('addresses') : openAuth();
          else if (act === 'orders') isLoggedIn() ? openProfile('orders') : openAuth();
          else openAuth(); // login / signup
        });
      }

      // refresh visible label and icon/avatar
      var svgWrap = a.querySelector('.svg-wrapper');
      var label = a._dcalLabel;
      var vh = a.querySelector('.visually-hidden');

      if (u) {
        if (svgWrap) svgWrap.innerHTML = u.avatar ? '<span class="dcal-avatar-btn"><img src="' + u.avatar + '" alt=""></span>' : '<span class="dcal-avatar-btn">' + esc(initials(u.name)) + '</span>';
        if (label) label.textContent = (u.name || 'Account').split(' ')[0];
        if (vh) vh.textContent = 'Your account';
        a.setAttribute('title', u.name);
      } else {
        if (svgWrap) svgWrap.innerHTML = PERSON_ICON;
        if (label) label.textContent = 'Login';
        if (vh) vh.textContent = 'Login / Sign up';
        a.setAttribute('title', 'Login / Sign up');
      }
    });
  }

  // close the account dropdown when clicking elsewhere
  document.addEventListener('click', function (e) {
    if (e.target.closest('.dcal-acct')) return;
    document.querySelectorAll('.dcal-acct.open').forEach(function (w) { w.classList.remove('open'); });
  });

  /* ====================================================
     GATING — actions that require login
     ==================================================== */
  var GATES = [
    { sel: '[data-pp-atc], button[name="add"], .product-form__submit, [data-dcal-gate="cart"]', action: 'cart' },
    { sel: '[data-pp-buynow], button[name="checkout"], [name="checkout"], #checkout, .cart__checkout-button, [data-dcal-gate="checkout"]', action: 'checkout' }
  ];

  function matchGate(target) {
    for (var i = 0; i < GATES.length; i++) {
      if (target.closest(GATES[i].sel)) return GATES[i];
    }
    return null;
  }

  // capture-phase interception so we beat the page's own (dead) form submit
  document.addEventListener('click', function (e) {
    var gate = matchGate(e.target);
    if (!gate) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var run = gate.action === 'checkout' ? doBuyNow : doAddToCart;
    if (!isLoggedIn()) { pendingAction = run; openAuth(); }
    else run();
  }, true);

  /* ====================================================
     CART + CHECKOUT (client-side, static demo)
     ==================================================== */
  // read product details from the current product page
  function pageProduct() {
    var t = document.querySelector('#MainContent h1.h-section, #MainContent .product__title, [data-pp-title]')
         || document.querySelector('#MainContent h1');
    var p = document.querySelector('[data-pp-price], [data-pp-atc-price], #MainContent .price-item');
    var img = document.querySelector('[data-pp-main], #MainContent .product__media img, #MainContent .product-media img, #MainContent img');
    var title = t ? t.textContent.trim() : (document.title.split('—')[0].trim() || 'D’Cal product');
    return {
      id: title,
      title: title.slice(0, 80),
      price: p ? p.textContent.trim().replace(/\s+/g, ' ') : '',
      image: img ? (img.getAttribute('src') || '') : '',
      qty: 1
    };
  }

  function doAddToCart() {
    var p = pageProduct();
    var cart = cartGet();
    var found = null;
    for (var i = 0; i < cart.length; i++) { if (cart[i].id === p.id) { found = cart[i]; break; } }
    if (found) found.qty = (found.qty || 1) + 1; else cart.push(p);
    cartSave(cart);
    updateCartBubbles();
    toast('Added to cart ✓');
    // take the user to the cart page to review their order
    var cartUrl = /\/html\//.test(location.pathname) ? 'cart.html' : 'html/cart.html';
    setTimeout(function () { location.href = cartUrl; }, 500);
  }

  // "Buy now" -> add the product to the cart and go to the cart,
  // where the customer continues through Address -> Summary -> Payment.
  function doBuyNow() {
    doAddToCart();
  }

  function updateCartBubbles() {
    var n = cartCount();
    document.querySelectorAll('.cart-count-bubble').forEach(function (b) {
      var s = b.querySelector('span') || b;
      s.textContent = n;
      b.style.display = n > 0 ? '' : 'none';   // hide the bubble when the cart is empty / guest
    });
  }

  function priceNum(s) { var n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; }
  function money(n) { return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var CART_ICON = '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>';

  function emptyCartHTML() {
    return '<div class="glass" style="max-width:560px;margin:0 auto;padding:48px;text-align:center;background:#fff">' +
      '<div style="color:#0077B6;display:flex;justify-content:center">' + CART_ICON + '</div>' +
      '<h2 style="font-size:24px;font-weight:700;margin:14px 0 8px">Your cart is empty</h2>' +
      '<p class="lead" style="margin:0 auto 24px">Looks like you haven’t added anything yet.</p>' +
      '<a href="collection.html" class="dcal-btn" style="display:inline-flex;width:auto;text-decoration:none">Shop D’Cal →</a></div>';
  }

  function cartItemHTML(item, i) {
    return '<div class="dcal-cart-item">' +
      (item.image ? '<img src="' + esc(item.image) + '" alt="">' : '<div class="dcal-ci-noimg">' + CART_ICON + '</div>') +
      '<div class="dcal-ci-info"><p class="dcal-ci-title">' + esc(item.title) + '</p><p class="dcal-ci-price">' + esc(item.price || '') + ' each</p></div>' +
      '<div class="dcal-qty"><button data-qm="' + i + '" aria-label="Decrease">−</button><span>' + (item.qty || 1) + '</span><button data-qp="' + i + '" aria-label="Increase">+</button></div>' +
      '<div class="dcal-ci-sub">' + money(priceNum(item.price) * (item.qty || 1)) + '</div>' +
      '<button class="dcal-ci-rm" data-rm="' + i + '" aria-label="Remove">×</button>' +
      '</div>';
  }

  function renderCartPage() {
    var root = document.getElementById('dcal-cart-root');
    if (!root) return;
    var cart = cartGet();
    if (!cart.length) { root.innerHTML = emptyCartHTML(); return; }
    var subtotal = cart.reduce(function (s, i) { return s + priceNum(i.price) * (i.qty || 1); }, 0);
    root.innerHTML =
      '<div class="dcal-cart-grid">' +
        '<div class="dcal-cart-items">' + cart.map(cartItemHTML).join('') + '</div>' +
        '<aside class="dcal-cart-summary">' +
          '<h3>Order Summary</h3>' +
          summaryBodyHTML(subtotal) +
          '<button class="dcal-btn dcal-cart-checkout">Proceed to Checkout</button>' +
          '<a class="dcal-cart-continue" href="collection.html">Continue shopping</a>' +
        '</aside>' +
      '</div>';

    root.querySelectorAll('[data-qp]').forEach(function (b) { b.onclick = function () { var c = cartGet(); var k = +b.getAttribute('data-qp'); c[k].qty = (c[k].qty || 1) + 1; cartSave(c); updateCartBubbles(); renderCartPage(); }; });
    root.querySelectorAll('[data-qm]').forEach(function (b) { b.onclick = function () { var c = cartGet(); var k = +b.getAttribute('data-qm'); c[k].qty = (c[k].qty || 1) - 1; if (c[k].qty < 1) c.splice(k, 1); cartSave(c); updateCartBubbles(); renderCartPage(); }; });
    root.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { var c = cartGet(); c.splice(+b.getAttribute('data-rm'), 1); cartSave(c); updateCartBubbles(); renderCartPage(); toast('Removed from cart'); }; });
    root.querySelector('.dcal-cart-checkout').addEventListener('click', function () { window.DcalAuth.require(startCheckout); });
    wireCoupon(root, renderCartPage);
  }

  /* ====================================================
     MULTI-STEP CHECKOUT  (Address → Order Summary → Payment)
     ==================================================== */
  var checkout = { address: null, addressId: null, payment: 'upi' };

  var PAY_METHODS = [
    { id: 'upi',     label: 'UPI',              note: 'Google Pay, PhonePe, Paytm & more' },
    { id: 'card',    label: 'Credit / Debit Card', note: 'Visa, Mastercard, RuPay' },
    { id: 'netbanking', label: 'Net Banking',   note: 'All major Indian banks' },
    { id: 'cod',     label: 'Cash on Delivery', note: 'Pay when your order arrives' }
  ];

  /* ---------- COUPONS ---------- */
  var COUPONS = {
    DCAL10:  { type: 'percent', value: 10, desc: '10% off' },
    DCAL200: { type: 'flat',    value: 200, min: 2000, desc: '₹200 off orders over ₹2,000' }
  };
  function getCouponCode() { try { return (localStorage.getItem('dcal_coupon') || '').toUpperCase(); } catch (e) { return ''; } }
  function setCouponCode(c) { try { if (c) localStorage.setItem('dcal_coupon', c.toUpperCase()); else localStorage.removeItem('dcal_coupon'); } catch (e) {} }
  function computeTotals(subtotal) {
    var code = getCouponCode(), c = COUPONS[code], discount = 0;
    if (c && (!c.min || subtotal >= c.min)) {
      discount = c.type === 'percent' ? Math.round(subtotal * c.value / 100) : c.value;
      if (discount > subtotal) discount = subtotal;
    } else { code = ''; }
    return { subtotal: subtotal, code: code, discount: discount, total: subtotal - discount };
  }
  function cartTotal() { return computeTotals(cartSubtotal()).total; }

  function couponBoxHTML(t) {
    if (t.code && t.discount > 0) {
      return '<div class="dcal-coupon"><div class="dcal-coupon-ok"><span>✓ <b>' + esc(t.code) + '</b> applied</span>' +
        '<button type="button" data-coupon-remove>Remove</button></div></div>';
    }
    return '<div class="dcal-coupon">' +
      '<div class="dcal-coupon-row"><input class="dcal-input" data-coupon-input placeholder="Coupon code (e.g. DCAL10)" maxlength="20" style="margin-bottom:0"><button type="button" class="dcal-coupon-apply" data-coupon-apply>Apply</button></div>' +
      '<div class="dcal-coupon-msg" data-coupon-msg></div></div>';
  }
  function summaryBodyHTML(subtotal) {
    var t = computeTotals(subtotal), n = cartCount();
    return '<div class="dcal-sum-row"><span>Subtotal (' + n + ' item' + (n > 1 ? 's' : '') + ')</span><b>' + money(t.subtotal) + '</b></div>' +
      '<div class="dcal-sum-row"><span>Shipping</span><b style="color:#0B6E4F">Free</b></div>' +
      couponBoxHTML(t) +
      (t.discount > 0 ? '<div class="dcal-sum-row"><span>Discount (' + esc(t.code) + ')</span><b style="color:#0B6E4F">−' + money(t.discount) + '</b></div>' : '') +
      '<div class="dcal-sum-row dcal-sum-total"><span>Total</span><b>' + money(t.total) + '</b></div>';
  }
  function wireCoupon(root, rerender) {
    var apply = root.querySelector('[data-coupon-apply]');
    if (apply) apply.addEventListener('click', function () {
      var inp = root.querySelector('[data-coupon-input]');
      var code = (inp ? inp.value : '').trim().toUpperCase();
      var msg = root.querySelector('[data-coupon-msg]');
      if (!code) { if (msg) { msg.textContent = 'Please enter a coupon code.'; msg.className = 'dcal-coupon-msg err'; } return; }
      var c = COUPONS[code];
      if (!c) { if (msg) { msg.textContent = 'Invalid or expired coupon code.'; msg.className = 'dcal-coupon-msg err'; } return; }
      if (c.min && cartSubtotal() < c.min) { if (msg) { msg.textContent = 'Add items worth ' + money(c.min) + ' to use this code.'; msg.className = 'dcal-coupon-msg err'; } return; }
      setCouponCode(code); toast('Coupon ' + code + ' applied 🎉'); rerender();
    });
    var rm = root.querySelector('[data-coupon-remove]');
    if (rm) rm.addEventListener('click', function () { setCouponCode(''); toast('Coupon removed'); rerender(); });
    var inp = root.querySelector('[data-coupon-input]');
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (apply) apply.click(); } });
  }

  /* ---------- ADDRESS BOOK (multiple addresses per user) ---------- */
  function newAddrId() { return 'addr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // returns the user's address list, migrating any legacy single `address` field
  function getAddresses() {
    var m = sessionMobile(); if (!m) return [];
    var u = users(); var rec = u[m]; if (!rec) return [];
    if (!Array.isArray(rec.addresses)) {
      rec.addresses = [];
      if (rec.address && rec.address.line) {              // migrate old single address
        var legacy = rec.address; legacy.id = newAddrId();
        rec.addresses.push(legacy);
        rec.defaultAddressId = legacy.id;
      }
      delete rec.address;
      saveUsers(u);
    }
    return rec.addresses;
  }
  function getDefaultAddress() {
    var list = getAddresses(); if (!list.length) return null;
    var m = sessionMobile(); var rec = users()[m] || {};
    return list.filter(function (a) { return a.id === rec.defaultAddressId; })[0] || list[0];
  }
  function getAddressById(id) { return getAddresses().filter(function (a) { return a.id === id; })[0] || null; }

  function saveAddress(addr) {                            // add or update; returns id
    var m = sessionMobile(); if (!m) return null;
    var u = users(); var rec = u[m]; if (!rec) return null;
    if (!Array.isArray(rec.addresses)) rec.addresses = getAddresses();
    if (addr.id) {
      for (var i = 0; i < rec.addresses.length; i++) {
        if (rec.addresses[i].id === addr.id) { rec.addresses[i] = addr; break; }
      }
    } else {
      addr.id = newAddrId();
      rec.addresses.push(addr);
      if (!rec.defaultAddressId) rec.defaultAddressId = addr.id;
    }
    saveUsers(u);
    syncAddresses(m);
    return addr.id;
  }
  function deleteAddress(id) {
    var m = sessionMobile(); if (!m) return;
    var u = users(); var rec = u[m]; if (!rec || !Array.isArray(rec.addresses)) return;
    rec.addresses = rec.addresses.filter(function (a) { return a.id !== id; });
    if (rec.defaultAddressId === id) rec.defaultAddressId = (rec.addresses[0] || {}).id || null;
    saveUsers(u);
    syncAddresses(m);
  }
  function setDefaultAddress(id) {
    var m = sessionMobile(); if (!m) return;
    var u = users(); if (u[m]) { u[m].defaultAddressId = id; saveUsers(u); syncAddresses(m); }
  }
  function isDefaultAddress(id) {
    var m = sessionMobile(); return !!m && (users()[m] || {}).defaultAddressId === id;
  }

  // all 28 states + 8 union territories
  var INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
    'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
    'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
    'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
    'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
  ];

  function coSelect(label, key, val, options, required) {
    var opts = options.slice();
    if (val && opts.indexOf(val) === -1) opts.unshift(val);   // keep any legacy/free-text value
    return '<div class="dcal-co-field"><label class="dcal-label">' + esc(label) + (required ? ' <span class="dcal-req">*</span>' : '') + '</label>' +
      '<select class="dcal-input" style="margin-bottom:0" data-co="' + key + '">' +
        '<option value="">Select state…</option>' +
        opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
      '</select></div>';
  }
  function cityOptionsHTML(list, current) {
    var html = '<option value="">' + (list.length ? 'Select your city / area…' : 'Enter pincode to load areas…') + '</option>';
    var seen = {};
    list.forEach(function (n) {
      if (!n) return; var k = n.toLowerCase(); if (seen[k]) return; seen[k] = 1;
      html += '<option value="' + esc(n) + '"' + (n === current ? ' selected' : '') + '>' + esc(n) + '</option>';
    });
    html += '<option value="__other__">✏️ Other — type manually</option>';
    return html;
  }
  function cityField(val) {
    return '<div class="dcal-co-field"><label class="dcal-label">City / Area <span class="dcal-req">*</span></label>' +
      '<select class="dcal-input" style="margin-bottom:0" data-co="city">' + cityOptionsHTML(val ? [val] : [], val) + '</select></div>';
  }
  // swap the city <select> for a free-text box (for "Other", or when offline)
  function cityToText(box, val) {
    var sel = box.querySelector('[data-co="city"]'); if (!sel) return;
    var inp = document.createElement('input');
    inp.className = 'dcal-input'; inp.type = 'text'; inp.style.marginBottom = '0';
    inp.setAttribute('data-co', 'city'); inp.setAttribute('autocomplete', 'off');
    inp.value = (val && val !== '__other__') ? val : '';
    inp.placeholder = 'Enter your city / area';
    sel.parentNode.replaceChild(inp, sel);
    inp.focus();
  }

  // shared address form fields + read/validate (used in checkout AND profile drawer)
  function addressFormHTML(a, scope) {
    a = a || {};
    return '<div data-addr-form="' + scope + '">' +
      '<div class="dcal-co-grid2">' +
        coField('Full name', 'name', a.name || '', 'text', true) +
        coField('Mobile number', 'phone', a.phone || '', 'tel', true) +
      '</div>' +
      coField('Address (House no., street, area)', 'line', a.line || '', 'text', true) +
      '<div class="dcal-co-grid2">' +
        coField('Pincode', 'pincode', a.pincode || '', 'tel', true) +
        coSelect('State', 'state', a.state || '', INDIAN_STATES, true) +
      '</div>' +
      '<div class="dcal-pin-note" data-pin-note></div>' +
      '<div class="dcal-co-grid2">' +
        cityField(a.city || '') +
        coField('Landmark (optional)', 'landmark', a.landmark || '', 'text', false) +
      '</div>' +
      (a.id ? '<input type="hidden" data-co="id" value="' + esc(a.id) + '">' : '') +
      '<div class="dcal-err" data-addr-err style="margin-top:4px"></div></div>';
  }
  function readAddressForm(scope) {
    var box = document.querySelector('[data-addr-form="' + scope + '"]'); if (!box) return null;
    var get = function (k) { var f = box.querySelector('[data-co="' + k + '"]'); return f ? f.value.trim() : ''; };
    var addr = { name: get('name'), phone: get('phone'), line: get('line'),
      city: get('city'), state: get('state'), pincode: get('pincode'), landmark: get('landmark') };
    if (addr.city === '__other__') addr.city = '';
    var id = get('id'); if (id) addr.id = id;
    return addr;
  }
  function validateAddress(addr) {
    if (addr.name.length < 2) return 'Please enter your full name.';
    if (!/^\d{10}$/.test(addr.phone)) return 'Mobile number must be exactly 10 digits.';
    if (addr.line.length < 5) return 'Please enter your full address.';
    if (!/^\d{6}$/.test(addr.pincode)) return 'Pincode must be exactly 6 digits.';
    if (!addr.state) return 'Please select your state.';
    if (!addr.city) return 'Please enter your city / district.';
    return '';
  }

  // restrict an input to digits only, with a max length
  function digitsOnly(input, max) {
    if (!input) return;
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('maxlength', String(max));
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '').slice(0, max);
      if (v !== input.value) input.value = v;
    });
  }
  // wire phone/pincode rules + pincode -> city/state auto-detect (India Post API)
  function wireAddressForm(scope) {
    var box = document.querySelector('[data-addr-form="' + scope + '"]'); if (!box) return;
    digitsOnly(box.querySelector('[data-co="phone"]'), 10);
    var pin = box.querySelector('[data-co="pincode"]');
    digitsOnly(pin, 6);
    if (pin) pin.addEventListener('input', function () { if (pin.value.length === 6) lookupPincode(scope, pin.value); });
    var citySel = box.querySelector('select[data-co="city"]');
    if (citySel) citySel.addEventListener('change', function () { if (citySel.value === '__other__') cityToText(box, ''); });
  }
  function setSelectValue(sel, val) {
    if (!sel || !val) return false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value.toLowerCase() === String(val).toLowerCase()) { sel.selectedIndex = i; return true; }
    }
    return false;
  }
  function lookupPincode(scope, pin) {
    var box = document.querySelector('[data-addr-form="' + scope + '"]'); if (!box) return;
    var note = box.querySelector('[data-pin-note]');
    if (note) { note.className = 'dcal-pin-note'; note.textContent = 'Detecting location…'; }
    fetch('https://api.postalpincode.in/pincode/' + pin)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var rec = data && data[0];
        if (!rec || rec.Status !== 'Success' || !rec.PostOffice || !rec.PostOffice.length) {
          if (note) { note.className = 'dcal-pin-note dcal-pin-note--warn'; note.textContent = 'Pincode not found — please fill city & state manually.'; }
          return;
        }
        var pos = rec.PostOffice;
        var state = pos[0].State, district = pos[0].District;
        setSelectValue(box.querySelector('[data-co="state"]'), state);
        var citySel = box.querySelector('select[data-co="city"]');
        if (citySel) {
          var current = (citySel.value && citySel.value !== '__other__') ? citySel.value : '';
          citySel.innerHTML = cityOptionsHTML([district].concat(pos.map(function (p) { return p.Name; })), current);
          if (!citySel.value) setSelectValue(citySel, district);
        }
        if (note) { note.className = 'dcal-pin-note dcal-pin-note--ok'; note.textContent = '✓ ' + district + ', ' + state + ' — now pick your area from the City dropdown.'; }
      })
      .catch(function () {
        if (note) { note.className = 'dcal-pin-note dcal-pin-note--warn'; note.textContent = 'Could not auto-detect — please fill city & state manually.'; }
      });
  }

  function cartSubtotal() {
    return cartGet().reduce(function (s, i) { return s + priceNum(i.price) * (i.qty || 1); }, 0);
  }

  function coStepper(active) {
    var steps = ['Address', 'Order Summary', 'Payment'];
    return '<div class="dcal-co-steps">' + steps.map(function (s, i) {
      var cls = i < active ? 'done' : (i === active ? 'active' : '');
      return '<div class="dcal-co-step ' + cls + '">' +
        '<span class="dcal-co-num">' + (i < active ? '✓' : (i + 1)) + '</span>' +
        '<span class="dcal-co-lbl">' + s + '</span></div>' +
        (i < steps.length - 1 ? '<span class="dcal-co-line"></span>' : '');
    }).join('') + '</div>';
  }

  function coShell(active, inner) {
    var root = document.getElementById('dcal-cart-root');
    if (!root) return null;
    root.innerHTML = '<div class="dcal-checkout">' + coStepper(active) + inner + '</div>';
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return root;
  }

  function coField(label, key, val, type, required) {
    return '<div class="dcal-co-field"><label class="dcal-label">' + esc(label) + (required ? ' <span class="dcal-req">*</span>' : '') + '</label>' +
      '<input class="dcal-input" style="margin-bottom:0" type="' + type + '" data-co="' + key + '" value="' + esc(val) + '"></div>';
  }

  function addressLines(a) {
    return [a.line, [a.city, a.state].filter(Boolean).join(', '),
            (a.pincode || ''), a.landmark ? 'Landmark: ' + a.landmark : '']
      .filter(Boolean).map(esc).join('<br>');
  }

  function startCheckout() {
    if (!cartGet().length) return;
    coAddress();
  }

  /* ---------- STEP 1 — Address (pick saved, or add new) ---------- */
  function coAddress() {
    var list = getAddresses();
    if (!list.length) { coAddressForm(null); return; }   // first-time: straight to the form

    var selId = checkout.addressId || (getDefaultAddress() || {}).id || list[0].id;
    var root = coShell(0,
      '<div class="dcal-co-card">' +
        '<h3 class="dcal-co-h">Select a delivery address</h3>' +
        '<div class="dcal-addr-pick">' + list.map(function (a) {
          return '<label class="dcal-addr-opt' + (a.id === selId ? ' sel' : '') + '">' +
            '<input type="radio" name="dcal-addr" value="' + esc(a.id) + '"' + (a.id === selId ? ' checked' : '') + '>' +
            '<span class="dcal-pay-radio"></span>' +
            '<span class="dcal-addr-body">' +
              '<span class="dcal-addr-name">' + esc(a.name) + ' · ' + esc(a.phone) +
                (isDefaultAddress(a.id) ? ' <span class="dcal-addr-tag">Default</span>' : '') + '</span>' +
              '<span class="dcal-addr-lines">' + addressLines(a) + '</span>' +
              '<span class="dcal-addr-actions">' +
                '<button type="button" class="dcal-link-btn" data-addr-edit="' + esc(a.id) + '">Edit</button>' +
              '</span>' +
            '</span>' +
          '</label>';
        }).join('') + '</div>' +
        '<button type="button" class="dcal-addr-add" data-addr-new>+ Add a new address</button>' +
        '<div class="dcal-co-actions">' +
          '<a class="dcal-cart-continue" href="cart.html" style="margin-top:0">← Back to cart</a>' +
          '<button class="dcal-btn dcal-co-next" style="width:auto;padding-left:30px;padding-right:30px">Deliver here →</button>' +
        '</div>' +
      '</div>');
    if (!root) return;

    root.querySelectorAll('input[name="dcal-addr"]').forEach(function (r) {
      r.addEventListener('change', function () {
        checkout.addressId = r.value;
        root.querySelectorAll('.dcal-addr-opt').forEach(function (o) { o.classList.remove('sel'); });
        r.closest('.dcal-addr-opt').classList.add('sel');
      });
    });
    root.querySelectorAll('[data-addr-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); coAddressForm(b.getAttribute('data-addr-edit')); });
    });
    root.querySelector('[data-addr-new]').addEventListener('click', function () { coAddressForm(null); });
    root.querySelector('.dcal-co-next').addEventListener('click', function () {
      var sel = (root.querySelector('input[name="dcal-addr"]:checked') || {}).value || selId;
      checkout.addressId = sel;
      checkout.address = getAddressById(sel);
      if (!checkout.address) return;
      coSummary();
    });
  }

  // add-new / edit-existing address form within checkout
  function coAddressForm(editId) {
    var existing = editId ? getAddressById(editId) : null;
    var hasList = getAddresses().length > 0;
    var root = coShell(0,
      '<div class="dcal-co-card">' +
        '<h3 class="dcal-co-h">' + (existing ? 'Edit address' : 'Add a new address') + '</h3>' +
        addressFormHTML(existing, 'checkout') +
        '<div class="dcal-co-actions">' +
          '<button type="button" class="dcal-cart-continue dcal-co-cancel" style="margin-top:0;background:none;border:none;cursor:pointer">' +
            (hasList ? '← Back' : '← Back to cart') + '</button>' +
          '<button class="dcal-btn dcal-addr-save" style="width:auto;padding-left:30px;padding-right:30px">Save & continue →</button>' +
        '</div>' +
      '</div>');
    if (!root) return;
    wireAddressForm('checkout');
    var cancel = root.querySelector('.dcal-co-cancel');
    if (hasList) cancel.addEventListener('click', coAddress);
    else cancel.addEventListener('click', function () { location.href = 'cart.html'; });
    root.querySelector('.dcal-addr-save').addEventListener('click', function () {
      var addr = readAddressForm('checkout');
      var err = root.querySelector('[data-addr-err]');
      var msg = validateAddress(addr);
      if (msg) { err.textContent = msg; return; }
      err.textContent = '';
      var id = saveAddress(addr);
      checkout.addressId = id;
      checkout.address = getAddressById(id);
      coAddress();   // back to picker with the new/edited address selected
    });
  }

  /* ---------- STEP 2 — Order Summary ---------- */
  function coSummary() {
    var cart = cartGet(); if (!cart.length) return;
    var subtotal = cartSubtotal();
    var a = checkout.address || {};
    var root = coShell(1,
      '<div class="dcal-co-2col">' +
        '<div class="dcal-co-card">' +
          '<h3 class="dcal-co-h">Review your order</h3>' +
          '<div class="dcal-cart-items">' + cart.map(function (it) {
            return '<div class="dcal-cart-item" style="box-shadow:none">' +
              (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<div class="dcal-ci-noimg">' + CART_ICON + '</div>') +
              '<div class="dcal-ci-info"><p class="dcal-ci-title">' + esc(it.title) + '</p>' +
                '<p class="dcal-ci-price">Qty ' + (it.qty || 1) + ' × ' + esc(it.price || '') + '</p></div>' +
              '<div class="dcal-ci-sub">' + money(priceNum(it.price) * (it.qty || 1)) + '</div></div>';
          }).join('') + '</div>' +
          '<div class="dcal-co-ship">' +
            '<div class="dcal-co-ship-head"><span>Deliver to</span>' +
              '<button type="button" class="dcal-co-edit" data-co-edit>Change</button></div>' +
            '<p class="dcal-co-name">' + esc(a.name) + ' · ' + esc(a.phone) + '</p>' +
            '<p class="dcal-co-addr">' + addressLines(a) + '</p>' +
          '</div>' +
        '</div>' +
        '<aside class="dcal-cart-summary">' +
          '<h3>Order Summary</h3>' +
          summaryBodyHTML(subtotal) +
          '<button class="dcal-btn dcal-co-next">Continue to Payment →</button>' +
          '<button type="button" class="dcal-cart-continue dcal-co-back" style="background:none;border:none;cursor:pointer;width:100%">← Back to address</button>' +
        '</aside>' +
      '</div>');
    if (!root) return;
    root.querySelector('.dcal-co-next').addEventListener('click', coPayment);
    root.querySelector('.dcal-co-back').addEventListener('click', coAddress);
    root.querySelector('[data-co-edit]').addEventListener('click', coAddress);
    wireCoupon(root, coSummary);
  }

  /* ---------- STEP 3 — Payment ---------- */
  function coPayment() {
    var cart = cartGet(); if (!cart.length) return;
    var subtotal = cartSubtotal();
    var root = coShell(2,
      '<div class="dcal-co-2col">' +
        '<div class="dcal-co-card">' +
          '<h3 class="dcal-co-h">Payment method</h3>' +
          '<div class="dcal-pay-list">' + PAY_METHODS.map(function (p) {
            return '<label class="dcal-pay-opt' + (checkout.payment === p.id ? ' sel' : '') + '">' +
              '<input type="radio" name="dcal-pay" value="' + p.id + '"' + (checkout.payment === p.id ? ' checked' : '') + '>' +
              '<span class="dcal-pay-radio"></span>' +
              '<span class="dcal-pay-text"><b>' + esc(p.label) + '</b><span>' + esc(p.note) + '</span></span>' +
            '</label>';
          }).join('') + '</div>' +
          '<div class="dcal-pay-fields" data-pay-fields></div>' +
          '<p class="dcal-co-secure"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg> 100% Secure · Razorpay Protected</p>' +
        '</div>' +
        '<aside class="dcal-cart-summary">' +
          '<h3>Order Summary</h3>' +
          summaryBodyHTML(subtotal) +
          '<button class="dcal-btn dcal-co-place">Place Order · ' + money(computeTotals(subtotal).total) + '</button>' +
          '<button type="button" class="dcal-cart-continue dcal-co-back" style="background:none;border:none;cursor:pointer;width:100%">← Back to summary</button>' +
        '</aside>' +
      '</div>');
    if (!root) return;
    function syncPlaceLabel() {
      var b = root.querySelector('.dcal-co-place');
      if (b) b.textContent = (checkout.payment === 'cod' ? 'Place Order · ' : 'Pay Securely · ') + money(cartTotal());
    }
    root.querySelectorAll('input[name="dcal-pay"]').forEach(function (r) {
      r.addEventListener('change', function () {
        checkout.payment = r.value;
        root.querySelectorAll('.dcal-pay-opt').forEach(function (o) { o.classList.remove('sel'); });
        r.closest('.dcal-pay-opt').classList.add('sel');
        syncPlaceLabel();
        refreshPayFields();
      });
    });
    syncPlaceLabel();
    root.querySelector('.dcal-co-back').addEventListener('click', coSummary);
    root.querySelector('.dcal-co-place').addEventListener('click', handlePlaceOrder);
    wireCoupon(root, coPayment);
    // load whether real Razorpay is on; if not, show the demo card/UPI/bank fields
    loadPaymentConfig().then(refreshPayFields);
  }

  /* ---------- payment-detail fields (demo until Razorpay is configured) ---------- */
  var razorpayConfig = null;   // { enabled, keyId }
  function loadPaymentConfig() {
    if (razorpayConfig) return Promise.resolve(razorpayConfig);
    return api('GET', '/api/payment/config')
      .then(function (c) { razorpayConfig = c || { enabled: false }; return razorpayConfig; })
      .catch(function () { razorpayConfig = { enabled: false }; return razorpayConfig; });
  }
  function razorpayOn() { return !!(razorpayConfig && razorpayConfig.enabled); }

  var NETBANKS = ['HDFC Bank', 'State Bank of India', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
    'Punjab National Bank', 'Bank of Baroda', 'Yes Bank', 'IDFC FIRST Bank', 'Other'];

  function payFieldsHTML(method) {
    if (method === 'card') {
      return '<div class="dcal-pay-form">' +
        '<label class="dcal-label">Card number <span class="dcal-req">*</span></label>' +
        '<input class="dcal-input" data-pf="number" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456">' +
        '<label class="dcal-label">Name on card <span class="dcal-req">*</span></label>' +
        '<input class="dcal-input" data-pf="name" autocomplete="cc-name" placeholder="As printed on the card">' +
        '<div class="dcal-co-grid2">' +
          '<div class="dcal-co-field"><label class="dcal-label">Expiry (MM/YY) <span class="dcal-req">*</span></label><input class="dcal-input" style="margin-bottom:0" data-pf="exp" inputmode="numeric" placeholder="MM/YY"></div>' +
          '<div class="dcal-co-field"><label class="dcal-label">CVV <span class="dcal-req">*</span></label><input class="dcal-input" style="margin-bottom:0" data-pf="cvv" inputmode="numeric" type="password" placeholder="•••"></div>' +
        '</div>' +
        '<div class="dcal-err" data-pf-err style="margin-top:8px"></div></div>';
    }
    if (method === 'upi') {
      return '<div class="dcal-pay-form">' +
        '<label class="dcal-label">Your UPI ID <span class="dcal-req">*</span></label>' +
        '<input class="dcal-input" style="margin-bottom:0" data-pf="upi" placeholder="yourname@bank">' +
        '<div class="dcal-err" data-pf-err style="margin-top:8px"></div></div>';
    }
    if (method === 'netbanking') {
      return '<div class="dcal-pay-form">' +
        '<label class="dcal-label">Select your bank <span class="dcal-req">*</span></label>' +
        '<select class="dcal-input" style="margin-bottom:0" data-pf="bank"><option value="">Choose your bank…</option>' +
          NETBANKS.map(function (b) { return '<option>' + esc(b) + '</option>'; }).join('') + '</select>' +
        '<div class="dcal-err" data-pf-err style="margin-top:8px"></div></div>';
    }
    return '';   // COD: nothing to collect
  }

  function refreshPayFields() {
    var box = document.querySelector('[data-pay-fields]'); if (!box) return;
    // Razorpay handles card entry itself, so only show our fields in demo mode
    if (razorpayOn() || checkout.payment === 'cod') { box.innerHTML = ''; return; }
    box.innerHTML = payFieldsHTML(checkout.payment);
    wirePayFields();
  }

  function wirePayFields() {
    var box = document.querySelector('[data-pay-fields]'); if (!box) return;
    var num = box.querySelector('[data-pf="number"]');
    if (num) num.addEventListener('input', function () {
      var v = num.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
      num.value = v;
    });
    var exp = box.querySelector('[data-pf="exp"]');
    if (exp) exp.addEventListener('input', function () {
      var d = exp.value.replace(/\D/g, '').slice(0, 4);
      exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
    });
    var cvv = box.querySelector('[data-pf="cvv"]');
    if (cvv) cvv.addEventListener('input', function () { cvv.value = cvv.value.replace(/\D/g, '').slice(0, 4); });
  }

  function validatePayFields(method) {
    var box = document.querySelector('[data-pay-fields]'); if (!box) return '';
    function v(k) { var f = box.querySelector('[data-pf="' + k + '"]'); return f ? f.value.trim() : ''; }
    if (method === 'card') {
      if (v('number').replace(/\s/g, '').length < 12) return 'Enter a valid card number.';
      if (v('name').length < 2) return 'Enter the name on the card.';
      if (!/^\d{2}\/\d{2}$/.test(v('exp'))) return 'Enter expiry as MM/YY.';
      if (!/^\d{3,4}$/.test(v('cvv'))) return 'Enter a valid CVV.';
    } else if (method === 'upi') {
      if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v('upi'))) return 'Enter a valid UPI ID (e.g. name@bank).';
    } else if (method === 'netbanking') {
      if (!v('bank')) return 'Please select your bank.';
    }
    return '';
  }

  /* ---------- Razorpay payment ---------- */
  function loadRazorpay() {
    return new Promise(function (resolve) {
      if (window.Razorpay) return resolve(true);
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }
  function resetPlaceBtn() {
    var b = document.querySelector('.dcal-co-place');
    if (b) { b.disabled = false; b.textContent = 'Place Order · ' + money(cartTotal()); }
  }

  // decide between Cash on Delivery, real Razorpay, or the demo card/UPI/bank flow
  function handlePlaceOrder() {
    if (checkout.payment === 'cod') { placeCartOrder({ paid: false }); return; }
    if (razorpayOn()) { payWithRazorpay(cartTotal()); return; }
    // demo mode: validate the entered card/UPI/bank details, then place the order
    var err = validatePayFields(checkout.payment);
    var errBox = document.querySelector('[data-pf-err]');
    if (err) { if (errBox) { errBox.textContent = err; errBox.classList.add('show'); } return; }
    placeCartOrder({ paid: true, demo: true });   // simulated successful payment
  }

  function payWithRazorpay(subtotal) {
    var btn = document.querySelector('.dcal-co-place');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting secure payment…'; }
    api('POST', '/api/payment/create-order', { amount: subtotal, receipt: 'dcal_' + Date.now() })
      .then(function (order) {
        return loadRazorpay().then(function (ok) {
          if (!ok) throw new Error('Razorpay script failed to load');
          var u = currentUser() || {};
          var addr = checkout.address || {};
          var rzp = new window.Razorpay({
            key: order.keyId,
            amount: order.amount,
            currency: order.currency,
            name: "D'Cal",
            description: 'Order payment',
            order_id: order.orderId,
            prefill: { name: addr.name || u.name || '', email: u.email || '', contact: addr.phone || u.mobile || '' },
            theme: { color: '#0077B6' },
            handler: function (resp) {
              api('POST', '/api/payment/verify', resp).then(function (v) {
                if (v && v.valid) placeCartOrder({ paid: true, paymentId: resp.razorpay_payment_id });
                else { toast('Payment could not be verified. Please contact support.'); resetPlaceBtn(); }
              }).catch(function () { toast('Payment verification failed.'); resetPlaceBtn(); });
            },
            modal: { ondismiss: resetPlaceBtn }
          });
          rzp.on('payment.failed', function () { toast('Payment failed. Please try again.'); resetPlaceBtn(); });
          rzp.open();
        });
      })
      .catch(function () {
        // Razorpay not set up yet (or server offline) -> complete as a demo order
        toast('Online payment not set up yet — placing as demo order.');
        placeCartOrder({ paid: false, demo: true });
      });
  }

  /* ---------- Place the order ---------- */
  function placeCartOrder(payInfo) {
    payInfo = payInfo || {};
    var cart = cartGet(); if (!cart.length) return;
    var t = computeTotals(cartSubtotal());
    var addr = checkout.address || getDefaultAddress() || {};
    var payLabel = (PAY_METHODS.filter(function (p) { return p.id === checkout.payment; })[0] || {}).label || 'UPI';
    var orderId = String(Date.now()).slice(-8);
    var list = orders();
    list.unshift({
      id: orderId,
      title: cart[0].title + (cart.length > 1 ? ' + ' + (cart.length - 1) + ' more' : ''),
      total: money(t.total), image: cart[0].image, items: cart.slice(),
      address: addr, payment: payLabel,
      coupon: t.code, discount: t.discount,
      paid: !!payInfo.paid, paymentId: payInfo.paymentId || '',
      date: Date.now(), status: 'Confirmed'
    });
    saveOrders(list);
    pushOrder(list[0], sessionMobile());   // save the order to the central database
    cartSave([]); setCouponCode(''); updateCartBubbles();
    checkout = { address: null, addressId: null, payment: 'upi' };
    var payNote = payInfo.paid
      ? 'Paid online via <b>' + esc(payLabel) + '</b> ✓'
      : (checkout.payment === 'cod' || payLabel === 'Cash on Delivery'
          ? 'Payment: <b>Cash on Delivery</b>'
          : 'Payment: <b>' + esc(payLabel) + '</b>');
    var root = document.getElementById('dcal-cart-root');
    if (root) root.innerHTML =
      '<div class="glass" style="max-width:560px;margin:0 auto;padding:48px;text-align:center;background:#fff">' +
        '<div style="color:#0B6E4F;display:flex;justify-content:center"><svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg></div>' +
        '<h2 style="font-size:24px;font-weight:700;margin:14px 0 8px">Order placed! 🎉</h2>' +
        '<p class="lead" style="margin:0 auto 8px">Thank you, ' + esc((addr.name || '').split(' ')[0] || 'friend') + '! Your order is confirmed.</p>' +
        '<div style="display:inline-block;background:#F4FCFE;border:1px solid #CAF0F8;border-radius:12px;padding:10px 20px;margin:6px auto 16px"><span style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0077B6">Order number</span><br><b style="font-size:18px;color:#0B1220;letter-spacing:.02em">#' + esc(orderId) + '</b></div>' +
        (t.discount > 0 ? '<p style="color:#0B6E4F;font-weight:700;font-size:14px;margin:0 auto 8px">You saved ' + money(t.discount) + ' with ' + esc(t.code) + ' 🎉</p>' : '') +
        '<p style="color:#64748B;font-size:14px;margin:0 auto 24px">' + payNote + ' · Track it in <b>My Orders</b>.</p>' +
        '<a href="collection.html" class="dcal-btn" style="display:inline-flex;width:auto;text-decoration:none">Continue shopping →</a></div>';
    toast('Order placed! 🎉');
  }

  /* ====================================================
     PUBLIC API + INIT
     ==================================================== */
  window.DcalAuth = {
    open: openAuth,
    openProfile: openProfile,
    isLoggedIn: isLoggedIn,
    user: currentUser,
    logout: logout,
    require: function (cb) { if (isLoggedIn()) cb(); else { pendingAction = cb; openAuth(); } }
  };

  function init() {
    updateHeader();
    updateCartBubbles();
    renderCartPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
