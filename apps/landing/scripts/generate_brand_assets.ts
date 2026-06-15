// Regenerates every brand raster + favicon SVG from the canonical "C" mark
// (spikes/walkthrough/logo/logo_regular.svg) as a white mark on the monochrome
// near-black theme. Run it after the logo changes:
//
//   bun run apps/landing/scripts/generate_brand_assets.ts
//
// Output lands in apps/landing/public/. The script is idempotent: re-running
// overwrites the same files. Raw hex is fine here (build-time tooling, not src/).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import pngToIco from "png-to-ico";
import sharp from "sharp";

// Near-black background == Tailwind `zinc-950`, matching the page's `bg-zinc-950`.
const BG = "#09090b";
const MARK = "#ffffff";

// Source viewBox is 0 0 512 512 (from logo_regular.svg).
const VIEWBOX = 512;
// Corner radius of the favicon square, as a fraction of its size.
const ROUNDED_RATIO = 0.22;
// Supersampling density so rasterized SVGs stay crisp at small sizes.
const RENDER_DENSITY = 384;

// Output pixel sizes.
const FAVICON_SMALL = 16;
const FAVICON_MEDIUM = 32;
const FAVICON_LARGE = 48;
const ICON_SMALL = 192;
const ICON_LARGE = 512;
const APPLE_SIZE = 180;

// Mark scale (0..1) for surfaces that need padding around the mark.
const APPLE_SCALE = 0.82;
const MASKABLE_SCALE = 0.6;

// OG card geometry.
const OG_WIDTH = 1_200;
const OG_HEIGHT = 630;
const OG_DENSITY = 144;
const OG_MARK_SIZE = 132;
const OG_MARK_GAP = 8;
const OG_TEXT_OFFSET = 78;
const OG_TEXT_SIZE = 84;
const OG_FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const publicDir = join(here, "..", "public");
const sourceSvg = join(repoRoot, "spikes", "walkthrough", "logo", "logo_regular.svg");

// Pulls the mark's drawable content out of the source <g>, dropping the source
// fill so we can recolor it for each surface.
const extractMarkBody = (svg: string): string => {
  const match = svg.match(/<g\b[^>]*>([\s\S]*?)<\/g>/);
  if (!match?.[1]) {
    throw new Error("Could not find the <g> mark body in the source SVG.");
  }
  return match[1].trim();
};

// Wraps the mark on an optional background. `scale` shrinks the mark toward the
// canvas center, used for padding and the maskable safe zone.
const composeMarkSvg = (
  markBody: string,
  options: { background?: string; rounded?: boolean; scale?: number } = {},
): string => {
  const { background, rounded = false, scale = 1 } = options;
  const inset = (VIEWBOX * (1 - scale)) / 2;
  const radius = rounded ? VIEWBOX * ROUNDED_RATIO : 0;
  const bgRect =
    background === undefined
      ? ""
      : `<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="${radius}" fill="${background}"/>`;
  const markGroup = `<g fill="${MARK}" transform="translate(${inset} ${inset}) scale(${scale})">${markBody}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${VIEWBOX}" height="${VIEWBOX}">${bgRect}${markGroup}</svg>`;
};

// The OG card: near-black 1200x630 with a centered mark + wordmark lockup.
const composeOgSvg = (markBody: string): string => {
  const markX = (OG_WIDTH - OG_MARK_SIZE) / 2;
  const markY = OG_HEIGHT / 2 - OG_MARK_SIZE - OG_MARK_GAP;
  const scale = OG_MARK_SIZE / VIEWBOX;
  const textY = OG_HEIGHT / 2 + OG_TEXT_OFFSET;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${BG}"/>
  <g fill="${MARK}" transform="translate(${markX} ${markY}) scale(${scale})">${markBody}</g>
  <text x="${OG_WIDTH / 2}" y="${textY}" fill="${MARK}" text-anchor="middle"
    font-family="${OG_FONT}" font-size="${OG_TEXT_SIZE}" font-weight="600" letter-spacing="-2">Codethrough</text>
</svg>`;
};

// Rasterizes an SVG string to a square PNG at the given size.
const renderPng = (svg: string, size: number): Promise<Buffer> =>
  sharp(Buffer.from(svg), { density: RENDER_DENSITY }).resize(size, size).png().toBuffer();

// Writes the SVG marks: the transparent canonical logo and the dark favicon.
const writeVectorMarks = async (source: string, markBody: string): Promise<void> => {
  await writeFile(join(publicDir, "logo.svg"), `${source.trim()}\n`);
  await writeFile(
    join(publicDir, "favicon.svg"),
    `${composeMarkSvg(markBody, { background: BG, rounded: true })}\n`,
  );
};

// Writes the PNG favicons, PWA icons, and the ICO bundle (all white on dark).
const writeIcons = async (markBody: string): Promise<void> => {
  const onDark = composeMarkSvg(markBody, { background: BG });
  const small = await renderPng(onDark, FAVICON_SMALL);
  const medium = await renderPng(onDark, FAVICON_MEDIUM);
  const large = await renderPng(onDark, FAVICON_LARGE);

  await writeFile(join(publicDir, "favicon-16x16.png"), small);
  await writeFile(join(publicDir, "favicon-32x32.png"), medium);
  await writeFile(join(publicDir, "icon-192.png"), await renderPng(onDark, ICON_SMALL));
  await writeFile(join(publicDir, "icon-512.png"), await renderPng(onDark, ICON_LARGE));
  await writeFile(join(publicDir, "favicon.ico"), await pngToIco([small, medium, large]));

  // Maskable icon: mark in the ~60% safe zone so platform masks never clip it.
  await writeFile(
    join(publicDir, "icon-maskable-512.png"),
    await renderPng(
      composeMarkSvg(markBody, { background: BG, scale: MASKABLE_SCALE }),
      ICON_LARGE,
    ),
  );
};

// Writes the opaque surfaces: the apple touch icon and the OG card. Flatten
// drops the alpha channel so both are fully opaque.
const writeOpaqueSurfaces = async (markBody: string): Promise<void> => {
  await sharp(Buffer.from(composeMarkSvg(markBody, { background: BG, scale: APPLE_SCALE })), {
    density: RENDER_DENSITY,
  })
    .resize(APPLE_SIZE, APPLE_SIZE)
    .flatten({ background: BG })
    .png()
    .toFile(join(publicDir, "apple-touch-icon.png"));

  await sharp(Buffer.from(composeOgSvg(markBody)), { density: OG_DENSITY })
    .resize(OG_WIDTH, OG_HEIGHT)
    .flatten({ background: BG })
    .png()
    .toFile(join(publicDir, "og", "og.png"));
};

const main = async (): Promise<void> => {
  const source = await readFile(sourceSvg, "utf8");
  const markBody = extractMarkBody(source);

  await mkdir(publicDir, { recursive: true });
  await mkdir(join(publicDir, "og"), { recursive: true });

  await writeVectorMarks(source, markBody);
  await writeIcons(markBody);
  await writeOpaqueSurfaces(markBody);

  process.stdout.write("Brand assets regenerated in apps/landing/public/.\n");
};

await main();
