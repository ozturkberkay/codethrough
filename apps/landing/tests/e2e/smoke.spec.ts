import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("landing page renders the hero and the get-started CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Codethrough/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Stop drowning");
  await expect(page.getByRole("link", { name: /get started/i })).toBeVisible();
});

test("landing page has zero axe violations", async ({ page }) => {
  // Reduced motion settles the entrance fade-ins so axe scores final colors,
  // not a mid-transition frame. Same guard as mobile.spec.ts.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
