/* =========================================================
   D'Cal — Hospital Water Softener Landing
   Interactions & lead capture
========================================================= */
(function () {
  "use strict";

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* footer year */
  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* navbar + progress + mobile CTA */
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
    if (mobileCta && hero) {
      var past = y > hero.offsetHeight * 0.6;
      var lead = $("#lead"), formVisible = false;
      if (lead) {
        var r = lead.getBoundingClientRect();
        formVisible = r.top < window.innerHeight * 0.8 && r.bottom > 0;
      }
      mobileCta.style.transform = (past && !formVisible) ? "translateY(0)" : "translateY(110%)";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* mobile nav */
  var navToggle = $("#navToggle"), navLinks = $("#navLinks");
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

  /* smooth scroll */
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

  /* scroll reveal (auto-stagger) */
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
          var el = entry.target, delay = parseInt(el.getAttribute("data-delay") || "0", 10);
          setTimeout(function () { el.classList.add("in"); }, delay);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else { reveals.forEach(function (el) { el.classList.add("in"); }); }

  /* animated counters */
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

  /* FAQ single-open */
  var faqItems = $$(".faq-item");
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (item.open) faqItems.forEach(function (o) { if (o !== item) o.open = false; });
    });
  });

  /* lead form -> /api/dealership (public, no login; emails sales + confirmation,
     lands in admin "Dealers" tab). Tagged clearly as an education/campus lead. */
  var API_BASE = (typeof window !== "undefined" && window.DCAL_API_BASE) || "";
  var form = $("#campusForm"), note = $("#formNote");

  if (form) {
    var pin = form.querySelector('[name="pincode"]');
    var pinNote = form.querySelector("[data-pin-note]");
    if (pin) {
      pin.addEventListener("input", function () {
        if (pin.value.length === 6) lookupPin(pin.value);
        else if (pinNote) pinNote.textContent = "";
      });
    }
    function lookupPin(code) {
      if (pinNote) { pinNote.textContent = "Detecting location…"; pinNote.style.color = "#59627f"; }
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

    function showThanks() {
      form.reset();
      if (pinNote) pinNote.textContent = "";
      if (note) { note.hidden = false; note.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }); }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var raw = {};
      new FormData(form).forEach(function (v, k) { raw[k] = (v || "").toString().trim(); });

      var payload = {
        fullName: raw.fullName,
        businessName: raw.businessName,
        mobile: raw.mobile,
        email: raw.email,
        city: raw.city,
        pincode: raw.pincode,
        state: form._detectedState || "",
        businessType: "Campus – " + (raw.institutionType || "Education"),
        currentProducts: raw.strength || "",
        message: "[CAMPUS WATER CONSULTATION] Institution: " + (raw.businessName || "-")
          + " | Type: " + (raw.institutionType || "-")
          + " | Students/Strength: " + (raw.strength || "-")
          + (raw.hostel ? " | Hostel: " + raw.hostel : "")
          + (raw.notes ? " | Notes: " + raw.notes : "")
      };

      var btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      fetch(API_BASE + "/api/dealership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function () { showThanks(); })
        .catch(function () { showThanks(); })
        .then(function () { if (btn) btn.disabled = false; });
    });
  }
})();
