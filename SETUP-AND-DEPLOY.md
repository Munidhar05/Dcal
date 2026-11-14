# D'Cal — Setup & Deploy Guide (simple steps)

Your website now has a **central database**. That means all orders and customers
from **any phone or computer** are saved in one place, and your **Admin page**
(`/admin`) can see them all.

There are 3 parts to switch it on:
1. **MongoDB Atlas** — the free online database (the "central notebook").
2. **GitHub** — where your website code lives.
3. **Render** — runs your website on the internet.

> 💡 You do NOT have to do this immediately. Until you deploy, the site keeps
> working on each browser by itself (demo mode). When you're ready, follow below.

---

## PART 1 — Create the free database (MongoDB Atlas)

1. Go to **https://www.mongodb.com/cloud/atlas/register** and sign up (free).
2. Create a **free cluster** (choose the **M0 / FREE** option). Pick any region near India.
3. On the left menu → **Database Access** → **Add New Database User**:
   - Username: `dcal`
   - Password: click **Autogenerate** and **COPY it somewhere safe**.
   - Click **Add User**.
4. On the left menu → **Network Access** → **Add IP Address** →
   click **ALLOW ACCESS FROM ANYWHERE** (`0.0.0.0/0`) → **Confirm**.
5. On the left menu → **Database** → **Connect** → **Drivers**.
   You'll see a link that looks like this:
   ```
   mongodb+srv://dcal:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   - Copy it.
   - Replace `<password>` with the password you saved in step 3.
   - Add your database name `dcal` right before the `?` so it ends like:
   ```
   mongodb+srv://dcal:YOURPASSWORD@cluster0.xxxxx.mongodb.net/dcal?retryWrites=true&w=majority
   ```
   - **Save this whole line** — this is your `MONGODB_URI`.

---

## PART 2 — Put your code on GitHub

1. Create a free account at **https://github.com**.
2. Click **New repository** → name it `dcal` → **Create**.
3. Upload your project folder. Easiest way on Windows:
   - Install **GitHub Desktop** (https://desktop.github.com), OR
   - Ask me and I'll give you the exact `git` commands to run.

> The `.gitignore` file is already set up so your secret `.env` and
> `node_modules` folder are NOT uploaded. Good.

---

## PART 3 — Deploy on Render

1. Go to **https://render.com** and sign up (you can sign in with GitHub).
2. Click **New +** → **Web Service**.
3. Connect your **GitHub** and pick the `dcal-store` repository.
4. Fill in these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Advanced** → **Add Environment Variable** and add these two:

   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | the long link you saved in Part 1 |
   | `ADMIN_PASSWORD` | any password you want for the admin page |

6. Click **Create Web Service**. Wait a few minutes for it to build.
7. Render gives you a web address like `https://dcal-store.onrender.com`.
   That's your live store! 🎉

---

## How to use it after deploying

- **Your store:** `https://YOUR-APP.onrender.com`
- **Admin page:** `https://YOUR-APP.onrender.com/admin`
  - Log in with the **`ADMIN_PASSWORD`** you set on Render.
  - You'll see a 🟢 "Connected to live database" note — that means it's showing
    real orders from everyone.

### Test it
1. Open your store on your phone, sign in, and place an order.
2. Open the admin page on your laptop → you should see that order. ✅

---

## Local testing on your own computer (optional)

1. Make a file named `.env` in the project root and add your settings:
   ```
   MONGODB_URI=your-mongodb-connection-string
   ADMIN_PASSWORD=your-private-admin-password
   RAZORPAY_KEY_ID=your-razorpay-key-id
   RAZORPAY_KEY_SECRET=your-razorpay-key-secret
   PORT=3000
   ```
2. Open a terminal in the project folder and run:
   ```
   npm install
   npm start
   ```
3. Open **http://localhost:3000** (store) and
   **http://localhost:3000/admin** (admin).

---

## PART 4 — Turn on real payments (Razorpay)

Until you do this, online payment runs in **demo mode** (no money is taken) and
"Cash on Delivery" works normally. To accept real money:

1. Sign up at **https://razorpay.com** and finish their KYC/business verification.
2. In the Razorpay Dashboard → **Settings → API Keys → Generate Key**.
   - You'll get a **Key Id** (`rzp_test_...` or `rzp_live_...`) and a **Key Secret**.
   - Use the **Test** keys first to practice; switch to **Live** keys when ready.
3. Add these two to your **Render → Environment** (same place as before):

   | Key | Value |
   |-----|-------|
   | `RAZORPAY_KEY_ID` | your Key Id |
   | `RAZORPAY_KEY_SECRET` | your Key Secret |

4. Save — Render restarts automatically. Done! 🎉

### How payment works now
- At checkout, **UPI / Card / Net Banking** → opens the secure Razorpay popup.
  The customer pays, and the server **verifies** the payment before confirming the order.
- **Cash on Delivery** → no online payment; the order is just placed.
- In the **Admin page**, paid orders show a green **Paid** badge, and the order's
  details show the Razorpay transaction id.

### Test card (Razorpay test mode)
Card: `4111 1111 1111 1111` · any future expiry · any CVV · any name.
For UPI test, use `success@razorpay`.

---

## PART 5 — Blog (posts from Befach Creatives)

Nobody writes blog posts on this site. When a post is published in the **Befach
Creatives** app with "Also publish a blog post" ticked, the app sends the article
here and it appears at **`/blog`** straight away (no redeploy). Posts are kept in
the same MongoDB as orders (collection `blog_posts`, hero images included).
A video post also carries a link to its video (`videoUrl`, kept as a link, never
copied): the article plays it with the post's image as the poster, and `/blog`
marks it with a "Video" badge.

- **Webhook:** `POST https://dcal.co.in/api/blog/ingest` — signed with a shared
  secret (`X-Blog-Timestamp` + `X-Blog-Signature`, an HMAC-SHA256 of
  `"<timestamp>.<body>"`). Sending the same post again updates it; its address never changes.
- **Pages:** `/blog` (12 per page), `/blog/<slug>`, plus `/sitemap.xml` and `/robots.txt`.
- **Render → Environment:**

  | Key | Value |
  |-----|-------|
  | `BLOG_WEBHOOK_SECRET` | 64 random hex characters, the same value pasted into the Creatives app |
  | `SITE_URL` | `https://dcal.co.in` |

  Make a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Without it the webhook answers 503 and nothing is published.

**Test it** (prints `200 {"url":…}`; swap in the live URL to test production):
```
node --env-file=.env -e '
const crypto = require("crypto");
const body = JSON.stringify({ sourceCreativeId: "test-blog-001", businessBrandName: "Test", title: "Test post", slug: "test-post", excerpt: "Testing the blog pipeline.", bodyMarkdown: "## Hello\n\nThis is a **test** post.\n\n<script>alert(1)</script>", heroImageUrl: null });
const ts = String(Math.floor(Date.now() / 1000));
const sig = crypto.createHmac("sha256", process.env.BLOG_WEBHOOK_SECRET).update(ts + "." + body).digest("hex");
fetch(process.argv[1], { method: "POST", headers: { "Content-Type": "application/json", "X-Blog-Signature": sig, "X-Blog-Timestamp": ts }, body })
  .then(async (r) => console.log(r.status, await r.text()));
' http://localhost:3000/api/blog/ingest
```
Remove the test post afterwards (Atlas → Browse Collections → `blog_posts`, or
`mongosh "$MONGODB_URI" --eval 'db.blog_posts.deleteOne({ sourceCreativeId: "test-blog-001" })'`).

---

## PART 6 — Meta pixel + Conversions API (what Meta hears about a buyer)

The pixel (`js/tracking.js`) fires these on top of `PageView`, and the server
sends Meta the same event with the same `event_id`, so Meta counts it once:

| Event | When | Sent with |
|---|---|---|
| `ViewContent` | a product page opens | `content_ids` (the slug), `value` (the Demo Kit is its ₹99 delivery), `INR` |
| `CompleteRegistration` | a sign-in succeeds | — |
| `AddToCart` | a product or the kit is added | as ViewContent, times the quantity |
| `InitiateCheckout` | the address step opens | `value`, `num_items` |
| `AddPaymentInfo` | Razorpay opens | `value` = the amount Razorpay was opened for |
| `Purchase` | the order is saved: paid online, or Cash on Delivery placed | `value` = amount paid, `order_id` (also the `event_id`), `kit`, `wallet_used`, `payment` (`online` / `cod`) |

A Razorpay order whose payment the server can't confirm sends no Purchase, from
either side. Every order also keeps where its buyer came from: `utm_*`, `fbc`,
`fbp` and the landing page (a 90-day first-party cookie, `dcal_attr`).

- **Render → Environment:**

  | Key | Value |
  |-----|-------|
  | `META_CAPI_TOKEN` | Events Manager → pixel `2994497707552848` → Settings → Conversions API → **Generate access token** |
  | `META_TEST_EVENT_CODE` | only while testing: the code on Events Manager → **Test events** |

  Without the token the pixel still fires; only the server's copy is skipped.
  `META_GRAPH_VERSION` (default `v26.0`) only needs changing if Meta retires it.
- **Check it:** open `https://dcal.co.in/api/health`. `meta.configured` should be
  `true`, and after an order `meta.last_purchase.ok` should be `true`. If it is
  `false`, `meta.last_purchase.error` says why (for example an expired token).

**Test it** (acceptance tests 1–3): set `META_TEST_EVENT_CODE`, open
`https://dcal.co.in/product/demo-kit?utm_campaign=dcal_demokit&fbclid=test123`,
order the kit and pay the ₹99. In Events Manager → Test events you should see
`ViewContent`, `AddToCart`, `InitiateCheckout`, `AddPaymentInfo` and one `Purchase`
of 99 INR received from both browser and server. Then remove
`META_TEST_EVENT_CODE`, or live events keep landing under Test events only.

---

## PART 7 — Orders export (read only, for reporting)

Two tables, read with their own key. The key reads only these, and any write that
carries it gets 403.

- `GET /api/export/orders?from=2026-10-28&to=2026-11-14`: one row per order.
  The dates are India dates and both days count; `to` defaults to today. You get
  500 rows at a time (`&limit=` up to 1000): while `next_cursor` is not null, ask
  again with `&cursor=<it>`. `total` is the number of orders in the range, to check
  against the admin panel.
- `GET /api/export/kit-wallets`: every Demo Kit buyer with the credit it gave,
  each order that spent it, and the balance.

- **Render → Environment:** `EXPORT_API_KEY` = 64 random hex characters. Make one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and hand it
  over privately. Never put it in chat, email or git.
- **Use it:**
  ```
  curl -H "Authorization: Bearer $EXPORT_API_KEY" "https://dcal.co.in/api/export/orders?from=2026-10-28"
  ```
  A `POST` with the same header answers `403`.

---

## Notes & limits

- **Free Render** services "go to sleep" after 15 minutes of no visitors, so the
  first visit after a quiet period can take ~30–50 seconds to wake up. Paid plans
  ($7/mo) stay awake.
- **Free MongoDB Atlas** gives 512 MB storage — plenty for thousands of orders.
- Login is by **phone number only** (no password), as you chose. This is fine to
  start; tell me later if you want to add real OTP-by-SMS or password login.
- **Razorpay is integrated** (see Part 4). It stays in demo mode until you add the
  two `RAZORPAY_` keys; then it takes real payments.
- **Clean web addresses:** pages show as `/login`, `/cart`, `/product` etc.
  (no ugly `.html` or `/html/` in the address bar) — looks more professional and
  trustworthy. Any old `…/x.html` link automatically redirects to the clean one,
  so nothing breaks.
- **Change your `ADMIN_PASSWORD`** to something strong before going live.
- ⚠️ Order amounts are currently sent from the customer's browser. This is fine for
  launch, but for maximum safety we can later make the server calculate prices from
  a product list so amounts can never be tampered with. Ask me when you want that.
