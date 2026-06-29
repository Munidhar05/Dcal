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
