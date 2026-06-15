import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import UnoCSS from "@unocss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Resolve HTML entries relative to this config so the build works from any cwd.
const here = fileURLToPath(new URL(".", import.meta.url));

// Dev/e2e harness for the @codethrough/review components. The package itself
// ships source (the CLI bundles it with its own build); this config only serves
// the harnesses so Playwright can prove Pierre renders. Two pages: index.html
// mounts the bare <DiffView> (the PR5 spec) and review.html mounts the full
// <Review> over a fake ReviewDataSource (the PR8 spec).
export default defineConfig({
  plugins: [solid(), UnoCSS()],
  server: { port: 5_173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(here, "index.html"),
        review: resolve(here, "review.html"),
      },
    },
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
