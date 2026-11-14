/* =============================================================================
   Meta Conversions API: the server's copy of every pixel event

   The browser fires each event on the pixel (js/tracking.js DcalTrack) and the
   server sends the same event here, with the same event_id, so Meta keeps one
   of the two (deduplication) and still counts the buyer when an ad blocker or
   iOS stopped the pixel.

     ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo,
     CompleteRegistration   the browser asks for its server copy through
                            POST /api/meta/event (server.js); the server prices
                            it from the catalog itself, never from the browser
     Purchase               sent from here only, when the order is saved:
                            paid online (Razorpay verified), or Cash on
                            Delivery placed. event_id = the order number, which
                            the browser uses for its own Purchase.

   Each server event carries what Meta matches a person by: the phone (with
   91, hashed), the same hash as external_id, the email when the account has
   one (hashed), the _fbc click id and _fbp browser id, the IP and user agent.
   Only a signed-in session's number is used, never a number the browser sends.

     META_CAPI_TOKEN       Events Manager → the pixel → Settings → Conversions
                           API → Generate access token. Unset = nothing is sent.
     META_PIXEL_ID         default 2994497707552848 (the one js/tracking.js loads)
     META_TEST_EVENT_CODE  set while testing: events then show under Test events
                           in Events Manager (and nowhere else). Remove after.
     META_GRAPH_VERSION    default v26.0
   ============================================================================= */
'use strict';

const crypto = require('crypto');

const env = (k, d) => String(process.env[k] || d || '').trim();
const token = () => env('META_CAPI_TOKEN');
const pixelId = () => env('META_PIXEL_ID', '2994497707552848');
const version = () => env('META_GRAPH_VERSION', 'v26.0');
const testCode = () => env('META_TEST_EVENT_CODE');
const graph = () => env('META_GRAPH_URL', 'https://graph.facebook.com').replace(/\/+$/, '');   // a local stand-in, for tests

function enabled() { return !!token(); }

/* ---------- who the event is about (hashed as Meta asks) ---------- */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// Meta's form of a phone: digits only, country code first, no + (E.164 without the +)
function phoneDigits(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return '91' + d;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  return '';
}
function userData(u) {
  u = u || {};
  const out = {};
  const ph = phoneDigits(u.mobile);
  if (ph) { out.ph = [sha(ph)]; out.external_id = [sha(ph)]; }
  const em = String(u.email || '').trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) out.em = [sha(em)];
  if (u.fbc) out.fbc = u.fbc;
  if (u.fbp) out.fbp = u.fbp;
  const ip = String(u.ip || '').replace(/^::ffff:/, '');
  if (ip) out.client_ip_address = ip;
  if (u.ua) out.client_user_agent = String(u.ua).slice(0, 512);
  return out;
}

/* ---------- what the event is about ---------- */
// lines = server-priced cart lines [{ slug, qty, price }] (server.js priceCart)
function contentData(lines) {
  lines = lines || [];
  const ids = [];
  lines.forEach((l) => { if (ids.indexOf(l.slug) < 0) ids.push(l.slug); });
  return {
    content_ids: ids,
    content_type: 'product',
    contents: lines.map((l) => ({ id: l.slug, quantity: l.qty, item_price: l.price })),
    num_items: lines.reduce((n, l) => n + l.qty, 0)
  };
}

function event(name, o) {
  o = o || {};
  const e = {
    event_name: name,
    event_time: Math.floor((o.time || Date.now()) / 1000),
    event_id: String(o.id || ''),
    action_source: 'website',
    user_data: userData(o.user)
  };
  if (o.url) e.event_source_url = String(o.url).slice(0, 1000);
  if (o.custom && Object.keys(o.custom).length) e.custom_data = o.custom;
  return e;
}

/* ---------- Purchase ---------- */
// what kind of purchase a saved order is, or null when it is not one yet (a
// Razorpay order whose payment could not be confirmed): js/auth.js asks the same
function purchaseKind(order) {
  if (!order) return null;
  if (order.paid) return 'online';
  if (/cash on delivery|\bcod\b/i.test(order.payment || '')) return 'cod';
  if (!(Number(order.totalNum) > 0)) return 'free';
  return null;
}
// order = the saved Order; ctx = { lines, user, url }
function purchase(order, ctx) {
  ctx = ctx || {};
  const kind = purchaseKind(order);
  if (!kind || !order.orderId) return Promise.resolve({ skipped: kind ? 'no order id' : 'not paid' });
  const lines = ctx.lines || [];
  const custom = Object.assign(contentData(lines), {
    value: Number(order.totalNum) || 0,
    currency: 'INR',
    order_id: order.orderId,
    kit: lines.some((l) => l.slug === 'demo-kit'),
    wallet_used: Number(order.walletUsed) || 0,
    payment: kind
  });
  return send([event('Purchase', { id: order.orderId, time: order.date, url: ctx.url, user: ctx.user, custom })]);
}

/* ---------- the browser asking for its server copy ---------- */
const FROM_BROWSER = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'CompleteRegistration'];
// -> { name, id, items, url, razorpayOrderId } or null; host = this site's host,
// so a page URL from anywhere else is dropped
function fromBrowser(body, host) {
  body = body || {};
  const name = String(body.event_name || '');
  const id = String(body.event_id || '');
  if (FROM_BROWSER.indexOf(name) < 0 || !/^[A-Za-z0-9._:-]{6,100}$/.test(id)) return null;
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20)
    .map((it) => ({ slug: String((it && it.slug) || '').slice(0, 60), qty: parseInt(it && it.qty, 10) || 1 }))
    .filter((it) => it.slug);
  let url = '';
  try { const u = new URL(String(body.url || '')); if (/^https?:$/.test(u.protocol) && (!host || u.host === host)) url = u.href; } catch (e) {}
  const rzp = String(body.razorpay_order_id || '');
  return { name, id, items, url, razorpayOrderId: /^order_[A-Za-z0-9]{6,40}$/.test(rzp) ? rzp : '' };
}

/* ---------- sending ---------- */
// the outcome of the last send, and of the last Purchase, for /api/health
let last = null, lastPurchase = null;
async function send(events) {
  if (!enabled()) return { skipped: 'META_CAPI_TOKEN not set' };
  const names = events.map((e) => e.event_name).join(',');
  const body = { data: events, access_token: token() };   // in the body: a token in a URL ends up in logs
  if (testCode()) body.test_event_code = testCode();
  let out;
  try {
    const r = await fetch(graph() + '/' + version() + '/' + encodeURIComponent(pixelId()) + '/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    const j = await r.json().catch(() => ({}));
    out = (r.ok && !j.error)
      ? { ok: true, at: Date.now(), events: names, received: j.events_received }
      : { ok: false, at: Date.now(), events: names, status: r.status, error: (j.error && j.error.message) || ('HTTP ' + r.status) };
  } catch (e) {
    out = { ok: false, at: Date.now(), events: names, error: (e && e.message) || 'request failed' };
  }
  if (!out.ok) { try { console.error('meta capi: ' + names + ' not accepted: ' + out.error); } catch (x) {} }
  last = out;
  if (/Purchase/.test(names)) lastPurchase = out;
  return out;
}

function status() {
  const iso = (o) => (o ? Object.assign({}, o, { at: new Date(o.at).toISOString() }) : null);
  return {
    configured: enabled(),
    pixel_id: pixelId(),
    graph_version: version(),
    test_events: !!testCode(),
    last: iso(last),
    last_purchase: iso(lastPurchase)
  };
}

module.exports = { enabled, event, send, purchase, purchaseKind, contentData, fromBrowser, userData, phoneDigits, status };
