/* =========================================================
   D'Cal — Hotel Water Softener Landing
   Interactions, cost calculator & lead capture
========================================================= */
(function () {
  "use strict";

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Footer year ---------- */
  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Navbar + scroll progress + mobile CTA ---------- */
  var navbar = $("#navbar");
  var progress = $("#scrollProgress");
  var mobileCta = $("#mobileCta");
  var hero = $("#hero");

  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (navbar) navbar.classList.toggle("scrolled", y > 30);
    if (progress) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    }
    // show sticky mobile CTA only after the hero has scrolled past
    if (mobileCta && hero) {
      var past = y > hero.offsetHeight * 0.6;
      var lead = $("#lead");
      var formVisible = false;
      if (lead) {
        var r = lead.getBoundingClientRect();
        formVisible = r.top < window.innerHeight * 0.8 && r.bottom > 0;
      }
      mobileCta.style.transform = (past && !formVisible) ? "translateY(0)" : "translateY(110%)";
    }
  }
  if (mobileCta) mobileCta.style.transition = "transform .4s cubic-bezier(.16,.8,.3,1)";
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---------- Mobile nav ---------- */
  var navToggle = $("#navToggle");
  var navLinks = $("#navLinks");
  function setNav(open) {
    if (navLinks) navLinks.classList.toggle("open", open);
    if (navToggle) navToggle.classList.toggle("active", open);
    document.body.classList.toggle("nav-open", open);   // dims + locks the page behind the menu
  }
  function closeNav() { setNav(false); }
  if (navToggle && navLinks) {
    var navBackdrop = document.createElement("div");
    navBackdrop.className = "nav-backdrop";
    navBackdrop.addEventListener("click", closeNav);      // tap outside to close
    document.body.appendChild(navBackdrop);
    navToggle.addEventListener("click", function () { setNav(!navLinks.classList.contains("open")); });
    $$("a", navLinks).forEach(function (a) { a.addEventListener("click", closeNav); });
  }

  /* back-to-top button + floating "fill the form" CTA */
  (function () {
    var toTop = document.getElementById("toTop");
    var formFloat = document.getElementById("formFloat");
    var leadSection = document.getElementById("lead");
    var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var formInView = false;
    if (leadSection && "IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { formInView = es[0].isIntersecting; sync(); }, { threshold: 0.12 }).observe(leadSection);
    }
    function sync() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      if (toTop) toTop.classList.toggle("show", y > 400);
      if (formFloat) formFloat.classList.toggle("show", y > 300 && !formInView);
    }
    if (toTop) toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: rm ? "auto" : "smooth" }); });
    window.addEventListener("scroll", sync, { passive: true });
    sync();
  })();

  /* ---------- Smooth-scroll for in-page anchors ---------- */
  $$('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      var id = link.getAttribute("href");
      if (id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.scrollY - 74;
      window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
    });
  });

  /* ---------- Scroll reveal (auto-stagger siblings) ---------- */
  var reveals = $$(".reveal");
  (function stagger() {
    var groups = [];
    reveals.forEach(function (el) {
      if (el.hasAttribute("data-delay")) return;
      var parent = el.parentElement, group = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].parent === parent) { group = groups[i]; break; }
      if (!group) { group = { parent: parent, items: [] }; groups.push(group); }
      group.items.push(el);
    });
    groups.forEach(function (g) {
      if (g.items.length < 2) return;
      g.items.forEach(function (el, i) { el.setAttribute("data-delay", Math.min(i * 85, 520)); });
    });
  })();

  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var el = entry.target;
          var delay = parseInt(el.getAttribute("data-delay") || "0", 10);
          setTimeout(function () { el.classList.add("in"); }, delay);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Animated counters (with suffix) ---------- */
  var stats = $$(".roi-num");
  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count") || "0", 10);
    var suffix = el.getAttribute("data-suffix") || "";
    if (reduceMotion) { el.textContent = target + suffix; return; }
    var dur = 1500, t0 = null;
    function tick(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick); else el.textContent = target + suffix;
    }
    requestAnimationFrame(tick);
  }
  if ("IntersectionObserver" in window && stats.length) {
    var statIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { animateCount(entry.target); statIo.unobserve(entry.target); }
      });
    }, { threshold: 0.5 });
    stats.forEach(function (el) { statIo.observe(el); });
  }

  /* ---------- Hero cost ticker (₹50k → ₹1L → ₹2L) ---------- */
  var ticker = $("#costTicker");
  if (ticker && !reduceMotion) {
    var amounts = ["₹50,000", "₹1,00,000", "₹2,00,000"];
    var idx = 0;
    setInterval(function () {
      idx = (idx + 1) % amounts.length;
      ticker.style.transition = "opacity .3s, transform .3s";
      ticker.style.opacity = "0";
      ticker.style.transform = "translateY(-8px)";
      setTimeout(function () {
        ticker.textContent = amounts[idx];
        ticker.style.opacity = "1";
        ticker.style.transform = "translateY(0)";
      }, 300);
    }, 1800);
  }

  /* ---------- Hero parallax ---------- */
  var orb = $(".product-orb");
  if (orb && hero && window.matchMedia("(pointer:fine)").matches && !reduceMotion) {
    hero.addEventListener("mousemove", function (e) {
      var dx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
      var dy = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
      orb.style.transform = "translate(" + dx * 14 + "px," + dy * 14 + "px)";
    });
    hero.addEventListener("mouseleave", function () { orb.style.transform = "translate(0,0)"; });
  }

  /* ---------- FAQ single-open ---------- */
  var faqItems = $$(".faq-item");
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (item.open) faqItems.forEach(function (o) { if (o !== item) o.open = false; });
    });
  });

  /* ---------- Cost of Hard Water Calculator ----------
     Per-room, per-month hidden cost of hard water (₹), based on typical
     Indian hospitality maintenance data. Multiplied by rooms & a hardness
     factor. D'Cal recovers ~72% of the recurring damage/waste. */
  var PER_ROOM = { fittings: 95, plumbing: 70, boiler: 85, laundry: 110, cleaning: 55 };
  var RECOVER = 0.72;

  var roomsRange = $("#roomsRange");
  var roomsOut = $("#roomsOut");
  var hardnessSeg = $("#hardnessSeg");
  var monthlyLossEl = $("#monthlyLoss");
  var yearlyLossEl = $("#yearlyLoss");
  var saveAmtEl = $("#saveAmt");
  var breakdownEl = $("#calcBreakdown");

  var hardnessMult = 1;

  function inr(n) {
    n = Math.round(n);
    // Indian grouping (xx,xx,xxx)
    var s = String(n), last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last3 = "," + last3;
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    return "₹" + rest + last3;
  }

  function renderCalc() {
    if (!roomsRange) return;
    var rooms = parseInt(roomsRange.value, 10);
    if (roomsOut) roomsOut.textContent = rooms;
    var total = 0, parts = {};
    Object.keys(PER_ROOM).forEach(function (k) {
      var v = PER_ROOM[k] * rooms * hardnessMult;
      parts[k] = v; total += v;
    });
    if (monthlyLossEl) monthlyLossEl.textContent = inr(total);
    if (yearlyLossEl) yearlyLossEl.textContent = inr(total * 12);
    if (saveAmtEl) saveAmtEl.textContent = inr(total * RECOVER);
    if (breakdownEl) {
      $$("strong[data-key]", breakdownEl).forEach(function (el) {
        var k = el.getAttribute("data-key");
        if (parts[k] != null) el.textContent = inr(parts[k]);
      });
    }
  }

  if (roomsRange) roomsRange.addEventListener("input", renderCalc);
  if (hardnessSeg) {
    $$("button", hardnessSeg).forEach(function (b) {
      b.addEventListener("click", function () {
        $$("button", hardnessSeg).forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        hardnessMult = parseFloat(b.getAttribute("data-mult")) || 1;
        renderCalc();
      });
    });
  }
  renderCalc();

  /* ---------- Lead form -> /api/dealership ----------
     Reuses the public dealership endpoint: it stores the lead (admin "Dealers"
     tab), emails the sales team and sends the hotel a confirmation. We map the
     hotel fields onto the endpoint's schema and tag it clearly as a hotel lead. */
  var API_BASE = (typeof window !== "undefined" && window.DCAL_API_BASE) || "";
  var form = $("#hotelForm");
  var note = $("#formNote");

  if (form) {
    // Pincode -> auto-fill City (India Post API)
    var pin = form.querySelector('[name="pincode"]');
    var pinNote = form.querySelector("[data-pin-note]");
    if (pin) {
      pin.addEventListener("input", function () {
        if (pin.value.length === 6) lookupPin(pin.value);
        else if (pinNote) pinNote.textContent = "";
      });
    }
    function lookupPin(code) {
      if (pinNote) { pinNote.textContent = "Detecting location…"; pinNote.style.color = "#64748B"; }
      fetch("https://api.postalpincode.in/pincode/" + code)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var rec = d && d[0];
          if (!rec || rec.Status !== "Success" || !rec.PostOffice || !rec.PostOffice.length) {
            if (pinNote) { pinNote.textContent = "Pincode not found — enter city manually."; pinNote.style.color = "#B45309"; }
            return;
          }
          var po = rec.PostOffice[0];
          var cityInput = form.querySelector('[name="city"]');
          if (cityInput && !cityInput.value) cityInput.value = po.District;
          if (pinNote) { pinNote.textContent = "✓ " + po.District + ", " + po.State; pinNote.style.color = "#0B6E4F"; }
          form._detectedState = po.State;
        })
        .catch(function () {
          if (pinNote) { pinNote.textContent = "Could not auto-detect — enter manually."; pinNote.style.color = "#B45309"; }
        });
    }

    // ---- durable submit: never lose a lead, never fake success ----
    // A submit counts as successful ONLY when the server actually accepts it (2xx).
    // On any network error or error status the lead is saved locally and retried on
    // later page loads, and the customer is shown how to reach us directly — so a
    // lead is never silently dropped behind a false "thank you". (A plain fetch
    // resolves even on a 500/503, so we must check r.ok explicitly.)
    var LEAD_Q_KEY = "dcal_lead_queue";
    function readLeadQ() { try { return JSON.parse(localStorage.getItem(LEAD_Q_KEY) || "[]"); } catch (e) { return []; } }
    function writeLeadQ(q) { try { localStorage.setItem(LEAD_Q_KEY, JSON.stringify(q.slice(-50))); } catch (e) {} }
    function queueLead(endpoint, data) { var q = readLeadQ(); q.push({ endpoint: endpoint, data: data, attempts: 0 }); writeLeadQ(q); }
    function postLead(endpoint, data) {
      return fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return true; });
    }
    function flushLeadQ() {
      var q = readLeadQ(); if (!q.length) return;
      writeLeadQ([]);                          // take the batch; re-queue only what still fails
      var keep = [], pending = q.length;
      q.forEach(function (item) {
        postLead(item.endpoint, item.data)
          .catch(function () { item.attempts = (item.attempts || 0) + 1; if (item.attempts < 8) keep.push(item); })
          .then(function () { if (--pending === 0 && keep.length) writeLeadQ(keep.concat(readLeadQ())); });
      });
    }
    flushLeadQ();   // retry anything that failed to send on an earlier visit

    var noteOkHtml = note ? note.innerHTML : "";
    function showThanks(queued) {
      form.reset();
      if (pinNote) pinNote.textContent = "";
      renderCalc();
      if (note) {
        note.innerHTML = queued
          ? "✅ We saved your request. Our expert will call you soon. If not, please call or WhatsApp <b>86229 09192</b>."
          : noteOkHtml;
        note.hidden = false;
        note.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }

      var raw = {};
      new FormData(form).forEach(function (v, k) { raw[k] = (v || "").toString().trim(); });

      // Map hotel fields onto the dealership endpoint's schema.
      var payload = {
        fullName: raw.fullName,
        businessName: raw.businessName,
        mobile: raw.mobile,
        email: raw.email,
        city: raw.city,
        pincode: raw.pincode,
        state: form._detectedState || "",
        businessType: "Hotel – " + (raw.propertyType || "Hotel"),
        currentProducts: raw.rooms || "",
        message: "[HOTEL WATER ANALYSIS] Property: " + (raw.businessName || "-")
          + " | Type: " + (raw.propertyType || "-")
          + " | Rooms: " + (raw.rooms || "-")
          + (raw.notes ? " | Notes: " + raw.notes : "")
      };

      var btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      var endpoint = API_BASE + "/api/dealership";
      postLead(endpoint, payload)
        .then(function () { showThanks(false); })                               // server confirmed
        .catch(function () { queueLead(endpoint, payload); showThanks(true); }) // preserve + retry later
        .then(function () { if (btn) btn.disabled = false; });
    });
  }
})();
