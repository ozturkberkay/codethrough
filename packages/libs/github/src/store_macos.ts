// Keychain backend for macOS, using the `security` command.

import type { CommandRunner } from "./command.js";
import { spawnRunner } from "./runtime.js";
import { CODETHROUGH_SERVICE, type SecretStore } from "./secret_store.js";

// The `security` exit code for "not found"; treated as absent or a no-op delete.
const ITEM_NOT_FOUND_EXIT = 44;

class MacKeychainStore implements SecretStore {
  readonly backend = "macos-security";
  private readonly run: CommandRunner;

  constructor(run: CommandRunner = spawnRunner) {
    this.run = run;
  }

  async set(account: string, secret: string): Promise<void> {
    // The secret goes in argv here, because `security` has no stdin mode for
    // this. That briefly exposes it to `ps`, but the keychain itself is safe at
    // rest.
    const r = await this.run("security", [
      "add-generic-password",
      "-U",
      "-s",
      CODETHROUGH_SERVICE,
      "-a",
      account,
      "-w",
      secret,
    ]);
    if (r.code !== 0) {
      throw new Error(`security add-generic-password failed: ${r.stderr.trim()}`);
    }
  }

  async get(account: string): Promise<string | null> {
    // A non-zero exit (44 is "not found") means there is no value.
    const r = await this.run("security", [
      "find-generic-password",
      "-s",
      CODETHROUGH_SERVICE,
      "-a",
      account,
      "-w",
    ]);
    if (r.code !== 0) {
      return null;
    }
    return r.stdout.replace(/\n$/, "");
  }

  async delete(account: string): Promise<void> {
    // Already gone (exit 44) is fine; delete should be repeatable.
    const r = await this.run("security", [
      "delete-generic-password",
      "-s",
      CODETHROUGH_SERVICE,
      "-a",
      account,
    ]);
    if (r.code !== 0 && r.code !== ITEM_NOT_FOUND_EXIT) {
      throw new Error(`security delete-generic-password failed: ${r.stderr.trim()}`);
    }
  }
}

export { MacKeychainStore };
