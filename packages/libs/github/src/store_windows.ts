// Windows Credential Manager backend.
//
// cmdkey can store and delete a credential but cannot read the value back
// (Windows hides it), so reading uses a small PowerShell vault script instead.

import type { CommandRunner } from "./command.js";
import { spawnRunner } from "./runtime.js";
import { CODETHROUGH_SERVICE, type SecretStore } from "./secret_store.js";

// The account name is dropped into a PowerShell command in get(), so a crafted
// value could run other commands. The only caller passes "github.com", but this
// allowlist guards against a future caller that forgets.
const SAFE_ACCOUNT = /^[A-Za-z0-9._-]+$/;

const assertSafeAccount = (account: string): void => {
  if (!SAFE_ACCOUNT.test(account)) {
    throw new Error(
      `Unsafe credential account ${JSON.stringify(account)}: only [A-Za-z0-9._-] is allowed.`,
    );
  }
};

class WindowsCredStore implements SecretStore {
  readonly backend = "windows-cmdkey+dpapi";
  private readonly run: CommandRunner;

  constructor(run: CommandRunner = spawnRunner) {
    this.run = run;
  }

  private target(account: string): string {
    return `${CODETHROUGH_SERVICE}:${account}`;
  }

  async set(account: string, secret: string): Promise<void> {
    assertSafeAccount(account);
    // The secret goes in argv via /pass; cmdkey has no stdin mode here.
    const r = await this.run("cmdkey", [
      `/generic:${this.target(account)}`,
      `/user:${account}`,
      `/pass:${secret}`,
    ]);
    if (r.code !== 0) {
      throw new Error(`cmdkey add failed: ${r.stderr.trim()}`);
    }
  }

  async get(account: string): Promise<string | null> {
    // Guard: the account name is put into the PowerShell command below.
    assertSafeAccount(account);
    // The script prints the stored password, or an empty string if there is none.
    const ps = [
      "-NoProfile",
      "-Command",
      `$ErrorActionPreference='Stop';` +
        `try {` +
        `  Add-Type -AssemblyName System.Runtime.WindowsRuntime;` +
        `  $vault = New-Object Windows.Security.Credentials.PasswordVault;` +
        `  ($vault.Retrieve('${CODETHROUGH_SERVICE}','${account}')).Password` +
        `} catch { '' }`,
    ];
    const r = await this.run("powershell", ps);
    if (r.code !== 0) {
      return null;
    }
    const out = r.stdout.replace(/\r?\n$/, "");
    return out.length > 0 ? out : null;
  }

  async delete(account: string): Promise<void> {
    assertSafeAccount(account);
    const r = await this.run("cmdkey", [`/delete:${this.target(account)}`]);
    if (r.code !== 0) {
      throw new Error(`cmdkey delete failed: ${r.stderr.trim()}`);
    }
  }
}

export { WindowsCredStore };
