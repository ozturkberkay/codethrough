// Logs in to GitHub with the OAuth-App device flow.
//
// There is no callback server: the CLI prints a code and a URL, the user enters
// the code on github.com, and the CLI polls until they approve.
//
// The fetch and the clock are passed in, so polling can be tested against a mock
// with no real network or waiting. The live login needs a real app and a human,
// so the client id is a constructor argument.
//
// This is an OAuth App, not a GitHub App: the device-code request carries a
// `scope`, and the user token it returns does not expire, so there is no refresh
// flow to run.

import { DeviceFlowError } from "./device_flow_error.js";
import { resolveSleep } from "./runtime.js";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

// The scope we request. `repo` covers reading private and public PRs and posting
// review comments. It is broad because OAuth Apps lack fine-grained scopes; that
// is the accepted trade for dropping the GitHub App's per-org install friction.
const DEFAULT_GITHUB_SCOPE = "repo";

// Conversion factor, the extra wait GitHub asks for on slow_down, and a cap on
// how many times we poll.
const MS_PER_SECOND = 1_000;
const SLOW_DOWN_BUMP_SECONDS = 5;
const DEFAULT_MAX_POLLS = 200;

const FORM_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
} as const;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface PendingResponse {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | "incorrect_client_credentials"
    | "unsupported_grant_type"
    | string;
  error_description?: string;
  interval?: number;
}

interface DeviceFlowOptions {
  clientId: string;
  // The OAuth scope to request; defaults to `repo`.
  scope?: string;
  // Override the URLs in tests; default to the real GitHub ones.
  deviceCodeUrl?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
  // Override the clock so tests do not really sleep.
  sleep?: (ms: number) => Promise<void>;
  // Called with the user code so the CLI can show it.
  onUserCode?: (r: DeviceCodeResponse) => void;
  // Stop after this many polls, no matter what.
  maxPolls?: number;
}

// The one call auth needs from this client. A test fake only has to provide this.
interface DeviceFlowAuthenticator {
  authenticate(): Promise<TokenResponse>;
}

// The result of one poll: the token, or "keep waiting" with the next wait. A
// fatal error throws instead.
type PollStep = { kind: "token"; token: TokenResponse } | { kind: "pending"; nextInterval: number };

const isTokenResponse = (body: TokenResponse | PendingResponse): body is TokenResponse =>
  "access_token" in body && Boolean(body.access_token);

class DeviceFlowClient implements DeviceFlowAuthenticator {
  private readonly clientId: string;
  private readonly scope: string;
  private readonly deviceCodeUrl: string;
  private readonly tokenUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onUserCode: ((r: DeviceCodeResponse) => void) | undefined;
  private readonly maxPolls: number;

  constructor(opts: DeviceFlowOptions) {
    this.clientId = opts.clientId;
    this.scope = opts.scope ?? DEFAULT_GITHUB_SCOPE;
    this.deviceCodeUrl = opts.deviceCodeUrl ?? GITHUB_DEVICE_CODE_URL;
    this.tokenUrl = opts.tokenUrl ?? GITHUB_TOKEN_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = resolveSleep(opts.sleep);
    this.onUserCode = opts.onUserCode;
    this.maxPolls = opts.maxPolls ?? DEFAULT_MAX_POLLS;
  }

  // Step 1: ask GitHub for a device code and a user code. OAuth Apps grant scopes
  // at this step, so the scope is sent here.
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const res = await this.fetchImpl(this.deviceCodeUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ client_id: this.clientId, scope: this.scope }).toString(),
    });
    if (!res.ok) {
      throw new DeviceFlowError(
        `device code request failed: HTTP ${res.status}`,
        "device_code_http_error",
      );
    }
    return (await res.json()) as DeviceCodeResponse;
  }

  // Poll once for the token. Returns the token or "keep waiting", and throws on a
  // fatal error. Does not sleep, so the caller controls timing.
  private async pollOnce(device: DeviceCodeResponse, interval: number): Promise<PollStep> {
    const res = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        client_id: this.clientId,
        device_code: device.device_code,
        grant_type: DEVICE_GRANT_TYPE,
      }).toString(),
    });
    // While the login is pending, GitHub still replies with HTTP 200 and puts the
    // status in an error field, so we read the body rather than the status code.
    const body = (await res.json()) as TokenResponse | PendingResponse;
    if (isTokenResponse(body)) {
      return { kind: "token", token: body };
    }
    const { error, interval: nextInterval } = body;
    switch (error) {
      case "authorization_pending": {
        return { kind: "pending", nextInterval: interval };
      }
      case "slow_down": {
        // GitHub wants us to wait longer; use the interval it gave, or add 5s.
        return { kind: "pending", nextInterval: nextInterval ?? interval + SLOW_DOWN_BUMP_SECONDS };
      }
      case "expired_token": {
        throw new DeviceFlowError("device code expired before authorization", "expired_token");
      }
      case "access_denied": {
        throw new DeviceFlowError("user denied the request", "access_denied");
      }
      default: {
        throw new DeviceFlowError(`token poll error: ${error}`, error ?? "unknown");
      }
    }
  }

  // Sleep, poll, repeat until we get a token or hit the poll cap. Each step waits
  // for the last, so the call depth stays small.
  private async pollUntilDone(
    device: DeviceCodeResponse,
    interval: number,
    attempt: number,
  ): Promise<TokenResponse> {
    if (attempt >= this.maxPolls) {
      throw new DeviceFlowError("polling exceeded maxPolls", "poll_timeout");
    }
    await this.sleep(interval * MS_PER_SECOND);
    const step = await this.pollOnce(device, interval);
    if (step.kind === "token") {
      return step.token;
    }
    return this.pollUntilDone(device, step.nextInterval, attempt + 1);
  }

  // Step 2: poll until the user approves, denies, or the code expires.
  pollForToken(device: DeviceCodeResponse): Promise<TokenResponse> {
    const interval = Math.max(device.interval, 1);
    return this.pollUntilDone(device, interval, 0);
  }

  // Run the whole flow and return the token.
  async authenticate(): Promise<TokenResponse> {
    const device = await this.requestDeviceCode();
    this.onUserCode?.(device);
    return this.pollForToken(device);
  }
}

// What we save in the keychain. An OAuth-App user token does not expire, so the
// access token is all we keep.
interface StoredToken {
  accessToken: string;
}

const toStoredToken = (t: TokenResponse): StoredToken => ({ accessToken: t.access_token });

export {
  DEFAULT_GITHUB_SCOPE,
  DEVICE_GRANT_TYPE,
  DeviceFlowClient,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_TOKEN_URL,
  toStoredToken,
};
export { DeviceFlowError } from "./device_flow_error.js";
export type {
  DeviceCodeResponse,
  DeviceFlowAuthenticator,
  DeviceFlowOptions,
  StoredToken,
  TokenResponse,
};
