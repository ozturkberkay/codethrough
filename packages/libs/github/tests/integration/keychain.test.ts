// A real round-trip through the macOS `security` keychain via the real spawn.
// Runs only on macOS, so Linux CI skips it. The unit tests cover the logic; this
// proves the real subprocess path works.

import { describe, expect, it } from "vitest";

import { MacKeychainStore, selectStore } from "../../src/keychain.js";

const isDarwin = process.platform === "darwin";
const account = `codethrough-it-${Date.now()}`;
const secret = `gho_it_${Math.random().toString(36).slice(2)}`;

describe.skipIf(!isDarwin)("macOS security keychain (REAL spawn)", () => {
  it("set + get + update + delete a real secret via /usr/bin/security", async () => {
    const store = new MacKeychainStore();
    await store.delete(account).catch(() => {});
    expect(await store.get(account)).toBeNull();

    await store.set(account, secret);
    expect(await store.get(account)).toBe(secret);

    // Set again to overwrite the existing value.
    const updated = `${secret}_v2`;
    await store.set(account, updated);
    expect(await store.get(account)).toBe(updated);

    await store.delete(account);
    expect(await store.get(account)).toBeNull();
  });

  it("delete is idempotent when the item is absent", async () => {
    const store = new MacKeychainStore();
    await expect(store.delete(`absent-${Date.now()}`)).resolves.toBeUndefined();
  });

  it("selectStore picks macos-security on darwin (real platform)", async () => {
    const store = await selectStore();
    expect(store.backend).toBe("macos-security");
  });
});
