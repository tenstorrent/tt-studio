/*
 * Top nav mobile toggle.
 *
 * On narrow viewports the hamburger (.tt-nav-hamburger) opens the top-nav
 * link list (the theme styles `.tt-top-nav.tt-mobile-open`). On desktop the
 * dropdowns are hover-driven via CSS and this does nothing.
 */
(function () {
  "use strict";
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    var nav = document.querySelector(".tt-top-nav");
    var burger = document.querySelector(".tt-nav-hamburger");
    if (!nav || !burger) return;
    burger.addEventListener("click", function (e) {
      e.preventDefault();
      // The landing page hides the doc sidebar, so RTD's document-level
      // wy-nav-top handler would slide in an element that isn't there.
      if (document.querySelector(".hero")) e.stopPropagation();
      nav.classList.toggle("tt-mobile-open");
    });
    nav.querySelectorAll(".tt-nav-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("tt-mobile-open");
      });
    });
  });
})();
