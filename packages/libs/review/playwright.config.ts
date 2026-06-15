import { defineConfig, devices } from "@playwright/test";

// The e2e harness proves @pierre/diffs renders from a Solid host. It builds the
// harness and serves it via `vite preview` so the production worker/optimizeDeps
// path (the one that breaks without `worker.format: "es"`) is exercised.
const PORT = 4_173;
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
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite build && vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
