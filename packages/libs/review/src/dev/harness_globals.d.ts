// Hooks the test harness puts on the global object so the tests can wait for the
// page and drive it.
declare var __ready: boolean | undefined;
declare var __setActiveStep: ((id: string) => void) | undefined;
declare var __unplaceableIds: string[] | undefined;
declare var __dispose: (() => void) | undefined;
// The latest copied Markdown, so tests can read it without the clipboard.
declare var __copiedMarkdown: string | undefined;
