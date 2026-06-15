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
        // Irreducible runtime edges: constructing the real Anthropic client needs
        // a network/API key, and Bun.which returns a path even with PATH cleared,
        // so the ripgrep branch cannot be flipped in a test. The grep git-grep
        // fallback these gate is integration-tested directly in tests/integration.
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
