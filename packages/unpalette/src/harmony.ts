import { hslToRgb, parseColor, rgbToHsl, toHex } from "./color";
import type { ColorSequence, RGB } from "./types";

export type HarmonyScheme =
  | "complementary"
  | "analogous"
  | "triadic"
  | "splitComplementary"
  | "monochromatic";

/** Hue offsets for each scheme, in degrees. */
const offsets: Record<HarmonyScheme, number[]> = {
  complementary: [0, 180],
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  splitComplementary: [0, 150, 210],
  monochromatic: [],
};

/** Lightness steps for the monochromatic scale. */
const monochromaticLightness = [0.25, 0.4, 0.55, 0.7, 0.85];

/**
 * Generate a harmonious palette from a base color (RGB or `#rrggbb`) using
 * classic color-wheel schemes. Every color keeps the base saturation;
 * monochromatic walks a lightness scale instead.
 */
export function generatePalette(
  base: RGB | string,
  scheme: HarmonyScheme = "complementary",
): ColorSequence {
  const { h, s, l } = rgbToHsl(parseColor(base));
  const colors =
    scheme === "monochromatic"
      ? monochromaticLightness.map((l) => hslToRgb({ h, s, l }))
      : offsets[scheme].map((degrees) => hslToRgb({ h: (h + degrees + 360) % 360, s, l }));

  return {
    colors: colors.map((color) => ({ color, hex: toHex(color) })),
  };
}
