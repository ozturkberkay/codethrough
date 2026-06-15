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
        // Irreducible runtime edges: constructing the real Anthropic client needs a
        // network/API key, and the real node:child_process spawn / fs / keychain
        // round-trips cannot run cross-OS in a unit test. Isolated here so the
        // injectable logic stays fully covered; the resolver + provider are tested
        // with injected env/fs/keychain and a fake Anthropic client.
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
