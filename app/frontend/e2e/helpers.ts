// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Page } from "@playwright/test";

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const settingField = { set: false, masked: null, value: null, source: null };

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
    (route) => route.fulfill(json([]))
  );
  // Endpoints whose consumers require a specific object shape rather than a
  // bare array (a mismatch throws during render). Most of these are read by
  // the app layout on every page. Registered after the generic handler:
  // Playwright matches routes in reverse registration order, so these take
  // precedence.
  await page.route("**/docker-api/deployment-history/**", (route) =>
    route.fulfill(json({ status: "success", deployments: [], count: 0 }))
  );
  await page.route("**/docker-api/deployments/**", (route) =>
    route.fulfill(json({}))
  );
  await page.route("**/docker-api/chip-status/**", (route) =>
    route.fulfill(
      json({ board_type: "unknown", total_slots: 0, slots: [], cards: [] })
    )
  );
  await page.route("**/board-api/device-state/**", (route) =>
    route.fulfill(
      json({
        state: "NOT_PRESENT",
        board_type: "unknown",
        board_name: "unknown",
        devices: [],
        last_updated: "",
        reset_suggested: false,
      })
    )
  );
  await page.route("**/board-api/footer-data/**", (route) =>
    route.fulfill(json({ cpuUsage: 0, memoryUsage: 0, memoryTotal: "0 GB" }))
  );
  // A completed setup, so the first-run guard doesn't redirect to /welcome.
  await page.route("**/settings-api/", (route) =>
    route.fulfill(
      json({
        setup_complete: true,
        jwt_secret: { ...settingField, editable: false },
        tavily_api_key: { ...settingField, editable: true },
        hf_token: { ...settingField, editable: true },
        tts_api_key: { ...settingField, editable: false },
        artifact: {
          branch: null,
          version: null,
          editable: false,
          description: "",
        },
      })
    )
  );
  await page.route("**/settings-api/hf-check/", (route) =>
    route.fulfill(json({ ok: true, results: [] }))
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
