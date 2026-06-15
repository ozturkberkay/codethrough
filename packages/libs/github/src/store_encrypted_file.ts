// An owner-only encrypted file, used when no OS credential command is available
// (headless Linux, CI, containers).
//
// Weaker than an OS keychain, since the key lives on the same disk, but it is the
// last resort and beats a plaintext token. The crypto is in crypto_box.ts; this
// file owns the on-disk store.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { open, type SealedRecord, seal } from "./crypto_box.js";
import type { SecretStore } from "./secret_store.js";

// Owner-only file permissions.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

class EncryptedFileStore implements SecretStore {
  readonly backend = "encrypted-file";
  private readonly dir: string;
  private readonly file: string;

  constructor(dir?: string) {
    this.dir =
      dir ?? process.env["CODETHROUGH_CONFIG_DIR"] ?? join(homedir(), ".config", "codethrough");
    this.file = join(this.dir, "secrets.enc.json");
  }

  private async load(): Promise<Record<string, SealedRecord>> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Record<string, SealedRecord>;
    } catch {
      // No file yet means an empty store.
      return {};
    }
  }

  private async save(db: Record<string, SealedRecord>): Promise<void> {
    // A recursive mkdir does nothing if the dir is already there.
    await mkdir(this.dir, { recursive: true, mode: DIR_MODE });
    await writeFile(this.file, JSON.stringify(db, null, 2), { mode: FILE_MODE });
    // Force owner-only even if the umask made it wider.
    await chmod(this.file, FILE_MODE);
  }

  async set(account: string, secret: string): Promise<void> {
    const db = await this.load();
    db[account] = seal(secret);
    await this.save(db);
  }

  async get(account: string): Promise<string | null> {
    const db = await this.load();
    const rec = db[account];
    // A changed record makes open throw, and that error propagates.
    return rec ? open(rec) : null;
  }

  async delete(account: string): Promise<void> {
    const db = await this.load();
    if (db[account]) {
      delete db[account];
      await this.save(db);
    }
  }

  // Where the file lives, so tests can clean up.
  get path(): string {
    return this.file;
  }
}

export { EncryptedFileStore };
