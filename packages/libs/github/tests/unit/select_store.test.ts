// Tests for how selectStore picks a backend per OS, using a fake runner and a
// fake platform so every branch runs on any OS.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CommandRunner, RunResult } from "../../src/command.js";
import { type SelectOptions, selectStore } from "../../src/keychain.js";

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (): RunResult => ({ code: 1, stdout: "", stderr: "boom" });

const present: CommandRunner = async () => ok("/usr/bin/x");
const absent: CommandRunner = async () => fail();
const on =
  (os: string): (() => string) =>
  () =>
    os;

// Get the chosen backend's name.
const backendOf = async (opts: SelectOptions): Promise<string> => {
  const store = await selectStore(opts);
  return store.backend;
};

describe("selectStore forced backends", () => {
  it("force:file returns the encrypted file store", async () => {
    const dir = join(tmpdir(), `ct-select-${Date.now()}`);
    expect(await backendOf({ force: "file", fileDir: dir, run: absent })).toBe("encrypted-file");
    rmSync(dir, { recursive: true, force: true });
  });

  it("force:macos / linux / windows return the matching backend", async () => {
    expect(await backendOf({ force: "macos", run: present })).toBe("macos-security");
    expect(await backendOf({ force: "linux", run: present })).toBe("linux-secret-tool");
    expect(await backendOf({ force: "windows", run: present })).toBe("windows-cmdkey+dpapi");
  });
});

describe("selectStore per-OS detection (injected platform)", () => {
  it("on linux picks secret-tool when present, else the file fallback", async () => {
    expect(await backendOf({ run: present, platform: on("linux") })).toBe("linux-secret-tool");
    expect(await backendOf({ run: absent, platform: on("linux") })).toBe("encrypted-file");
  });

  it("on windows picks cmdkey when present, else the file fallback", async () => {
    expect(await backendOf({ run: present, platform: on("win32") })).toBe("windows-cmdkey+dpapi");
    expect(await backendOf({ run: absent, platform: on("win32") })).toBe("encrypted-file");
  });

  it("on darwin always picks the macOS keychain", async () => {
    expect(await backendOf({ run: absent, platform: on("darwin") })).toBe("macos-security");
  });

  it("on an unknown platform falls back to the encrypted file", async () => {
    expect(await backendOf({ run: absent, platform: on("freebsd") })).toBe("encrypted-file");
  });

  it("treats a probe runner that throws as a missing command", async () => {
    const thrower: CommandRunner = async () => {
      throw new Error("spawn failed");
    };
    expect(await backendOf({ run: thrower, platform: on("linux") })).toBe("encrypted-file");
  });
});
