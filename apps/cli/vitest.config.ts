import { defineConfig } from "vitest/config";

// Unit + integration tests for the CLI. Coverage is scoped to the pure/testable
// modules: the arg parsers, the config-precedence resolver, the server security
// guards, the SSE serializer (server) and parser (frontend), the html token
// injection, the request router, and the server-side review source. The
// irreducible shell (the Bun.serve socket bind, the browser spawn, the process
// signal handlers, the real engine/ingest/auth wiring) is isolated into runtime
// modules excluded below and exercised by integration + e2e instead. This mirrors
// landing/engine/github scoping coverage to the functional core.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "frontend/**/*.ts"],
      exclude: [
        // Solid component / entry shells, proven by e2e, never unit coverage.
        "frontend/**/*.tsx",
        "frontend/main.tsx",
        // Irreducible imperative edges: the Bun.serve bind, the browser spawn,
        // the process signal handlers, and the real engine/ingest/auth/store
        // wiring all need a socket, a browser, or a network/keychain. They are
        // integration- and e2e-tested at the boundary. Mirrors engine/github
        // runtime.ts and landing's shell scoping.
        "src/runtime.ts",
        "src/main.ts",
        "src/server/serve.ts",
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
