/*
 * D'Cal site-wide marketing tags.
 * Loaded on every customer-facing page via <script src="/js/tracking.js"></script>.
 * Keep all tracking IDs here so they only ever change in one place.
 */
(function () {
  var GTM_ID = 'GTM-PQVLS3WZ';        // Google Tag Manager container
  var META_PIXEL_ID = '2994497707552848'; // Meta (Facebook) Pixel

  // --- Google Tag Manager ---
  (function (w, d, s, l, i) {
    w[l] = w[l] || [];
    w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = d.getElementsByTagName(s)[0],
        j = d.createElement(s),
        dl = l != 'dataLayer' ? '&l=' + l : '';
    j.async = true;
    j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
    f.parentNode.insertBefore(j, f);
  })(window, document, 'script', 'dataLayer', GTM_ID);

  // --- Meta Pixel ---
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', META_PIXEL_ID);
  fbq('track', 'PageView');

  // --- Where this visit came from ---
  // The ad's utm_* and Meta's fbclid, plus the page they landed on, kept in a
  // first-party cookie for 90 days. server/attribution.js copies it onto the
  // order when one is placed. A visit that carries a utm_* or an fbclid
  // replaces what was there (the last campaign click wins); a visit without
  // one only fills an empty cookie, so browsing the site never wipes the ad.
  try {
    var q = new URLSearchParams(location.search);
    var hasAttr = /(?:^|;\s*)dcal_attr=/.test(document.cookie);
    var fbclid = (q.get('fbclid') || '').trim();
    var attr = {}, campaign = false;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      var v = (q.get(k) || '').trim().slice(0, 200);
      if (v) { attr[k] = v; campaign = true; }
    });
    // the click id as Meta writes it in _fbc: fb.<subdomain index>.<ms>.<fbclid>
    if (/^[A-Za-z0-9_.-]{4,500}$/.test(fbclid)) { attr.fbc = 'fb.1.' + Date.now() + '.' + fbclid; campaign = true; }
    if (campaign || !hasAttr) {
      attr.landing_page = location.pathname.slice(0, 300);
      attr.landed_at = Date.now();
      document.cookie = 'dcal_attr=' + encodeURIComponent(JSON.stringify(attr)) + '; Max-Age=' + (90 * 86400) +
        '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    }
  } catch (e) {}

  // --- Funnel events: the pixel's copy and the server's, one event_id ---
  // DcalTrack.event(name, params, opts) fires a Meta standard event on the pixel
  // and asks the server (POST /api/meta/event, server/meta.js) to send Meta the
  // same event through the Conversions API, so Meta keeps one of the two.
  //   opts.items        [{slug, qty}] — the server prices these from the catalog
  //   opts.id           the event_id to use (Purchase: the order number)
  //   opts.browserOnly  no server copy (Purchase: the server sends its own when it saves the order)
  //   opts.razorpayOrderId  AddPaymentInfo: the Razorpay order it was opened for
  function newEventId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  window.DcalTrack = {
    event: function (name, params, opts) {
      opts = opts || {};
      var id = opts.id || newEventId();
      try { fbq('track', name, params || {}, { eventID: id }); } catch (e) {}
      if (!opts.browserOnly && window.fetch) {
        try {
          // keepalive: Add to Cart moves on to /cart half a second later
          fetch('/api/meta/event', {
            method: 'POST', keepalive: true, credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_name: name, event_id: id, items: opts.items || [],
                                   razorpay_order_id: opts.razorpayOrderId || '', url: location.href })
          }).catch(function () {});
        } catch (e) {}
      }
      return id;
    }
  };
})();
