import { afterEach, describe, expect, it, vi } from "vitest";

describe("config loader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to local when CODETHROUGH_ENV is unset", async () => {
    vi.stubEnv("CODETHROUGH_ENV", "");
    vi.resetModules();
    const { config } = await import("../../src/index.js");

    expect(config.env).toBe("local");
    expect(config.landing.base_url).toBe("http://localhost:4321");
  });

  it("returns production values when CODETHROUGH_ENV=production", async () => {
    vi.stubEnv("CODETHROUGH_ENV", "production");
    vi.resetModules();
    const { config } = await import("../../src/index.js");

    expect(config.env).toBe("production");
    expect(config.landing.base_url).toBe("https://codethrough.dev");
  });

  it("throws a clear error when CODETHROUGH_ENV is unknown", async () => {
    vi.stubEnv("CODETHROUGH_ENV", "staging");
    vi.resetModules();

    // The env value must be one of the allowed names; loading the module checks it.
    await expect(import("../../src/index.js")).rejects.toThrow(/staging/);
  });

  it("returns a frozen config object", async () => {
    vi.stubEnv("CODETHROUGH_ENV", "local");
    vi.resetModules();
    const { config } = await import("../../src/index.js");

    expect(Object.isFrozen(config)).toBe(true);
  });

  it("rejects unknown top-level keys under allowed: strict", async () => {
    vi.stubEnv("CODETHROUGH_ENV", "local");
    vi.resetModules();
    const { configSchema } = await import("../../src/schema.js");

    // A key that is not in the schema must fail strict validation.
    configSchema.load({ rogue_key: "nope" } as never);
    expect(() => configSchema.validate({ allowed: "strict" })).toThrow();
  });
});
