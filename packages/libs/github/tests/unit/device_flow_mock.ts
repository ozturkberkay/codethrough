// A shared fetch mock for the device-flow tests. Each token-URL call returns the
// next scripted response; the device-code URL returns a stub. Records each
// request so tests can check it.

import type { DeviceCodeResponse } from "../../src/device_flow.js";

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, string>;
}

interface MockOptions {
  device?: Partial<DeviceCodeResponse>;
  tokenScript: { status?: number; body: unknown }[];
}

const OK = 200;

const makeMock = (opts: MockOptions): { fetchImpl: typeof fetch; calls: MockCall[] } => {
  const calls: MockCall[] = [];
  let idx = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const params = new URLSearchParams(init.body as string);
    calls.push({
      url,
      method: init.method as string,
      headers: init.headers as Record<string, string>,
      body: Object.fromEntries(params.entries()),
    });
    if (url.endsWith("/device/code")) {
      return new Response(
        JSON.stringify({
          device_code: "DEV-CODE-SECRET",
          user_code: "WDJB-MJHT",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
          ...opts.device,
        }),
        { status: OK },
      );
    }
    const step = opts.tokenScript[idx++] ?? opts.tokenScript.at(-1);
    return new Response(JSON.stringify(step?.body), { status: step?.status ?? OK });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

const CLIENT_ID = "Iv1.test_client_id";
const noopSleep = async (): Promise<void> => {};

export { CLIENT_ID, makeMock, noopSleep };
export type { MockCall, MockOptions };
