import { parse } from "valibot";
import { describe, expect, it } from "vitest";
import {
  Comment,
  CommentDraft,
  DiffFile,
  DiffModel,
  FileStatus,
  Placement,
  type ReviewContext,
  ReviewData,
  type ReviewDataSource,
  ReviewEvent,
  ReviewMeta,
  Step,
  Summary,
  toJsonSchema,
  Walkthrough,
  WalkthroughChunk,
} from "../../src/index.js";

// A tiny stream for the stub: just one done chunk.
const emptyStream = async function* emptyStreamGen(): AsyncIterable<WalkthroughChunk> {
  yield { type: "done" };
};

describe("package barrel", () => {
  it("re-exports every schema as a usable Valibot value", () => {
    const schemas = [
      Summary,
      Step,
      Walkthrough,
      FileStatus,
      DiffFile,
      DiffModel,
      Placement,
      Comment,
      CommentDraft,
      ReviewEvent,
      ReviewMeta,
      ReviewData,
      WalkthroughChunk,
    ];

    for (const schema of schemas) {
      expect(schema.kind).toBe("schema");
    }
  });

  it("re-exports toJsonSchema", () => {
    expect(toJsonSchema(Summary).type).toBe("object");
  });

  it("lets a stub satisfy the ReviewDataSource contract", async () => {
    const context: ReviewContext = {
      sessionId: "s1",
      mode: "path",
      viewer: null,
      repo: null,
    };

    const review = parse(ReviewData, {
      meta: {
        title: "t",
        body: "b",
        repoOwner: null,
        repoName: null,
        number: null,
        baseRef: "main",
        headRef: "feature",
        author: null,
        url: null,
      },
      diff: { rawDiff: "diff", files: [] },
      comments: [],
    });

    const source: ReviewDataSource = {
      context,
      getReview: async () => await Promise.resolve(review),
      startWalkthrough: async () => await Promise.resolve({ jobId: "j1" }),
      streamWalkthrough: (_jobId: string) => emptyStream(),
      cancelWalkthrough: async () => await Promise.resolve(),
      listComments: async () => await Promise.resolve([]),
      listDrafts: async () => await Promise.resolve([]),
      draftComment: async () => await Promise.resolve(),
      submitReview: async () => await Promise.resolve(),
      capabilities: { comments: false },
    };

    const loaded = await source.getReview();
    expect(loaded.diff.rawDiff).toBe("diff");
    expect(source.capabilities.comments).toBe(false);

    const chunks: WalkthroughChunk[] = [];
    for await (const chunk of source.streamWalkthrough("j1")) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: "done" }]);
  });
});
