/* =============================================================================
   D'Cal partner API — the whole store, read only, behind one key

   Another system (Befach's WhatsApp CRM, a sheet, a dashboard) reads D'Cal from
   its own server with `Authorization: Bearer <PARTNER_API_KEY>`. Nothing here
   writes. The key travels ONLY in that header — there is no ?key= form,
   because a key in a URL ends up in proxy and access logs — and is compared
   in constant time.

     GET /api/partner                  what is here, and how many of each
     GET /api/partner/products         the catalog: prices, stock, images, links
     GET /api/partner/coupons          the coupon codes and their rules
     GET /api/partner/signups?since=   customer accounts
     GET /api/partner/orders?since=    orders
     GET /api/partner/dealers?since=   "Become a Business Partner" applications
     GET /api/partner/voice?since=     voice assistant conversations

   The ?since= feeds work like Befach's partner feeds, so one client reads
   both: every row created or CHANGED at or after `since` (any ISO-8601 time),
   oldest first, 100 at a time, as a bare JSON array. X-Has-More says more
   follow; ask again with X-Next-Since (the last row's updated_at). The
   boundary is inclusive, so a row can repeat but is never skipped — keep rows
   by id.

   "Changed" is updatedAt, which the User, Order and Dealer models stamp on
   every write. Rows last written before that field existed fall back to the
   latest time they do carry: a sign-up or login, an order's last status
   change or cancellation, an application's arrival.

     PARTNER_API_KEY       the key; unset = every partner route answers 503
     PARTNER_RATE_PER_MIN  requests per minute per calling IP (default 120)
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const express = require('express');

const PAGE = 100;

/* ---------- the key ---------- */
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
// hashing first makes the lengths equal, which timingSafeEqual requires
function keyMatches(given, key) {
  if (!given || !key) return false;
  return crypto.timingSafeEqual(digest(given), digest(key));
}

/* Whether the key reaches THIS process, for /api/health: a boolean and, when
   it does not, the near miss that explains it — variable NAMES only, never a
   value. On Befach (9 Oct 2026) the key was "set on Render" under another
   name and the live site still answered 503; this turns that guess into one GET. */
function keyStatus(env) {
  env = env || process.env;
  const raw = env.PARTNER_API_KEY;
  if (raw && raw.trim()) return { configured: true };
  if (raw !== undefined) return { configured: false, hint: 'PARTNER_API_KEY is set but empty' };
  const near = Object.keys(env).filter((k) => /PARTNER/i.test(k) && k !== 'PARTNER_RATE_PER_MIN');
  if (near.length) return { configured: false, hint: 'found ' + near.join(', ') + '; the name must be exactly PARTNER_API_KEY' };
  return { configured: false, hint: 'PARTNER_API_KEY is not in this service\'s environment' };
}

function gate(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const key = String(process.env.PARTNER_API_KEY || '').trim();
  if (!key) return res.status(503).json({ error: 'PARTNER_API_KEY not configured' });
  const auth = String(req.get('authorization') || '');
  const given = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
  if (!keyMatches(given, key)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

/* ---------- shaping ---------- */
const msOf = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : NaN);
const iso = (v) => { const t = msOf(v); return isFinite(t) && t > 0 ? new Date(t).toISOString() : null; };
// a stored value as text, or null; numbers too (a pincode can arrive as one)
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? (String(v).trim() || null) : null);

// The number with its country code. Accounts and checkout keep 10 digits, all
// Indian mobiles; anything else stays null rather than a guessed code.
function phoneOf(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return '+91' + d;
  if (/^91[6-9]\d{9}$/.test(d)) return '+' + d;
  return null;
}

function addressRow(a) {
  a = a || {};
  return { name: str(a.name), phone: str(a.phone), line: str(a.line), landmark: str(a.landmark),
           city: str(a.city), state: str(a.state), pincode: str(a.pincode) };
}

function mount(app, d) {
  const { User, Order, Dealer, voicelog, CATALOG, COUPONS, PRODUCT_CODE, slugOf, itemImage, toNum } = d;
  const origin = (req) => req.protocol + '://' + req.get('host');
  const abs = (base, p) => (!p ? null : /^https?:\/\//i.test(p) ? p : base + '/' + encodeURI(String(p).replace(/^\/+/, '')));

  function sinceOf(req, res) {
    const raw = String(req.query.since || '').trim();
    const t = raw ? Date.parse(raw) : NaN;
    if (!isFinite(t)) { res.status(400).json({ error: 'since is required: an ISO-8601 time, e.g. 2026-10-01T00:00:00Z' }); return null; }
    return t;
  }
  function needDb(res) {
    if (d.dbReady()) return true;
    res.status(503).json({ error: 'Database not connected' });
    return false;
  }
  function send(res, rows, hasMore) {
    res.set('X-Has-More', String(hasMore));
    if (rows.length) res.set('X-Next-Since', rows[rows.length - 1].updated_at);
    res.json(rows);
  }
  // Rows changed at or after `since`, oldest first. `changed` is an expression
  // for when a row last changed. It is worked out per row, so this reads the
  // whole collection — fine at D'Cal's size, and the only way to cover rows
  // written before updatedAt existed.
  async function feed(Model, changed, since) {
    const docs = await Model.aggregate([
      { $addFields: { _changed: changed } },
      { $match: { _changed: { $gte: since } } },
      { $sort: { _changed: 1, _id: 1 } },
      { $limit: PAGE + 1 }
    ]);
    return { docs: docs.slice(0, PAGE), hasMore: docs.length > PAGE };
  }

  const r = express.Router();
  r.use(gate, d.rateLimit);

  r.get('/', async (req, res) => {
    try {
      const db = d.dbReady();
      res.json({
        store: "D'Cal", base_url: origin(req), database: db,
        counts: {
          products: Object.keys(CATALOG).length, coupons: Object.keys(COUPONS).length,
          signups: db ? await User.estimatedDocumentCount() : null,
          orders: db ? await Order.estimatedDocumentCount() : null,
          dealers: db ? await Dealer.estimatedDocumentCount() : null
        },
        endpoints: ['/api/partner/products', '/api/partner/coupons', '/api/partner/signups?since=',
                    '/api/partner/orders?since=', '/api/partner/dealers?since=', '/api/partner/voice?since=']
      });
    } catch (e) { d.serverErr(res, e); }
  });

  r.get('/products', (req, res) => {
    const base = origin(req);
    res.json(Object.keys(CATALOG).map((slug) => {
      const p = CATALOG[slug], code = PRODUCT_CODE[slug] || {};
      return {
        slug, code: code.code || null, title: p.title, category: p.cat || null,
        price: p.price, mrp: p.was || null, currency: 'INR',
        rating: p.rating ? Number(p.rating) : null,
        in_stock: !p.outOfStock, free: !!p.free,
        description: p.desc || null,
        image_url: p.img ? abs(base, 'images/' + p.img) : null,
        // the free Demo Kit has no page of its own; it is ordered from the strip on /collection
        url: base + (p.free ? '/collection' : '/product/' + slug)
      };
    }));
  });

  r.get('/coupons', (req, res) => {
    res.json(Object.keys(COUPONS).map((code) => {
      const c = COUPONS[code];
      return { code, description: c.desc || null, type: c.type, value: c.value, min_order: c.min || null,
               products: c.slugs || null, once_per_customer: !!c.oncePerUser };
    }));
  });

  r.get('/signups', async (req, res) => {
    const since = sinceOf(req, res); if (since === null || !needDb(res)) return;
    try {
      const { docs, hasMore } = await feed(User, { $max: ['$updatedAt', '$createdAt', '$lastLogin'] }, since);
      send(res, docs.map((u) => ({
        id: String(u._id),
        created_at: iso(u.createdAt),
        updated_at: iso(u._changed),
        name: str(u.name),
        phone: phoneOf(u.mobile),
        mobile: str(u.mobile),
        email: str(u.email),
        signed_up_with: str(u.provider) || 'phone',
        google_linked: !!u.googleId,
        // a picture uploaded on the site is a data: URL that can run to megabytes
        avatar_url: /^https:\/\//i.test(u.avatar || '') ? u.avatar : null,
        addresses: (u.addresses || []).map((a) => Object.assign({ id: str(a.id) }, addressRow(a),
          { default: !!u.defaultAddressId && a.id === u.defaultAddressId })),
        logins: u.logins || 0,
        last_login_at: iso(u.lastLogin)
      })), hasMore);
    } catch (e) { d.serverErr(res, e); }
  });

  r.get('/orders', async (req, res) => {
    const since = sinceOf(req, res); if (since === null || !needDb(res)) return;
    try {
      const base = origin(req);
      const { docs, hasMore } = await feed(Order, { $max: ['$updatedAt', '$date', '$cancelledAt', { $max: '$statusHistory.at' }] }, since);
      send(res, docs.map((o) => {
        const total = Number(o.totalNum) || toNum(o.total);
        const discount = Number(o.discount) || 0;
        // total = subtotal − discount + shipping − wallet (server.js quoteOrder)
        const shipping = Number(o.shipping) || 0, wallet = Number(o.walletUsed) || 0;
        return {
          order_id: o.orderId,
          created_at: iso(o.date),
          updated_at: iso(o._changed),
          status: o.status,
          status_history: (o.statusHistory || []).map((h) => ({ status: h.status, at: iso(h.at) })),
          customer: { name: str(o.customerName), phone: phoneOf(o.mobile), mobile: str(o.mobile) },
          items: (o.items || []).map((it) => {
            const slug = slugOf(it) || null;
            return {
              slug, title: str(it && it.title) || (slug ? CATALOG[slug].title : null),
              qty: Math.max(1, parseInt(it && it.qty, 10) || 1),
              // as the cart showed it; `total` below is the server's own figure, the one charged
              unit_price: it && it.price != null && String(it.price).trim() ? toNum(it.price) : (slug ? CATALOG[slug].price : null),
              image_url: abs(base, itemImage(it) || (it && it.image))
            };
          }),
          subtotal: total + discount + wallet - shipping, discount, coupon: str(o.coupon),
          shipping, wallet_used: wallet, wallet_credit: Number(o.walletCredit) || 0, total, currency: 'INR',
          payment: str(o.payment), paid: !!o.paid,
          payment_id: str(o.paymentId), razorpay_order_id: str(o.razorpayOrderId),
          address: addressRow(o.address),
          cancelled_at: iso(o.cancelledAt), cancel_reason: str(o.cancelReason), refund_status: str(o.refundStatus)
        };
      }), hasMore);
    } catch (e) { d.serverErr(res, e); }
  });

  r.get('/dealers', async (req, res) => {
    const since = sinceOf(req, res); if (since === null || !needDb(res)) return;
    try {
      const { docs, hasMore } = await feed(Dealer, { $max: ['$updatedAt', '$createdAt'] }, since);
      send(res, docs.map((x) => ({
        id: String(x._id),
        created_at: iso(x.createdAt),
        updated_at: iso(x._changed),
        name: str(x.fullName), business_name: str(x.businessName),
        phone: phoneOf(x.mobile), mobile: str(x.mobile), email: str(x.email),
        pincode: str(x.pincode), city: str(x.city), state: str(x.state),
        business_type: str(x.businessType), current_products: str(x.currentProducts),
        experience: str(x.experience), message: str(x.message)
      })), hasMore);
    } catch (e) { d.serverErr(res, e); }
  });

  // Conversations are kept 30 days (voicelog), so `since` reaches back no further.
  // Phone numbers and emails in them are already masked when they are recorded.
  const VOICE_TYPE = { you: 'customer', bot: 'assistant', ev: 'event' };
  r.get('/voice', async (req, res) => {
    const since = sinceOf(req, res); if (since === null) return;
    try {
      const docs = await voicelog.since(since, PAGE + 1);
      send(res, docs.slice(0, PAGE).map((s) => {
        const sum = voicelog.summaryOf(s);
        return {
          id: s.sid,
          created_at: iso(s.startedAt),
          updated_at: iso(s.lastAt),
          device: str(s.device), signed_in: !!s.signedIn,
          turns: sum.turns, languages: sum.langs, pages: sum.pages,
          problems: sum.problems,
          review: s.review ? { wanted: s.review.wanted || null, achieved: s.review.achieved, summary: s.review.summary } : null,
          items: (s.items || []).map((it) => ({
            type: VOICE_TYPE[it.t] || it.t, at: iso(it.at), text: it.text, lang: it.lang, page: it.page,
            via: it.via, kind: it.kind, detail: it.detail, reply_ms: it.ms, voice_ms: it.voiceMs
          }))
        };
      }), docs.length > PAGE);
    } catch (e) { d.serverErr(res, e); }
  });

  app.use('/api/partner', r);
}

module.exports = { mount, keyStatus, keyMatches, phoneOf };
