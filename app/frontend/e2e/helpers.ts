// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Page } from "@playwright/test";

// `vite preview` has no backend proxy, so every relative API call would 404.
// Intercept them in the browser context instead: the liveness probe gets a 200
// (this also keeps the suite green once the backend-health gate lands, which
// replaces the whole app with a disconnect overlay after two failed /up/ polls)
// and the REST endpoints get an empty-but-valid JSON body.
export async function mockBackend(page: Page): Promise<void> {
  await page.route("**/up/", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "" })
  );
  await page.route(
    /\/(docker|models|board|logs|collections|app|vector-db)-api\//,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      })
  );
  // Endpoints whose consumers require a specific object shape rather than a
  // bare array (a mismatch throws during render and blanks the whole tree).
  // Registered after the generic handler: Playwright matches routes in
  // reverse registration order, so these take precedence.
  await page.route("**/docker-api/deployment-history/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", deployments: [], count: 0 }),
    })
  );
}

// Console noise that does not indicate a rendering failure. Uncaught page
// errors are never allowlisted.
const CONSOLE_ERROR_ALLOWLIST: RegExp[] = [
  /Failed to load resource/i, // mocked/absent backend resources
  /Download the React DevTools/i,
  /onnxruntime|wasm/i, // onnxruntime-web warnings on media pages
  /WebSocket/i, // ws-api endpoints are not mocked
  /Failed to fetch/i, // components logging their own fetch failures
  /NetworkError|net::ERR/i,
];

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(`Uncaught page error: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (CONSOLE_ERROR_ALLOWLIST.some((pattern) => pattern.test(text))) return;
    errors.push(`Console error: ${text}`);
  });
  return errors;
}
