/* =========================================================
   D'Cal Dealership Landing — interactions & animations
========================================================= */
(function () {
  "use strict";

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Navbar scroll state ---------- */
  var navbar = document.getElementById("navbar");
  var progress = document.getElementById("scrollProgress");
  var floatingCta = document.getElementById("floatingCta");

  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;

    if (navbar) navbar.classList.toggle("scrolled", y > 40);

    // scroll progress bar
    if (progress) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    }

    // hide floating CTA when the form is on screen
    if (floatingCta) {
      var form = document.getElementById("apply");
      if (form) {
        var r = form.getBoundingClientRect();
        var visible = r.top < window.innerHeight * 0.7 && r.bottom > 0;
        floatingCta.style.opacity = visible ? "0" : "1";
        floatingCta.style.pointerEvents = visible ? "none" : "auto";
        floatingCta.style.transform =
          (visible ? "translateY(20px)" : "translateY(0)") +
          (window.innerWidth <= 680 ? " translateX(-50%)" : "");
      }
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---------- Mobile nav ---------- */
  var navToggle = document.getElementById("navToggle");
  var navLinks = document.getElementById("navLinks");
  function closeNav() {
    if (navLinks) navLinks.classList.remove("open");
    if (navToggle) navToggle.classList.remove("active");
  }
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      navLinks.classList.toggle("open");
      navToggle.classList.toggle("active");
    });
    navLinks.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeNav);
    });
  }

  /* ---------- Scroll reveal (IntersectionObserver) ---------- */
  var reveals = document.querySelectorAll(".reveal");

  /* Auto-stagger siblings so grids cascade in one-by-one */
  (function staggerReveals() {
    var groups = [];
    reveals.forEach(function (el) {
      if (el.hasAttribute("data-delay")) return; // respect explicit delays
      var parent = el.parentElement;
      var group = null;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].parent === parent) { group = groups[i]; break; }
      }
      if (!group) { group = { parent: parent, items: [] }; groups.push(group); }
      group.items.push(el);
    });
    groups.forEach(function (group) {
      if (group.items.length < 2) return;
      group.items.forEach(function (el, i) {
        el.setAttribute("data-delay", Math.min(i * 90, 600));
      });
    });
  })();

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var el = entry.target;
            var delay = parseInt(el.getAttribute("data-delay") || "0", 10);
            setTimeout(function () {
              el.classList.add("in");
            }, delay);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add("in");
    });
  }

  /* ---------- Animated stat counters ---------- */
  var stats = document.querySelectorAll(".stat-num");
  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count") || "0", 10);
    var start = 0;
    var dur = 1600;
    var t0 = null;
    function tick(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      // ease-out
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }
  if ("IntersectionObserver" in window && stats.length) {
    var statIo = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            statIo.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    stats.forEach(function (el) {
      statIo.observe(el);
    });
  }

  /* ---------- FAQ accordion (single-open) ---------- */
  var faqItems = document.querySelectorAll(".faq-item");
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (item.open) {
        faqItems.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      }
    });
  });

  /* ---------- Smooth-scroll for in-page anchors ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      var id = link.getAttribute("href");
      if (id.length < 2) return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      var top =
        target.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: top, behavior: "smooth" });
    });
  });

  /* ---------- Hero parallax on mouse move ---------- */
  var orb = document.querySelector(".product-orb");
  var hero = document.querySelector(".hero");
  if (orb && hero && window.matchMedia("(pointer:fine)").matches) {
    hero.addEventListener("mousemove", function (e) {
      var cx = window.innerWidth / 2;
      var cy = window.innerHeight / 2;
      var dx = (e.clientX - cx) / cx;
      var dy = (e.clientY - cy) / cy;
      orb.style.transform =
        "translate(" + dx * 16 + "px," + dy * 16 + "px)";
    });
    hero.addEventListener("mouseleave", function () {
      orb.style.transform = "translate(0,0)";
    });
  }

  /* ---------- Lead form ---------- */
  // Where the dealership API lives. Same origin in production (the server serves
  // this page); override with window.DCAL_API_BASE if hosted separately.
  var API_BASE = (typeof window !== "undefined" && window.DCAL_API_BASE) || "";
  var form = document.getElementById("dealerForm");
  var note = document.getElementById("formNote");
  if (form) {
    // Pincode -> auto-fill City & State (India Post API)
    var pin = form.querySelector('[name="pincode"]');
    if (pin) {
      pin.addEventListener("input", function () {
        if (pin.value.length === 6) lookupDealerPincode(pin.value);
      });
    }
    function lookupDealerPincode(code) {
      var noteEl = form.querySelector("[data-pin-note]");
      if (noteEl) { noteEl.textContent = "Detecting location…"; noteEl.style.color = "#64748B"; }
      fetch("https://api.postalpincode.in/pincode/" + code)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var rec = d && d[0];
          if (!rec || rec.Status !== "Success" || !rec.PostOffice || !rec.PostOffice.length) {
            if (noteEl) { noteEl.textContent = "Pincode not found — fill city & state manually."; noteEl.style.color = "#B45309"; }
            return;
          }
          var po = rec.PostOffice[0];
          var cityInput = form.querySelector('[name="city"]');
          var stateSel = form.querySelector('[name="state"]');
          if (cityInput && !cityInput.value) cityInput.value = po.District;
          if (stateSel) {
            var set = false, i;
            for (i = 0; i < stateSel.options.length; i++) {
              if (stateSel.options[i].text.toLowerCase() === po.State.toLowerCase()) { stateSel.selectedIndex = i; set = true; break; }
            }
            if (!set) for (i = 0; i < stateSel.options.length; i++) { if (stateSel.options[i].text === "Other") { stateSel.selectedIndex = i; break; } }
          }
          if (noteEl) { noteEl.textContent = "✓ " + po.District + ", " + po.State; noteEl.style.color = "#0B6E4F"; }
        })
        .catch(function () {
          if (noteEl) { noteEl.textContent = "Could not auto-detect — fill manually."; noteEl.style.color = "#B45309"; }
        });
    }

    function showThanks() {
      form.reset();
      var pinNote = form.querySelector("[data-pin-note]");
      if (pinNote) pinNote.textContent = "";
      if (note) {
        note.hidden = false;
        note.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = (v || "").toString().trim(); });

      // Save the application to our server (stored in MongoDB → admin "Dealers"
      // tab). The server dedupes by mobile. We optimistically show the thank-you
      // even on a network/DB hiccup so a valid lead is never trapped behind an error.
      var btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; }
      fetch(API_BASE + "/api/dealership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function () { showThanks(); })
        .catch(function () { showThanks(); })
        .then(function () { if (btn) btn.disabled = false; });
    });
  }
})();
