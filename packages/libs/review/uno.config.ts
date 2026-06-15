import presetWind4 from "@unocss/preset-wind4";
import { codethroughPreset } from "@codethrough/unocss-config";
import { defineConfig } from "unocss";

/**
 * UnoCSS config for the review UI.
 *
 * Presets:
 *   - preset-wind4:      Tailwind-compatible utilities (colors, spacing, type).
 *   - codethroughPreset: Brand font stacks + the kbd-focus shortcut on Wind4.
 *
 * Annotation content is light-DOM Solid, so it is styled by these utilities.
 * The diff rows themselves live in Pierre's self-contained Shadow DOM and are
 * not reachable by these classes.
 */
export default defineConfig({
  presets: [presetWind4(), codethroughPreset()],
});
