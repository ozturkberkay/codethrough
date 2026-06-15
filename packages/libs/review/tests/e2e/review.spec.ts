import { expect, type Page, test } from "@playwright/test";

// Checks the full review screen over the fake data source: the summary shows,
// steps stream in and prev/next moves between them and scrolls the diff, a line
// comment shows with its text, the side area shows the off-line comments, and copy
// produces the expected Markdown.

const errorsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
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

  await page.goto("/review.html");
  // Wait for the title, then the first step, which means steps have started.
  await page.waitForSelector('[data-testid="review-title"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="step-title"]', { timeout: 30_000 });
});

const pageErrors = (page: Page): string[] => errorsByPage.get(page) ?? [];

test("renders the summary after the summary chunk arrives", async ({ page }) => {
  const panel = page.locator('[data-testid="summary-panel"]');
  await expect(panel).toContainText("The adder subtracted instead of adding.");
  await expect(panel).toContainText("Swap the operator and drop the stray log.");
  await expect(panel).toContainText("Keep the public signatures");
  // The "generating" message is gone once the summary arrives.
  await expect(page.locator('[data-testid="summary-generating"]')).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
});

test("streams steps and navigates with prev/next, scrolling the diff", async ({ page }) => {
  // The first step is active by default.
  await expect(page.locator('[data-testid="step-title"]')).toHaveText(
    "Remove the stray log in greet",
  );
  await expect(page.locator('[data-testid="nav-position"]')).toHaveText("1 / 2");
  await expect(page.locator('[data-testid="nav-prev"]')).toBeDisabled();

  // Wait for the diff to render so scrolling has somewhere to go.
  await page.waitForFunction(
    () => {
      const containers = [...document.querySelectorAll("diffs-container")];
      return containers.some((c) => (c.shadowRoot?.textContent ?? "").includes("added line here"));
    },
    null,
    { timeout: 30_000 },
  );

  const host = page.locator('[data-testid="diff-view"]');
  await expect(host).toHaveJSProperty("scrollTop", 0);

  // Next moves to the step below the fold, so the diff scrolls.
  await page.locator('[data-testid="nav-next"]').click();
  await expect(page.locator('[data-testid="step-title"]')).toHaveText("Seed the grid");
  await expect(page.locator('[data-testid="nav-position"]')).toHaveText("2 / 2");
  await expect(page.locator('[data-testid="nav-next"]')).toBeDisabled();
  await expect
    .poll(async () => host.evaluate((element) => element.scrollTop), { timeout: 5_000 })
    .toBeGreaterThan(0);

  // Prev goes back to the first step.
  await page.locator('[data-testid="nav-prev"]').click();
  await expect(page.locator('[data-testid="step-title"]')).toHaveText(
    "Remove the stray log in greet",
  );
  expect(pageErrors(page)).toEqual([]);
});

test("renders a line comment as an annotation carrying its body", async ({ page }) => {
  // The line comment on greet.ts line 3 shows on its line.
  const annotation = page.locator('.review-annotation[data-kind="comment"]').first();
  await expect(annotation).toBeVisible({ timeout: 30_000 });
  await expect(annotation).toContainText("Was this console.log meant to ship?");
  // Its reply shows under it.
  await expect(annotation.locator("[data-comment-reply]")).toContainText("No, I will remove it.");
  expect(pageErrors(page)).toEqual([]);
});

test("shows the general comments area with outdated + file-note comments", async ({ page }) => {
  const general = page.locator('[data-testid="general-comments"]');
  await expect(general).toBeVisible();
  // The outdated comment is shown, not hidden.
  await expect(general).toContainText("This used to subtract; the old code is gone now.");
  // The file note is shown.
  await expect(general).toContainText("Consider splitting this module before it grows.");
  // Both are grouped under their file.
  await expect(general.locator('[data-general-file="src/math.ts"]')).toContainText(
    "This used to subtract",
  );
  await expect(general.locator('[data-general-file="src/greet.ts"]')).toContainText(
    "Consider splitting this module",
  );
  expect(pageErrors(page)).toEqual([]);
});

test("copy-as-Markdown produces the shareable document", async ({ page }) => {
  await page.locator('[data-testid="copy-markdown"]').click();

  // The copied text is mirrored to a global and to a hidden element. Check both.
  const copied = await page.evaluate(() => globalThis.__copiedMarkdown ?? "");
  expect(copied).toContain("# Fix the adder and tidy greet");
  expect(copied).toContain("## Problem\n\nThe adder subtracted instead of adding.");
  expect(copied).toContain("## Solution\n\nSwap the operator and drop the stray log.");
  expect(copied).toContain("- Keep the public signatures");
  expect(copied).toContain("### Step 1: Remove the stray log in greet");
  expect(copied).toContain("### Step 2: Seed the grid");

  await expect(page.locator('[data-testid="markdown-output"]')).toHaveText(copied);
  expect(pageErrors(page)).toEqual([]);
});

test("drafts a comment that appears in the pending list", async ({ page }) => {
  // Fill in a path and body, add a draft, and see it listed as pending.
  await page.locator('[data-testid="composer-path"]').fill("src/greet.ts");
  await page.locator('[data-testid="composer-line"]').fill("3");
  await page.locator('[data-testid="composer-body"]').fill("Please remove this log.");
  await page.locator('[data-testid="composer-save"]').click();

  const drafts = page.locator('[data-testid="draft-list"]');
  await expect(drafts).toBeVisible();
  await expect(drafts.locator("[data-pending-draft]")).toHaveCount(1);
  await expect(drafts.locator("[data-draft-body]")).toContainText("Please remove this log.");
  await expect(drafts.locator("[data-draft-target]")).toContainText("src/greet.ts:3");
  expect(pageErrors(page)).toEqual([]);
});

test("submits a review and the UI reflects success", async ({ page }) => {
  // Draft a comment, pick an event, then submit.
  await page.locator('[data-testid="composer-path"]').fill("src/greet.ts");
  await page.locator('[data-testid="composer-body"]').fill("LGTM with a nit.");
  await page.locator('[data-testid="composer-save"]').click();
  await expect(page.locator("[data-pending-draft]")).toHaveCount(1);

  await page.locator('[data-testid="submit-event"]').selectOption("APPROVE");
  await page.locator('[data-testid="submit-button"]').click();

  // The success line shows and the drafts are cleared.
  await expect(page.locator('[data-testid="submit-success"]')).toBeVisible();
  await expect(page.locator("[data-pending-draft]")).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
});

test("a live comment pushed by the source appears without a reload", async ({ page }) => {
  // The fake source pushes a comment after the UI subscribes; it should appear in
  // the side area on its own.
  const general = page.locator('[data-testid="general-comments"]');
  await expect(general).toContainText("A live comment that arrived after load.", {
    timeout: 5_000,
  });
  expect(pageErrors(page)).toEqual([]);
});

test("surfaces the per-run cost + elapsed after the usage chunk arrives", async ({ page }) => {
  // The stream ends with usage, so the footer shows the cost, time, and tokens.
  const footer = page.locator('[data-testid="usage-footer"]');
  await expect(footer).toContainText("$0.0180", { timeout: 5_000 });
  await expect(footer).toContainText("1,200 in / 300 out");
  await expect(footer).toContainText("s");
  expect(pageErrors(page)).toEqual([]);
});

test("cleanUp tears down the diff without error", async ({ page }) => {
  await page.evaluate(() => globalThis.__dispose?.());
  await page.waitForFunction(
    () => document.querySelectorAll("diffs-container").length === 0,
    null,
    { timeout: 5_000 },
  );

  const remaining = await page.evaluate(() => document.querySelectorAll("diffs-container").length);
  expect(remaining).toBe(0);
  expect(pageErrors(page)).toEqual([]);
});
