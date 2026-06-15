// Linux secret store, using the `secret-tool` command.

import type { CommandRunner } from "./command.js";
import { spawnRunner } from "./runtime.js";
import { CODETHROUGH_SERVICE, type SecretStore } from "./secret_store.js";

class SecretToolStore implements SecretStore {
  readonly backend = "linux-secret-tool";
  private readonly run: CommandRunner;

  constructor(run: CommandRunner = spawnRunner) {
    this.run = run;
  }

  async set(account: string, secret: string): Promise<void> {
    // The secret goes in on stdin so it never lands in argv. The service and
    // account name the item for later lookup.
    const r = await this.run(
      "secret-tool",
      [
        "store",
        "--label",
        `${CODETHROUGH_SERVICE}:${account}`,
        "service",
        CODETHROUGH_SERVICE,
        "account",
        account,
      ],
      secret,
    );
    if (r.code !== 0) {
      throw new Error(`secret-tool store failed: ${r.stderr.trim()}`);
    }
  }

  async get(account: string): Promise<string | null> {
    // A non-zero exit means no match. The value comes back with no trailing newline.
    const r = await this.run("secret-tool", [
      "lookup",
      "service",
      CODETHROUGH_SERVICE,
      "account",
      account,
    ]);
    if (r.code !== 0) {
      return null;
    }
    return r.stdout.length > 0 ? r.stdout : null;
  }

  async delete(account: string): Promise<void> {
    const r = await this.run("secret-tool", [
      "clear",
      "service",
      CODETHROUGH_SERVICE,
      "account",
      account,
    ]);
    if (r.code !== 0) {
      throw new Error(`secret-tool clear failed: ${r.stderr.trim()}`);
    }
  }
}

export { SecretToolStore };
