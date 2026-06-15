// Encrypt and decrypt for the file-based secret store. In its own file so the
// crypto can be tested alone.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { homedir, platform } from "node:os";

const KEY_LENGTH_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

interface SealedRecord {
  iv: string;
  salt: string;
  tag: string;
  ct: string;
}

// Build the key from values that are stable on this machine, so the file cannot
// be decrypted as-is on another machine or by another user.
const deriveKey = (salt: Buffer): Buffer => {
  const material = `${process.env["CODETHROUGH_FILE_KEY"] ?? ""}:${homedir()}:${platform()}`;
  return scryptSync(material, salt, KEY_LENGTH_BYTES);
};

// Encrypt text into a record holding everything needed to decrypt it later.
const seal = (plaintext: string): SealedRecord => {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
};

// Decrypt a record. Throws if the data was changed (the auth tag check fails).
const open = (rec: SealedRecord): string => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(Buffer.from(rec.salt, "base64")),
    Buffer.from(rec.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(rec.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(rec.ct, "base64")), decipher.final()]);
  return pt.toString("utf8");
};

export { open, seal };
export type { SealedRecord };
