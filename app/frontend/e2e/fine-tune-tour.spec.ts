// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { test, expect } from "@playwright/test";
import { mockBackend, collectPageErrors } from "./helpers";

// Titles in tour order; the dialog-driven steps must open the New Training Job
// dialog and it must close again once the tour moves past them.
const STEP_TITLES = [
  "Fine-Tune on Tenstorrent Hardware",
  "Start a New Training Job",
  "Choose a Base Model",
  "Pick a Dataset",
  "Tune Hyperparameters",
  "LoRA Configuration",
  "Launch Training",
  "Monitor Your Jobs",
  "Bring Your Own Dataset",
  "Reuse Uploaded Datasets",
  "Promote for Inference",
  "Deploy Your Fine-Tuned Model",
];
const DIALOG_STEPS = new Set([2, 3, 4, 5, 6]);

test.describe("fine-tune guided tour", () => {
  test("walks every step and drives the training dialog", async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBackend(page);
    await page.route("**/training-api/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: route.request().url().includes("/catalog/")
          ? JSON.stringify({ models: [], datasets: [], device: "" })
          : "[]",
      })
    );
    // Skip the first-visit auto-run so the help menu is the only tour source.
    await page.addInitScript(() => {
      window.localStorage.setItem("tourCompleted:onboarding", "true");
      window.localStorage.setItem("tourCompleted:deploy-model", "true");
    });

    // Launch from another page to exercise the route hop into /training.
    await page.goto("/models-deployed");
    await page.getByRole("button", { name: "Guided Tours & Help" }).click();
    await page.getByText("Fine-Tune & Promote a Model").click();
    await expect(page).toHaveURL(/\/training$/);

    const tooltip = page.locator('[data-test-id="tooltip"], .react-joyride__tooltip').first();
    const dialog = page.getByRole("dialog", { name: "New Training Job" });

    for (let i = 0; i < STEP_TITLES.length; i++) {
      await expect(tooltip).toContainText(STEP_TITLES[i], { timeout: 10_000 });
      if (DIALOG_STEPS.has(i)) {
        await expect(dialog).toBeVisible();
      } else {
        await expect(dialog).toBeHidden();
      }
      const isLast = i === STEP_TITLES.length - 1;
      await tooltip
        .getByRole("button", { name: isLast ? "Done" : /^Next/ })
        .click();
    }

    await expect(tooltip).toBeHidden();
    await expect(dialog).toBeHidden();
    // Exiting a tour launched from elsewhere returns to where it started.
    await expect(page).toHaveURL(/\/models-deployed$/);
    expect(errors).toEqual([]);
  });
});
