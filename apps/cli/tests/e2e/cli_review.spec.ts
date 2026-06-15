import { expect, type Page, test } from "@playwright/test";

// Proves the two halves of the CLI fit together: the real server serves the built
// frontend and the API (with fake data), and the browser loads the full <Review>
// UI. The summary and steps stream in, and the diff renders. This exercises the
// real transport end to end with no GitHub or Anthropic call.

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

  await page.goto("/");
  // The review loads, then the walkthrough streams in. Wait for the title, then
  // for the first step.
  await page.waitForSelector('[data-testid="review-title"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="step-title"]', { timeout: 30_000 });
});

const pageErrors = (page: Page): string[] => errorsByPage.get(page) ?? [];

test("injects the bearer token into the page, never the URL", async ({ page }) => {
  // The token lives in the page, not the URL, so the URL stays clean.
  expect(page.url()).not.toContain("token");
  const hasToken = await page.evaluate(() => typeof globalThis.__CODETHROUGH__?.token === "string");
  expect(hasToken).toBe(true);
  expect(pageErrors(page)).toEqual([]);
});

test("renders the summary after the summary chunk streams in over SSE", async ({ page }) => {
  const panel = page.locator('[data-testid="summary-panel"]');
  await expect(panel).toContainText("The adder subtracted instead of adding.");
  await expect(panel).toContainText("Swap the operator and drop the stray log.");
  await expect(panel).toContainText("Keep the public signatures");
  expect(pageErrors(page)).toEqual([]);
});

test("streams the walkthrough steps and navigates them", async ({ page }) => {
  await expect(page.locator('[data-testid="step-title"]')).toHaveText(
    "Remove the stray log in greet",
  );
  await expect(page.locator('[data-testid="nav-position"]')).toHaveText("1 / 2");

  await page.locator('[data-testid="nav-next"]').click();
  await expect(page.locator('[data-testid="step-title"]')).toHaveText("Fix the adder");
  await expect(page.locator('[data-testid="nav-position"]')).toHaveText("2 / 2");
  expect(pageErrors(page)).toEqual([]);
});

test("renders the Pierre diff into its shadow DOM over the served data", async ({ page }) => {
  // The diff highlights in the background, so wait until a known added line has
  // rendered.
  await page.waitForFunction(
    () => {
      const containers = [...document.querySelectorAll("diffs-container")];
      return containers.some((container) =>
        (container.shadowRoot?.textContent ?? "").includes("debug greet line"),
      );
    },
    null,
    { timeout: 30_000 },
  );

  const probe = await page.evaluate(() => {
    const containers = [...document.querySelectorAll("diffs-container")] as HTMLElement[];
    let shadowText = "";
    for (const container of containers) {
      shadowText += container.shadowRoot?.textContent ?? "";
    }
    return {
      containerCount: containers.length,
      shadowHosts: containers.filter((container) => container.shadowRoot).length,
      hasGreet: shadowText.includes("debug greet line"),
      hasMath: shadowText.includes("a + b"),
    };
  });
  expect(probe.containerCount).toBeGreaterThan(0);
  expect(probe.shadowHosts).toBe(probe.containerCount);
  expect(probe.hasGreet).toBe(true);
  expect(probe.hasMath).toBe(true);
  expect(pageErrors(page)).toEqual([]);
});

test("renders a line comment annotation and the general comments area", async ({ page }) => {
  const annotation = page.locator('.review-annotation[data-kind="comment"]').first();
  await expect(annotation).toBeVisible({ timeout: 30_000 });
  await expect(annotation).toContainText("Was this debug log meant to ship?");

  const general = page.locator('[data-testid="general-comments"]');
  await expect(general).toBeVisible();
  await expect(general).toContainText("A general note that has no current line.");
  expect(pageErrors(page)).toEqual([]);
});

test("drafts and submits a review over the real HTTP transport", async ({ page }) => {
  // Draft a comment via the composer; it POSTs to /api/comments/draft and the
  // server echoes it into the pending list.
  await page.locator('[data-testid="composer-path"]').fill("src/greet.ts");
  await page.locator('[data-testid="composer-body"]').fill("Drop the debug log.");
  await page.locator('[data-testid="composer-save"]').click();
  await expect(page.locator("[data-pending-draft]")).toHaveCount(1);

  // Submit posts to /api/review/submit; the injected GitHub submit returns a url,
  // the server clears the drafts, and the UI reflects success.
  await page.locator('[data-testid="submit-button"]').click();
  await expect(page.locator('[data-testid="submit-success"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-pending-draft]")).toHaveCount(0);
  expect(pageErrors(page)).toEqual([]);
});

test("merges a live comment delta pushed over SSE", async ({ page }) => {
  // The server's poller re-fetches comments and pushes an `added` delta over
  // /api/comments/stream; the new general comment appears without a reload.
  const general = page.locator('[data-testid="general-comments"]');
  await expect(general).toContainText("A live comment that arrived after load.", {
    timeout: 10_000,
  });
  expect(pageErrors(page)).toEqual([]);
});

test("shows the per-run cost + elapsed footer after the usage chunk streams", async ({ page }) => {
  // The fixture stream ends with a usage chunk (1,200 in / 300 out, $0.018); the
  // footer surfaces the priced cost + the token split (and an elapsed time).
  const footer = page.locator('[data-testid="usage-footer"]');
  await expect(footer).toContainText("$0.0180", { timeout: 10_000 });
  await expect(footer).toContainText("1,200 in / 300 out");
  await expect(footer).toContainText("s");
  expect(pageErrors(page)).toEqual([]);
});
