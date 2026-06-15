// The config the server puts in the page. The frontend reads the token from it and
// sends it on every API call, so the token never travels in the URL.

interface CodethroughBootstrap {
  token: string;
  apiBase: string;
}

declare global {
  // The config the server set on the page.
  var __CODETHROUGH__: CodethroughBootstrap | undefined;
  // The e2e reads the copied Markdown here, so it needs no clipboard permission.
  var __copiedMarkdown: string | undefined;
}

export type { CodethroughBootstrap };
