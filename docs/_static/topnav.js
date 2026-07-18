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
      nav.classList.toggle("tt-mobile-open");
    });
  });
})();
