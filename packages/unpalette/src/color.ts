import type { PixelInput, RGB } from "./types";

export function toHex({ r, g, b }: RGB): string {
  const to2 = (value: number) => value.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * "Redmean" weighted squared distance — noticeably better than plain RGB
 * Euclidean distance while staying cheap enough for per-pixel lookups.
 */
export function distance(a: RGB, b: RGB): number {
  const redMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return (2 + redMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - redMean) / 256) * db * db;
}

export function nearest(color: RGB, palette: readonly RGB[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, candidate] of palette.entries()) {
    const weight = distance(color, candidate);
    if (weight < bestDistance) {
      bestDistance = weight;
      best = index;
    }
  }
  return best;
}

/** Accept an RGB object or a `#rrggbb` string. */
export function parseColor(input: RGB | string): RGB {
  if (typeof input !== "string") return input;
  const normalized = input.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new RangeError(`Expected a #rrggbb color, got ${JSON.stringify(input)}.`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}
export interface HSL {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  l: number;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return { h: (hue * 60 + 360) % 360, s: saturation, l: lightness };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60);
  let red = 0;
  let green = 0;
  let blue = 0;
  switch (sector) {
    case 0:
      red = c;
      green = x;
      break;
    case 1:
      red = x;
      green = c;
      break;
    case 2:
      green = c;
      blue = x;
      break;
    case 3:
      green = x;
      blue = c;
      break;
    case 4:
      red = x;
      blue = c;
      break;
    default:
      red = c;
      blue = x;
      break;
  }
  return {
    r: Math.round((red + m) * 255),
    g: Math.round((green + m) * 255),
    b: Math.round((blue + m) * 255),
  };
}
function assertPixelInput(input: PixelInput): void {
  const expected = input.width * input.height * 4;
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.data.length < expected
  ) {
    throw new RangeError(
      `Pixel data does not match its declared dimensions: expected at least ${expected} bytes.`,
    );
  }
}

/** Uniformly sample pixels down to `maxPixels`, honoring the alpha threshold. */
export function sample(input: PixelInput, alphaThreshold: number, maxPixels: number): RGB[] {
  assertPixelInput(input);
  const total = input.width * input.height;
  const stride = Math.max(1, Math.ceil(total / maxPixels));
  const pixels: RGB[] = [];
  for (let index = 0; index < total; index += stride) {
    const offset = index * 4;
    if (input.data[offset + 3]! < alphaThreshold) continue;
    pixels.push({
      r: input.data[offset]!,
      g: input.data[offset + 1]!,
      b: input.data[offset + 2]!,
    });
  }
  if (pixels.length === 0) {
    throw new RangeError("No pixels above the alpha threshold; nothing to extract.");
  }
  return pixels;
}
