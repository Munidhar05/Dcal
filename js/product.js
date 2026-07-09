/* =========================================================
   D'Cal product catalog — makes one product.html show the
   product that was clicked (via ?id=slug) and wires every
   product card link to carry its id.  Static-site friendly.
   ========================================================= */
(function () {
  'use strict';

  var CATALOG = {
    'water-softener': {
      cat: 'Water Softener', title: "D'Cal Independent House Water Softener", rating: '4.9',
      price: '₹4,500.00', was: '₹4,500.00', img: 'water-softener-card.jpg',
      desc: 'Drop-in tank softener for independent homes. Stops scaling, hair fall and skin irritation. Lasts 12 months per cartridge.'
    },
    'shower-filter': {
      cat: 'Shower Filter', title: "D'Cal Shower Head Filter", rating: '4.8',
      price: '₹2,700.00', was: '₹2,700.00', img: 'e2e02608-3ad7-4e25-8001-85ea004cecaa-Because-your-skin-deserves-shower-head.webp',
      desc: 'Easy install with 14-stage filtration. Reduces hair fall and dry skin. 6-month replaceable cartridge.'
    },
    'tap-filter': {
      cat: 'Tap Filter', title: "D'Cal Tap Filter", rating: '4.8',
      price: '₹2,700.00', was: '₹2,700.00', img: 'tap-filter-card-2.jpg',
      desc: 'No fitting needed — just hang it on the tap. Reduces hair fall and skin irritation from hard water.'
    },
    'washing-ball': {
      cat: 'Laundry Care', title: "D'Cal Washing Machine Ball", rating: '4.7',
      price: '₹500.00', was: '₹500.00', img: 'cdfe502b-7b69-4f95-809a-3a9b2b582b89-IntroducingtheDcalWashingBall.webp',
      desc: 'Just drop it in your washing machine. Cuts detergent use and keeps your garments looking new.'
    },
    'tap-tile-cleaner': {
      cat: 'Cleaning', title: "D'Cal Tap & Tile Cleaner", rating: '4.6',
      price: '₹300.00', was: '₹300.00', img: 'tap-tile-cleaner-card.jpg',
      desc: 'Restores the natural shine of taps & tiles. Gentle water-based formula. Spray it, scrub it, wash it.'
    }
  };

  // title (normalised) -> slug, so cards can self-identify
  var TITLE2SLUG = {};
  Object.keys(CATALOG).forEach(function (slug) { TITLE2SLUG[norm(CATALOG[slug].title)] = slug; });

  function norm(s) { return String(s || '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim().toLowerCase(); }
  function num(s) { var n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : n; }
  function savePct(p) { var w = num(p.was), c = num(p.price); return w > c && w ? Math.round((w - c) / w * 100) : 0; }
  function param(n) { try { return new URLSearchParams(location.search).get(n); } catch (e) { return null; } }
  // product slug from the clean path (/product/<slug>) or the legacy ?id= query
  function pageSlug() {
    var m = location.pathname.match(/\/product\/([^\/?#]+)/i);
    if (m && m[1]) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    return param('id') || '';
  }

  /* ---- 1) rewrite every product-card link to the clean /product/<slug> path ---- */
  function tagLink(a, slug) {
    if (!a || !slug) return;
    var href = (a.getAttribute('href') || '').split('?')[0];
    if (!/product(-classic)?\.html$/.test(href) && !/\/product(\/|$)/.test(href)) return;
    a.setAttribute('href', '/product/' + slug);
  }

  function titleOf(scope) {
    var el = scope.querySelector && scope.querySelector('.pc-title, .pp-card-title, .pp-more-title');
    return (el && el.textContent) || (scope.getAttribute && scope.getAttribute('aria-label')) || '';
  }

  function wireLinks() {
    // collection cards (.pc) — link is a sibling of the title
    document.querySelectorAll('.pc').forEach(function (card) {
      var slug = TITLE2SLUG[norm(titleOf(card))];
      if (slug) card.querySelectorAll('a[href*="product"]').forEach(function (a) { tagLink(a, slug); });
    });
    // standalone product links: home .pp-row, "More from D'Cal" .pp-more-card, etc.
    // (links are the clean "/product" now; keep the old .html forms as a fallback)
    document.querySelectorAll('a[href="/product"], a[href*="product.html"], a[href*="product-classic.html"]').forEach(function (a) {
      if (a.closest('.pc')) return; // already handled above
      var slug = TITLE2SLUG[norm(titleOf(a))];
      if (slug) tagLink(a, slug);
    });
  }

  /* ---- 2) on the product page, render the chosen product ---- */
  function renderProduct() {
    var main = document.querySelector('[data-pp-main]');
    if (!main) return; // not a product page
    var p = CATALOG[pageSlug()];
    if (!p) return;    // no/unknown slug -> leave the default page as-is

    var info = document.querySelector('.pp-col-info') || document;
    function set(el, txt) { if (el) el.textContent = txt; }

    document.title = p.title + " — D'Cal";
    set(info.querySelector('.eyebrow'), p.cat);
    set(info.querySelector('h1.h-section'), p.title);
    var crumb = document.querySelector('.pp-crumb span:last-child'); set(crumb, p.title);
    main.src = '../images/' + p.img; main.alt = p.title;
    set(document.querySelector('[data-pp-rating]'), p.rating + ' · 12,840+ reviews');
    set(document.querySelector('[data-pp-price]'), p.price);
    var cmp = document.querySelector('[data-pp-compare]'); if (cmp) { cmp.textContent = p.was; cmp.style.display = num(p.was) > num(p.price) ? '' : 'none'; }
    set(document.querySelector('[data-pp-atc-price]'), p.price);
    var save = document.querySelector('[data-pp-save]');
    if (save) { var s = savePct(p); save.textContent = 'SAVE ' + s + '%'; save.style.display = s > 0 ? '' : 'none'; }
    var desc = document.querySelector('.pp-full-desc'); if (desc) desc.textContent = p.desc;
    // keep the cart variant data in sync so add-to-cart records the right price
    var vj = document.querySelector('[data-pp-variants]');
    if (vj) { try { var arr = JSON.parse(vj.textContent); if (arr[0]) { arr[0].price = p.price; arr[0].compare_at = p.was; } vj.textContent = JSON.stringify(arr); } catch (e) {} }
  }

  /* ---- 3) point the Share buttons at the REAL page URL ----
     The static markup shares the literal string "product.html"; rewrite each button
     to share this page's actual absolute URL (incl. ?id=) + the product title, so a
     shared link opens the right product for whoever receives it. */
  function wireShare() {
    var box = document.querySelector('.pp-share');
    if (!box) return;
    var url = location.href;
    var pid = pageSlug();
    var pr = pid && CATALOG[pid];
    var title = (pr && pr.title) || (document.title.split('—')[0].trim()) || "D'Cal";
    var u = encodeURIComponent(url), t = encodeURIComponent(title);
    box.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (/wa\.me|whatsapp/i.test(h)) a.setAttribute('href', 'https://wa.me/?text=' + encodeURIComponent(title + ' ' + url));
      else if (/facebook\.com/i.test(h)) a.setAttribute('href', 'https://www.facebook.com/sharer/sharer.php?u=' + u);
      else if (/twitter\.com|x\.com/i.test(h)) a.setAttribute('href', 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t);
      else if (/instagram\.com/i.test(h)) {
        // Instagram has no web "share a link" URL. On mobile use the native share sheet
        // (Instagram appears there); on desktop copy the link + open our IG profile.
        a.addEventListener('click', function (e) {
          if (navigator.share) { e.preventDefault(); navigator.share({ title: title, text: title, url: url }).catch(function () {}); }
          else { try { if (navigator.clipboard) navigator.clipboard.writeText(url); if (typeof toast === 'function') toast('Link copied — paste it in your Instagram'); } catch (err) {} }
        });
      }
    });
  }

  /* ---- 4) wishlist + share actions on every product image ----
     A heart (save to wishlist, kept in localStorage) stacked above a send icon (native
     share sheet -> WhatsApp/Instagram, with a WhatsApp fallback). Both act on the clean
     /product/<slug> URL that carries the server-injected rich link preview. */
  var SEND_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  var HEART_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>';

  var WISH_KEY = 'dcal_wishlist';
  function getWish() { try { return JSON.parse(localStorage.getItem(WISH_KEY) || '[]'); } catch (e) { return []; } }
  function saveWish(a) { try { localStorage.setItem(WISH_KEY, JSON.stringify(a.slice(0, 200))); } catch (e) {} }
  function inWish(slug) { return getWish().indexOf(slug) > -1; }
  function toggleWish(slug) {
    var a = getWish(), i = a.indexOf(slug);
    if (i > -1) a.splice(i, 1); else a.push(slug);
    saveWish(a); updateWishUI();
    return i < 0;   // true when newly added
  }
  function updateWishUI() {
    document.querySelectorAll('[data-wish]').forEach(function (b) { b.classList.toggle('active', inWish(b.getAttribute('data-wish'))); });
  }

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'pp-toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300); }, 1800);
  }
  function shareProduct(slug, title) {
    var url = location.origin + '/product/' + slug;
    if (navigator.share) navigator.share({ title: title, text: title, url: url }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(title + ' ' + url), '_blank', 'noopener');
  }

  function iconBtn(cls, icon, label, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pp-img-btn ' + cls; b.setAttribute('aria-label', label); b.title = label;
    b.innerHTML = icon;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }
  function addImageActions(el, slug, title) {
    if (!el) return;
    var media = (el.tagName === 'IMG') ? el.parentNode : el;   // attach beside the image, not inside it
    if (!media || media.querySelector('.pp-img-actions')) return;
    try { if (getComputedStyle(media).position === 'static') media.style.position = 'relative'; } catch (e) {}
    var box = document.createElement('div'); box.className = 'pp-img-actions';
    var wish = iconBtn('pp-wish-btn' + (inWish(slug) ? ' active' : ''), HEART_ICON, 'Save ' + title + ' to wishlist', function () {
      toast(toggleWish(slug) ? '♥ Saved to wishlist' : 'Removed from wishlist');
    });
    wish.setAttribute('data-wish', slug);
    box.appendChild(wish);
    box.appendChild(iconBtn('pp-share-btn', SEND_ICON, 'Share ' + title, function () { shareProduct(slug, title); }));
    media.appendChild(box);
  }

  function wireImageActions() {
    document.querySelectorAll('.pp-row, .pc, .pp-more-card').forEach(function (card) {
      var title = (titleOf(card) || '').trim();
      var slug = TITLE2SLUG[norm(title)];
      if (!slug) return;
      addImageActions(card.querySelector('.pp-row-media, .pc-media, .pp-more-img'), slug, title || (CATALOG[slug] && CATALOG[slug].title) || "D'Cal");
    });
    var main = document.querySelector('[data-pp-main]');
    if (main) { var s = pageSlug(); if (CATALOG[s]) addImageActions(main.closest('.pp-image-wrap') || main.parentNode, s, CATALOG[s].title); }
    updateWishUI();
  }

  function init() { renderProduct(); wireLinks(); wireShare(); wireImageActions(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
