import { defineConfig, devices } from "@playwright/test";
import { config } from "@codethrough/config";

const baseURL = config.landing.base_url;
const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/tests/e2e/**/*.spec.ts", "**/tests/integration/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: true,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : "100%",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/tests/e2e/mobile.spec.ts"],
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: ["**/tests/e2e/mobile.spec.ts"],
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: ["**/tests/e2e/mobile.spec.ts"],
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 14"] },
      testMatch: ["**/tests/e2e/mobile.spec.ts"],
    },
  ],
  // Self-contained stack: bring up the landing container via the root compose
  // file so `playwright test` works standalone (one `turbo run test:e2e`
  // entrypoint per app). Foreground `up` so Playwright tears the container down
  // on exit (SIGTERM stops it). `reuseExistingServer` locally lets a dev who
  // already ran `docker compose --profile landing up` skip the build.
  //
  // Tradeoff: e2e BUILDS the landing image locally (`--build`) rather than
  // pulling the pre-built `pr-<n>` GHCR image. This decouples e2e from the
  // docker_build pipeline (which stays for deploy) at the cost of a local
  // build; the deliberate trade for one self-contained entrypoint.
  webServer: {
    command: "docker compose -f ../../docker-compose.yml --profile landing up --build",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 300_000,
  },
});
