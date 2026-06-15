import { expect, test } from "@playwright/test";

import { computedOpacity } from "../common/motion";

// Fade-in observer source: apps/landing/src/layouts/base.astro (a bundled
// script that adds .is-visible when a [data-fade-in] element intersects). The
// transition CSS lives in apps/landing/src/styles/global.css.
//
// The hero's fade-in elements (lockup, lede, CTA) are all above the fold, so
// the observer fires for them on load with no scroll. We assert that at least
// one [data-fade-in] exists and that it resolves to opacity 1 shortly after
// load under default (animated) motion.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
});

test("at least one [data-fade-in] element exists on /", async ({ page }) => {
  await page.goto("/");
  const count = await page.locator("[data-fade-in]").count();
  expect(count, "page must carry at least one [data-fade-in] element").toBeGreaterThan(0);
});

test("an above-the-fold [data-fade-in] reaches opacity 1 after load", async ({ page }) => {
  await page.goto("/");

  const selector = "[data-fade-in]";
  await expect(page.locator(selector).first()).toBeAttached();

  // The transition is ~700ms; 10s gives slower engines headroom without
  // masking a real regression (a never-observed element would stay below 1).
  await expect
    .poll(async () => Number(await computedOpacity(page, selector)), {
      timeout: 10_000,
      message: "[data-fade-in] must resolve to opacity 1 after load",
    })
    .toBe(1);
});
