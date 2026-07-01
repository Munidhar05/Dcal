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
app.set('trust proxy', true);   // so req.protocol is https behind Render's proxy
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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';   // OAuth client id for Google Sign-In
const SMTP_HOST = process.env.SMTP_HOST || '';                 // email OTP sender (any SMTP provider)
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';     // e.g. https://yourdomain.com (for email images)

/* ---------- customer sessions (signed httpOnly cookie) ----------
   A logged-in customer carries a signed token in an httpOnly cookie. Every
   customer endpoint reads identity from this token via authCustomer() — the
   client-supplied `mobile` is never trusted. This closes the IDOR where anyone
   could read another customer's orders by guessing their phone number.

   PHASE 1 NOTE: the token is currently minted by the existing login flow, which
   still trusts the phone number (the OTP is client-side). The lock is in place;
   real verification (Google Sign-In / email OTP) gets wired to the mint point in
   the next phases, which is what makes guessing a number stop working. */
const SESSION_COOKIE = 'dcal_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;            // 30 days
const SESSION_SECRET = process.env.SESSION_SECRET
  || crypto.randomBytes(32).toString('hex');               // random per-boot fallback
if (!process.env.SESSION_SECRET) {
  console.warn('⚠ SESSION_SECRET not set — using a random per-boot secret (logins reset on restart). Set it in .env for production.');
}
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); }
function signSession(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  return body + '.' + sig;
}
function verifySession(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 1) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch (e) { return null; }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
function parseCookies(req) {
  const out = {}; const h = req.headers && req.headers.cookie; if (!h) return out;
  h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function issueSession(res, mobile) {
  const token = signSession({ mobile: String(mobile), iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: !!process.env.COOKIE_SECURE,
    maxAge: SESSION_TTL_MS, path: '/'
  });
}
function clearSession(res) { res.clearCookie(SESSION_COOKIE, { path: '/' }); }
// gate a route: require a valid session, expose req.customerMobile, ignore any client-sent mobile
function authCustomer(req, res, next) {
  const payload = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!payload || !payload.mobile) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.customerMobile = String(payload.mobile);
  next();
}

/* ---------- Google Sign-In verification ----------
   Verify a Google ID token (the `credential` the browser's Google button returns)
   server-side via Google's tokeninfo endpoint, then confirm it was issued for OUR
   app (aud === GOOGLE_CLIENT_ID) and that the email is verified. This is what makes
   a login real: the client can no longer just claim to be a phone number — it must
   present a token Google signed for this app. Returns the verified profile or null.
   (For high traffic, switch to local JWKS verification / google-auth-library.) */
async function verifyGoogleCredential(credential) {
  if (!GOOGLE_CLIENT_ID || !credential || typeof credential !== 'string') return null;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return null;
    const p = await r.json();
    if (p.aud !== GOOGLE_CLIENT_ID) return null;                                    // token must be for THIS app
    if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') return null;
    if (String(p.email_verified) !== 'true') return null;                          // only verified emails
    if (!p.sub) return null;
    return { sub: String(p.sub), email: String(p.email || '').toLowerCase(), name: p.name || '', picture: p.picture || '' };
  } catch (e) { return null; }
}

/* ---------- email OTP (free fallback for customers without a Google account) ----------
   We generate a 6-digit code, email it, and store only its HMAC hash + expiry in
   memory (codes are short-lived; losing them on restart is fine). Verified emails
   then carry a short-lived signed "ticket" into the phone-binding step. SMTP is
   provider-agnostic — Gmail app-password, Brevo, Resend, etc. all work. */
let mailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  const nodemailer = require('nodemailer');
  mailer = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  console.log('✓ Email OTP enabled (SMTP ' + SMTP_HOST + ')');
}
// once a real verification method exists, we stop minting sessions from a bare phone number
function secureAuthAvailable() { return !!GOOGLE_CLIENT_ID || !!mailer; }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const emailOtps = new Map();                 // email -> { hash, exp, attempts, lastSent }
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
function otpHash(email, code) { return crypto.createHmac('sha256', SESSION_SECRET).update(email + '|' + code).digest('hex'); }
function sweepOtps() { const now = Date.now(); for (const [k, v] of emailOtps) if (now > v.exp) emailOtps.delete(k); }
async function sendOtpEmail(to, code) {
  const subject = "Your D'Cal sign-in code";
  const text = "Your D'Cal verification code is " + code + ". It expires in 10 minutes. If you didn't request this, you can ignore this email.";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:auto;padding:8px">'
    + '<h2 style="color:#0077B6;margin:0 0 8px">D\'Cal</h2>'
    + '<p style="color:#0B1220;margin:0 0 6px">Your verification code is:</p>'
    + '<p style="font-size:30px;font-weight:800;letter-spacing:6px;color:#0B1220;margin:0 0 10px">' + code + '</p>'
    + '<p style="color:#64748B;font-size:13px;margin:0">This code expires in 10 minutes. If you didn\'t request it, ignore this email.</p></div>';
  if (!mailer) { console.log('[email-otp DEV] code for ' + to + ' = ' + code + '  (set SMTP_* in .env to actually send)'); return; }
  await mailer.sendMail({ from: MAIL_FROM, to: to, subject: subject, text: text, html: html });
}

/* ---------- transactional emails (order lifecycle) ----------
   Fire-and-forget: a failed email must NEVER break an order. Customers are mailed
   at their account email (if we have one); the store gets a copy of new orders and
   cancellations at STORE_NOTIFY_EMAIL (defaults to the From address). */
const STORE_NOTIFY_EMAIL = process.env.STORE_NOTIFY_EMAIL || MAIL_FROM;
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function sendMail(opts) {
  if (!mailer) { console.log('[mail DEV] to=' + opts.to + ' | subject=' + opts.subject); return Promise.resolve(); }
  return mailer.sendMail({ from: MAIL_FROM, to: opts.to, subject: opts.subject, text: opts.text || '', html: opts.html || '' });
}
// build an absolute, email-safe URL; pass through full URLs, prefix relative ones
function absUrl(base, u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (!base) return '';
  return base.replace(/\/+$/, '') + '/' + String(u).replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '');
}
// site origin for email images: PUBLIC_BASE_URL if set, else derive from the request
function baseUrlFrom(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, '');
  try { return req.protocol + '://' + req.get('host'); } catch (e) { return ''; }
}
function mailLayout(heading, inner, logoUrl) {
  const wordmark = '<span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:.3px;vertical-align:middle">D\'Cal</span>';
  const brand = logoUrl
    ? '<img src="' + logoUrl + '" alt="" height="34" style="height:34px;width:auto;border:0;vertical-align:middle;margin-right:10px">' + wordmark
    : wordmark;
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0B1220">'
    + '<div style="background:linear-gradient(135deg,#0077B6,#00B4D8);padding:18px 22px;border-radius:14px 14px 0 0">'
    + brand + '</div>'
    + '<div style="border:1px solid #E2E8F0;border-top:0;border-radius:0 0 14px 14px;padding:22px">'
    + '<h2 style="margin:0 0 12px;font-size:19px">' + heading + '</h2>' + inner
    + '<p style="color:#94A3B8;font-size:12px;margin:22px 0 0">D\'Cal · automated message, please don\'t reply.</p>'
    + '</div></div>';
}
function logoFor(base) { return absUrl(base, 'img/dcal-logo.png'); }
// Outlook can't render .webp — if a .jpg/.jpeg/.png twin exists on disk, use it
function preferRasterImage(rel) {
  if (!rel || /^https?:\/\//i.test(rel)) return rel;
  const clean = String(rel).replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '');
  if (!/\.webp$/i.test(clean)) return clean;
  const stem = clean.replace(/\.webp$/i, '');
  for (const ext of ['.jpg', '.jpeg', '.png']) {
    try { if (fs.existsSync(path.join(ROOT, stem + ext))) return stem + ext; } catch (e) {}
  }
  return clean;
}
function productImgHtml(base, order) {
  const raw = order && order.image;
  const src = (raw && /^https?:\/\//i.test(raw)) ? raw : absUrl(base, preferRasterImage(raw));
  return src ? '<img src="' + src + '" alt="" width="150" style="border-radius:10px;margin:8px 0;max-width:150px;height:auto;border:1px solid #F1F5F9">' : '';
}
function orderItemsHtml(order) {
  const items = order.items || [];
  if (!items.length) return '';
  return '<table style="width:100%;border-collapse:collapse;margin:10px 0">'
    + items.map((it) => '<tr><td style="padding:6px 0;border-bottom:1px solid #F1F5F9;font-size:14px">' + escHtml(it.title || 'Item') + ' &times; ' + (it.qty || 1) + '</td></tr>').join('')
    + '</table>';
}
function addressHtml(a) {
  a = a || {};
  const parts = [a.name, a.line, [a.city, a.state, a.pincode].filter(Boolean).join(', '), a.phone].filter(Boolean);
  return parts.length ? '<p style="margin:6px 0;color:#475569;font-size:14px">' + parts.map(escHtml).join('<br>') + '</p>' : '';
}
async function emailForMobile(mobile) {
  try { const u = await User.findOne({ mobile }); return (u && u.email) ? u.email : ''; }
  catch (e) { return ''; }
}
const STATUS_MSG = {
  'Confirmed': "We've received your order and it's confirmed.",
  'Processing': 'Your order is being prepared for dispatch.',
  'Shipped': 'Good news — your order has shipped!',
  'Out for Delivery': 'Your order is out for delivery and arriving soon.',
  'Delivered': 'Your order has been delivered. Thank you for shopping with D\'Cal!',
  'Cancelled': 'Your order has been cancelled.'
};
async function notifyOrderPlaced(order, base) {
  const logo = logoFor(base);
  const inner = '<p style="margin:0 0 6px">Hi ' + escHtml(order.customerName || 'there') + ', thanks for your order!</p>'
    + '<p style="margin:0 0 4px;color:#475569;font-size:14px">Order <b>#' + escHtml(order.orderId) + '</b> · ' + escHtml(order.total) + (order.paid ? ' · Paid' : ' · Pay on delivery') + '</p>'
    + productImgHtml(base, order)
    + orderItemsHtml(order) + addressHtml(order.address)
    + '<p style="margin:14px 0 0;color:#475569;font-size:14px">We\'ll email you as your order progresses.</p>';
  const email = await emailForMobile(order.mobile);
  if (email) sendMail({ to: email, subject: "Your D'Cal order #" + order.orderId + ' is confirmed', html: mailLayout('Order confirmed 🎉', inner, logo), text: 'Order #' + order.orderId + ' confirmed. Total ' + order.total }).catch((e) => console.warn('order-confirm email failed:', e.message));
  if (STORE_NOTIFY_EMAIL) sendMail({ to: STORE_NOTIFY_EMAIL, subject: 'New order #' + order.orderId + ' (' + order.total + ')', html: mailLayout('New order received', inner + '<p style="font-size:13px;color:#475569">Customer mobile: ' + escHtml(order.mobile) + '</p>', logo) }).catch(() => {});
}
async function notifyStatusChange(order, base) {
  const logo = logoFor(base);
  const msg = STATUS_MSG[order.status] || ('Your order status is now: ' + order.status + '.');
  const inner = '<p style="margin:0 0 8px">' + escHtml(msg) + '</p>'
    + '<p style="margin:0 0 4px;color:#475569;font-size:14px">Order <b>#' + escHtml(order.orderId) + '</b> — status: <b>' + escHtml(order.status) + '</b></p>'
    + productImgHtml(base, order)
    + orderItemsHtml(order);
  const email = await emailForMobile(order.mobile);
  if (email) sendMail({ to: email, subject: "D'Cal order #" + order.orderId + ': ' + order.status, html: mailLayout('Order update', inner, logo), text: 'Order #' + order.orderId + ' is now ' + order.status }).catch((e) => console.warn('status email failed:', e.message));
}
async function notifyOrderCancelled(order, base) {
  const logo = logoFor(base);
  const inner = '<p style="margin:0 0 8px">Your order <b>#' + escHtml(order.orderId) + '</b> has been cancelled.</p>'
    + productImgHtml(base, order)
    + orderItemsHtml(order)
    + (order.refundStatus ? '<p style="margin:8px 0 4px;color:#475569;font-size:14px">Refund: ' + escHtml(order.refundStatus) + '</p>' : '')
    + (order.cancelReason ? '<p style="margin:0;color:#475569;font-size:14px">Reason: ' + escHtml(order.cancelReason) + '</p>' : '');
  const email = await emailForMobile(order.mobile);
  if (email) sendMail({ to: email, subject: "D'Cal order #" + order.orderId + ' cancelled', html: mailLayout('Order cancelled', inner, logo), text: 'Order #' + order.orderId + ' cancelled.' }).catch(() => {});
  if (STORE_NOTIFY_EMAIL) sendMail({ to: STORE_NOTIFY_EMAIL, subject: 'Order #' + order.orderId + ' cancelled', html: mailLayout('Order cancelled', inner + '<p style="font-size:13px;color:#475569">Customer mobile: ' + escHtml(order.mobile) + '</p>', logo) }).catch(() => {});
}
// label/value table for lead & dealership notifications (skips empty fields)
function detailTable(rows) {
  return '<table style="width:100%;border-collapse:collapse;font-size:14px">'
    + rows.filter((r) => r[1]).map((r) => '<tr><td style="padding:5px 10px 5px 0;color:#64748B;white-space:nowrap;vertical-align:top">' + escHtml(r[0]) + '</td><td style="padding:5px 0;color:#0B1220">' + escHtml(r[1]) + '</td></tr>').join('')
    + '</table>';
}
async function notifyNewLead(lead, base) {
  const logo = logoFor(base);
  const inner = detailTable([
    ['Name', lead.name], ['Phone', lead.phone], ['Email', lead.email], ['Village/Area', lead.village],
    ['City', lead.city], ['State', lead.state], ['Pincode', lead.pincode], ['Home type', lead.home_type], ['Source', lead.source]
  ]);
  if (STORE_NOTIFY_EMAIL) sendMail({ to: STORE_NOTIFY_EMAIL, subject: 'New demo-kit request: ' + (lead.name || lead.phone), html: mailLayout('New demo-kit request', inner, logo) }).catch(() => {});
  if (lead.email) sendMail({ to: lead.email, subject: "We've received your D'Cal demo-kit request", html: mailLayout('Request received 🎉', '<p>Hi ' + escHtml(lead.name || 'there') + ", thanks for requesting a D'Cal demo kit! Our team will contact you shortly.</p>", logo) }).catch(() => {});
}
async function notifyNewDealer(dealer, base) {
  const logo = logoFor(base);
  const inner = detailTable([
    ['Name', dealer.fullName], ['Business', dealer.businessName], ['Mobile', dealer.mobile], ['Email', dealer.email],
    ['City', dealer.city], ['State', dealer.state], ['Pincode', dealer.pincode], ['Business type', dealer.businessType],
    ['Current products', dealer.currentProducts], ['Experience', dealer.experience], ['Message', dealer.message]
  ]);
  if (STORE_NOTIFY_EMAIL) sendMail({ to: STORE_NOTIFY_EMAIL, subject: 'New dealership application: ' + (dealer.fullName || dealer.businessName || dealer.mobile), html: mailLayout('New dealership application', inner, logo) }).catch(() => {});
  if (dealer.email) sendMail({ to: dealer.email, subject: "We've received your D'Cal dealership application", html: mailLayout('Application received 🤝', '<p>Hi ' + escHtml(dealer.fullName || 'there') + ", thanks for your interest in becoming a D'Cal dealer! Our team will review your application and reach out soon.</p>", logo) }).catch(() => {});
}

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
    const { mobile, resume } = req.body || {};
    if (!mobile) return res.status(400).json({ error: 'mobile required' });
    const user = await User.findOne({ mobile });
    if (!user) return res.json({ isNew: true });
    // `resume` just refreshes the session cookie on page load — don't double-count it as a login
    if (!resume) {
      user.logins = (user.logins || 0) + 1;
      user.lastLogin = Date.now();
      await user.save();
    }
    // Phone login is unverified (no SMS). Once Google/email is configured we STOP
    // minting sessions here, so the only way to get a session is a real verification.
    if (!secureAuthAvailable()) issueSession(res, mobile);
    res.json({ isNew: false, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// clear the session cookie
app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

// public front-end config (the Google client id is public by design)
app.get('/api/config', (req, res) => { res.json({ googleClientId: GOOGLE_CLIENT_ID, emailLogin: !!mailer }); });

// soft session check (no 401) — lets the client reconcile a stale local login
app.get('/api/session/me', (req, res) => {
  const p = verifySession(parseCookies(req)[SESSION_COOKIE]);
  res.json({ loggedIn: !!(p && p.mobile), mobile: (p && p.mobile) || null });
});

/* Email OTP: request a code -> verify it -> (first time) bind a phone number. */
app.post('/api/auth/email/request', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    sweepOtps();
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 160) return res.status(400).json({ error: 'Enter a valid email address.' });
    const prev = emailOtps.get(email);
    if (prev && Date.now() - prev.lastSent < OTP_RESEND_MS) return res.status(429).json({ error: 'Please wait a few seconds before requesting another code.' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    emailOtps.set(email, { hash: otpHash(email, code), exp: Date.now() + OTP_TTL_MS, attempts: 0, lastSent: Date.now() });
    try { await sendOtpEmail(email, code); }
    catch (e) { emailOtps.delete(email); return res.status(502).json({ error: 'Could not send the email. Please try again.' }); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/email/verify', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const code = String((req.body || {}).code || '').replace(/[^0-9]/g, '');
    const rec = emailOtps.get(email);
    if (!rec || Date.now() > rec.exp) { emailOtps.delete(email); return res.status(400).json({ error: 'Code expired. Please request a new one.' }); }
    if (rec.attempts >= OTP_MAX_ATTEMPTS) { emailOtps.delete(email); return res.status(429).json({ error: 'Too many attempts. Please request a new code.' }); }
    rec.attempts++;
    if (code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit code.' });
    const ok = crypto.timingSafeEqual(Buffer.from(rec.hash), Buffer.from(otpHash(email, code)));
    if (!ok) return res.status(400).json({ error: 'Incorrect code. Please try again.' });
    emailOtps.delete(email);                 // consume on success
    const user = await User.findOne({ email });
    if (user) { issueSession(res, user.mobile); return res.json({ user }); }
    const ticket = signSession({ email: email, purpose: 'email', iat: Date.now(), exp: Date.now() + 10 * 60 * 1000 });
    res.json({ needPhone: true, ticket: ticket, profile: { email: email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/email/bind', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const payload = verifySession(b.ticket);
    if (!payload || payload.purpose !== 'email' || !payload.email) return res.status(401).json({ error: 'Verification expired. Please sign in again.' });
    const email = String(payload.email).toLowerCase();
    const existing = await User.findOne({ email });            // linked since the ticket was issued
    if (existing) { issueSession(res, existing.mobile); return res.json({ user: existing }); }
    const mobile = String(b.mobile || '').replace(/[^0-9]/g, '').slice(0, 10);
    if (mobile.length !== 10 || !/^[6-9]/.test(mobile)) return res.status(400).json({ error: 'A valid 10-digit mobile number is required.' });
    const taken = await User.findOne({ mobile });
    if (taken) return res.status(409).json({ error: 'This mobile number is already registered. Please sign in with that number instead.' });
    const user = await User.create({ mobile, email, name: '', provider: 'email', logins: 1, lastLogin: Date.now() });
    issueSession(res, mobile);
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Google Sign-In: verify the credential, then either log the existing user in or,
   for a first-time Google user, tell the client to collect a phone number to bind
   (we key orders by mobile, and need it for delivery). */
app.post('/api/auth/google', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const info = await verifyGoogleCredential((req.body || {}).credential);
    if (!info) return res.status(401).json({ error: 'Google sign-in could not be verified.' });
    const user = await User.findOne({ googleId: info.sub });
    if (user) {
      user.logins = (user.logins || 0) + 1;
      user.lastLogin = Date.now();
      if (info.name && !user.name) user.name = info.name;
      if (info.picture) user.avatar = info.picture;
      if (info.email && !user.email) user.email = info.email;
      await user.save();
      issueSession(res, user.mobile);
      return res.json({ user });
    }
    // first time with this Google account — client must bind a phone next
    res.json({ needPhone: true, profile: { name: info.name, email: info.email, picture: info.picture } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// finish a first-time Google sign-in by binding a phone number (re-verifies the credential)
app.post('/api/auth/google/bind', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const b = req.body || {};
    const info = await verifyGoogleCredential(b.credential);
    if (!info) return res.status(401).json({ error: 'Google sign-in could not be verified.' });
    // already linked (e.g. double-submit) — just log in
    const linked = await User.findOne({ googleId: info.sub });
    if (linked) { issueSession(res, linked.mobile); return res.json({ user: linked }); }

    const mobile = String(b.mobile || '').replace(/[^0-9]/g, '').slice(0, 10);
    if (mobile.length !== 10 || !/^[6-9]/.test(mobile)) return res.status(400).json({ error: 'A valid 10-digit mobile number is required.' });
    const taken = await User.findOne({ mobile });
    if (taken) {
      // Returning customer: the existing account carries this SAME Google-verified
      // email, so it's the same person — link Google to it and log in (don't block).
      if (taken.email && taken.email.toLowerCase() === info.email) {
        taken.googleId = info.sub;
        if (!taken.name && info.name) taken.name = info.name;
        if (info.picture) taken.avatar = info.picture;
        taken.logins = (taken.logins || 0) + 1;
        taken.lastLogin = Date.now();
        await taken.save();
        issueSession(res, taken.mobile);
        return res.json({ user: taken });
      }
      // number belongs to a different account (different email) — don't allow takeover
      return res.status(409).json({ error: 'This number is registered to a different account. Please use the email or number it was created with.' });
    }

    const user = await User.create({
      mobile, googleId: info.sub, email: info.email, name: info.name,
      avatar: info.picture, provider: 'google', logins: 1, lastLogin: Date.now()
    });
    issueSession(res, mobile);
    res.json({ user });
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
      if (!secureAuthAvailable()) issueSession(res, mobile);
      return res.json({ user });
    }
    user = await User.create({
      mobile, name: name || '', email: email || '', avatar: avatar || '',
      provider: provider || 'phone', logins: 1, lastLogin: Date.now()
    });
    if (!secureAuthAvailable()) issueSession(res, mobile);
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- free demo kit (one per logged-in account) ----------
   The claim is recorded on the user record. The update is atomic (it only
   succeeds when freeKitClaimed isn't already true), so a double-tap or two
   tabs can never get two kits. */
app.post('/api/freekit/claim', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { info } = req.body || {};
    const mobile = req.customerMobile;
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

app.get('/api/freekit/status/:mobile', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const u = await User.findOne({ mobile: req.customerMobile });
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
    notifyNewLead(lead, baseUrlFrom(req)).catch(() => {});
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
    notifyNewDealer(dealer, baseUrlFrom(req)).catch(() => {});
    res.json({ ok: true, already: false, id: dealer._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- profile + addresses ---------- */
app.get('/api/users/:mobile', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const user = await User.findOne({ mobile: req.customerMobile });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:mobile', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { name, email, avatar } = req.body || {};
    const set = {};
    if (name !== undefined) set.name = name;
    if (email !== undefined) set.email = email;
    if (avatar !== undefined) set.avatar = avatar;
    const user = await User.findOneAndUpdate({ mobile: req.customerMobile }, { $set: set }, { new: true });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:mobile/addresses', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { addresses, defaultAddressId } = req.body || {};
    const user = await User.findOneAndUpdate(
      { mobile: req.customerMobile },
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
  DCAL200: { type: 'flat', value: 200, min: 2000, oncePerUser: true, desc: '₹200 off orders over ₹2,000' }
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
app.post('/api/orders', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const o = req.body || {};
    const mobile = req.customerMobile;          // identity from the session, not the body
    if (!o.orderId) return res.status(400).json({ error: 'orderId required' });

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
    notifyOrderPlaced(order, baseUrlFrom(req)).catch(() => {});   // fire-and-forget order confirmation
    res.json({ order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const orders = await Order.find({ mobile: req.customerMobile }).sort({ date: -1 });
    res.json({ orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// customer cancels their own order (only before it ships)
app.put('/api/orders/:orderId/cancel', authCustomer, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { reason } = req.body || {};
    const order = await Order.findOne({ orderId: req.params.orderId, mobile: req.customerMobile });
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (['Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'].indexOf(order.status) > -1)
      return res.status(400).json({ error: 'This order can no longer be cancelled.' });
    order.status = 'Cancelled';
    order.cancelReason = reason || '';
    order.cancelledAt = Date.now();
    order.refundStatus = order.paid ? 'Refund initiated' : 'No payment taken';
    await order.save();
    notifyOrderCancelled(order, baseUrlFrom(req)).catch(() => {});
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
    const before = await Order.findOne({ orderId: req.params.orderId });
    const order = await Order.findOneAndUpdate({ orderId: req.params.orderId }, { $set: set }, { new: true });
    if (!order) return res.status(404).json({ error: 'not found' });
    // email the customer only when the status actually changed (e.g. Shipped -> Out for Delivery)
    if (set.status !== undefined && before && before.status !== order.status) notifyStatusChange(order, baseUrlFrom(req)).catch(() => {});
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
