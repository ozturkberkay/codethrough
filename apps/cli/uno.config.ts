import presetWind4 from "@unocss/preset-wind4";
import { codethroughPreset } from "@codethrough/unocss-config";
import { defineConfig } from "unocss";

/**
 * UnoCSS config for the CLI's served frontend.
 *
 * Presets:
 *   - preset-wind4:      Tailwind-compatible utilities (colors, spacing, type).
 *   - codethroughPreset: Brand font stacks + the kbd-focus shortcut on Wind4.
 *
 * The frontend mounts @codethrough/review's <Review>, whose annotation content
 * is light-DOM Solid styled by these utilities. Pierre's diff rows live in a
 * self-contained Shadow DOM not reachable by these classes.
 */
export default defineConfig({
  presets: [presetWind4(), codethroughPreset()],
});
