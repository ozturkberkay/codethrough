import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/dist/**",
        "tests/**",
        "node_modules/**",
        // Irreducible runtime edges: the real node:child_process spawn runner and
        // the real Octokit constructor cannot be exercised cross-OS without a
        // subprocess/network. Isolated here so the injectable logic stays fully
        // covered; both are integration-tested at the boundary (the macOS
        // security round-trip and the gh-cli reuse, guarded by platform/presence).
        "src/runtime.ts",
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
