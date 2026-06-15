// Pick a secret store for the current OS, without any native module.
//
// We call each OS's built-in credential command instead of a native module.
// Native modules do not survive the single-file build. When no command is
// available (headless, CI), we fall back to an owner-only encrypted file.
//
// The command runner and the OS name are passed in so the choice and each backend
// can be tested on any platform.

import { platform } from "node:os";

import type { CommandRunner } from "./command.js";
import { spawnRunner } from "./runtime.js";
import { CODETHROUGH_SERVICE, type SecretStore } from "./secret_store.js";
import { EncryptedFileStore } from "./store_encrypted_file.js";
import { MacKeychainStore } from "./store_macos.js";
import { SecretToolStore } from "./store_secret_tool.js";
import { WindowsCredStore } from "./store_windows.js";

// Check whether a command is installed. Uses the shell's lookup builtin: `where`
// on Windows, `command -v` elsewhere.
const hasCommand = async (cmd: string, run: CommandRunner, os: string): Promise<boolean> => {
  const isWindows = os === "win32";
  const shell = isWindows ? "cmd" : "sh";
  const shellArgs = isWindows ? ["/c", `where ${cmd}`] : ["-c", `command -v ${cmd}`];
  try {
    const r = await run(shell, shellArgs);
    return r.code === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
};

interface SelectOptions {
  // Force a backend, for tests or a `--keychain` flag.
  force?: "macos" | "linux" | "windows" | "file";
  fileDir?: string;
  // Override the command runner; defaults to the real spawn.
  run?: CommandRunner;
  // Override the OS name so the choice can be tested on any platform.
  platform?: () => string;
}

// Return the forced backend, or null if none was forced.
const forcedStore = (opts: SelectOptions, run: CommandRunner): SecretStore | null => {
  switch (opts.force) {
    case "file": {
      return new EncryptedFileStore(opts.fileDir);
    }
    case "macos": {
      return new MacKeychainStore(run);
    }
    case "linux": {
      return new SecretToolStore(run);
    }
    case "windows": {
      return new WindowsCredStore(run);
    }
    default: {
      return null;
    }
  }
};

const selectStore = async (opts: SelectOptions = {}): Promise<SecretStore> => {
  const run = opts.run ?? spawnRunner;
  const forced = forcedStore(opts, run);
  if (forced !== null) {
    return forced;
  }

  const os = (opts.platform ?? platform)();
  if (os === "darwin") {
    // `security` is always present on macOS.
    return new MacKeychainStore(run);
  }
  if (os === "linux" && (await hasCommand("secret-tool", run, os))) {
    return new SecretToolStore(run);
  }
  if (os === "win32" && (await hasCommand("cmdkey", run, os))) {
    return new WindowsCredStore(run);
  }
  return new EncryptedFileStore(opts.fileDir);
};

export {
  CODETHROUGH_SERVICE,
  EncryptedFileStore,
  MacKeychainStore,
  SecretToolStore,
  WindowsCredStore,
  selectStore,
};
export type { SecretStore, SelectOptions };
