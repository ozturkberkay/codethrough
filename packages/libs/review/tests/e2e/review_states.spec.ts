import { expect, type Page, test } from "@playwright/test";

// Checks the two unhappy states, picked from the harness with a `?variant=`:
//   - error: the walkthrough fails, so the error banner shows and the no-step note
//     does not. A failure should not look like an empty success.
//   - path: comments are disabled, so the write UI shows its fallback instead of a
//     composer that would fail on submit.

const errorsByPage = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
});

const pageErrors = (page: Page): string[] => errorsByPage.get(page) ?? [];

test("renders a distinct error banner when the walkthrough fails (max_tokens)", async ({
  page,
}) => {
  await page.goto("/review.html?variant=error");
  await page.waitForSelector('[data-testid="review-title"]', { timeout: 30_000 });

  // The banner shows a title for this failure and the raw message.
  const banner = page.locator('[data-testid="walkthrough-error"]');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="walkthrough-error-title"]')).toContainText(/cut off/i);
  await expect(banner).toContainText("max_tokens");

  // The no-step note must not show; a failure is a different state.
  await expect(page.locator('[data-testid="thin-result"]')).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
});

test("shows the write 'unavailable' fallback in local-path mode (comments disabled)", async ({
  page,
}) => {
  await page.goto("/review.html?variant=path");
  await page.waitForSelector('[data-testid="review-title"]', { timeout: 30_000 });
  // The walkthrough still streams here, so steps appear.
  await page.waitForSelector('[data-testid="step-title"]', { timeout: 30_000 });

  // With comments disabled, the submit area shows the note, not the form.
  await expect(page.locator('[data-testid="write-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-testid="submit-button"]')).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
});
