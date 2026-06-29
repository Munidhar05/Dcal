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
  var STATUSES = ['Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

  var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

  var API_BASE = (typeof window !== 'undefined' && window.DCAL_API_BASE) || '';
  var SERVER = false;          // true once we confirm a live backend with a database
  var serverOrders = [];        // cache of orders fetched from the server
  var serverCustomers = [];     // cache of customers fetched from the server
  var serverLeads = [];         // cache of demo-kit leads fetched from the server

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
    return Promise.all([api('GET', '/api/admin/orders'), api('GET', '/api/admin/customers'), api('GET', '/api/admin/leads')])
      .then(function (res) {
        serverOrders = (res[0] && res[0].orders) || [];
        serverCustomers = (res[1] && res[1].customers) || [];
        serverLeads = (res[2] && res[2].leads) || [];
      });
  }

  function read(key, fb) { try { var v = LS.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function write(key, val) { try { LS.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function priceNum(s) { var n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; }
  function fmtDate(t) { return t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
  function fmtDay(t) { return t ? new Date(t).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'; }

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

  // every free-demo-kit form submission (public form -> Lead collection)
  function demokitRows() {
    if (SERVER) {
      return serverLeads.map(function (i) {
        return {
          id: i._id, name: i.name || '—', phone: i.phone || '—', email: i.email || '',
          age: i.age || '', address: i.address || '', village: i.village || '',
          city: i.city || '', state: i.state || '', pincode: i.pincode || '',
          source: i.source || '', home_type: i.home_type || '', claimedAt: i.createdAt
        };
      }).sort(function (a, b) { return (b.claimedAt || 0) - (a.claimedAt || 0); });
    }
    return [];   // leads are a server feature; no localStorage fallback
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
      aov: paidCount ? revenue / paidCount : 0, demokits: demokitRows().length
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
        if (val === ADMIN_PASSCODE) { LS.setItem(K_ADMIN, '1'); renderDash('orders'); }
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
          return '<span class="adm-chip adm-chip--' + st.toLowerCase() + '">' + st + ': <b>' + (s.byStatus[st] || 0) + '</b></span>';
        }).join('') + '</div>' +
        '<div class="adm-tabs">' +
          '<button class="adm-tab' + (tab === 'orders' ? ' active' : '') + '" data-tab="orders">Orders (' + s.orders + ')</button>' +
          '<button class="adm-tab' + (tab === 'customers' ? ' active' : '') + '" data-tab="customers">Customers (' + s.customers + ')</button>' +
          '<button class="adm-tab' + (tab === 'demokits' ? ' active' : '') + '" data-tab="demokits">Demo Kits (' + s.demokits + ')</button>' +
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
    else if (tab === 'demokits') renderDemokits();
    else renderOrders();
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
          '<td>' + fmtDay(o.date) + '</td>' +
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
    return '<select class="adm-status adm-status--' + cur.toLowerCase() + '" data-status data-mobile="' + esc(mobile) + '" data-idx="' + idx + '" data-oid="' + esc(orderId) + '">' +
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
        sel.className = 'adm-status adm-status--' + sel.value.toLowerCase();
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
          '<td>' + fmtDay(r.createdAt) + '</td>' +
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

  /* ---------- demo-kit leads panel ---------- */
  function renderDemokits() {
    var panel = document.getElementById('adm-panel');
    var rows = demokitRows();
    panel.innerHTML =
      '<div class="adm-toolbar"><input class="adm-input adm-search" id="adm-dsearch" placeholder="Search by name, phone, village, city, PIN…"></div>' +
      '<div class="adm-tablewrap">' + demokitsTable(rows) + '</div>';
    wireActions();
    var search = document.getElementById('adm-dsearch');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var filtered = !q ? rows : rows.filter(function (r) {
        return [r.name, r.phone, r.email, r.village, r.city, r.state, r.pincode].join(' ').toLowerCase().indexOf(q) > -1;
      });
      panel.querySelector('.adm-tablewrap').innerHTML = demokitsTable(filtered);
      wireActions();
    });
  }

  function demokitsTable(rows) {
    if (!rows.length) return '<div class="adm-empty">No demo-kit requests yet.</div>';
    return '<table class="adm-table"><thead><tr>' +
      '<th>Name</th><th>Phone</th><th>Village / Area</th><th>City / District</th><th>State</th><th>PIN</th><th>Home</th><th>Source</th><th>Requested</th><th></th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        return '<tr>' +
          '<td><b>' + esc(r.name) + '</b>' + (r.email ? '<br><span class="adm-muted">' + esc(r.email) + '</span>' : '') + '</td>' +
          '<td>+91 ' + esc(r.phone) + '</td>' +
          '<td>' + esc(r.village || '—') + '</td>' +
          '<td>' + esc(r.city || '—') + '</td>' +
          '<td>' + esc(r.state || '—') + '</td>' +
          '<td>' + esc(r.pincode || '—') + '</td>' +
          '<td>' + esc(r.home_type || '—') + '</td>' +
          '<td>' + esc(r.source || '—') + '</td>' +
          '<td>' + fmtDay(r.claimedAt) + '</td>' +
          actionCell('lead', r.id) +
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
    return kind === 'lead' ? '/api/admin/leads/' + encodeURIComponent(id)
      : kind === 'customer' ? '/api/admin/customers/' + encodeURIComponent(id)
        : '/api/admin/orders/' + encodeURIComponent(id);
  }
  function tabFor(kind) { return kind === 'lead' ? 'demokits' : kind === 'customer' ? 'customers' : 'orders'; }

  // UNDO an edit: re-apply the captured previous values
  function editUndo(kind, id, before) {
    api('PUT', pathFor(kind, id), before).then(function () { reloadAnd(tabFor(kind), 'Reverted'); })
      .catch(function (e) { toast('Undo failed: ' + e.message); });
  }
  // UNDO a delete: re-insert the captured document
  function restoreDeleted(kind, doc) {
    if (!doc) { toast('Nothing to undo'); return; }
    api('POST', '/api/admin/' + (kind === 'lead' ? 'leads' : kind === 'customer' ? 'customers' : 'orders') + '/restore', { doc: doc })
      .then(function () { reloadAnd(tabFor(kind), 'Restored'); })
      .catch(function (e) { toast('Undo failed: ' + e.message); });
  }
  function snapshotFor(kind, id) {
    if (kind === 'lead') return serverLeads.filter(function (l) { return String(l._id) === String(id); })[0];
    if (kind === 'customer') return serverCustomers.filter(function (u) { return u.mobile === id; })[0];
    return serverOrders.filter(function (o) { return o.orderId === id; })[0];
  }

  function onEdit(kind, id) {
    if (kind === 'lead') {
      var r = demokitRows().filter(function (x) { return String(x.id) === String(id); })[0];
      if (!r) return;
      var lf = [
        { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
        { key: 'age', label: 'Age' }, { key: 'address', label: 'Address' }, { key: 'village', label: 'Village / Area' },
        { key: 'city', label: 'City / District' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'Pincode' },
        { key: 'home_type', label: 'Home type' }, { key: 'source', label: 'Source' }
      ];
      var before = {}; lf.forEach(function (f) { before[f.key] = r[f.key] == null ? '' : r[f.key]; });
      editModal('Edit demo-kit lead', lf, r, function (out, close) {
        api('PUT', pathFor('lead', id), out)
          .then(function () { close(); reloadAndUndo('demokits', 'Lead updated', function () { editUndo('lead', id, before); }); })
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
    var label = kind === 'lead' ? 'demo-kit lead' : kind;
    if (!confirm('Delete this ' + label + '? You can Undo right after.')) return;
    var snap = SERVER ? snapshotFor(kind, id) : null;
    if (kind === 'lead') {
      api('DELETE', pathFor('lead', id))
        .then(function () { serverLeads = serverLeads.filter(function (l) { return String(l._id) !== String(id); }); renderDash('demokits'); undoToast('Lead deleted', function () { restoreDeleted('lead', snap); }); })
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
        return [r.name, r.mobile, r.email, fmtDay(r.createdAt), r.logins, fmtDate(r.lastLogin), r.orders, r.spent.toFixed(2), r.addresses, r.cart];
      });
      download('dcal-customers.csv', toCSV(['Name', 'Mobile', 'Email', 'Joined', 'Logins', 'LastLogin', 'Orders', 'Spent', 'Addresses', 'CartItems'], rows));
    } else if (tab === 'demokits') {
      var drows = demokitRows().map(function (r) {
        return [r.name, r.phone, r.email, r.age, r.address, r.village, r.city, r.state, r.pincode, r.home_type, r.source, fmtDate(r.claimedAt)];
      });
      download('dcal-demo-kits.csv', toCSV(['Name', 'Phone', 'Email', 'Age', 'Address', 'Village/Area', 'City/District', 'State', 'Pincode', 'HomeType', 'Source', 'RequestedAt'], drows));
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
