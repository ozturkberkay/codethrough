import { defineConfig, devices } from "@playwright/test";

// The e2e harness proves the two halves integrate: the real Bun server (with
// fake ingested ReviewData + a fake engine) serves the built frontend, and a
// browser drives the full <Review> UI over the REAL HTTP+SSE transport. No
// external network or API key. The server is started by a small fixture entry
// (tests/e2e/serve_fixture.ts) that builds nothing itself; Playwright runs the
// Vite build first so dist/ exists for the server's static handler.
const PORT = 4_178;
const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build the frontend, then start the real server bound to the fixed e2e port
    // with fake data. CODETHROUGH_E2E_PORT pins the port so Playwright's URL
    // matches (the product picks a random free port; the fixture honors this).
    command: `vite build && bun run tests/e2e/serve_fixture.ts`,
    url: `http://127.0.0.1:${PORT}`,
    env: { CODETHROUGH_E2E_PORT: String(PORT) },
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
