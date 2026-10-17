import { contrastRatio } from "./accessibility";
import { toHex } from "./color";
import { mixColors, type MixOptions } from "./transform";
import type { ColorSequence, RGB } from "./types";

export interface ColorScaleOptions {
  /** Number of colors. Default 9. */
  steps?: number;
  /** Order of the returned scale. Default light-to-dark. */
  direction?: "light-to-dark" | "dark-to-light";
  /** Interpolation space. Default RGB. */
  space?: MixOptions["space"];
}

function withStops(colors: readonly RGB[]): ColorSequence {
  return { colors: colors.map((color) => ({ color, hex: toHex(color) })) };
}

/**
 * Generate a light-to-dark tonal scale. The middle step is closest to the
 * input color (exactly the base color when `steps` is odd).
 */
export function generateColorScale(
  base: Parameters<typeof mixColors>[0],
  options: ColorScaleOptions = {},
): ColorSequence {
  const steps = options.steps ?? 9;
  if (!Number.isInteger(steps) || steps < 3) {
    throw new RangeError("Color scale steps must be an integer of at least 3.");
  }
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const space = options.space === undefined ? {} : { space: options.space };
  const colors: RGB[] = [];
  for (let index = 0; index < steps; index += 1) {
    const position = index / (steps - 1);
    if (position <= 0.5) {
      colors.push(mixColors(white, base, { amount: position * 2, ...space }));
    } else {
      colors.push(mixColors(base, black, { amount: (position - 0.5) * 2, ...space }));
    }
  }
  if (options.direction === "dark-to-light") colors.reverse();
  return withStops(colors);
}

export function generateShades(
  base: Parameters<typeof mixColors>[0],
  steps = 5,
  space?: MixOptions["space"],
): ColorSequence {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError("Shade count must be an integer of at least 2.");
  }
  const colors: RGB[] = [];
  for (let index = 0; index < steps; index += 1) {
    colors.push(
      mixColors(
        base,
        { r: 0, g: 0, b: 0 },
        {
          amount: index / (steps - 1),
          ...(space === undefined ? {} : { space }),
        },
      ),
    );
  }
  return withStops(colors);
}

export function generateTints(
  base: Parameters<typeof mixColors>[0],
  steps = 5,
  space?: MixOptions["space"],
): ColorSequence {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError("Tint count must be an integer of at least 2.");
  }
  const colors: RGB[] = [];
  for (let index = 0; index < steps; index += 1) {
    colors.push(
      mixColors(
        base,
        { r: 255, g: 255, b: 255 },
        {
          amount: index / (steps - 1),
          ...(space === undefined ? {} : { space }),
        },
      ),
    );
  }
  return withStops(colors);
}

export interface PaletteContrastIssue {
  color: RGB;
  hex: string;
  ratio: number;
}

/** Keep colors that meet a WCAG contrast ratio against a background. */
export function filterPaletteByContrast(
  palette: readonly RGB[],
  background: RGB,
  threshold = 4.5,
): RGB[] {
  return palette.filter((color) => contrastRatio(color, background) >= threshold);
}
