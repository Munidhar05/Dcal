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
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const User = require('./models/User');
const Order = require('./models/Order');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

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

/* ---------- health ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady }));

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

/* ---------- orders (customer) ---------- */
app.post('/api/orders', async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const o = req.body || {};
    if (!o.mobile || !o.orderId) return res.status(400).json({ error: 'mobile & orderId required' });
    const order = await Order.create({
      orderId: o.orderId, mobile: o.mobile, customerName: o.customerName || '',
      title: o.title || '', total: o.total || '', totalNum: toNum(o.total),
      image: o.image || '', items: o.items || [], address: o.address || {},
      payment: o.payment || '', status: o.status || 'Confirmed', date: o.date || Date.now()
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

app.put('/api/admin/orders/:orderId', adminAuth, async (req, res) => {
  if (!requireDB(res)) return;
  try {
    const { status } = req.body || {};
    const order = await Order.findOneAndUpdate({ orderId: req.params.orderId }, { $set: { status } }, { new: true });
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json({ order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- serve the storefront ---------- */
app.use(express.static(ROOT));
// unknown API route -> JSON 404 (so the SPA fallback below never hijacks /api)
app.all('/api/*', (req, res) => res.status(404).json({ error: 'not found' }));
// everything else -> home page
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => console.log('D\'Cal server running on http://localhost:' + PORT));
