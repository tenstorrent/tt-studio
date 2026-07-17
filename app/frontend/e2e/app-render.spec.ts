// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { test, expect } from "@playwright/test";
import { mockBackend, collectPageErrors } from "./helpers";

test.describe("home page", () => {
  test("renders the navbar and model deployment stepper", async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBackend(page);
    await page.goto("/");

    await expect(
      page.getByAltText("Tenstorrent Logo").first()
    ).toBeVisible();
    await expect(page.getByText("Model Selection").first()).toBeVisible();
    await expect(page.getByText("Deploy Model").first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});

// Shallow render checks: every public route must mount inside MainLayout
// (navbar present) without a blank page or an uncaught exception.
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
  "/coding-agents",
];

test.describe("route smoke tests", () => {
  for (const route of ROUTES) {
    test(`renders ${route}`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await mockBackend(page);
      await page.goto(route);

      await expect(
        page.getByAltText("Tenstorrent Logo").first()
      ).toBeVisible();
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
    await expect(page.getByAltText("Tenstorrent Logo").first()).toBeVisible();
  });

  test("/voice-pipeline redirects to /voice-agent", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/voice-pipeline");

    await expect(page).toHaveURL(/\/voice-agent$/);
  });
});
