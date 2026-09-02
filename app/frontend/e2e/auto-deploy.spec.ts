// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { test, expect, type Page } from "@playwright/test";
import { mockBackend, collectPageErrors } from "./helpers";

// The CLI's `python run.py run <model>` opens the UI at `/?auto-deploy=<model>`
// (plus `&device-id=` when pinned) and expects the page to perform the deploy.

const CATALOG = [
  {
    id: "id_qwen3_32b",
    name: "Qwen3-32B",
    is_compatible: true,
    compatible_boards: ["P300x2"],
    model_type: "chat",
    display_model_type: "LLM",
    current_board: "P300x2",
    status: "COMPLETE",
    chips_required: 2,
    hf_model_id: "Qwen/Qwen3-32B",
  },
  {
    id: "id_llama_8b",
    name: "Llama-3.1-8B-Instruct",
    is_compatible: true,
    compatible_boards: ["P300x2"],
    model_type: "chat",
    display_model_type: "LLM",
    current_board: "P300x2",
    status: "COMPLETE",
    chips_required: 2,
    hf_model_id: "meta-llama/Llama-3.1-8B-Instruct",
  },
];

const FIELD = { set: false, masked: null, value: null, source: null, editable: true };

function settings(setupComplete: boolean) {
  return {
    setup_complete: setupComplete,
    jwt_secret: { ...FIELD, set: true, editable: false },
    tavily_api_key: FIELD,
    hf_token: FIELD,
    tts_api_key: FIELD,
    artifact: { branch: null, version: "0.20.0", editable: false, description: "" },
  };
}

async function mockAutoDeployBackend(
  page: Page,
  { setupComplete = true }: { setupComplete?: boolean } = {}
): Promise<Record<string, unknown>[]> {
  await mockBackend(page);
  await page.route("**/settings-api/", (route) =>
    route.fulfill({ json: settings(setupComplete) })
  );
  await page.route("**/docker-api/get_containers/", (route) =>
    route.fulfill({ json: CATALOG })
  );
  const deploys: Record<string, unknown>[] = [];
  await page.route("**/docker-api/deploy/", (route) => {
    deploys.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 201,
      json: { status: "success", job_id: "job-1", message: "started" },
    });
  });
  return deploys;
}

test.describe("CLI auto-deploy (?auto-deploy=)", () => {
  test("shows the CLI overlay and posts the deploy without a device_id", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    const deploys = await mockAutoDeployBackend(page);
    await page.goto("/?auto-deploy=Qwen3-32B");

    await expect(page.getByText("Auto-deploying from the CLI")).toBeVisible();
    await expect(page.getByText("run Qwen3-32B")).toBeVisible();

    await expect.poll(() => deploys.length).toBe(1);
    expect(deploys[0]).toMatchObject({ model_id: "id_qwen3_32b", weights_id: "" });
    expect(deploys[0]).not.toHaveProperty("device_id");

    await expect(page).toHaveURL(/\/models-deployed$/);
    expect(errors.filter((e) => e.startsWith("Uncaught page error"))).toEqual([]);
  });

  test("forwards a pinned multi-chip device-id as a comma list", async ({ page }) => {
    const deploys = await mockAutoDeployBackend(page);
    await page.goto("/?auto-deploy=Llama-3.1-8B-Instruct&device-id=0,1");

    await expect.poll(() => deploys.length).toBe(1);
    expect(deploys[0]).toMatchObject({ model_id: "id_llama_8b", device_id: "0,1" });
  });

  test("forwards a single pinned chip as a number", async ({ page }) => {
    const deploys = await mockAutoDeployBackend(page);
    await page.goto("/?auto-deploy=Qwen3-32B&device-id=2");

    await expect.poll(() => deploys.length).toBe(1);
    expect(deploys[0]).toMatchObject({ model_id: "id_qwen3_32b", device_id: 2 });
  });

  test("an ambiguous name fails inline with a manual fallback", async ({ page }) => {
    const deploys = await mockAutoDeployBackend(page);
    // "3" is a substring of both catalog names, so it cannot resolve uniquely.
    await page.goto("/?auto-deploy=3");

    await expect(page.getByText("Auto-deploy failed")).toBeVisible();
    // The message shows in the overlay and in a toast; either is fine.
    await expect(page.getByText(/matched multiple models/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Deploy manually" })).toBeVisible();
    expect(deploys).toEqual([]);
  });

  test("a fresh install keeps the query string through the welcome redirect", async ({
    page,
  }) => {
    await mockAutoDeployBackend(page, { setupComplete: false });
    await page.goto("/?auto-deploy=Qwen3-32B&device-id=0,1");

    await expect(page).toHaveURL(/\/welcome\?auto-deploy=Qwen3-32B&device-id=0(,|%2C)1$/);
  });
});
