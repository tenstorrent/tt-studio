// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { test, expect, type Page } from "@playwright/test";
import {
  mockBackend,
  collectPageErrors,
  suppressOnboardingTour,
} from "./helpers";

// The OCR page reads images one at a time and keeps every page that finished,
// so the behaviour worth pinning down is the queue: what runs, in what order,
// and what survives a failure partway through. The upstream endpoint is mocked,
// so none of this needs hardware or a deployed model -- the page's "remote
// endpoint" option is selected by default when nothing is deployed, which is
// exactly the path these tests drive.

// Smallest valid PNG, so the browser reports a real image/png upload.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gEBAQEAAAAASUVORK5CYII=",
  "base64",
);

function imageUpload(name: string) {
  return { name, mimeType: "image/png", buffer: PNG_1X1 };
}

async function addImages(page: Page, names: string[]) {
  await page
    .locator("#ocr-upload-handle")
    .setInputFiles(names.map(imageUpload));
}

/** Answer /models-api/ocr/ per call, so a run can succeed then fail. */
async function mockOcr(
  page: Page,
  responder: (call: number) => { status: number; body: unknown },
) {
  let call = 0;
  // Registered after mockBackend so it wins: Playwright matches routes in
  // reverse registration order.
  await page.route("**/models-api/ocr/", async (route) => {
    call += 1;
    const { status, body } = responder(call);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

function okPage(call: number) {
  return {
    status: 200,
    body: {
      pages: [
        {
          index: 0,
          filename: `page-${call}.png`,
          text: `TRANSCRIBED PAGE ${call}`,
          finish_reason: "stop",
          usage: { completion_tokens: 3 },
        },
      ],
      text: `TRANSCRIBED PAGE ${call}`,
    },
  };
}

test.describe("ocr page", () => {
  test("explains that no OCR model is deployed and will not read nothing", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await suppressOnboardingTour(page);
    await mockBackend(page);
    await page.goto("/ocr");

    await expect(page.getByText("No OCR model is deployed.")).toBeVisible();
    // Nothing dropped yet, so there is nothing to read.
    await expect(page.getByRole("button", { name: /Read text/ })).toBeDisabled();
    // The fixed instruction is stated rather than hidden.
    await expect(page.getByText("OCR:", { exact: true })).toBeVisible();

    expect(errors.filter((e) => e.startsWith("Uncaught page error"))).toEqual([]);
  });

  test("refuses a non-image and an oversized image, naming each", async ({
    page,
  }) => {
    await suppressOnboardingTour(page);
    await mockBackend(page);
    await page.goto("/ocr");

    await page.locator("#ocr-upload-handle").setInputFiles([
      { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-") },
    ]);
    await expect(page.getByText(/Not an image: scan\.pdf/)).toBeVisible();

    await page.locator("#ocr-upload-handle").setInputFiles([
      {
        name: "huge.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(26 * 1024 * 1024),
      },
    ]);
    await expect(page.getByText(/Too large, 25 MB max: huge\.png/)).toBeVisible();

    // Neither was queued, so there is still nothing to read.
    await expect(page.getByRole("button", { name: /Read text/ })).toBeDisabled();
  });

  test("reads each image in turn and offers the combined text", async ({
    page,
  }) => {
    await suppressOnboardingTour(page);
    await mockBackend(page);
    await mockOcr(page, okPage);
    await page.goto("/ocr");

    await addImages(page, ["first.png", "second.png"]);
    await expect(page.getByText("2 images ready")).toBeVisible();

    await page.getByRole("button", { name: /Read text/ }).click();

    // Upload order is preserved, and each image gets its own result.
    await expect(page.getByText("TRANSCRIBED PAGE 1")).toBeVisible();
    await expect(page.getByText("TRANSCRIBED PAGE 2")).toBeVisible();
    await expect(page.getByText("2 pages read")).toBeVisible();
    await expect(page.getByText("1. first.png")).toBeVisible();
    await expect(page.getByText("2. second.png")).toBeVisible();

    // Raw view shows the model's output verbatim, which is what Copy all takes.
    await page.getByRole("button", { name: "Raw text" }).click();
    await expect(page.getByRole("button", { name: "Rendered" })).toBeVisible();
  });

  test("stops the queue when the endpoint fails and keeps the finished pages", async ({
    page,
  }) => {
    await suppressOnboardingTour(page);
    await mockBackend(page);
    await mockOcr(page, (call) =>
      call === 1
        ? okPage(call)
        : {
            status: 502,
            body: { error: "cannot reach OCR model: refused", pages: [] },
          },
    );
    await page.goto("/ocr");

    await addImages(page, ["a.png", "b.png", "c.png"]);
    await page.getByRole("button", { name: /Read text/ }).click();

    // A 5xx is endpoint-level: the remaining images are not attempted, because
    // each one would only burn the per-image timeout again.
    await expect(
      page.getByText(/Stopped after image 2 of 3/),
    ).toBeVisible();
    await expect(page.getByText(/1 page kept/)).toBeVisible();
    // The work already done survives.
    await expect(page.getByText("TRANSCRIBED PAGE 1")).toBeVisible();
    await expect(
      page.getByText("cannot reach OCR model: refused", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1 page read")).toBeVisible();
  });

  test("reports a page the server could not decode without failing the run", async ({
    page,
  }) => {
    await suppressOnboardingTour(page);
    await mockBackend(page);
    // An undecodable upload comes back 200 with the reason inside pages[0],
    // so the status code alone would look like success.
    await mockOcr(page, (call) =>
      call === 1
        ? {
            status: 200,
            body: {
              pages: [
                {
                  index: 0,
                  filename: "broken.png",
                  error: "unreadable image: cannot identify image file",
                },
              ],
              text: "",
            },
          }
        : okPage(call),
    );
    await page.goto("/ocr");

    await addImages(page, ["broken.png", "good.png"]);
    await page.getByRole("button", { name: /Read text/ }).click();

    await expect(page.getByText(/unreadable image/)).toBeVisible();
    // A bad file says nothing about the next one, so the run continues.
    await expect(page.getByText("TRANSCRIBED PAGE 2")).toBeVisible();
    await expect(page.getByText("1 page read")).toBeVisible();
  });
  test("cancelling keeps the pages already read, and offers them after a reload", async ({
    page,
  }) => {
    await suppressOnboardingTour(page);
    await mockBackend(page);
    // Second image hangs, so there is something to cancel. Routed inline
    // rather than through mockOcr because this one has to stall.
    let call = 0;
    await page.route("**/models-api/ocr/", async (route) => {
      call += 1;
      if (call > 1) {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(okPage(call).body),
      });
    });
    await page.goto("/ocr");

    await addImages(page, ["one.png", "two.png", "three.png"]);
    await page.getByRole("button", { name: /Read text/ }).click();

    await expect(page.getByText("TRANSCRIBED PAGE 1")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText(/Cancelled\. 1 page kept/)).toBeVisible();
    await expect(page.getByText("TRANSCRIBED PAGE 1")).toBeVisible();
    await expect(page.getByText("1 page read")).toBeVisible();

    // An interrupted run is recoverable, because the images themselves cannot
    // be re-read from a reloaded page.
    await page.reload();
    await expect(
      page.getByText(/An earlier run was interrupted after 1 page/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show it" }).click();
    await expect(page.getByText("TRANSCRIBED PAGE 1")).toBeVisible();
  });
});
