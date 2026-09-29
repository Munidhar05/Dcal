/* =============================================================================
   D'Cal — video testimonials player (homepage + /partner/)

   Markup contract (see index.html, #video-stories):
     <div data-vt-group="customers" data-vt-label="Delighted customers"
          data-vt-cta-href="/collection" data-vt-cta-label="Shop D'Cal">
       <a class="vt-card vt-card--reel" href="/videos/testimonials/customer-1.mp4"
          data-vt-id="customer-1" data-vt-shape="reel"
          data-vt-name="…" data-vt-meta="…">…</a>
     </div>

   - Click a card    -> full-screen player with sound; ←/→, swipe, Esc; the next
                        story in the same group starts when one ends.
   - Hover (mouse)   -> muted in-card preview of the first seconds.
   - Touch           -> the card most in view previews muted, one at a time.
   Previews are skipped for reduced-motion, Save-Data and 2G, so nobody pays
   for video they did not ask for. Without JS, each card is a plain link to
   its .mp4 and still plays.
   ============================================================================= */
(function () {
  'use strict';

  var groups = [].slice.call(document.querySelectorAll('[data-vt-group]'));
  if (!groups.length) return;

  var PREVIEW_SECONDS = 9;
  var conn = navigator.connection || {};
  var canPreview =
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !conn.saveData && !/2g/.test(conn.effectiveType || '');
  var hoverDevice = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- analytics: GTM dataLayer + Meta Pixel (js/tracking.js) ---------- */
  function track(event, data) {
    try { (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: event }, data)); } catch (e) {}
    try { if (typeof window.fbq === 'function') window.fbq('trackCustom', event, data); } catch (e) {}
  }

  /* ---------- muted in-card preview ---------- */
  var previewing = null;

  function startPreview(card) {
    if (!canPreview || previewing === card) return;
    stopPreview();
    previewing = card;
    var v = card.querySelector('video');
    if (!v) {
      v = document.createElement('video');
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('muted', '');
      v.setAttribute('aria-hidden', 'true');
      v.preload = 'auto';
      v.tabIndex = -1;
      v.src = card.getAttribute('href');
      v.addEventListener('timeupdate', function () {
        if (v.currentTime > PREVIEW_SECONDS) v.currentTime = 0;
      });
      v.addEventListener('playing', function () {
        if (previewing === card) card.classList.add('is-previewing');
      });
      card.querySelector('img').insertAdjacentElement('afterend', v);
    }
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stopPreview() {
    if (!previewing) return;
    var v = previewing.querySelector('video');
    if (v) v.pause();
    previewing.classList.remove('is-previewing');
    previewing = null;
  }

  var allCards = [].slice.call(document.querySelectorAll('.vt-card[data-vt-id]'));

  if (canPreview && hoverDevice) {
    allCards.forEach(function (card) {
      card.addEventListener('mouseenter', function () { startPreview(card); });
      card.addEventListener('mouseleave', function () { if (previewing === card) stopPreview(); });
    });
  } else if (canPreview && 'IntersectionObserver' in window) {
    // Touch: preview whichever reel is most in view (vertical page scroll AND
    // the horizontal swipe row both change this), one video at a time.
    var ratios = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { ratios.set(en.target, en.intersectionRatio); });
      var best = null, bestRatio = 0.85;
      ratios.forEach(function (r, card) { if (r >= bestRatio) { best = card; bestRatio = r; } });
      if (best) startPreview(best);
      else stopPreview();
    }, { threshold: [0, 0.5, 0.85, 1] });
    document.querySelectorAll('.vt-card--reel[data-vt-id]').forEach(function (c) { io.observe(c); });
  }

  /* ---------- modal player ---------- */
  var ICON = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>'
  };

  var dlg, stage, video, counter, nameEl, metaEl, ctaEl, prevBtn, nextBtn;
  var current = null;   // { cards, index, group }
  var lastFocus = null;

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'vt-modal';
    dlg.setAttribute('aria-label', 'Video testimonial');
    dlg.innerHTML =
      '<button type="button" class="vt-btn vt-close" aria-label="Close video">' + ICON.close + '</button>' +
      '<div class="vt-modal-inner">' +
        '<div class="vt-counter" aria-live="polite"></div>' +
        '<div class="vt-stage"><video controls playsinline preload="auto"></video></div>' +
        '<div class="vt-caption">' +
          '<div><div class="vt-caption-name"></div><div class="vt-caption-meta"></div></div>' +
          '<a class="btn btn-primary" href="#"></a>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="vt-btn vt-prev" aria-label="Previous video">' + ICON.prev + '</button>' +
      '<button type="button" class="vt-btn vt-next" aria-label="Next video">' + ICON.next + '</button>';
    document.body.appendChild(dlg);

    stage = dlg.querySelector('.vt-stage');
    video = dlg.querySelector('video');
    counter = dlg.querySelector('.vt-counter');
    nameEl = dlg.querySelector('.vt-caption-name');
    metaEl = dlg.querySelector('.vt-caption-meta');
    ctaEl = dlg.querySelector('.vt-caption .btn');
    prevBtn = dlg.querySelector('.vt-prev');
    nextBtn = dlg.querySelector('.vt-next');

    dlg.querySelector('.vt-close').addEventListener('click', function () { dlg.close(); });
    prevBtn.addEventListener('click', function () { go(-1); });
    nextBtn.addEventListener('click', function () { go(1); });

    // click on the dark area around the video closes it
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.classList.contains('vt-modal-inner')) dlg.close();
    });
    // Esc and the close button both end up here
    dlg.addEventListener('close', cleanup);

    dlg.addEventListener('keydown', function (e) {
      if (e.target === video) return;          // let the player seek with arrows
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    });

    video.addEventListener('ended', function () {
      if (!current) return;
      track('vt_complete', { vt_id: current.cards[current.index].getAttribute('data-vt-id'), vt_group: current.group });
      if (current.index < current.cards.length - 1) go(1);
    });

    ctaEl.addEventListener('click', function () {
      if (!current) return;
      track('vt_cta_click', { vt_id: current.cards[current.index].getAttribute('data-vt-id'), vt_group: current.group });
      // same-page anchors (e.g. #apply) need the dialog out of the way first
      if (ctaEl.getAttribute('href').charAt(0) === '#') dlg.close();
    });

    // swipe left/right on the video; ignore the bottom strip where the native
    // controls live so scrubbing never skips to the next story
    var sx = 0, sy = 0, tracking = false;
    stage.addEventListener('touchstart', function (e) {
      var t = e.touches[0], r = stage.getBoundingClientRect();
      tracking = t.clientY < r.bottom - 64;
      sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (!tracking) return;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function show(index) {
    var card = current.cards[index];
    current.index = index;
    dlg.setAttribute('data-shape', card.getAttribute('data-vt-shape') || 'reel');

    video.src = card.getAttribute('href');
    video.poster = card.querySelector('img').getAttribute('src');
    var p = video.play();
    if (p && p.catch) p.catch(function () {});

    nameEl.textContent = card.getAttribute('data-vt-name') || '';
    metaEl.textContent = card.getAttribute('data-vt-meta') || '';
    counter.textContent = current.label + ' · ' + (index + 1) + ' of ' + current.cards.length;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === current.cards.length - 1;

    // replay the entrance animation on every story
    stage.style.animation = 'none';
    void stage.offsetWidth;
    stage.style.animation = '';

    track('vt_play', { vt_id: card.getAttribute('data-vt-id'), vt_group: current.group });
  }

  function go(step) {
    if (!current) return;
    var i = current.index + step;
    if (i >= 0 && i < current.cards.length) show(i);
  }

  function open(groupEl, card) {
    if (!dlg) build();
    stopPreview();
    var cards = [].slice.call(groupEl.querySelectorAll('.vt-card[data-vt-id]'));
    current = {
      cards: cards,
      index: 0,
      group: groupEl.getAttribute('data-vt-group'),
      label: groupEl.getAttribute('data-vt-label') || 'Story'
    };
    var ctaHref = groupEl.getAttribute('data-vt-cta-href');
    ctaEl.hidden = !ctaHref;
    if (ctaHref) {
      ctaEl.href = ctaHref;
      ctaEl.innerHTML = '';
      ctaEl.appendChild(document.createTextNode(groupEl.getAttribute('data-vt-cta-label') || 'Learn more'));
      ctaEl.insertAdjacentHTML('beforeend', ICON.arrow);
    }
    lastFocus = document.activeElement;
    document.documentElement.classList.add('vt-locked');
    dlg.showModal();
    show(cards.indexOf(card));
  }

  function cleanup() {
    video.pause();
    video.removeAttribute('src');
    video.load();                 // stops the download, not just the playback
    current = null;
    document.documentElement.classList.remove('vt-locked');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  groups.forEach(function (groupEl) {
    groupEl.addEventListener('click', function (e) {
      var card = e.target.closest('.vt-card[data-vt-id]');
      if (!card || typeof HTMLDialogElement !== 'function') return;  // no <dialog>: plain link
      e.preventDefault();
      open(groupEl, card);
    });
  });
})();
