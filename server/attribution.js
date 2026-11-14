/* =============================================================================
   Where an order came from: the ad click, stamped on the order

   js/tracking.js writes a first-party cookie when a visitor lands:
     dcal_attr  {utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                 landing_page, landed_at, fbc}, replaced by the next visit that
                 carries a utm_* or an fbclid (last campaign click wins), and
                 kept 90 days. fbc is the fbclid as Meta writes it,
                 fb.1.<ms>.<fbclid>.
   The pixel writes its own _fbc (the same click id) and _fbp (its browser id).
   Its _fbc wins; the cookie's fbc is there for a browser that blocked the
   pixel. The browser sends them all with every request, so the order is
   stamped from the request that places it.

   An order the Razorpay webhook recovers has no browser behind it, so
   create-order also copies the attribution onto the Razorpay order's notes
   (Razorpay allows 15 notes of 256 characters; the order already uses 4) and
   the webhook reads it back from there.

   Everything here came from the visitor's browser: it is capped, stripped of
   control characters, and never trusted for anything but reporting.
   ============================================================================= */
'use strict';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const KEY = { utm_source: 'utmSource', utm_medium: 'utmMedium', utm_campaign: 'utmCampaign', utm_content: 'utmContent', utm_term: 'utmTerm' };

// a short clean string, or '' (control characters out, length capped)
function clean(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 200);
}
// Meta's formats: fb.<subdomain index>.<creation ms>.<fbclid | random number>,
// sometimes with a dotted suffix its newer scripts append
const FBC = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{4,500}$/;
const FBP = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_.-]{4,60}$/;
function fbcOf(v) { v = clean(v, 520); return FBC.test(v) ? v : ''; }
function fbpOf(v) { v = clean(v, 80); return FBP.test(v) ? v : ''; }

// the stored shape (camelCase, like the rest of the Order model); empty fields left out
function shape(src) {
  const out = {};
  UTM.forEach((k) => { const v = clean(src[k]); if (v) out[KEY[k]] = v; });
  const lp = clean(src.landing_page, 300);
  if (lp) out.landingPage = lp;
  const at = Number(src.landed_at);
  if (isFinite(at) && at > 1.5e12 && at < 4e12) out.landedAt = Math.round(at);
  const fbc = fbcOf(src.fbc), fbp = fbpOf(src.fbp);
  if (fbc) out.fbc = fbc;
  if (fbp) out.fbp = fbp;
  return out;
}

// -> the attribution a request's cookies carry (server.js parseCookies), e.g.
// { utmCampaign:'dcal_demokit', fbc:'fb.1…', landingPage:'/product/demo-kit' }
function fromCookies(cookies) {
  cookies = cookies || {};
  let a = {};
  try { a = JSON.parse(cookies.dcal_attr || '{}') || {}; } catch (e) { a = {}; }
  if (typeof a !== 'object' || Array.isArray(a)) a = {};
  return shape(Object.assign({}, a, { fbc: fbcOf(cookies._fbc) || a.fbc, fbp: cookies._fbp }));
}

// -> Razorpay notes for an attribution plus the browser that placed it (for Meta,
// whose website events need the user agent and IP); empty values are left out
function toNotes(attr, client) {
  const n = {};
  const put = (k, v) => { v = clean(v, 255); if (v) n[k] = v; };
  attr = attr || {}; client = client || {};
  UTM.forEach((k) => put(k, attr[KEY[k]]));
  put('landing_page', attr.landingPage);
  put('fbc', attr.fbc);
  put('fbp', attr.fbp);
  put('ua', client.ua);
  put('ip', client.ip);
  return n;
}
// -> { attr, client } back from those notes
function fromNotes(notes) {
  notes = notes || {};
  return { attr: shape(notes), client: { ua: clean(notes.ua, 255), ip: clean(notes.ip, 64) } };
}

module.exports = { fromCookies, toNotes, fromNotes, fbcOf, fbpOf };
