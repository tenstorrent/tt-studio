// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Minimal service worker with a single job: when a page NAVIGATION fails
// because the frontend server is unreachable (run.py stopped, dev-server
// restarting, container down), serve the cached offline.html instead of the
// browser's dead error page. offline.html polls the server and reloads once
// it is back, so the tab always recovers on its own.
//
// It deliberately never caches or intercepts app assets or API calls — only
// `mode === "navigate"` requests — so it cannot serve stale application code.

// Bump the version suffix whenever offline.html changes so clients re-cache it.
const CACHE_NAME = "tt-studio-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // `cache: "reload"` bypasses the HTTP cache so we always store the
      // server's current copy of offline.html.
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached || Response.error();
    })
  );
});
