/*
 * Left-nav dropdown carets.
 *
 * The house theme (tt_theme.css) folds every sub-tree by default and shows a
 * chevron on items that have children; expansion is driven by a `.tt-open`
 * class. The canonical site toggles that class from tt-search.js, which this
 * standalone site does not vendor — so this small script provides the same
 * behaviour: clicking the chevron expands/collapses the branch in place
 * (without navigating), while clicking the label still follows the link. The
 * active page's ancestors are opened on load.
 */
(function () {
  "use strict";
  var CARET_ZONE = 34; // px from the link's right edge that counts as the chevron

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var menu = document.querySelector(".wy-menu-vertical");
    if (!menu) return;

    // Wire each parent item (an <li> that owns a nested <ul>).
    menu.querySelectorAll("li").forEach(function (li) {
      var sub = li.querySelector(":scope > ul");
      var link = li.querySelector(":scope > a");
      if (!sub || !link) return;
      link.addEventListener("click", function (e) {
        var rect = link.getBoundingClientRect();
        // Only the chevron zone toggles; clicks on the label navigate normally.
        if (e.clientX >= rect.right - CARET_ZONE) {
          e.preventDefault();
          li.classList.toggle("tt-open");
        }
      });
    });

    // Seed the active path open without animating the carets.
    menu.classList.add("tt-seeding");
    menu.querySelectorAll("li.current").forEach(function (li) {
      if (li.querySelector(":scope > ul")) li.classList.add("tt-open");
    });
    var active = menu.querySelector("a.current");
    var node = active ? active.parentElement : null;
    while (node && menu.contains(node)) {
      if (node.tagName === "LI" && node.querySelector(":scope > ul")) {
        node.classList.add("tt-open");
      }
      node = node.parentElement;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        menu.classList.remove("tt-seeding");
      });
    });
  });
})();
