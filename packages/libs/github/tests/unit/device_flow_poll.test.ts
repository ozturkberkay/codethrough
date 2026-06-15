// Tests for the device-flow requests and the polling loop. No network and no real
// sleeping; fetch and sleep are fakes.

import { describe, expect, it } from "vitest";

import { DeviceFlowClient, DeviceFlowError, type TokenResponse } from "../../src/device_flow.js";
import { CLIENT_ID, makeMock, noopSleep } from "./device_flow_mock.js";

const SUCCESS: TokenResponse = {
  access_token: "ghu_realtoken",
  token_type: "bearer",
  scope: "repo",
};

describe("Device Flow request shapes", () => {
  it("device code request: URL, method, headers, client_id and default repo scope", async () => {
    const { fetchImpl, calls } = makeMock({
      tokenScript: [{ body: { error: "authorization_pending" } }],
    });
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl,
      sleep: noopSleep,
      maxPolls: 0,
    });
    const dev = await client.requestDeviceCode();
    expect(dev.user_code).toBe("WDJB-MJHT");
    expect(dev.verification_uri).toBe("https://github.com/login/device");

    const [req] = calls;
    expect(req?.url).toBe("https://github.com/login/device/code");
    expect(req?.method).toBe("POST");
    expect(req?.headers["Accept"]).toBe("application/json");
    expect(req?.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(req?.body["client_id"]).toBe(CLIENT_ID);
    // OAuth Apps grant scopes at the device-code step; default is `repo`.
    expect(req?.body["scope"]).toBe("repo");
  });

  it("device code request sends a custom scope when one is given", async () => {
    const { fetchImpl, calls } = makeMock({
      tokenScript: [{ body: { error: "authorization_pending" } }],
    });
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      scope: "repo read:org",
      fetchImpl,
      sleep: noopSleep,
      maxPolls: 0,
    });
    await client.requestDeviceCode();
    const [req] = calls;
    expect(req?.body["scope"]).toBe("repo read:org");
  });

  it("throws a typed error when the device code endpoint is not ok", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl: failing,
      sleep: noopSleep,
    });
    await expect(client.requestDeviceCode()).rejects.toMatchObject({
      code: "device_code_http_error",
    });
  });

  it("defaults to the real GitHub endpoints when no URLs are injected", async () => {
    // With no URLs given, the client must call the real GitHub endpoints. The
    // fake fetch records the URLs, so no network is touched.
    const hits: string[] = [];
    const fetchImpl = (async (url: string) => {
      hits.push(url);
      if (url.endsWith("/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "DEV",
            user_code: "WDJB-MJHT",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "access_denied" }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new DeviceFlowClient({ clientId: CLIENT_ID, fetchImpl, sleep: noopSleep });
    await expect(client.authenticate()).rejects.toMatchObject({ code: "access_denied" });
    expect(hits).toEqual([
      "https://github.com/login/device/code",
      "https://github.com/login/oauth/access_token",
    ]);
  });

  it("invokes onUserCode with the device response during authenticate", async () => {
    const { fetchImpl } = makeMock({
      tokenScript: [{ body: { access_token: "ghu_x", token_type: "bearer", scope: "" } }],
    });
    const seen: string[] = [];
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl,
      sleep: noopSleep,
      onUserCode: (r) => seen.push(r.user_code),
    });
    await client.authenticate();
    expect(seen).toEqual(["WDJB-MJHT"]);
  });
});

describe("Device Flow polling state machine", () => {
  it("authorization_pending -> slow_down -> success, with interval backoff", async () => {
    const { fetchImpl, calls } = makeMock({
      device: { interval: 5 },
      tokenScript: [
        { body: { error: "authorization_pending" } },
        { body: { error: "slow_down", interval: 10 } },
        { body: { error: "authorization_pending" } },
        { body: SUCCESS },
      ],
    });

    const slept: number[] = [];
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    const tok = await client.authenticate();
    expect(tok.access_token).toBe("ghu_realtoken");

    const [, poll] = calls;
    expect(poll?.url).toBe("https://github.com/login/oauth/access_token");
    expect(poll?.body["grant_type"]).toBe("urn:ietf:params:oauth:grant-type:device_code");
    expect(poll?.body["device_code"]).toBe("DEV-CODE-SECRET");
    expect(poll?.body["client_id"]).toBe(CLIENT_ID);

    // Waits grow: 5s, 5s, then 10s after slow_down raised it.
    expect(slept).toEqual([5000, 5000, 10000, 10000]);
  });

  it("slow_down with no interval field falls back to +5 backoff", async () => {
    const { fetchImpl } = makeMock({
      device: { interval: 5 },
      tokenScript: [
        { body: { error: "slow_down" } },
        { body: { access_token: "ghu_x", token_type: "bearer", scope: "" } },
      ],
    });
    const slept: number[] = [];
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const tok = await client.authenticate();
    expect(tok.access_token).toBe("ghu_x");
    expect(slept).toEqual([5000, 10000]);
  });

  it("access_denied stops with a typed error", async () => {
    const { fetchImpl } = makeMock({ tokenScript: [{ body: { error: "access_denied" } }] });
    const client = new DeviceFlowClient({ clientId: CLIENT_ID, fetchImpl, sleep: noopSleep });
    await expect(client.authenticate()).rejects.toThrow(DeviceFlowError);
    await expect(client.authenticate()).rejects.toMatchObject({ code: "access_denied" });
  });

  it("expired_token stops with a typed error", async () => {
    const { fetchImpl } = makeMock({ tokenScript: [{ body: { error: "expired_token" } }] });
    const client = new DeviceFlowClient({ clientId: CLIENT_ID, fetchImpl, sleep: noopSleep });
    await expect(client.authenticate()).rejects.toMatchObject({ code: "expired_token" });
  });

  it("an unknown error code stops with a typed error", async () => {
    const { fetchImpl } = makeMock({
      tokenScript: [{ body: { error: "incorrect_client_credentials" } }],
    });
    const client = new DeviceFlowClient({ clientId: CLIENT_ID, fetchImpl, sleep: noopSleep });
    await expect(client.authenticate()).rejects.toMatchObject({
      code: "incorrect_client_credentials",
    });
  });

  it("an error body with no error field maps to an unknown code", async () => {
    const { fetchImpl } = makeMock({ tokenScript: [{ body: {} }] });
    const client = new DeviceFlowClient({ clientId: CLIENT_ID, fetchImpl, sleep: noopSleep });
    await expect(client.authenticate()).rejects.toMatchObject({ code: "unknown" });
  });

  it("times out after maxPolls without a terminal response", async () => {
    const { fetchImpl } = makeMock({
      tokenScript: [{ body: { error: "authorization_pending" } }],
    });
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl,
      sleep: noopSleep,
      maxPolls: 3,
    });
    await expect(client.authenticate()).rejects.toMatchObject({ code: "poll_timeout" });
  });

  it("clamps a sub-1 device interval to at least one second", async () => {
    const { fetchImpl } = makeMock({
      device: { interval: 0 },
      tokenScript: [{ body: { access_token: "ghu_x", token_type: "bearer", scope: "" } }],
    });
    const slept: number[] = [];
    const client = new DeviceFlowClient({
      clientId: CLIENT_ID,
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await client.authenticate();
    expect(slept).toEqual([1000]);
  });
});
