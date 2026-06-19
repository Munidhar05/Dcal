---
name: auth-system-clientside
description: D'Cal login/profile system is fully client-side with simulated OTP; needs a backend to go live
metadata:
  type: project
---

The D'Cal site is a **static** export (no Shopify, no Node backend — see README.txt). The Flipkart/Myntra-style login system built on 2026-06-18 is therefore **fully client-side**:

- Code lives in [js/auth.js](../js/auth.js) (logic) + the `D'CAL AUTH SYSTEM` block at the end of [css/premium-custom.css](../css/premium-custom.css) (styles). Wired into every store page (index.html + html/*.html) via a `<script src=".../js/auth.js" defer>` tag after premium-custom.js.
- Persistence is **localStorage** keyed by the account id (mobile for OTP users, lowercase email for Google users): `dcal_users` (accounts), `dcal_session` (current id), `dcal_cart:<id>`, `dcal_orders:<id>`.
- **Real login = Google Sign-In.** Set `GOOGLE_CLIENT_ID` at the top of [js/auth.js](../js/auth.js) (Google Identity Services, loaded dynamically; no backend). While that constant is **blank**, the modal falls back to the **simulated phone OTP** demo (6-digit code shown in a "Demo mode" box — no SMS). Google only works over http(s) (localhost/deployed), not `file://`.
- Public API: `window.DcalAuth` (`open()`, `openProfile()`, `isLoggedIn()`, `user()`, `logout()`, `require(cb)`).
- Gating is by `require(cb)` + a capture-phase click interceptor matching add-to-cart (`[data-pp-atc]`, `button[name=add]`) and checkout (`[name=checkout]`, `[data-pp-buynow]`). Add-to-cart redirects to cart.html; checkout/Buy Now records an order. Guests get the login modal; logged-in users pass through. **Wishlist was removed.**
- Multi-product: [js/product.js](../js/product.js) holds the product catalog; cards link `product.html?id=<slug>` and the product page renders the chosen item.

The standalone [html/login.html](../html/login.html) page still exists but is now redundant — the header account icon opens the modal everywhere.
