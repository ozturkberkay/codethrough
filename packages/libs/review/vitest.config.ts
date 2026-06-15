import { defineConfig } from "vitest/config";

// Unit tests cover only the pure functional core: annotations.ts, markdown.ts,
// walkthrough_stream.ts, comment_groups.ts, and step_nav.ts (all matched by the
// `src/**/*.ts` include below). The Solid components (*.tsx) and the dev harness
// instantiate Pierre, which needs a real browser, so they are proven by
// Playwright e2e, not unit coverage. This mirrors landing scoping coverage to its
// imperative shell out of unit numbers.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Only the pure .ts modules. The .tsx component and the dev harness are
      // covered by e2e, never by unit coverage.
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.tsx",
        "src/dev/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/dist/**",
        "tests/**",
        "node_modules/**",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
        autoUpdate: false,
      },
    },
  },
});
