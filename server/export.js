/* =============================================================================
   Orders export: two tables to judge the Demo Kit campaign by, read only

     GET /api/export                                      what is here
     GET /api/export/orders?from=YYYY-MM-DD&to=YYYY-MM-DD one row per order
     GET /api/export/kit-wallets                          one row per kit buyer

   Sent with `Authorization: Bearer <EXPORT_API_KEY>`. The key reads these
   routes and nothing else, and any write that carries it (POST, PUT, PATCH,
   DELETE, anywhere on the site) is answered 403. It is a separate key from
   the partner API's, so either can be changed without the other.

   Orders: from and to are India dates and both days count. `to` defaults to
   today. Rows come oldest first, `limit` at a time (default 500, at most
   1000); while `next_cursor` is not null, ask again with ?cursor=<it> and the
   same from/to. `total` is how many orders the whole range holds, the number
   to check against the admin panel. Times are ISO-8601 in India time (+05:30).

   Kit wallets: every customer who ordered the Demo Kit, with the wallet credit
   it gave, every live order that spent it, and what is left. Cancelled orders
   count for neither, the same rule the wallet itself follows (server.js walletOf).

     EXPORT_API_KEY   the key; unset = every route here answers 503
   ============================================================================= */
'use strict';

const express = require('express');
const { keyMatches } = require('./partner');

const KIT = 'demo-kit';
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const configuredKey = () => String(process.env.EXPORT_API_KEY || '').trim();
function bearer(req) {
  const auth = String(req.get('authorization') || '');
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : '';
}
function keyStatus() {
  if (configuredKey()) return { configured: true };
  return { configured: false, hint: process.env.EXPORT_API_KEY !== undefined ? 'EXPORT_API_KEY is set but empty' : 'EXPORT_API_KEY is not in this service\'s environment' };
}

// Mounted before every route: the export key never writes anything.
function blockWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const key = configuredKey(), given = bearer(req);
  if (key && given && keyMatches(given, key)) return res.status(403).json({ error: 'This key is read-only.' });
  next();
}
function gate(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const key = configuredKey();
  if (!key) return res.status(503).json({ error: 'EXPORT_API_KEY not configured' });
  if (!keyMatches(bearer(req), key)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

/* ---------- India time ---------- */
// 'YYYY-MM-DD' -> ms at 00:00 India time that day, or NaN
function istDayStart(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return NaN;
  const t = Date.parse(s + 'T00:00:00+05:30');
  return isFinite(t) && new Date(t + IST_MS).toISOString().slice(0, 10) === s ? t : NaN;   // 2026-02-31 is not a day
}
const istToday = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const ist = (ms) => (isFinite(ms) && ms > 0 ? new Date(ms + IST_MS).toISOString().replace('Z', '+05:30') : null);

/* ---------- the cursor: where the last page stopped (date, then _id) ---------- */
const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function encodeCursor(doc) { return b64u(JSON.stringify({ d: doc.date, i: String(doc._id) })); }
function decodeCursor(s) {
  try {
    const c = JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return c && isFinite(c.d) && /^[0-9a-f]{24}$/.test(c.i) ? c : null;
  } catch (e) { return null; }
}

/* ---------- shaping a row ---------- */
const str = (v) => (typeof v === 'string' || typeof v === 'number' ? (String(v).trim() || null) : null);
const isKitLine = (it) => !!it && (it.slug === KIT || it.id === KIT);
// the store's six statuses as the four the campaign is judged by
const STATUS = { 'Confirmed': 'placed', 'Processing': 'placed', 'Shipped': 'shipped', 'Out for Delivery': 'shipped', 'Delivered': 'delivered', 'Cancelled': 'cancelled' };
function paymentMethod(o) {
  if (o.paid) return 'online';
  if (/cash on delivery|\bcod\b/i.test(o.payment || '')) return 'cod';
  if (!(Number(o.totalNum) > 0)) return 'free';
  return 'online';                     // sent to Razorpay, payment not confirmed
}
function paymentStatus(o) {
  if (o.paid) return 'paid';
  return Number(o.totalNum) > 0 ? 'unpaid' : 'free';
}
function lastAt(o, status) {
  const h = (o.statusHistory || []).filter((x) => x && x.status === status);
  return h.length ? ist(h[h.length - 1].at) : null;
}

function mount(app, d) {
  const { Order, CATALOG, slugOf, toNum } = d;
  function needDb(res) {
    if (d.dbReady()) return true;
    res.status(503).json({ error: 'Database not connected' });
    return false;
  }

  function orderRow(o) {
    const a = o.address || {}, at = o.attribution || {};
    return {
      order_id: o.orderId,
      created_at: ist(o.date),
      mobile: str(o.mobile),
      name: str(o.customerName) || str(a.name),
      city: str(a.city),
      pincode: str(a.pincode),
      items: (o.items || []).map((it) => {
        const slug = slugOf(it) || null;
        return {
          slug,
          qty: Math.max(1, parseInt(it && it.qty, 10) || 1),
          price: it && it.price != null && String(it.price).trim() ? toNum(it.price) : (slug ? CATALOG[slug].price : null)
        };
      }),
      kit: (o.items || []).some(isKitLine),
      discount: Number(o.discount) || 0,
      coupon: str(o.coupon),
      shipping: Number(o.shipping) || 0,
      wallet_used: Number(o.walletUsed) || 0,
      wallet_credit: Number(o.walletCredit) || 0,
      total: Number(o.totalNum) || toNum(o.total),
      payment_method: paymentMethod(o),
      payment_status: paymentStatus(o),
      razorpay_order_id: str(o.razorpayOrderId),
      status: STATUS[o.status] || String(o.status || 'placed').toLowerCase(),
      status_label: str(o.status),
      delivered_at: lastAt(o, 'Delivered'),
      cancelled_at: ist(o.cancelledAt),
      refund_status: str(o.refundStatus),
      utm_source: str(at.utmSource),
      utm_medium: str(at.utmMedium),
      utm_campaign: str(at.utmCampaign),
      utm_content: str(at.utmContent),
      utm_term: str(at.utmTerm),
      fbc: str(at.fbc),
      fbp: str(at.fbp),
      landing_page: str(at.landingPage)
    };
  }

  const r = express.Router();
  r.use(gate, d.rateLimit);

  r.get('/', (req, res) => {
    res.json({ endpoints: ['/api/export/orders?from=YYYY-MM-DD&to=YYYY-MM-DD', '/api/export/kit-wallets'], timezone: 'Asia/Kolkata' });
  });

  r.get('/orders', async (req, res) => {
    const from = String(req.query.from || ''), to = String(req.query.to || istToday());
    const start = istDayStart(from), end = istDayStart(to);
    if (!isFinite(start)) return res.status(400).json({ error: 'from is required: an India date, YYYY-MM-DD' });
    if (!isFinite(end)) return res.status(400).json({ error: 'to must be an India date, YYYY-MM-DD' });
    if (end < start) return res.status(400).json({ error: 'to is before from' });
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 500));
    let cur = null;
    if (req.query.cursor) { cur = decodeCursor(req.query.cursor); if (!cur) return res.status(400).json({ error: 'cursor is not one this API gave out' }); }
    if (!needDb(res)) return;
    try {
      const range = { date: { $gte: start, $lt: end + DAY_MS } };
      const q = cur ? { $and: [range, { $or: [{ date: { $gt: cur.d } }, { date: cur.d, _id: { $gt: cur.i } }] }] } : range;
      const [docs, total] = await Promise.all([
        Order.find(q).sort({ date: 1, _id: 1 }).limit(limit + 1).lean(),
        Order.countDocuments(range)
      ]);
      const page = docs.slice(0, limit);
      res.json({
        from, to, timezone: 'Asia/Kolkata', total, count: page.length,
        next_cursor: docs.length > limit ? encodeCursor(page[page.length - 1]) : null,
        rows: page.map(orderRow)
      });
    } catch (e) { d.serverErr(res, e); }
  });

  r.get('/kit-wallets', async (req, res) => {
    if (!needDb(res)) return;
    try {
      const docs = await Order.find({ $or: [{ 'items.slug': KIT }, { 'items.id': KIT }, { walletCredit: { $gt: 0 } }, { walletUsed: { $gt: 0 } }] },
        { orderId: 1, mobile: 1, customerName: 1, address: 1, items: 1, date: 1, status: 1, paid: 1, totalNum: 1, total: 1, walletCredit: 1, walletUsed: 1 })
        .sort({ date: 1, _id: 1 }).lean();
      const by = new Map();
      docs.forEach((o) => { const m = String(o.mobile || ''); if (!by.has(m)) by.set(m, []); by.get(m).push(o); });
      const rows = [];
      by.forEach((list, mobile) => {
        const live = list.filter((o) => o.status !== 'Cancelled');
        const kits = list.filter((o) => (o.items || []).some(isKitLine) || Number(o.walletCredit) > 0);
        if (!kits.length) return;                       // spent a wallet without a kit: not a kit buyer
        // the kit order that counts: the live one that gave the credit, else any live kit, else the latest
        const kit = kits.filter((o) => o.status !== 'Cancelled' && Number(o.walletCredit) > 0)[0]
                 || kits.filter((o) => o.status !== 'Cancelled')[0] || kits[kits.length - 1];
        const given = live.reduce((s, o) => s + (Number(o.walletCredit) || 0), 0);
        const spent = live.filter((o) => Number(o.walletUsed) > 0);
        const used = spent.reduce((s, o) => s + (Number(o.walletUsed) || 0), 0);
        rows.push({
          mobile: str(mobile),
          name: str(kit.customerName) || str((kit.address || {}).name),
          kit_order_id: kit.orderId,
          kit_ordered_at: ist(kit.date),
          kit_status: STATUS[kit.status] || String(kit.status || 'placed').toLowerCase(),
          kit_paid: !!kit.paid,
          credit_given: given,
          credit_used: used,
          redemptions: spent.map((o) => ({
            order_id: o.orderId, created_at: ist(o.date), amount: Number(o.walletUsed) || 0,
            order_total: Number(o.totalNum) || toNum(o.total), status: STATUS[o.status] || String(o.status || 'placed').toLowerCase(),
            items: (o.items || []).map((it) => slugOf(it) || null)
          })),
          balance: Math.max(0, given - used)             // never below 0, as walletOf
        });
      });
      res.json({ count: rows.length, rows });
    } catch (e) { d.serverErr(res, e); }
  });

  app.use('/api/export', r);
}

module.exports = { mount, blockWrites, keyStatus, istDayStart, decodeCursor };
