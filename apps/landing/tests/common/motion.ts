// Motion-preference helpers shared across the e2e specs. Specs that need to
// emulate a reduced-motion preference call page.emulateMedia() directly in a
// beforeEach so the query is set before navigation; the only reusable helper
// is the computed-opacity reader below.
import type { Page } from "@playwright/test";

/**
 * Evaluates getComputedStyle(selector).opacity in the page context. Returns
 * null when the selector matches no element so the caller's assertion
 * message can describe the selector instead of failing on `Cannot read
 * property 'opacity' of null`.
 */
export const computedOpacity = (page: Page, selector: string): Promise<string | null> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) {
      return null;
    }
    return getComputedStyle(el).opacity;
  }, selector);
