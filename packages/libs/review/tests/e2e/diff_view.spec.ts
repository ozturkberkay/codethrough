import { expect, type Page, test } from "@playwright/test";

// Checks the diff view in a real browser: the diff renders, our comments and step
// highlights show on their lines and stay interactive, moving between steps
// scrolls the diff, a comment on an off-diff line is dropped without an error, and
// teardown runs cleanly.

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
  await page.waitForFunction(() => globalThis.__ready === true, null, { timeout: 30_000 });
  // Highlighting happens in the background, so wait until real code shows up
  // before checking anything.
  await page.waitForFunction(
    () => {
      const containers = [...document.querySelectorAll("diffs-container")];
      return containers.some((container) =>
        (container.shadowRoot?.textContent ?? "").includes("added line here"),
      );
    },
    null,
    { timeout: 30_000 },
  );
  // The step highlight appears after highlighting; wait for it.
  await page.waitForSelector('.review-annotation[data-annotation-id="step-1"]', {
    timeout: 30_000,
  });
});

const pageErrors = (page: Page): string[] => errorsByPage.get(page) ?? [];

test("renders the diff in per-file shadow roots", async ({ page }) => {
  const probe = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="diff-view"]')!;
    const containers = [...host.querySelectorAll("diffs-container")] as HTMLElement[];
    const shadowHosts = containers.filter((container) => container.shadowRoot).length;
    let shadowText = "";
    for (const container of containers) {
      shadowText += container.shadowRoot?.textContent ?? "";
    }
    return {
      containerCount: containers.length,
      shadowHosts,
      hasAddedLine: shadowText.includes("added line here"),
      hasMath: shadowText.includes("a + b"),
    };
  });

  expect(probe.containerCount).toBeGreaterThan(0);
  expect(probe.shadowHosts).toBe(probe.containerCount);
  expect(probe.hasAddedLine).toBe(true);
  expect(probe.hasMath).toBe(true);
  expect(pageErrors(page)).toEqual([]);
});

test("renders a step annotation as a light-DOM node with stable data-*", async ({ page }) => {
  const step = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(
      '.review-annotation[data-annotation-id="step-1"]',
    );
    if (!node) {
      return null;
    }
    return {
      side: node.dataset["side"],
      line: node.dataset["line"],
      kind: node.dataset["kind"],
      hasSolidChild: node.querySelector('[data-solid="1"]') !== null,
    };
  });

  expect(step).not.toBeNull();
  expect(step!.side).toBe("additions");
  expect(step!.line).toBe("3");
  expect(step!.kind).toBe("step");
  expect(step!.hasSolidChild).toBe(true);
});

test("the Solid node inside an annotation is interactive", async ({ page }) => {
  const button = page.locator('.review-annotation[data-annotation-id="step-1"] [data-solid="1"]');

  await expect(button.locator("[data-count]")).toHaveText(" (0)");
  await button.click();
  await expect(button.locator("[data-count]")).toHaveText(" (1)");
  await button.click();
  await expect(button.locator("[data-count]")).toHaveText(" (2)");
});

test("scrollTo drives the active step without error", async ({ page }) => {
  const host = page.locator('[data-testid="diff-view"]');
  await expect(host).toHaveJSProperty("scrollTop", 0);

  // Activate a comment below the fold, so the diff has to scroll.
  await page.evaluate(() => globalThis.__setActiveStep?.("comment-1"));
  await expect
    .poll(async () => host.evaluate((element) => element.scrollTop), { timeout: 5_000 })
    .toBeGreaterThan(0);

  expect(pageErrors(page)).toEqual([]);
});

test("an out-of-range annotation is silently dropped, not thrown", async ({ page }) => {
  // The comment points at a line the diff does not show. Its element gets built
  // but has no line to attach to, so it stays hidden and the page does not error.
  // This is why we move such comments to the side list instead of leaving them
  // here.
  const probe = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(
      '.review-annotation[data-annotation-id="comment-2-out-of-range"]',
    );
    const wrapper = node?.parentElement;
    const assignedSlot = (wrapper as unknown as { assignedSlot?: unknown } | undefined)
      ?.assignedSlot;
    const rect = node?.getBoundingClientRect();
    return {
      unplaceableIds: globalThis.__unplaceableIds ?? [],
      assignedToRealSlot: Boolean(assignedSlot),
      visible: rect ? rect.width > 0 && rect.height > 0 : false,
    };
  });

  expect(probe.unplaceableIds).toContain("comment-2-out-of-range");
  expect(probe.assignedToRealSlot).toBe(false);
  expect(probe.visible).toBe(false);
  expect(pageErrors(page)).toEqual([]);
});

test("cleanUp tears down without error", async ({ page }) => {
  await page.evaluate(() => globalThis.__dispose?.());
  // Give cleanup a moment to run.
  await page.waitForFunction(
    () => document.querySelectorAll("diffs-container").length === 0,
    null,
    {
      timeout: 5_000,
    },
  );

  const remaining = await page.evaluate(() => document.querySelectorAll("diffs-container").length);
  expect(remaining).toBe(0);
  expect(pageErrors(page)).toEqual([]);
});
