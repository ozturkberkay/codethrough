// The shared interface and constant for the OS secret stores. Each backend is in
// its own file; selectStore in keychain.ts chooses one at runtime.

const CODETHROUGH_SERVICE = "codethrough";

interface SecretStore {
  readonly backend: string;
  set(account: string, secret: string): Promise<void>;
  get(account: string): Promise<string | null>;
  delete(account: string): Promise<void>;
}

export { CODETHROUGH_SERVICE };
export type { SecretStore };
