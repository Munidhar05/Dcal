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
    });
  }

  function init() { renderProduct(); wireLinks(); wireShare(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
