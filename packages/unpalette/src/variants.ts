import { rgbToHsl, sample } from "./color";
import { cut } from "./median";
import type { ExtractOptions, Palette, PixelInput, RGB } from "./types";

export type PaletteVariant = "vibrant" | "muted" | "dark" | "light";

const defaultVariantColors = 4;

function matchesVariant(hsl: { s: number; l: number }, variant: PaletteVariant): boolean {
  switch (variant) {
    case "vibrant":
      return hsl.s >= 0.35 && hsl.l >= 0.3 && hsl.l <= 0.7;
    case "muted":
      return hsl.s < 0.35 && hsl.l >= 0.3 && hsl.l <= 0.7;
    case "dark":
      return hsl.l < 0.3;
    case "light":
      return hsl.l > 0.7;
  }
}

export interface PaletteVariants {
  vibrant: Palette | undefined;
  muted: Palette | undefined;
  dark: Palette | undefined;
  light: Palette | undefined;
}

/**
 * Generate differently-flavored palettes from one image: vivid colors,
 * desaturated tones, and the dark and light ends of the luminance range.
 * A variant whose pixel set is empty is reported as `undefined`.
 */
export interface VariantOptions extends ExtractOptions {
  /** Colors per variant. Default 4. */
  variantColors?: number;
}

export function extractPaletteVariants(
  input: PixelInput,
  options: VariantOptions = {},
): PaletteVariants {
  const pixels = sample(input, options.alphaThreshold ?? 255, options.maxPixels ?? 65536);
  const variantColors = options.variantColors ?? defaultVariantColors;

  const groups: Record<PaletteVariant, RGB[]> = {
    vibrant: [],
    muted: [],
    dark: [],
    light: [],
  };
  for (const pixel of pixels) {
    const hsl = rgbToHsl(pixel);
    for (const variant of ["vibrant", "muted", "dark", "light"] as const) {
      if (matchesVariant(hsl, variant)) groups[variant].push(pixel);
    }
  }

  return {
    vibrant: toPalette(groups.vibrant, variantColors),
    muted: toPalette(groups.muted, variantColors),
    dark: toPalette(groups.dark, variantColors),
    light: toPalette(groups.light, variantColors),
  };
}

function toPalette(pixels: RGB[], colors: number): Palette | undefined {
  if (pixels.length === 0) return undefined;
  return cut(pixels, Math.min(colors, pixels.length));
}
