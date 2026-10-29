// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { test, expect, type Page } from "@playwright/test";
import { mockBackend, collectPageErrors } from "./helpers";

/**
 * The app layout is mounted (its sidebar brand link is visible) and the page
 * inside it rendered instead of falling back to the page error boundary, which
 * would otherwise hide a crash from these tests.
 */
async function expectPageInLayout(page: Page) {
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "TT-Studio" })
  ).toBeVisible();
  // a page that crashes on its data does so once its first requests are back
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByText("Something went wrong on this page")
  ).toHaveCount(0);
}

test.describe("home page", () => {
  test("renders the app layout and the hardware overview", async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBackend(page);
    await page.goto("/");

    await expectPageInLayout(page);
    await expect(page.getByText("Hardware", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-scan" })).toBeVisible();
    await expect(
      page.getByText("No Tenstorrent hardware detected")
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});

// Shallow render checks: every public route must mount inside the app layout
// without a blank page, an uncaught exception, or the page error fallback.
const ROUTES = [
  "/",
  "/models-deployed",
  "/chat",
  "/rag-management",
  "/logs",
  "/object-detection",
  "/face-recognition",
  "/deployed-home",
  "/image-generation",
  "/voice-agent",
  "/speech-to-text",
  "/api-info/test-model",
  "/deployment-history",
  "/tts",
  "/video-generation",
  "/settings",
  "/coding-agents",
];

test.describe("route smoke tests", () => {
  for (const route of ROUTES) {
    test(`renders ${route}`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await mockBackend(page);
      await page.goto(route);

      await expectPageInLayout(page);
      await expect(page.locator("#root")).not.toBeEmpty();

      expect(
        errors.filter((error) => error.startsWith("Uncaught page error"))
      ).toEqual([]);
    });
  }
});

test.describe("routing edge cases", () => {
  test("unknown paths render the 404 page inside the layout", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/definitely-not-a-route");

    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText("Page Not Found")).toBeVisible();
    await expectPageInLayout(page);
  });

  test("/voice-pipeline redirects to /voice-agent", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/voice-pipeline");

    await expect(page).toHaveURL(/\/voice-agent$/);
  });
});
