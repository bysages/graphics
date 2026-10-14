# unpalette

![npm version](https://img.shields.io/npm/v/unpalette)
![npm license](https://img.shields.io/npm/l/unpalette)

> Color palette extraction, quantization, and remapping for browsers and Node.js — zero runtime dependencies, one algorithm everywhere.

## Features

- 🎨 **Dominant color extraction** — median-cut with largest-gap splitting, so a cut never lands inside a tight color cluster; colors come back sorted by pixel share with HEX output
- 🪣 **Quantization** — reduce any RGBA8 image to its dominant palette, alpha preserved per pixel
- 🖌 **Remapping** — apply a caller-provided palette (a fixed brand set, a terminal theme) with redmean nearest-color matching
- ⚡ **One algorithm, every runtime** — pure TypeScript with zero runtime dependencies; the browser and Node produce identical palettes from identical pixels
- 📦 **Bounded work** — large inputs are uniformly sampled down to a configurable pixel budget
- 🌈 **Palette generation** — `generatePalette` derives complementary, analogous, triadic, split-complementary, and monochromatic palettes from one base color through classic color-wheel schemes
- 🎭 **Style variants** — `extractPaletteVariants` reads one image into vivid, muted, dark, and light palettes by HSL attributes

## Installation

```bash
# pnpm
pnpm add unpalette

# npm
npm install unpalette

# yarn
yarn add unpalette

# bun
bun add unpalette
```

## Quick Start

```ts
import { applyPalette, extractPalette, quantize } from "unpalette";

const pixels = { data, width, height }; // RGBA8 — decode with unimage, canvas, or your own loader

// Dominant colors, sorted by pixel share.
const palette = extractPalette(pixels, { colors: 6 });
palette.colors.forEach(({ hex, ratio }) => console.log(hex, `${(ratio * 100).toFixed(1)}%`));

// Reduce the image onto its dominant palette (alpha preserved).
const reduced = quantize(pixels, { colors: 16 });

// Or remap onto a fixed brand palette.
const branded = applyPalette(pixels, [
  { r: 28, g: 28, b: 30 },
  { r: 255, g: 214, b: 10 },
  { r: 10, g: 132, b: 255 },
]);
```

`extractPalette` skips pixels below `alphaThreshold` (default 255), and samples large inputs down to `maxPixels` (default 65536) before analysis. Nearest-color matching uses the redmean distance — noticeably better than plain RGB Euclidean while staying cheap enough for per-pixel lookups.

### Generating palettes

Two paths produce palettes without decoding anything yourself:

```ts
import { extractPaletteVariants, generatePalette } from "unpalette";

// From one base color, through classic color-wheel schemes.
const complementary = generatePalette({ r: 255, g: 90, b: 0 }, "complementary");
const scale = generatePalette("#3366cc", "monochromatic");

// From one image: vivid, muted, dark, and light variants by HSL attributes.
const { vibrant, muted, dark, light } = extractPaletteVariants(pixels, {
  variantColors: 4,
});
```

## Pairing with unimage

`unpalette` accepts raw RGBA8 pixels, so decoding lives wherever it belongs:

```ts
import { createImageManager } from "unimage";
import { sharpDriver } from "unimage/drivers/sharp";
import { extractPalette } from "unpalette";

const image = createImageManager({ driver: sharpDriver() });
const result = await image.transform(input, {
  operations: [{ type: "resize", width: 256 }],
  output: { format: "png", metadataPolicy: "strip" },
});

// Decode directly to RGBA8 pixels; no intermediate encoded image is needed.
const pixels = await image.decode(input, { frames: "first" });

const palette = extractPalette(pixels);
```

## Related Projects

- [Graphics](https://github.com/bysages/graphics) — the parent monorepo and ecosystem docs
- [unimage](https://github.com/bysages/graphics/tree/main/packages/unimage) — decode image bytes into the RGBA8 pixels that palette APIs consume

## License

- [MIT](../../LICENSE) © [By Sages](https://www.bysages.com/)
