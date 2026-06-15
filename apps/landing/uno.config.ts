import presetAttributify from "@unocss/preset-attributify";
import presetWind4 from "@unocss/preset-wind4";
import transformerDirectives from "@unocss/transformer-directives";
import transformerVariantGroup from "@unocss/transformer-variant-group";
import { codethroughPreset } from "@codethrough/unocss-config";
import { defineConfig, presetIcons } from "unocss";

/**
 * UnoCSS config for the landing page.
 *
 * Presets:
 *   - preset-wind4:        Tailwind-compatible utilities (colors, spacing, typography).
 *   - preset-icons:        On-demand icon classes (i-ph-* and i-simple-icons-*).
 *   - preset-attributify:  Attribute-style utilities (bg="bg-2" text="fg").
 *                          Use on elements with 5+ utility classes for readability.
 *   - codethroughPreset:   Brand font stacks layered on top of Wind4.
 *
 * Transformers:
 *   - transformer-variant-group: hover:(bg-fg text-bg) shorthand.
 *   - transformer-directives:    @apply, @screen, and theme('colors.fg')
 *                                inside <style> blocks. Required wherever a Wind4
 *                                token must flow into raw CSS.
 */
export default defineConfig({
  presets: [
    presetWind4(),
    presetIcons({
      collections: {
        ph: async () => {
          const { default: icons } = await import("@iconify-json/ph/icons.json");
          return icons;
        },
        simple: async () => {
          const { default: icons } = await import("@iconify-json/simple-icons/icons.json");
          return icons;
        },
      },
    }),
    presetAttributify(),
    codethroughPreset(),
  ],
  transformers: [transformerVariantGroup(), transformerDirectives()],
});
