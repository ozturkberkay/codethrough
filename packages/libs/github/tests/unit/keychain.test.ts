// Tests for the secret stores. The encrypted-file store uses real crypto in a
// tmp dir. The macOS, Linux, and Windows backends run against a fake command
// runner, so they work on any OS.

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandRunner, RunResult } from "../../src/command.js";
import { CODETHROUGH_SERVICE } from "../../src/secret_store.js";
import { EncryptedFileStore } from "../../src/store_encrypted_file.js";
import { MacKeychainStore } from "../../src/store_macos.js";
import { SecretToolStore } from "../../src/store_secret_tool.js";
import { WindowsCredStore } from "../../src/store_windows.js";

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (code = 1, stderr = "boom"): RunResult => ({ code, stdout: "", stderr });

const ACCOUNT = "github.com";
const SECRET = "gho_unit_secret_value";

interface RecordedCall {
  cmd: string;
  args: string[];
  stdin?: string;
}

// A fake runner that returns a result per command and records the calls.
const scriptRunner = (
  script: (cmd: string, args: string[], stdin?: string) => RunResult,
): { run: CommandRunner; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const run: CommandRunner = async (cmd, args, stdin) => {
    calls.push({ cmd, args, ...(stdin === undefined ? {} : { stdin }) });
    return script(cmd, args, stdin);
  };
  return { run, calls };
};

describe("MacKeychainStore (fake runner)", () => {
  it("set passes -U and the secret via -w and the service/account", async () => {
    const { run, calls } = scriptRunner(() => ok());
    await new MacKeychainStore(run).set(ACCOUNT, SECRET);
    const [call] = calls;
    expect(call?.cmd).toBe("security");
    expect(call?.args).toContain("add-generic-password");
    expect(call?.args).toContain("-U");
    expect(call?.args).toContain(CODETHROUGH_SERVICE);
    expect(call?.args).toContain(SECRET);
  });

  it("set throws on a non-zero exit", async () => {
    const { run } = scriptRunner(() => fail(1, "denied"));
    await expect(new MacKeychainStore(run).set(ACCOUNT, SECRET)).rejects.toThrow(/security/);
  });

  it("get strips the trailing newline", async () => {
    const { run } = scriptRunner(() => ok(`${SECRET}\n`));
    expect(await new MacKeychainStore(run).get(ACCOUNT)).toBe(SECRET);
  });

  it("get returns null when the item is absent (exit 44)", async () => {
    const { run } = scriptRunner(() => fail(44));
    expect(await new MacKeychainStore(run).get(ACCOUNT)).toBeNull();
  });

  it("delete tolerates not-found (exit 44) as a no-op", async () => {
    const { run } = scriptRunner(() => fail(44));
    await expect(new MacKeychainStore(run).delete(ACCOUNT)).resolves.toBeUndefined();
  });

  it("delete throws on other non-zero exits", async () => {
    const { run } = scriptRunner(() => fail(1, "locked"));
    await expect(new MacKeychainStore(run).delete(ACCOUNT)).rejects.toThrow(/security/);
  });
});

describe("SecretToolStore (fake runner)", () => {
  it("set feeds the secret via stdin, never argv", async () => {
    const { run, calls } = scriptRunner(() => ok());
    await new SecretToolStore(run).set(ACCOUNT, SECRET);
    const [call] = calls;
    expect(call?.cmd).toBe("secret-tool");
    expect(call?.stdin).toBe(SECRET);
    expect(call?.args).not.toContain(SECRET);
  });

  it("set throws on a non-zero exit", async () => {
    const { run } = scriptRunner(() => fail());
    await expect(new SecretToolStore(run).set(ACCOUNT, SECRET)).rejects.toThrow(/secret-tool/);
  });

  it("get returns the secret value verbatim", async () => {
    const { run } = scriptRunner(() => ok(SECRET));
    expect(await new SecretToolStore(run).get(ACCOUNT)).toBe(SECRET);
  });

  it("get returns null on a miss (exit 1)", async () => {
    const { run } = scriptRunner(() => fail());
    expect(await new SecretToolStore(run).get(ACCOUNT)).toBeNull();
  });

  it("get returns null on empty stdout even at exit 0", async () => {
    const { run } = scriptRunner(() => ok(""));
    expect(await new SecretToolStore(run).get(ACCOUNT)).toBeNull();
  });

  it("delete throws on a non-zero exit", async () => {
    const { run } = scriptRunner(() => fail());
    await expect(new SecretToolStore(run).delete(ACCOUNT)).rejects.toThrow(/secret-tool/);
  });

  it("delete resolves on success", async () => {
    const { run } = scriptRunner(() => ok());
    await expect(new SecretToolStore(run).delete(ACCOUNT)).resolves.toBeUndefined();
  });
});

describe("WindowsCredStore (fake runner)", () => {
  it("set uses cmdkey with the namespaced target", async () => {
    const { run, calls } = scriptRunner(() => ok());
    await new WindowsCredStore(run).set(ACCOUNT, SECRET);
    const [call] = calls;
    expect(call?.cmd).toBe("cmdkey");
    expect(call?.args[0]).toBe(`/generic:${CODETHROUGH_SERVICE}:${ACCOUNT}`);
  });

  it("set throws on a non-zero exit", async () => {
    const { run } = scriptRunner(() => fail());
    await expect(new WindowsCredStore(run).set(ACCOUNT, SECRET)).rejects.toThrow(/cmdkey/);
  });

  it("get reads back via the PowerShell vault shim and trims CRLF", async () => {
    const { run, calls } = scriptRunner((cmd) =>
      cmd === "powershell" ? ok(`${SECRET}\r\n`) : ok(),
    );
    expect(await new WindowsCredStore(run).get(ACCOUNT)).toBe(SECRET);
    expect(calls[0]?.cmd).toBe("powershell");
  });

  it("get returns null when the shim exits non-zero", async () => {
    const { run } = scriptRunner(() => fail());
    expect(await new WindowsCredStore(run).get(ACCOUNT)).toBeNull();
  });

  it("get returns null when the shim prints an empty value", async () => {
    const { run } = scriptRunner(() => ok("\r\n"));
    expect(await new WindowsCredStore(run).get(ACCOUNT)).toBeNull();
  });

  it("delete throws on a non-zero exit", async () => {
    const { run } = scriptRunner(() => fail());
    await expect(new WindowsCredStore(run).delete(ACCOUNT)).rejects.toThrow(/cmdkey/);
  });

  it("delete resolves on success", async () => {
    const { run } = scriptRunner(() => ok());
    await expect(new WindowsCredStore(run).delete(ACCOUNT)).resolves.toBeUndefined();
  });

  it("rejects an account with unsafe characters before spawning (injection guard)", async () => {
    // The account name goes into a PowerShell command in get(), so a value with a
    // quote or semicolon must be rejected and never run.
    const { run, calls } = scriptRunner(() => ok());
    const evil = "github.com'; whoami; #";
    const store = new WindowsCredStore(run);
    await expect(store.get(evil)).rejects.toThrow(/Unsafe credential account/);
    await expect(store.set(evil, SECRET)).rejects.toThrow(/Unsafe credential account/);
    await expect(store.delete(evil)).rejects.toThrow(/Unsafe credential account/);
    // The guard fires before any command runs.
    expect(calls).toHaveLength(0);
  });
});

describe("store construction defaults", () => {
  // Constructing with no runner uses the real spawn default but runs nothing, so
  // it is safe on any OS.
  it("each subprocess store constructs with the real runner default", () => {
    expect(new MacKeychainStore().backend).toBe("macos-security");
    expect(new SecretToolStore().backend).toBe("linux-secret-tool");
    expect(new WindowsCredStore().backend).toBe("windows-cmdkey+dpapi");
  });
});

describe("EncryptedFileStore (real crypto, tmp dir)", () => {
  const dirs: string[] = [];
  const freshDir = (): string => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dir = join(tmpdir(), `ct-keychain-unit-${suffix}`);
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("round-trips; file is 0600; ciphertext is not the plaintext", async () => {
    const store = new EncryptedFileStore(freshDir());
    await store.set(ACCOUNT, SECRET);
    expect(await store.get(ACCOUNT)).toBe(SECRET);

    const raw = readFileSync(store.path, "utf8");
    expect(raw.includes(SECRET)).toBe(false);

    const mode = statSync(store.path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns null for an unknown account and for an empty store", async () => {
    const store = new EncryptedFileStore(freshDir());
    expect(await store.get("nobody")).toBeNull();
    await store.set(ACCOUNT, SECRET);
    expect(await store.get("still-nobody")).toBeNull();
  });

  it("delete removes one account and is a no-op when absent", async () => {
    const store = new EncryptedFileStore(freshDir());
    await store.set(ACCOUNT, SECRET);
    await store.delete(ACCOUNT);
    expect(await store.get(ACCOUNT)).toBeNull();
    // Deleting again, when already gone, must not throw.
    await expect(store.delete(ACCOUNT)).resolves.toBeUndefined();
  });

  it("GCM auth tag rejects tampering", async () => {
    const store = new EncryptedFileStore(freshDir());
    await store.set("tamper", "secret-value");
    const db = JSON.parse(readFileSync(store.path, "utf8")) as Record<string, { ct: string }>;
    const ct = Buffer.from(db["tamper"]?.ct ?? "", "base64");
    ct[0] = (ct[0] ?? 0) ^ 255;
    const tampered = db["tamper"];
    if (tampered) {
      tampered.ct = ct.toString("base64");
    }
    writeFileSync(store.path, JSON.stringify(db));
    await expect(store.get("tamper")).rejects.toThrow();
  });

  it("honors CODETHROUGH_CONFIG_DIR when no dir is passed", () => {
    const dir = freshDir();
    vi.stubEnv("CODETHROUGH_CONFIG_DIR", dir);
    try {
      const store = new EncryptedFileStore();
      expect(store.path).toBe(join(dir, "secrets.enc.json"));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
