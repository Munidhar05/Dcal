/* =========================================================
   D'Cal on Amazon.in — each product's Amazon photos, videos
   and customer reviews, shown on our own pages.

   data/amazon/<slug>.json is a snapshot of that product's
   Amazon listing. The photos and videos are copied into
   images/amazon and videos/amazon rather than hot-linked, so
   a page never waits on (or breaks with) Amazon's CDN.
   Reviews: only 5-star ones, and only from reviewers whose own
   Amazon name is a real name (the owner's rule, 15 Oct 2026; the
   import drops handles like "mxmuz", it never renames anyone).
   Their words are kept exactly. Because they are a selection,
   the block says "5-star reviews from Amazon.in" and links to
   the full list there, so it never passes for all of them.

   Product page: a gallery (our own photo first, then Amazon's
   photos, then its videos) and the reviews block.
   ========================================================= */
(function () {
  'use strict';

  var FIRST = 6;    // reviews shown before "Show more"
  var STEP = 24;    // added per "Show more"

  // <slug>.json is the gallery + reviewCount/reviewPages. The reviews themselves
  // (1,700+ for the softener) sit in <slug>-reviews-<n>.json, 150 a file: the
  // server sends no gzip, so one file would be ~600 KB on a phone. Page 1 comes
  // when the reviews are near, each next one only when "Show more" runs past it.
  var cache = {};
  function getJSON(file) {
    if (!cache[file]) {
      cache[file] = fetch('/data/amazon/' + file)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return cache[file];
  }
  function load(slug) { return getJSON(encodeURIComponent(slug) + '.json'); }
  // the import keeps only 5-star reviews; the filter holds the line if a future
  // data file ever slips a lower one through
  function loadReviewPage(slug, n) {
    return getJSON(encodeURIComponent(slug) + '-reviews-' + n + '.json').then(function (d) {
      return ((d && d.reviews) || []).filter(function (r) { return r.stars === 5; });
    });
  }
  // start fetching once el is within a screen or so of the viewport
  function whenNear(node, fn) {
    if (!('IntersectionObserver' in window)) return fn();
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); }
    }, { rootMargin: '900px 0px' });
    io.observe(node);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function mmss(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  var STAR = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  function stars(n) {
    var h = '';
    for (var i = 1; i <= 5; i++) h += '<span class="' + (i <= n ? 'on' : 'off') + '">' + STAR + '</span>';
    return '<span class="amz-stars" role="img" aria-label="' + n + ' out of 5 stars">' + h + '</span>';
  }
  var PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  var PREV = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var NEXT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  // left/right swipe on touch screens; a vertical drag stays a page scroll
  function onSwipe(node, fn) {
    var x0 = null, y0 = 0;
    node.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    node.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) fn(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  // Overlays lock the page scroll; counted, so one closing never unlocks the
  // page under another that is still open.
  var locks = 0;
  function lock(on) {
    locks = Math.max(0, locks + (on ? 1 : -1));
    document.documentElement.classList.toggle('amz-locked', locks > 0);
  }

  /* ---- full-screen photo viewer (gallery photos and reviewers' photos) ---- */
  function lightbox(srcs, start, label) {
    var i = start || 0;
    var box = el('div', 'amz-lb');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label || 'Photo');
    var img = el('img');
    img.alt = label || '';
    var count = el('div', 'amz-lb-count');
    var close = el('button', 'amz-lb-btn amz-lb-close', CLOSE);
    close.type = 'button'; close.setAttribute('aria-label', 'Close');
    box.appendChild(img); box.appendChild(count); box.appendChild(close);
    var prev, next;
    if (srcs.length > 1) {
      prev = el('button', 'amz-lb-btn amz-lb-prev', PREV); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous photo');
      next = el('button', 'amz-lb-btn amz-lb-next', NEXT); next.type = 'button'; next.setAttribute('aria-label', 'Next photo');
      box.appendChild(prev); box.appendChild(next);
    }
    function show(n) {
      i = (n + srcs.length) % srcs.length;
      img.src = srcs[i];
      count.textContent = srcs.length > 1 ? (i + 1) + ' / ' + srcs.length : '';
    }
    function done() {
      document.removeEventListener('keydown', key, true);
      if (box.parentNode) box.parentNode.removeChild(box);
      lock(false);
    }
    function key(e) {
      if (e.key === 'Escape') { e.stopPropagation(); done(); }
      else if (e.key === 'ArrowLeft' && prev) show(i - 1);
      else if (e.key === 'ArrowRight' && next) show(i + 1);
    }
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.closest('.amz-lb-close')) done();
      else if (e.target.closest('.amz-lb-prev')) show(i - 1);
      else if (e.target.closest('.amz-lb-next')) show(i + 1);
    });
    if (srcs.length > 1) onSwipe(box, function (d) { show(i + d); });
    document.addEventListener('keydown', key, true);
    show(i);
    document.body.appendChild(box);
    lock(true);
    close.focus();
  }

  /* ---- gallery: one big frame + a thumbnail strip ----
     frame already holds the page's <img>; videos play in the same frame. */
  function gallery(frame, thumbsAfter, items, title) {
    if (items.length < 2) return;
    var img = frame.querySelector('img');
    var cur = 0, video = null;
    var photos = items.filter(function (it) { return !it.video; });

    var strip = el('div', 'pp-thumbs amz-thumbs');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', title + ' photos and videos');
    items.forEach(function (it, n) {
      var b = el('button', 'amz-thumb' + (it.video ? ' is-video' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', it.video ? 'Play video: ' + it.video.title + ' (' + mmss(it.video.seconds) + ')' : 'Photo ' + (n + 1) + ' of ' + items.length);
      b.innerHTML = '<img src="' + esc(it.thumb) + '" alt="" loading="lazy" width="200" height="200">' +
        (it.video ? '<span class="amz-thumb-play">' + PLAY + '</span><span class="amz-thumb-time">' + mmss(it.video.seconds) + '</span>' : '');
      b.addEventListener('click', function () { show(n, true); });
      strip.appendChild(b);
    });
    thumbsAfter.parentNode.insertBefore(strip, thumbsAfter.nextSibling);

    var prev = el('button', 'amz-nav amz-prev', PREV), next = el('button', 'amz-nav amz-next', NEXT);
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next');
    prev.addEventListener('click', function (e) { e.stopPropagation(); show(cur - 1); });
    next.addEventListener('click', function (e) { e.stopPropagation(); show(cur + 1); });
    frame.appendChild(prev); frame.appendChild(next);
    onSwipe(frame, function (d) { if (!video) show(cur + d); });

    // a tap on the big photo opens it full screen, with the other photos beside it
    img.classList.add('amz-zoomable');
    img.addEventListener('click', function () {
      var at = photos.indexOf(items[cur]);
      lightbox(photos.map(function (p) { return p.src; }), at < 0 ? 0 : at, title);
    });

    function show(n, fromThumb) {
      cur = (n + items.length) % items.length;
      var it = items[cur];
      if (video) { video.pause(); video.parentNode.removeChild(video); video = null; }
      frame.classList.toggle('amz-playing', !!it.video);
      if (it.video) {
        video = el('video', 'amz-video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.poster = it.video.poster;
        video.src = it.video.src;
        video.setAttribute('aria-label', it.video.title);
        frame.insertBefore(video, img.nextSibling);
        // only a tap on the video's own thumbnail starts it (arrows just show it)
        if (fromThumb) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); }
      } else {
        img.src = it.src;
      }
      strip.querySelectorAll('.amz-thumb').forEach(function (b, k) {
        b.classList.toggle('active', k === cur);
        if (k === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
      var t = strip.children[cur];
      if (t && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: t.offsetLeft - strip.clientWidth / 2 + t.offsetWidth / 2, behavior: 'smooth' });
    }
    show(0);
  }

  // our own photo first, then every Amazon photo, then the videos
  function itemsFor(data, ownSrc) {
    var items = [];
    if (ownSrc) items.push({ src: ownSrc, thumb: ownSrc });
    (data.images || []).forEach(function (p) { items.push({ src: p.src, thumb: p.thumb }); });
    (data.videos || []).forEach(function (v) { items.push({ thumb: v.thumb, video: v }); });
    return items;
  }

  /* ---- reviews ---- */
  function reviewCard(r) {
    var a = el('article', 'amz-rv');
    var photos = r.photos || [];
    a.innerHTML =
      '<div class="amz-rv-who">' +
        '<span class="amz-rv-av" aria-hidden="true">' + esc((r.name || '?').trim().charAt(0).toUpperCase()) + '</span>' +
        '<div><div class="amz-rv-name">' + esc(r.name) + '</div>' +
        (r.verified ? '<div class="amz-rv-ver">Verified Purchase</div>' : '') + '</div>' +
      '</div>' +
      '<div class="amz-rv-head">' + stars(r.stars) + (r.title ? '<h3 class="amz-rv-title">' + esc(r.title) + '</h3>' : '') + '</div>' +
      '<div class="amz-rv-date">' + esc(r.date) + (r.variant ? ' · ' + esc(r.variant) : '') + '</div>' +
      (r.body ? '<p class="amz-rv-body">' + esc(r.body).replace(/\n/g, '<br>') + '</p><button type="button" class="amz-rv-more" hidden>Read more</button>' : '') +
      (photos.length ? '<div class="amz-rv-photos">' + photos.map(function (p, k) {
        return '<button type="button" data-k="' + k + '" aria-label="Photo ' + (k + 1) + ' from ' + esc(r.name) + '"><img src="' + esc(p.thumb) + '" alt="" loading="lazy" width="200" height="200"></button>';
      }).join('') + '</div>' : '');
    a.addEventListener('click', function (e) {
      var ph = e.target.closest('.amz-rv-photos button');
      if (ph) return lightbox(photos.map(function (p) { return p.src; }), +ph.getAttribute('data-k'), 'Photo from ' + r.name);
      var more = e.target.closest('.amz-rv-more');
      if (more) {
        var open = a.classList.toggle('open');
        more.textContent = open ? 'Read less' : 'Read more';
      }
    });
    return a;
  }

  // "Read more" only where the text is actually cut off. Measured after the
  // card is in the page — a hidden card has no height to compare.
  function fitMore(card) {
    var body = card.querySelector('.amz-rv-body'), more = card.querySelector('.amz-rv-more');
    if (body && more) more.hidden = body.scrollHeight <= body.clientHeight + 2;
  }

  // Fills box with the product's reviews. Resolves false if there were none.
  function reviews(box, data, slug) {
    var total = data.reviewCount || 0, pages = data.reviewPages || 1;
    var list = [], loaded = 0, shown = 0, busy = false;
    var sum = el('div', 'amz-rv-sum');
    sum.innerHTML =
      '<span class="amz-rv-badge">Amazon.in</span>' +
      '<span class="amz-rv-count">' + total.toLocaleString('en-IN') + ' five-star review' + (total === 1 ? '' : 's') + ' from Amazon.in</span>' +
      '<a class="amz-rv-link" href="' + esc(data.url) + '" target="_blank" rel="noopener">See all reviews on Amazon <span aria-hidden="true">↗</span></a>';
    var grid = el('div', 'amz-rv-grid');
    var moreBtn = el('button', 'btn amz-rv-showmore');
    moreBtn.type = 'button';
    moreBtn.hidden = true;

    // cards are only ever appended, so a "Show more" never redraws (or re-measures)
    // the ones already on screen
    function showUpTo(n) {
      var add = list.slice(shown, n);
      add.forEach(function (r) { grid.appendChild(reviewCard(r)); });
      [].slice.call(grid.children, shown).forEach(fitMore);
      shown += add.length;
      var left = (loaded < pages ? total : list.length) - shown;
      moreBtn.hidden = left <= 0;
      moreBtn.textContent = 'Show more reviews (' + Math.max(left, 0).toLocaleString('en-IN') + ')';
    }
    function more(n) {
      if (n <= list.length || loaded >= pages) return Promise.resolve(showUpTo(n));
      busy = true; moreBtn.disabled = true;
      return loadReviewPage(slug, loaded + 1).then(function (part) {
        loaded++; list = list.concat(part);
        busy = false; moreBtn.disabled = false;
        return more(n);
      });
    }
    moreBtn.addEventListener('click', function () { if (!busy) more(shown + STEP); });

    return more(FIRST).then(function () {
      if (!list.length) return false;
      box.innerHTML = '';
      box.appendChild(sum); box.appendChild(grid); box.appendChild(moreBtn);
      grid.querySelectorAll('.amz-rv').forEach(fitMore);   // measured now that they are in the page
      return true;
    });
  }

  /* ---- product page ---- */
  function productPage() {
    var main = document.querySelector('[data-pp-main]');
    if (!main) return;   // not a product page
    var slug = main.getAttribute('data-pp-amazon');   // set by product.js for a product sold on Amazon
    // The old Judge.me widget never loaded (no script), so its block was only a
    // heading over nothing. It is filled with Amazon's reviews, or else hidden.
    var widget = document.querySelector('.jdgm-review-widget');
    var block = widget && widget.parentNode;
    if (!slug) { if (block) block.hidden = true; return; }
    load(slug).then(function (data) {
      if (!data) { if (block) block.hidden = true; return; }
      var frame = main.closest('.pp-image-wrap');
      var glass = frame && frame.closest('.glass');
      if (frame && glass) gallery(frame, glass, itemsFor(data, main.getAttribute('src')), main.alt || '');
      if (!block) return;
      if (!data.reviewCount) { block.hidden = true; return; }   // nothing that meets the rule
      var eb = block.querySelector('.eyebrow'), lead = block.querySelector('.lead');
      if (eb) eb.textContent = '5-star reviews from Amazon';
      if (lead) lead.textContent = 'Word for word from buyers on Amazon.in.';
      var box = el('div', 'amz-reviews');
      box.id = 'amazon-reviews';
      block.replaceChild(box, widget);
      // watch the section, not box: the theme's div:empty{display:none} hides the
      // still-empty box, and a hidden element never intersects anything
      whenNear(block, function () {
        reviews(box, data, slug).then(function (any) { if (!any) block.hidden = true; });
      });
    });
  }

  function init() { productPage(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
