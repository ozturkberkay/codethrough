// Tests for the token helper toStoredToken.

import { describe, expect, it } from "vitest";

import { toStoredToken } from "../../src/device_flow.js";

describe("toStoredToken", () => {
  it("keeps only the access token from the OAuth response", () => {
    const s = toStoredToken({ access_token: "ghu_x", token_type: "bearer", scope: "repo" });
    expect(s).toEqual({ accessToken: "ghu_x" });
  });
});
