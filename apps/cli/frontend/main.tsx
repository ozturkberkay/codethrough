// The app entry: read the config from the page, build the data source, and mount
// <Review>. A thin shell (not unit-tested); the e2e drives it over the real server.
import "virtual:uno.css";
import { render } from "solid-js/web";
import { Review } from "@codethrough/review";
import { readBootstrap } from "./bootstrap.js";
import { createHttpReviewDataSource } from "./http_data_source.js";

// The data source takes its context and capabilities from the page config the
// server set. So in local-path mode comments is false and the write UI shows its
// "unavailable" fallback instead of a composer that would fail.
const bootstrap = readBootstrap(globalThis);
const source = createHttpReviewDataSource({ bootstrap });

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Review
        source={source}
        onCopy={(markdown) => {
          // Save the copied Markdown to a global so the e2e can read it without a
          // clipboard permission.
          globalThis.__copiedMarkdown = markdown;
        }}
      />
    ),
    root,
  );
}
