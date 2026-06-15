import { type Preset, definePreset } from "unocss";
import { fontStack } from "@codethrough/design-tokens";

const basePreset = definePreset(() => ({
  name: "@codethrough/unocss-config",
  theme: {
    // Wind4 reads `theme.font.*` (not `theme.fontFamily.*`) for
    // `--font-*` vars. Using the wrong key falls back to system fonts.
    //
    // Both stacks soft-prefer the brand face (Inter / JetBrains Mono) if the
    // user has it installed locally, then fall through to system fonts. No
    // webfont is shipped: keeps CSP `style-src 'self'` strict and saves a
    // network round-trip on first paint.
    font: {
      sans: fontStack.sans,
      mono: fontStack.mono,
    },
  },
  // Accessible keyboard-focus indicator (WCAG 2.4.7).
  //
  // Named `kbd-focus`, NOT `focus-ring`/`focus-ring-visible`: preset-wind4 parses
  // any `focus-*` token as the `focus`/`focus-visible` variant first, so a
  // shortcut under such a key is shadowed and never expands. A bare `ring` is the
  // same trap: its `box-shadow` references undefined `--un-ring-*` vars (invalid
  // at computed-value time -> no visible ring).
  shortcuts: {
    "kbd-focus":
      "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-50",
  },
}));

/**
 * Thin UnoCSS preset that extends preset-wind4 with the Codethrough font
 * stacks and an accessible keyboard-focus shortcut.
 */
export const codethroughPreset = (): Preset => basePreset() as Preset;
