/*
 * Left-nav external links open in a new tab.
 *
 * The shared theme marks external sidebar links with an "open in new tab" glyph
 * (.wy-menu-vertical a.reference.external::after in tt_theme.css). This makes the
 * click behavior match that affordance: every such link gets target="_blank" +
 * rel="noopener noreferrer".
 *
 * Note: custom.js already adds target="_blank" to *cross-origin* links, but the
 * sidebar shows the external glyph on any .reference.external link -- including
 * ones that resolve to the same origin in production (e.g. another
 * docs.tenstorrent.com sub-site). Those would otherwise open in the same tab
 * despite the icon. Here the icon, not the origin, is the source of truth.
 */
(function () {
  "use strict";

  function mark() {
    var links = document.querySelectorAll(".wy-menu-vertical a.reference.external");
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute("target", "_blank");
      links[i].setAttribute("rel", "noopener noreferrer");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mark);
  } else {
    mark();
  }
})();
