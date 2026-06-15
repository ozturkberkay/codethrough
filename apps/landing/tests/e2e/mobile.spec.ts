import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// This spec runs only under the `webkit-mobile` project in
// playwright.config.ts, which wraps WebKit with Playwright's `iPhone 14`
// descriptor (mobile viewport, touch, coarse pointer). The assertions mirror
// the desktop smoke + a11y checks at a small viewport and add the
// mobile-specific invariant that the page never scrolls horizontally.

test("hero and CTA are visible on a mobile viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Codethrough/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Stop drowning");
  // The CTA is a top-level `<a>` to the repo, so it surfaces with role=link.
  await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
});

test("no horizontal scrollbar: scrollWidth equals clientWidth on <html>", async ({ page }) => {
  await page.goto("/");
  // Evaluate in the browser so we read the live layout values. A 1px
  // difference is tolerated because subpixel rounding on some engines emits
  // an off-by-one even on well-behaved layouts.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `html.scrollWidth (${overflow.scrollWidth}) must equal html.clientWidth (${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("axe scan has zero violations on mobile", async ({ page }) => {
  // Settle the entrance fade-ins before scanning: reduced motion paints
  // [data-fade-in] at full opacity (see global.css), so axe scores the final
  // colors, not a mid-transition frame that reads as faint text on dark.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
