// Tests for the draft store: a valid body is stored, an invalid one is rejected
// (null), the list is a copy, and clear empties it.

import type { CommentDraft } from "@codethrough/schema";
import { describe, expect, it } from "vitest";

import { createDraftStore } from "../../src/server/draft_store.js";

const VALID_DRAFT: CommentDraft = {
  path: "src/a.ts",
  body: "Nit.",
  line: 12,
  side: "RIGHT",
  startLine: null,
  startSide: null,
  subjectType: "line",
};

describe("createDraftStore", () => {
  it("starts empty", () => {
    expect(createDraftStore().list()).toEqual([]);
  });

  it("parses and appends a valid draft, returning it", () => {
    const store = createDraftStore();
    expect(store.add(VALID_DRAFT)).toEqual(VALID_DRAFT);
    expect(store.list()).toEqual([VALID_DRAFT]);
  });

  it("appends multiple drafts in order", () => {
    const store = createDraftStore();
    store.add(VALID_DRAFT);
    store.add({ ...VALID_DRAFT, body: "Second." });
    expect(store.list().map((d) => d.body)).toEqual(["Nit.", "Second."]);
  });

  it("rejects a schema-invalid body with null and does not store it", () => {
    const store = createDraftStore();
    expect(store.add({ nonsense: true })).toBeNull();
    // A body missing the required line/side/subjectType fields is rejected.
    expect(store.add({ path: "a", body: "b" })).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("coerces nothing: a wrong-typed field is rejected", () => {
    const store = createDraftStore();
    // `line` must be number | null; a string is invalid.
    expect(store.add({ ...VALID_DRAFT, line: "12" })).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("returns a defensive copy that cannot mutate the store", () => {
    const store = createDraftStore();
    store.add(VALID_DRAFT);
    const snapshot = store.list();
    snapshot.push({ ...VALID_DRAFT, body: "injected" });
    expect(store.list()).toHaveLength(1);
  });

  it("clear empties the store", () => {
    const store = createDraftStore();
    store.add(VALID_DRAFT);
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
