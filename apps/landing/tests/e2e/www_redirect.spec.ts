import { expect, test } from "@playwright/test";
import { config } from "@codethrough/config";

// Locally the static stack serves the apex directly, so we assert it returns
// the page. The www -> apex 301 only exists in production (CloudFront), so that
// assertion runs only under production config.
if (config.env === "local") {
  test("local origin serves / with a 200", async ({ request }) => {
    const target = config.landing.base_url.replace(/\/$/, "");
    const response = await request.get(`${target}/`);
    expect(response.status()).toBe(200);
  });
} else {
  test("www.codethrough.dev/ returns 301 to apex", async ({ request }) => {
    const target = config.landing.base_url.replace(/\/$/, "");
    const response = await request.get(`${target}/`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers()["location"]).toMatch(/^https:\/\/codethrough\.dev\/?$/);
  });
}
