import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import UnoCSS from "@unocss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Resolve paths relative to this config so the build works from any cwd.
const here = fileURLToPath(new URL(".", import.meta.url));

// Vite build for the served SPA. The Bun server serves the emitted dist/ for
// every non-/api path; index.html is the single page that mounts <Review> over
// the HTTP+SSE ReviewDataSource. The build mirrors @codethrough/review's
// requirements because we bundle @pierre/diffs through it.
export default defineConfig({
  root: resolve(here, "frontend"),
  plugins: [solid(), UnoCSS()],
  build: {
    // Emit into the package's dist/ (one level up from the frontend root) so the
    // server's static handler can resolve it next to src/.
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
  },
  // REQUIRED: Pierre's worker is a module worker that code-splits (Shiki + wasm
  // chunks). Vite's default "iife" worker format cannot code-split, so a prod
  // build fails. ES-format worker output fixes it.
  worker: { format: "es" },
  // Pierre pulls a CJS dep (lru_map). Let Vite's optimizer prebundle the package
  // so the CJS->ESM default-export interop is handled. We declare lru_map as a
  // direct dependency because the isolated linker hides transitive deps.
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/worker", "lru_map"],
  },
});
