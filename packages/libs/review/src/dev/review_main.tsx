// Test harness: render the full review screen over the fake data source. `bun run
// dev` opens this to see the whole UI. The copied Markdown is mirrored to a global
// so tests can read it without the clipboard.
//
// A `?variant=` in the URL picks the fixture, so one page can show several states:
// the default, a failing walkthrough, and a run with comments disabled.
import "virtual:uno.css";
import { render } from "solid-js/web";
import { Review } from "../review.js";
import {
  makeErrorReviewSource,
  makeFixtureReviewSource,
  makePathReviewSource,
} from "./review_fixture.js";

// Pick the variant from the URL, defaulting to the full source.
const variant = new URLSearchParams(globalThis.location.search).get("variant");
const sourceFor = (): ReturnType<typeof makeFixtureReviewSource> => {
  if (variant === "error") {
    return makeErrorReviewSource();
  }
  if (variant === "path") {
    return makePathReviewSource();
  }
  return makeFixtureReviewSource();
};
const source = sourceFor();

const root = document.getElementById("root");
if (root) {
  const dispose = render(
    () => (
      <Review
        source={source}
        onCopy={(markdown) => {
          globalThis.__copiedMarkdown = markdown;
        }}
      />
    ),
    root,
  );
  // Expose teardown so the test can confirm cleanup runs without error.
  globalThis.__dispose = dispose;
}
