import { type Page, expect, test } from "@playwright/test";

import { computedOpacity } from "../common/motion";

// Reduced-motion contract for the hero:
//   - Entrance fade ([data-fade-in], e.g. the lede) collapses to its final
//     state immediately via the prefers-reduced-motion block in global.css.
//   - The spotlight island (src/scripts/spotlight.ts) returns early, so the
//     [data-spotlight] layer never moves: its transform is identical across
//     frames.
// emulateMedia runs before navigation so matchMedia() sees `reduce` at startup.

const spotlightTransform = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.querySelector("[data-spotlight]");
    if (!el) {
      throw new Error("[data-spotlight] not found");
    }
    return getComputedStyle(el).transform;
  });

test.describe("prefers-reduced-motion: reduce", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the lede fade-in is fully visible immediately", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const lede = await computedOpacity(page, "p[data-fade-in]");
    expect(lede, "the lede must carry [data-fade-in]").not.toBeNull();
    expect(lede, "[data-fade-in] must be fully visible under reduced motion").toBe("1");
  });

  test("the spotlight layer does not move (transform stable across frames)", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const first = await spotlightTransform(page);
    // Long enough for several animation frames had a rAF loop been running.
    await page.waitForTimeout(200);
    const second = await spotlightTransform(page);

    expect(first, "spotlight must hold a non-empty rest transform").not.toBe("none");
    expect(second, "spotlight transform must not change under reduced motion").toBe(first);
  });
});
