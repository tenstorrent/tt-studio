/*
 * Sidebar scroll stability.
 *
 * The Read the Docs theme (theme.js) runs ThemeNav.reset() on every page load
 * and on hashchange. reset() locates the current page's nav link (rendered as
 * href="#") and calls scrollIntoView() on it, which snaps that link to the TOP
 * of the fixed, independently-scrolling sidebar (.wy-side-scroll). Because every
 * left-menu item is a real page link, each click is a full-page navigation -> on
 * the new page reset() fires and the menu visibly jumps/jitters to reposition
 * the active item at the top.
 *
 * Fix, in two parts:
 *   1. Suppress the scrollIntoView() call inside reset() (keeping its
 *      current-class / expand logic intact). reset() runs at DOMContentLoaded
 *      via jQuery's ready queue, so a plain "restore scroll afterwards" loses the
 *      race -- reset() runs last and re-scrolls. Replacing nav.reset HERE (at
 *      parse time, before theme.js's deferred enable() runs) means both the
 *      on-load reset and the hashchange-bound reset use the no-scroll version.
 *   2. Persist the sidebar's scroll position across navigations so the menu
 *      stays exactly where it was instead of resetting to the top.
 *
 * Loaded from the footer block (after theme.js defines SphinxRtdTheme, but
 * before its enable() fires on DOMContentLoaded).
 */
(function () {
  "use strict";

  var KEY = "tt-sidebar-scroll";

  function sidebar() {
    return document.querySelector(".wy-side-scroll");
  }

  // 1. Neutralize the scrollIntoView() that reset() performs on the active item.
  var nav = window.SphinxRtdTheme && window.SphinxRtdTheme.Navigation;
  if (nav && typeof nav.reset === "function" && !nav.__ttNoScroll) {
    nav.__ttNoScroll = true;
    var origReset = nav.reset;
    nav.reset = function () {
      var realScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function () {};
      try {
        return origReset.apply(this, arguments);
      } finally {
        Element.prototype.scrollIntoView = realScrollIntoView;
      }
    };
  }

  // 2. Restore the saved scroll position; keep saving it as the user navigates.
  function restore() {
    var el = sidebar();
    if (!el) return;
    var saved = sessionStorage.getItem(KEY);
    if (saved !== null) el.scrollTop = parseInt(saved, 10) || 0;
  }

  function save() {
    var el = sidebar();
    if (!el) return;
    try {
      sessionStorage.setItem(KEY, String(el.scrollTop));
    } catch (e) {
      /* sessionStorage may be unavailable (privacy mode); fail quietly */
    }
  }

  restore();                                            // parse time (best effort)
  document.addEventListener("DOMContentLoaded", restore); // after layout is resolved
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", save);
})();
