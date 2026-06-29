/* =========================================================
   D'Cal backend — Express + MongoDB
   Serves the static storefront AND a central API so that
   orders/customers from every device land in one database.
   Falls back gracefully: if MONGODB_URI is missing the site
   still serves, but data endpoints return 503 (the frontend
   then keeps using the browser's localStorage).
   ========================================================= */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const User = require('./models/User');
const Order = require('./models/Order');
const Lead = require('./models/Lead');
const Dealer = require('./models/Dealer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

/* ---------- security: block NoSQL injection ----------
   Strip any Mongo operator keys ($gt, $ne, …) and dotted keys from every
   request body/query/params, so a payload like {"mobile":{"$ne":null}} can
   never reach a query and dump other users' data. */
function stripMongoOperators(obj, depth) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) { delete obj[key]; continue; }
    stripMongoOperators(obj[key], (depth || 0) + 1);
  }
}
app.use((req, _res, next) => {
  stripMongoOperators(req.body, 0);
  stripMongoOperators(req.query, 0);
  stripMongoOperators(req.params, 0);
  next();
});

const ROOT = path.join(__dirname, '..');                 // project root (where index.html lives)
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dcal-admin-2026';
const MONGODB_URI = process.env.MONGODB_URI || '';

/* ---------- database ---------- */
let dbReady = false;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => { dbReady = true; console.log('✓ MongoDB connected'); })
    .catch((err) => console.error('✗ MongoDB connection error:', err.message));
} else {
  console.warn('⚠ No MONGODB_URI set — running storefront only (no central data).');
}

function requireDB(res) { if (!dbReady) { res.status(503).json({ error: 'Database not connected' }); return false; } return true; }
function toNum(s) { const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; }

/* ---------- Razorpay (real payments) ---------- */
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
let razorpay = null;
if (RZP_KEY_ID && RZP_KEY_SECRET) {
  try {
    const Razorpay = require('razorpay');
    razorpay = new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });
    console.log('✓ Razorpay enabled');
  } catch (e) { console.error('✗ Razorpay init failed:', e.message); }
} else {
  console.warn('⚠ Razorpay keys not set — online payment runs in demo mode.');
}

/* ---------- health ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady, payments: !!razorpay }));

/* ---------- payments (Razorpay) ---------- */
app.get('/api/payment/config', (req, res) => res.json({ enabled: !!razorpay, keyId: RZP_KEY_ID }));

// 1) create a Razorpay order. The amount is computed by the SERVER from the cart
//    items + coupon (never taken from the client), so it can't be tampered.
app.post('/api/payment/create-order', async (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Razorpay not configured' });
  try {
    const { items, coupon, mobile } = req.body || {};
    const q = await quoteOrder(items, coupon, mobile);
    if (!q.ok) return res.status(400).json({ error: 'Some items could not be priced. Please refresh your cart.' });
    if (!q.total || q.total <= 0) return res.status(400).json({ error: 'empty or invalid cart' });
    const order = await razorpay.orders.create({
      amount: Math.round(q.total * 100),    // Razorpay works in paise
      currency: 'INR',
      receipt: 'dcal_' + Date.now()
    });
    // remember exactly what we charged for, so verify + order-save can trust it
    pendingPayments.set(order.id, { total: q.total, discount: q.discount, code: q.code, amount: order.amount, mobile: String(mobile || ''), verified: false });
    res.json({ keyId: RZP_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2) verify the payment signature, then mark this order_id as paid-for so the
//    order-save step can trust it. Returns the server total for display.
app.post('/api/payment/verify', (req, res) => {
  if (!RZP_KEY_SECRET) return res.status(503).json({ error: 'Razorpay not configured' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return res.status(400).json({ error: 'missing fields' });
  const expected = crypto.createHmac('sha256', RZP_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
  const valid = expected === razorpay_signature;
  if (!valid) return res.json({ valid: false });
  const pending = pendingPayments.get(razorpay_order_id);
  if (pending) { pending.verified = true; pending.paymentId = razorpay_payment_id; }
  res.json({ valid: true, total: pending ? pending.total : null });
});

/* ---------- auth (phone-only, no password) ---------- */
// returns { isNew:true } if the phone isn't registered yet, else logs the login and returns the user
app.post('/api/login', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { mobile } = req.body || {};
    if (!mobile) return res.status(400).json({ error: 'mobile required' });
    const user = await User.findOne({ mobile });
    if (!user) return res.json({ isNew: true });
    user.logins = (user.logins || 0) + 1;
    user.lastLogin = Date.now();
    await user.save();
    res.json({ isNew: false, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// create a new account (or log in if it already exists)
app.post('/api/register', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { mobile, name, email, avatar, provider } = req.body || {};
    if (!mobile) return res.status(400).json({ error: 'mobile required' });
    let user = await User.findOne({ mobile });
    if (user) {
      user.logins = (user.logins || 0) + 1;
      user.lastLogin = Date.now();
      await user.save();
      return res.json({ user });
    }
    user = await User.create({
      mobile, name: name || '', email: email || '', avatar: avatar || '',
      provider: provider || 'phone', logins: 1, lastLogin: Date.now()
    });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- free demo kit (one per logged-in account) ----------
   The claim is recorded on the user record. The update is atomic (it only
   succeeds when freeKitClaimed isn't already true), so a double-tap or two
   tabs can never get two kits. */
app.post('/api/freekit/claim', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { mobile, info } = req.body || {};
    if (!mobile) return res.status(400).json({ error: 'mobile required' });
    const claimed = await User.findOneAndUpdate(
      { mobile, freeKitClaimed: { $ne: true } },
      { $set: { freeKitClaimed: true, freeKitAt: Date.now(), freeKitInfo: info || {} } },
      { new: true }
    );
    if (claimed) return res.json({ ok: true, alreadyClaimed: false });
    // update didn't match -> either no such user, or already claimed
    const existing = await User.findOne({ mobile });
    if (!existing) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: false, alreadyClaimed: true, claimedAt: existing.freeKitAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/freekit/status/:mobile', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const u = await User.findOne({ mobile: req.params.mobile });
    res.json({ claimed: !!(u && u.freeKitClaimed), claimedAt: (u && u.freeKitAt) || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- demo-kit leads (PUBLIC form — no login required) ----------
   Every free-demo-kit submission is stored here and shows up in the admin
   "Demo Kits" tab + its Excel/CSV export. */
app.post('/api/leads', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const phone = String(b.phone || '').replace(/[^0-9]/g, '').slice(0, 15);
    if (!String(b.name || '').trim() || phone.length < 10) {
      return res.status(400).json({ error: 'name & valid phone required' });
    }
    // ONE demo-kit request per phone number — if this number already requested,
    // don't create a duplicate; tell the client so it can show "already requested".
    const existing = await Lead.findOne({ phone });
    if (existing) return res.json({ ok: true, already: true, at: existing.createdAt });

    const pick = (k) => String(b[k] == null ? '' : b[k]).trim().slice(0, 200);
    const lead = await Lead.create({
      name: pick('name'), phone: phone, email: pick('email'),
      age: pick('age'), address: pick('address'), village: pick('village'),
      city: pick('city'), state: pick('state'), pincode: pick('pincode'),
      source: pick('source'), home_type: pick('home_type'), createdAt: Date.now()
    });
    res.json({ ok: true, already: false, id: lead._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- dealership applications (PUBLIC form — no login required) ----------
   Every "Become a Business Partner" submission is stored here and shows up in the
   admin "Dealers" tab + its CSV export. Same pattern as demo-kit leads. */
app.post('/api/dealership', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || '').replace(/[^0-9]/g, '').slice(0, 15);
    if (!String(b.fullName || '').trim() || mobile.length < 10) {
      return res.status(400).json({ error: 'name & valid mobile required' });
    }
    // ONE application per mobile number — repeat submissions don't create a
    // duplicate; tell the client so it can show "already applied".
    const existing = await Dealer.findOne({ mobile });
    if (existing) return res.json({ ok: true, already: true, at: existing.createdAt });

    const pick = (k) => String(b[k] == null ? '' : b[k]).trim().slice(0, 500);
    const dealer = await Dealer.create({
      fullName: pick('fullName'), businessName: pick('businessName'), mobile: mobile,
      email: pick('email'), pincode: pick('pincode'), city: pick('city'), state: pick('state'),
      businessType: pick('businessType'), currentProducts: pick('currentProducts'),
      experience: pick('experience'), message: pick('message'), createdAt: Date.now()
    });
    res.json({ ok: true, already: false, id: dealer._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- profile + addresses ---------- */
app.get('/api/users/:mobile', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const user = await User.findOne({ mobile: req.params.mobile });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:mobile', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { name, email, avatar } = req.body || {};
    const set = {};
    if (name !== undefined) set.name = name;
    if (email !== undefined) set.email = email;
    if (avatar !== undefined) set.avatar = avatar;
    const user = await User.findOneAndUpdate({ mobile: req.params.mobile }, { $set: set }, { new: true });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:mobile/addresses', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { addresses, defaultAddressId } = req.body || {};
    const user = await User.findOneAndUpdate(
      { mobile: req.params.mobile },
      { $set: { addresses: addresses || [], defaultAddressId: defaultAddressId || null } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- coupons (server is the source of truth for eligibility) ----------
   `oncePerUser` coupons can be redeemed only one time per phone number. We treat
   a coupon as "already used" if the customer has a prior, non-cancelled order
   that carries that code. */
const COUPONS = {
  DCAL10:  { type: 'percent', value: 10, oncePerUser: true, desc: '10% off' },
  DCAL200: { type: 'flat',    value: 200, min: 2000, oncePerUser: true, desc: '₹200 off orders over ₹2,000' }
};
function couponDiscount(c, subtotal) {
  if (!c) return 0;
  let d = c.type === 'percent' ? Math.round(subtotal * c.value / 100) : c.value;
  return d > subtotal ? subtotal : d;
}
async function couponUsedBy(mobile, code) {
  if (!mobile || !code || !dbReady) return false;
  return !!(await Order.exists({ mobile, coupon: code, status: { $ne: 'Cancelled' } }));
}

/* ---------- pricing (server is the source of truth for money) ----------
   Prices come from data/catalog.json, never from the browser. Each cart line is
   priced by its catalog slug (or, as a fallback, by matching the product title),
   so a tampered price/amount in the client can't change what is actually charged. */
const CATALOG = require('../data/catalog.json');
const byTitle = {};
function normTitle(s) { return String(s || '').replace(/[’‘']/g, "'").replace(/\s+/g, ' ').trim().toLowerCase(); }
Object.keys(CATALOG).forEach((slug) => { byTitle[normTitle(CATALOG[slug].title)] = slug; });
function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// price a cart -> { subtotal, lines, ok }; ok=false if any line can't be priced
function priceCart(items) {
  let subtotal = 0, ok = true; const lines = [];
  (Array.isArray(items) ? items : []).forEach((it) => {
    const qty = Math.max(1, Math.min(99, parseInt(it && it.qty, 10) || 1));
    const slug = (it && CATALOG[it.slug]) ? it.slug : byTitle[normTitle(it && (it.title || it.id))];
    if (!slug) { ok = false; return; }
    subtotal += CATALOG[slug].price * qty;
    lines.push({ slug, qty, price: CATALOG[slug].price });
  });
  return { subtotal, lines, ok: ok && lines.length > 0 };
}

// full server quote: catalog pricing + coupon eligibility = the authoritative total
async function quoteOrder(items, couponCode, mobile) {
  const { subtotal, lines, ok } = priceCart(items);
  let code = String(couponCode || '').trim().toUpperCase();
  let discount = 0;
  const c = COUPONS[code];
  if (c && (!c.min || subtotal >= c.min) && !(c.oncePerUser && await couponUsedBy(mobile, code))) {
    discount = couponDiscount(c, subtotal);
  } else { code = ''; }
  return { ok, subtotal, discount, total: subtotal - discount, code, lines };
}

// razorpay order_id -> the server-computed quote, so /verify and /orders can trust it
const pendingPayments = new Map();

// validate a coupon for a given user+cart BEFORE they pay (the authoritative check)
app.post('/api/coupon/validate', async (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim().toUpperCase();
    const subtotal = Number(body.subtotal) || 0;
    const c = COUPONS[code];
    if (!c) return res.json({ ok: false, reason: 'Invalid or expired coupon code.' });
    if (c.min && subtotal < c.min) return res.json({ ok: false, reason: 'Add items worth ₹' + c.min.toLocaleString('en-IN') + ' to use this code.' });
    if (c.oncePerUser) {
      if (!body.mobile) return res.json({ ok: false, reason: 'Please sign in to use this coupon.' });
      if (await couponUsedBy(body.mobile, code)) return res.json({ ok: false, reason: 'You’ve already used this coupon — it’s valid one time per customer.' });
    }
    res.json({ ok: true, code, discount: couponDiscount(c, subtotal), desc: c.desc });
  } catch (e) { res.status(500).json({ ok: false, reason: 'Could not verify the coupon. Please try again.' }); }
});

/* ---------- orders (customer) ---------- */
app.post('/api/orders', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const o = req.body || {};
    const mobile = String(o.mobile || '');
    if (!mobile || !o.orderId) return res.status(400).json({ error: 'mobile & orderId required' });

    // SERVER-AUTHORITATIVE total: re-price the cart from the catalog. Never trust
    // the client's total/discount/coupon — they are display values only.
    const q = await quoteOrder(o.items, o.coupon, mobile);
    if (!q.ok) return res.status(400).json({ error: 'Some items could not be priced. Please refresh your cart.' });
    // once-per-user coupon backstop (defence in depth)
    if (q.code && COUPONS[q.code] && COUPONS[q.code].oncePerUser && await couponUsedBy(mobile, q.code)) {
      return res.status(409).json({ error: 'coupon already used', coupon: q.code });
    }

    // PAYMENT TRUST: only mark an order "paid" when a Razorpay payment was
    // verified for this exact amount. Otherwise paid stays false (e.g. COD), and
    // a client claiming paid:true with no real payment is ignored.
    let paid = false, paymentId = '';
    const pending = o.razorpayOrderId ? pendingPayments.get(String(o.razorpayOrderId)) : null;
    if (pending && pending.verified && pending.amount === Math.round(q.total * 100)) {
      paid = true; paymentId = pending.paymentId || '';
      pendingPayments.delete(String(o.razorpayOrderId));   // consume — can't be reused
    } else if (!razorpay && o.demo === true) {
      paid = !!o.paid;   // demo mode only (no real Razorpay configured): simulated payment
    }

    const order = await Order.create({
      orderId: o.orderId, mobile, customerName: o.customerName || '',
      title: o.title || '', total: money(q.total), totalNum: q.total,
      image: o.image || '', items: o.items || [], address: o.address || {},
      payment: o.payment || '', coupon: q.code, discount: q.discount,
      paid, paymentId,
      status: 'Confirmed', date: Date.now()
    });
    res.json({ order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { mobile } = req.query;
    if (!mobile) return res.status(400).json({ error: 'mobile required' });
    const orders = await Order.find({ mobile }).sort({ date: -1 });
    res.json({ orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// customer cancels their own order (only before it ships)
app.put('/api/orders/:orderId/cancel', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { mobile, reason } = req.body || {};
    if (!mobile) return res.status(400).json({ error: 'mobile required' });
    const order = await Order.findOne({ orderId: req.params.orderId, mobile });
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (['Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'].indexOf(order.status) > -1)
      return res.status(400).json({ error: 'This order can no longer be cancelled.' });
    order.status = 'Cancelled';
    order.cancelReason = reason || '';
    order.cancelledAt = Date.now();
    order.refundStatus = order.paid ? 'Refund initiated' : 'No payment taken';
    await order.save();
    res.json({ order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- admin (password protected) ---------- */
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || (req.body && req.body.password);
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'wrong password' });
  res.json({ ok: true });
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ orders: await Order.find({}).sort({ date: -1 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/customers', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ customers: await User.find({}).sort({ createdAt: -1 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/leads', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ leads: await Lead.find({}).sort({ createdAt: -1 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/dealers', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ dealers: await Dealer.find({}).sort({ createdAt: -1 }) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/orders/:orderId', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const set = {};
    if (b.status !== undefined) set.status = String(b.status).slice(0, 40);
    if (b.customerName !== undefined) set.customerName = String(b.customerName).slice(0, 120);
    if (b.payment !== undefined) set.payment = String(b.payment).slice(0, 60);
    if (b.address !== undefined && typeof b.address === 'object') set.address = b.address;
    const order = await Order.findOneAndUpdate({ orderId: req.params.orderId }, { $set: set }, { new: true });
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json({ order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/orders/:orderId', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const r = await Order.findOneAndDelete({ orderId: req.params.orderId });
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* edit / delete a customer */
app.put('/api/admin/customers/:mobile', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const set = {};
    if (b.name !== undefined) set.name = String(b.name).slice(0, 120);
    if (b.email !== undefined) set.email = String(b.email).slice(0, 160);
    const user = await User.findOneAndUpdate({ mobile: req.params.mobile }, { $set: set }, { new: true });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/customers/:mobile', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const r = await User.findOneAndDelete({ mobile: req.params.mobile });
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* edit / delete a demo-kit lead */
app.put('/api/admin/leads/:id', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const allow = ['name', 'phone', 'email', 'age', 'address', 'village', 'city', 'state', 'pincode', 'source', 'home_type'];
    const set = {};
    allow.forEach((k) => { if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 200); });
    const lead = await Lead.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!lead) return res.status(404).json({ error: 'not found' });
    res.json({ lead });
  } catch (e) { res.status(400).json({ error: 'invalid id' }); }
});

app.delete('/api/admin/leads/:id', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const r = await Lead.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'invalid id' }); }
});

/* edit / delete a dealership application */
app.put('/api/admin/dealers/:id', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const allow = ['fullName', 'businessName', 'mobile', 'email', 'pincode', 'city', 'state', 'businessType', 'currentProducts', 'experience', 'message'];
    const set = {};
    allow.forEach((k) => { if (b[k] !== undefined) set[k] = String(b[k]).slice(0, 500); });
    const dealer = await Dealer.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!dealer) return res.status(404).json({ error: 'not found' });
    res.json({ dealer });
  } catch (e) { res.status(400).json({ error: 'invalid id' }); }
});

app.delete('/api/admin/dealers/:id', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const r = await Dealer.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'invalid id' }); }
});

/* ---------- admin UNDO: re-insert a record that was just deleted ----------
   The admin sends back the exact document it had cached (incl. its _id), so the
   restored row keeps the same id/timestamps. */
function restoreDoc(Model, body) {
  const d = (body && body.doc) || {};
  delete d.__v;                 // mongoose version key — let it regenerate
  return Model.create(d);
}
app.post('/api/admin/leads/restore', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ lead: await restoreDoc(Lead, req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/orders/restore', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ order: await restoreDoc(Order, req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/customers/restore', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ user: await restoreDoc(User, req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/dealers/restore', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try { res.json({ dealer: await restoreDoc(Dealer, req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- clean URLs (no “.html”, no “/html/” in the address bar) ----------
   The pages physically live in /html (plus a couple in their own folders), but
   we serve and show them as bare, professional paths like /login, /cart,
   /product. Any old “…/x.html” address is permanently redirected to its clean
   form, and clean paths are resolved back to the real file on disk. This needs
   no changes to the 500+ existing links — they keep working and just land on a
   clean URL. */

// turn a request path into a clean slug:  '/html/cart.html' -> 'cart', '/' -> ''
function cleanSlug(p) {
  return decodeURIComponent(p)
    .replace(/^\/+/, '')        // drop leading slash(es)
    .replace(/^html\//i, '')    // pages live under /html
    .replace(/\.html$/i, '')    // drop the “.html” extension
    .replace(/\/index$/i, '')   // “folder/index” -> “folder”
    .replace(/\/+$/, '');       // drop any trailing slash
}

// resolve a clean slug back to a real file on disk (or null if none matches)
function resolvePage(slug) {
  const tries = slug === ''
    ? ['index.html']
    : ['html/' + slug + '.html', slug + '.html', slug + '/index.html'];
  for (const rel of tries) {
    const fp = path.join(ROOT, rel);
    if (fp.startsWith(ROOT) && fs.existsSync(fp)) return fp;   // stay inside ROOT
  }
  return null;
}

// 1) canonicalize: 301-redirect any “.html” / “/html/…” address to its clean form
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  const lower = req.path.toLowerCase();
  const isHtml = lower.endsWith('.html');
  const inHtmlDir = lower.startsWith('/html/');
  if (!isHtml && !inHtmlDir) return next();

  let target;
  // keep folder pages (e.g. /become-a-business-partner) as directory URLs so
  // their same-folder assets (script.js, styles.css) keep resolving
  if (!inHtmlDir && /\/index\.html$/i.test(req.path)) {
    target = req.path.replace(/\/index\.html$/i, '/');
  } else {
    const slug = cleanSlug(req.path);
    target = slug ? '/' + slug : '/';
  }
  const qs = req.originalUrl.slice(req.path.length);            // keep ?query=…
  if (target + qs === req.originalUrl) return next();
  res.redirect(301, target + qs);
});

/* ---------- retired account pages ----------
   Sign-in, registration and account/address management all happen in the
   on-page modal (DcalAuth) — the old standalone Shopify template pages
   (login, register, account, addresses, password reset/activation) were
   removed. Send any old link, bookmark or no-JS account-icon click to the
   homepage, where the account modal is available, instead of a 404. */
const RETIRED_PAGES = new Set([
  'login', 'register', 'account', 'addresses',
  'reset-password', 'activate-account', 'password'
]);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (RETIRED_PAGES.has(cleanSlug(req.path))) return res.redirect(301, '/');
  next();
});

/* ---------- serve the storefront ---------- */
// Don't let anyone download the server source, dependencies or config files.
// (express.static already ignores dotfiles like .env / .git by default.)
const BLOCKED = /^\/(server|node_modules|package\.json|package-lock\.json|render\.yaml|SETUP-AND-DEPLOY\.md)(\/|$)/i;
app.use((req, res, next) => {
  if (BLOCKED.test(req.path)) return res.status(404).sendFile(path.join(ROOT, 'html', '404.html'));
  next();
});
app.use(express.static(ROOT, { dotfiles: 'ignore' }));
// unknown API route -> JSON 404 (so the page resolver below never hijacks /api)
app.all('/api/*', (req, res) => res.status(404).json({ error: 'not found' }));
// 2) clean path -> real file; anything truly unknown gets the 404 page
app.get('*', (req, res) => {
  const fp = resolvePage(cleanSlug(req.path));
  if (fp) return res.sendFile(fp);
  res.status(404).sendFile(path.join(ROOT, 'html', '404.html'));
});

app.listen(PORT, () => console.log('D\'Cal server running on http://localhost:' + PORT));
