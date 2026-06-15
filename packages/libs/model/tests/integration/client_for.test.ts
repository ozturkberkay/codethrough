// Tests for building the real Anthropic client from a credential. Constructing the
// client does no network I/O, so we can check the auth wiring directly: an api key
// uses key auth; an oauth token uses bearer auth plus the oauth beta header. This
// checks the subscription-oauth path without a live token.

import type { Anthropic } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { createAnthropicProvider } from "../../src/providers/anthropic.js";
import { clientFor } from "../../src/runtime.js";

// The SDK keeps its constructor options on a private field. Read it through a narrow
// view so the test can check the beta header.
const defaultHeadersOf = (client: Anthropic): Record<string, string> | undefined =>
  (client as unknown as { _options: { defaultHeaders?: Record<string, string> } })._options
    .defaultHeaders;

describe("clientFor", () => {
  it("builds an api-key client (X-Api-Key auth, no auth token, no beta header)", () => {
    const client = clientFor({ kind: "apiKey", apiKey: "sk-ant-api-xyz" });
    expect(client.apiKey).toBe("sk-ant-api-xyz");
    expect(client.authToken).toBeNull();
    // An api-key client gets no oauth beta header.
    expect(defaultHeadersOf(client)?.["anthropic-beta"]).toBeUndefined();
  });

  it("builds an oauth client (Bearer auth token) with the oauth beta default header", () => {
    const client = clientFor({ kind: "oauth", token: "sk-ant-oat01-abc" });
    // The auth token drives bearer auth on every request.
    expect(client.authToken).toBe("sk-ant-oat01-abc");
    expect(client.apiKey).toBeNull();
    expect(defaultHeadersOf(client)?.["anthropic-beta"]).toBe("oauth-2025-04-20");
  });

  it("builds an oauth client the same way for an expired-flagged credential", () => {
    // The expired flag is just advice; the bearer token is still wired up.
    const client = clientFor({ kind: "oauth", token: "sk-ant-oat01-stale", expired: true });
    expect(client.authToken).toBe("sk-ant-oat01-stale");
    expect(defaultHeadersOf(client)?.["anthropic-beta"]).toBe("oauth-2025-04-20");
  });
});

describe("createAnthropicProvider default client", () => {
  it("constructs the real client from the credential when none is injected", () => {
    // Covers the default-client path; building the client does no network I/O, so
    // this stays offline.
    const p = createAnthropicProvider({
      model: "claude-opus-4-8",
      effort: "high",
      credential: { kind: "apiKey", apiKey: "sk-ant-api-default" },
    });
    expect(p.modelId).toBe("claude-opus-4-8");
  });
});
