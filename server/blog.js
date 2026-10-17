/* =============================================================================
   D'Cal blog — articles that arrive from Befach Creatives

   Nobody writes posts on this site. When a social post is published in the
   Befach Creatives app with "Also publish a blog post" ticked, the app writes
   an article with AI and POSTs it here; we keep it in MongoDB (blog_posts,
   server/models/BlogPost.js) and render it on every request, so a new post is
   live the moment it lands — no deploy, no build step.

     POST /api/blog/ingest       the app's webhook (signed, see below)
     GET  /blog                  every post, newest first, 12 a page (?page=2)
     GET  /blog/<slug>           one article
     GET  /blog/<slug>/image     its hero image, served from our own copy
     GET  /sitemap.xml           the site's pages + /blog + every post
     GET  /robots.txt            allows everything, points at the sitemap

   The ingest contract is the sender's, already live — match it, don't improve it:
     X-Blog-Timestamp  unix seconds, as a string
     X-Blog-Signature  hex HMAC-SHA256 of "<timestamp>.<raw body>" keyed with
                       BLOG_WEBHOOK_SECRET; older than 5 minutes = refused
     body              { sourceCreativeId, businessBrandName, title, slug,
                         excerpt, bodyMarkdown, heroImageUrl,
                         videoUrl, videoMimeType }   (video: both may be null/absent)
     answer            200 { url, externalId } — anything else (or no url)
                       shows as Failed in the app, and it gives up after 20 s

     BLOG_WEBHOOK_SECRET  shared with the app; unset = the webhook answers 503
     SITE_URL             public origin for the url we answer with, canonical
                          links and the sitemap (default https://dcal.co.in)
   ============================================================================= */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const BlogPost = require('./models/BlogPost');
const Counter = require('./models/Counter');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'html', 'blog.html');
const NOT_FOUND = path.join(ROOT, 'html', '404.html');
const PER_PAGE = 12;
const MAX_SKEW_S = 300;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15000;
// raster only: an SVG is an image/* too, but served from our own origin it can
// carry script — and nothing the app sends a social post with is an SVG
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

// SITE_URL, not PUBLIC_BASE_URL: the latter still pointed at the old
// dcalwater.com domain after the 29 Sep 2026 move, and a wrong url here is a
// broken link in the Creatives app forever.
function siteUrl() { return (process.env.SITE_URL || 'https://dcal.co.in').trim().replace(/\/+$/, ''); }

function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
// JSON inside <script>: a "</script>" in a title must not close the tag
function jsonForScript(o) { return JSON.stringify(o).replace(/</g, '\\u003c'); }

/* ---------- Markdown ----------
   html:false renders any raw HTML in the article as text, and markdown-it's own
   link check refuses javascript:, vbscript:, file: and non-image data: URLs.
   The title is the page's only <h1>, so a "# heading" in the body steps down. */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
md.core.ruler.push('dcal_single_h1', function (state) {
  state.tokens.forEach(function (t) { if ((t.type === 'heading_open' || t.type === 'heading_close') && t.tag === 'h1') t.tag = 'h2'; });
});

/* ---------- the signature ---------- */
function signatureOk(raw, timestamp, signature, secret) {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_S) return false;
  // over the exact bytes received: the sender signed its own serialisation
  const expected = crypto.createHmac('sha256', secret).update(String(timestamp) + '.').update(raw).digest();
  const given = Buffer.from(String(signature), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* ---------- slugs ---------- */
// spaces and underscores become hyphens first, so "hard water" stays two words
function cleanSlug(s) {
  return String(s || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/, '');
}
// Only a NEW post gets here; a re-send keeps the slug it was given the first time.
// A slug that belongs to another post gets "-" + the last 6 of our sourceCreativeId
// (the sender's rule); the numbered fallbacks only exist so two posts can never
// end up fighting over one URL.
async function freeSlug(wanted, sourceCreativeId) {
  const base = cleanSlug(wanted) || 'post';
  const tail = cleanSlug(String(sourceCreativeId).slice(-6)) || crypto.randomBytes(3).toString('hex');
  const tries = [base, base + '-' + tail];
  for (let n = 2; n <= 20; n++) tries.push(base + '-' + tail + '-' + n);
  for (const s of tries) if (!(await BlogPost.exists({ slug: s }))) return s;
  return base + '-' + crypto.randomBytes(4).toString('hex');
}

async function nextId() {
  const c = await Counter.findByIdAndUpdate('blog', { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

/* ---------- the hero image ----------
   The app's link expires five minutes after it sends it, so we copy the bytes
   now or never. Never a reason to fail the request: no copy = a post with no
   image. The link itself is a signed URL, so only its host is ever logged. */
async function copyImage(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  let host = '?';
  try { host = new URL(url).host; } catch (e) { return null; }
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, IMAGE_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) { console.warn('blog: hero image not copied from ' + host + ': HTTP ' + r.status); return null; }
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) { console.warn('blog: hero image not copied from ' + host + ': ' + (type || 'no type')); ctl.abort(); return null; }
    if (Number(r.headers.get('content-length')) > IMAGE_MAX_BYTES) { console.warn('blog: hero image over 10 MB, not copied'); ctl.abort(); return null; }
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > IMAGE_MAX_BYTES) { console.warn('blog: hero image over 10 MB, not copied'); ctl.abort(); return null; }
      chunks.push(chunk);
    }
    return size ? { data: Buffer.concat(chunks), contentType: type } : null;
  } catch (e) {
    console.warn('blog: hero image not copied from ' + host + ': ' + (e && e.name === 'AbortError' ? 'timed out' : (e && e.message)));
    return null;
  } finally { clearTimeout(timer); }
}

/* ---------- the video ----------
   Stored exactly as sent, never fetched: the app's link is permanent and 302s to
   a short-lived storage URL that the browser follows itself, seeking included.
   It ends up in a src attribute, so anything but an https URL of sane length is
   dropped to null — and, like the image, never a reason to fail the request. */
function videoFields(b) {
  const u = b.videoUrl;
  let ok = typeof u === 'string' && u.length <= 1000 && /^https:\/\//i.test(u);
  if (ok) { try { ok = new URL(u).protocol === 'https:'; } catch (e) { ok = false; } }
  if (!ok) return { videoUrl: null, videoMimeType: null };
  const t = b.videoMimeType;
  return { videoUrl: u, videoMimeType: typeof t === 'string' && /^video\/[a-z0-9][a-z0-9.+-]{0,60}$/i.test(t) ? t.toLowerCase() : null };
}

/* ---------- POST /api/blog/ingest ----------
   Mounted with express.raw BEFORE the global express.json (see server.js): once
   the body has been parsed, re-serialising it can never match the signature. */
function ingest(dbReady) {
  return async function (req, res) {
    res.set('Cache-Control', 'no-store');
    const secret = process.env.BLOG_WEBHOOK_SECRET;
    if (!secret || !secret.trim()) return res.status(503).json({ error: 'Blog webhook is not configured.' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!signatureOk(raw, req.get('x-blog-timestamp'), req.get('x-blog-signature'), secret)) {
      return res.status(401).json({ error: 'Invalid or expired signature.' });
    }

    let b;
    try { b = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'Body is not valid JSON.' }); }
    if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Body must be a JSON object.' });
    const missing = ['sourceCreativeId', 'title', 'slug', 'excerpt', 'bodyMarkdown']
      .filter(function (k) { return typeof b[k] !== 'string' || !b[k].trim(); });
    if (missing.length) return res.status(400).json({ error: 'Missing or empty: ' + missing.join(', ') });
    if (!dbReady()) return res.status(503).json({ error: 'Database unavailable.' });

    const sid = b.sourceCreativeId.trim();
    // the video fields ride along with the words: a re-send overwrites them, and
    // a re-send without a video (null or absent) takes the player off the article
    const fields = Object.assign({ title: b.title.trim(), excerpt: b.excerpt.trim(), bodyMarkdown: b.bodyMarkdown }, videoFields(b));
    try {
      const image = await copyImage(b.heroImageUrl);
      let post = null;
      // two tries: a duplicate-key error means a parallel retry of this same post
      // (or a parallel post on the same slug) won the race — the second pass sees it
      for (let attempt = 0; attempt < 2 && !post; attempt++) {
        const now = new Date();
        const existing = await BlogPost.findOne({ sourceCreativeId: sid }).select('_id slug').lean();
        if (existing) {
          // A retry: new words, same URL. A fresh image replaces the old one; an
          // explicit null removes it; a link that could not be copied (expired,
          // a video) keeps the copy we already have rather than lose it.
          const set = Object.assign({ updatedAt: now }, fields);
          if (image) set.heroImage = image;
          else if (b.heroImageUrl === null) set.heroImage = null;
          await BlogPost.updateOne({ _id: existing._id }, { $set: set });
          post = existing;
          break;
        }
        try {
          const doc = await BlogPost.create(Object.assign({
            _id: await nextId(), sourceCreativeId: sid, slug: await freeSlug(b.slug, sid),
            heroImage: image, publishedAt: now, updatedAt: now
          }, fields));
          post = { _id: doc._id, slug: doc.slug };
        } catch (e) {
          if (!(e && e.code === 11000) || attempt) throw e;
        }
      }
      return res.json({ url: siteUrl() + '/blog/' + post.slug, externalId: String(post._id) });
    } catch (e) {
      try { console.error('blog ingest failed:', e && e.message); } catch (x) {}
      return res.status(500).json({ error: 'Could not save the post.' });
    }
  };
}

/* ---------- pages ---------- */
function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }); }
  catch (e) { return ''; }
}
function isoDate(d) { try { return new Date(d).toISOString(); } catch (e) { return ''; } }
// the version makes a re-sent image a new URL, so the day-long cache never shows the old one
function imagePath(p) { return '/blog/' + encodeURIComponent(p.slug) + '/image?v=' + new Date(p.updatedAt || p.publishedAt).getTime(); }
function hasImage(p) { return !!(p.heroImage && p.heroImage.contentType); }

// html/blog.html is the shell for every blog page (the site's header + footer);
// read per request like the product page, so editing it needs no restart
function render(res, status, o) {
  fs.readFile(TEMPLATE, 'utf8', function (err, html) {
    if (err || !html) return res.status(500).send('Blog unavailable');
    const head =
      '<link rel="canonical" href="' + escHtml(o.canonical) + '">\n' +
      '  <meta property="og:site_name" content="D\'Cal">\n' +
      '  <meta property="og:type" content="' + (o.ogType || 'website') + '">\n' +
      '  <meta property="og:title" content="' + escHtml(o.ogTitle || o.title) + '">\n' +
      '  <meta property="og:description" content="' + escHtml(o.description) + '">\n' +
      '  <meta property="og:url" content="' + escHtml(o.canonical) + '">\n' +
      '  <meta property="og:image" content="' + escHtml(o.image) + '">\n' +
      '  <meta name="twitter:card" content="summary_large_image">\n' +
      '  <meta name="twitter:title" content="' + escHtml(o.ogTitle || o.title) + '">\n' +
      '  <meta name="twitter:description" content="' + escHtml(o.description) + '">\n' +
      '  <meta name="twitter:image" content="' + escHtml(o.image) + '">' +
      (o.video ? '\n  <meta property="og:video" content="' + escHtml(o.video.url) + '">' +
        '\n  <meta property="og:video:type" content="' + escHtml(o.video.type) + '">' : '') +
      // one <script> per object: a video post carries a VideoObject beside its BlogPosting
      [].concat(o.jsonld || []).map(function (j) { return '\n  <script type="application/ld+json">' + jsonForScript(j) + '</script>'; }).join('') +
      (o.noindex ? '\n  <meta name="robots" content="noindex">' : '');
    let out = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + escHtml(o.title) + '</title>');
    out = out.replace(/<meta\s+name="description"[^>]*>/i, '<meta name="description" content="' + escHtml(o.description) + '">');
    out = out.replace('<!--blog:head-->', function () { return head; });
    out = out.replace('<!--blog:main-->', function () { return o.main; });
    res.status(status).set('Content-Type', 'text/html; charset=utf-8').send(out);
  });
}

const LIST_DESC = "Tips and guides on hard water, limescale and keeping your home's water soft — from D'Cal.";
const DROP = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7c-3.3 4-6 7.5-6 11a6 6 0 0 0 12 0c0-3.5-2.7-7-6-11z"/></svg>';
const VIDEO_BADGE = '<span class="bl-badge"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>Video</span>';

function card(p) {
  const href = '/blog/' + encodeURIComponent(p.slug);
  // the list keeps the still frame as the thumbnail; a badge says there is a video behind it
  const thumb = (hasImage(p)
    ? '<img src="' + escHtml(imagePath(p)) + '" alt="" loading="lazy" decoding="async">'
    : '<span class="bl-thumb-none">' + DROP + '</span>') + (p.videoUrl ? VIDEO_BADGE : '');
  return '<article class="bl-card"><a class="bl-card-link" href="' + escHtml(href) + '">' +
    '<div class="bl-thumb">' + thumb + '</div>' +
    '<div class="bl-card-body">' +
      '<time class="bl-date" datetime="' + isoDate(p.publishedAt) + '">' + escHtml(fmtDate(p.publishedAt)) + '</time>' +
      '<h2 class="bl-card-title">' + escHtml(p.title) + '</h2>' +
      '<p class="bl-card-excerpt">' + escHtml(p.excerpt) + '</p>' +
      '<span class="bl-more">Read article <span aria-hidden="true">→</span></span>' +
    '</div></a></article>';
}

function mountPages(app, deps) {
  const dbReady = deps.dbReady;
  const productSlugs = deps.productSlugs || [];

  app.get('/blog', async function (req, res) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const site = siteUrl();
    const canonical = site + '/blog' + (page > 1 ? '?page=' + page : '');
    const base = { title: "Blog — D'Cal", description: LIST_DESC, canonical: canonical, image: site + '/img/dcal-logo.png' };
    const intro = '<span class="ip-eyebrow">Blog</span><h1>The D\'Cal Blog</h1>' +
      '<p class="ip-lead">Hard water, limescale and how to keep your home, skin and appliances safe from both.</p>';
    if (!dbReady()) {
      return render(res, 503, Object.assign(base, { noindex: true,
        main: '<main class="bl-main">' + intro + '<p class="bl-empty">The blog is unavailable for a moment. Please try again shortly.</p></main>' }));
    }
    try {
      const total = await BlogPost.countDocuments();
      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (page > pages) return res.status(404).sendFile(NOT_FOUND);
      const posts = await BlogPost.find()
        .sort({ publishedAt: -1, _id: -1 }).skip((page - 1) * PER_PAGE).limit(PER_PAGE)
        .select('slug title excerpt publishedAt updatedAt heroImage.contentType videoUrl').lean();
      let body = posts.length
        ? '<div class="bl-grid">' + posts.map(card).join('') + '</div>'
        : '<p class="bl-empty">No posts yet</p>';
      if (pages > 1) {
        body += '<nav class="bl-pager" aria-label="Blog pages">' +
          (page > 1 ? '<a href="/blog' + (page > 2 ? '?page=' + (page - 1) : '') + '" rel="prev">← Newer posts</a>' : '<span></span>') +
          '<span class="bl-pager-at">Page ' + page + ' of ' + pages + '</span>' +
          (page < pages ? '<a href="/blog?page=' + (page + 1) + '" rel="next">Older posts →</a>' : '<span></span>') +
          '</nav>';
      }
      if (page > 1) base.title = "Blog — page " + page + " — D'Cal";
      render(res, 200, Object.assign(base, { main: '<main class="bl-main">' + intro + body + '</main>' }));
    } catch (e) {
      try { console.error('blog list failed:', e && e.message); } catch (x) {}
      res.status(500).sendFile(NOT_FOUND);
    }
  });

  app.get('/blog/:slug', async function (req, res) {
    const slug = String(req.params.slug || '');
    if (!dbReady()) return res.status(503).sendFile(NOT_FOUND);
    try {
      const p = /^[a-z0-9-]+$/.test(slug)
        ? await BlogPost.findOne({ slug: slug }).select('-heroImage.data').lean()
        : null;
      if (!p) return res.status(404).sendFile(NOT_FOUND);
      const site = siteUrl();
      const url = site + '/blog/' + p.slug;
      const img = hasImage(p) ? site + imagePath(p) : site + '/img/dcal-logo.png';
      const jsonld = {
        '@context': 'https://schema.org', '@type': 'BlogPosting',
        headline: p.title, description: p.excerpt,
        datePublished: isoDate(p.publishedAt), dateModified: isoDate(p.updatedAt || p.publishedAt),
        image: [img], url: url, mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        author: { '@type': 'Organization', name: "D'Cal", url: site },
        publisher: { '@type': 'Organization', name: "D'Cal", logo: { '@type': 'ImageObject', url: site + '/img/dcal-logo.png' } }
      };
      // A video post shows its player where the hero image would be, with that
      // image (a still from the video) as the poster. Re-checked here as well as
      // at ingest: whatever is stored, only an https URL ever reaches the page.
      const video = p.videoUrl && videoFields(p).videoUrl
        ? { url: p.videoUrl, type: p.videoMimeType || 'video/mp4' }
        : null;
      const top = video
        ? '<video class="bl-video" controls playsinline preload="metadata"' +
            (hasImage(p) ? ' poster="' + escHtml(imagePath(p)) + '"' : '') + '>' +
            '<source src="' + escHtml(video.url) + '" type="' + escHtml(video.type) + '">' +
            'Your browser can\'t play this video.</video>'
        : (hasImage(p) ? '<img class="bl-hero" src="' + escHtml(imagePath(p)) + '" alt="' + escHtml(p.title) + '" fetchpriority="high">' : '');
      const ld = video
        ? [jsonld, {
            '@context': 'https://schema.org', '@type': 'VideoObject',
            name: p.title, description: p.excerpt, thumbnailUrl: img,
            uploadDate: isoDate(p.publishedAt), contentUrl: video.url
          }]
        : jsonld;
      const main =
        '<main class="bl-main bl-main--post"><article class="bl-post">' +
          '<a class="bl-back" href="/blog">← All posts</a>' +
          '<h1>' + escHtml(p.title) + '</h1>' +
          '<time class="bl-date" datetime="' + isoDate(p.publishedAt) + '">' + escHtml(fmtDate(p.publishedAt)) + '</time>' +
          top +
          '<div class="bl-body">' + md.render(p.bodyMarkdown || '') + '</div>' +
          '<div class="bl-cta"><p>Hard water at home? D\'Cal stops limescale without electricity, salt or chemicals.</p>' +
          '<a class="ip-btn" href="/collection">Explore D\'Cal products →</a></div>' +
        '</article></main>';
      render(res, 200, {
        title: p.title + " — D'Cal", ogTitle: p.title, description: p.excerpt, canonical: url,
        image: img, ogType: 'article', jsonld: ld, video: video, main: main
      });
    } catch (e) {
      try { console.error('blog post failed:', e && e.message); } catch (x) {}
      res.status(500).sendFile(NOT_FOUND);
    }
  });

  app.get('/blog/:slug/image', async function (req, res) {
    if (!dbReady()) return res.status(503).end();
    try {
      const p = await BlogPost.findOne({ slug: String(req.params.slug || '') }).select('heroImage');
      if (!p || !p.heroImage || !p.heroImage.data || !IMAGE_TYPES.has(p.heroImage.contentType)) return res.status(404).end();
      res.set('Content-Type', p.heroImage.contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(p.heroImage.data);
    } catch (e) {
      try { console.error('blog image failed:', e && e.message); } catch (x) {}
      res.status(500).end();
    }
  });

  // the Shopify-era placeholder article page this blog replaces
  app.get('/article', function (req, res) { res.redirect(301, '/blog'); });

  /* ---------- sitemap + robots ----------
     The site had neither. The sitemap lists the public storefront pages too —
     one listing only the blog would read to a crawler as "this is the site". */
  const STATIC_PAGES = ['/', '/collection', '/about', '/contact', '/faq', '/shipping-returns', '/track-order',
    '/privacy-policy', '/legal', '/campus/', '/hotel/', '/hospital/', '/partner/', '/blog'];
  app.get('/sitemap.xml', async function (req, res) {
    const site = siteUrl();
    const urls = STATIC_PAGES.concat(productSlugs.map(function (s) { return '/product/' + s; }))
      .map(function (u) { return '<url><loc>' + escHtml(site + u) + '</loc></url>'; });
    if (dbReady()) {
      try {
        const posts = await BlogPost.find().sort({ publishedAt: -1 }).select('slug publishedAt updatedAt').lean();
        posts.forEach(function (p) {
          urls.push('<url><loc>' + escHtml(site + '/blog/' + p.slug) + '</loc><lastmod>' + isoDate(p.updatedAt || p.publishedAt) + '</lastmod></url>');
        });
      } catch (e) { try { console.error('sitemap: posts left out:', e && e.message); } catch (x) {} }
    }
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n');
  });
  app.get('/robots.txt', function (req, res) {
    res.type('text/plain').send('User-agent: *\nDisallow:\n\nSitemap: ' + siteUrl() + '/sitemap.xml\n');
  });
}

module.exports = { ingest, mountPages, signatureOk, cleanSlug };
