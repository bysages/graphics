import { assertPixelInput, nearest, sample, toHex } from "./color";
import { cut } from "./median";
import type {
  ExtractOptions,
  Palette,
  PaletteColor,
  PixelInput,
  QuantizedImage,
  RGB,
} from "./types";

const defaultColors = 8;
const defaultAlphaThreshold = 1;
const defaultMaxPixels = 65536;

function resolveColors(colors: number | undefined): number {
  const resolved = colors ?? defaultColors;
  if (!Number.isInteger(resolved) || resolved < 2 || resolved > 256) {
    throw new RangeError(`Palette size must be an integer between 2 and 256, got ${resolved}.`);
  }
  return resolved;
}

/** Dominant colors via sampled median cut, sorted by pixel share. */
export function extractPalette(input: PixelInput, options: ExtractOptions = {}): Palette {
  const pixels = sample(
    input,
    resolveAlphaThreshold(options.alphaThreshold),
    resolveMaxPixels(options.maxPixels),
  );
  return cut(pixels, resolveColors(options.colors));
}

/** Reduce the image to its dominant palette, remapping every pixel. */
export function quantize(input: PixelInput, options: ExtractOptions = {}): QuantizedImage {
  const { colors } = extractPalette(input, options);
  return remap(
    input,
    colors.map((entry) => entry.color),
    resolveAlphaThreshold(options.alphaThreshold),
  );
}

/** Remap the image onto a caller-provided palette (e.g. a fixed brand set). */
export function applyPalette(
  input: PixelInput,
  palette: readonly RGB[] | Palette,
  options: { alphaThreshold?: number } = {},
): QuantizedImage {
  const colors = "colors" in palette ? palette.colors.map((entry) => entry.color) : [...palette];
  if (colors.length === 0) {
    throw new RangeError("The palette must contain at least one color.");
  }
  return remap(input, colors, resolveAlphaThreshold(options.alphaThreshold));
}

function resolveAlphaThreshold(value: number | undefined): number {
  const resolved = value ?? defaultAlphaThreshold;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 255) {
    throw new RangeError(`Alpha threshold must be an integer between 0 and 255, got ${resolved}.`);
  }
  return resolved;
}

function resolveMaxPixels(value: number | undefined): number {
  const resolved = value ?? defaultMaxPixels;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new RangeError(`Maximum pixel count must be a positive integer, got ${resolved}.`);
  }
  return resolved;
}

function remap(input: PixelInput, rgbColors: RGB[], alphaThreshold: number): QuantizedImage {
  assertPixelInput(input);
  const total = input.width * input.height;
  const data = new Uint8Array(total * 4);
  const usage: number[] = Array.from({ length: rgbColors.length }, () => 0);
  const nearestCache = new Map<number, number>();
  let counted = 0;

  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const alpha = input.data[offset + 3]!;
    if (alpha < alphaThreshold) {
      data[offset] = input.data[offset]!;
      data[offset + 1] = input.data[offset + 1]!;
      data[offset + 2] = input.data[offset + 2]!;
      data[offset + 3] = alpha;
      continue;
    }
    const key =
      (input.data[offset]! << 16) | (input.data[offset + 1]! << 8) | input.data[offset + 2]!;
    let match = nearestCache.get(key);
    if (match === undefined) {
      match = nearest(
        { r: input.data[offset]!, g: input.data[offset + 1]!, b: input.data[offset + 2]! },
        rgbColors,
      );
      nearestCache.set(key, match);
    }
    usage[match] = (usage[match] ?? 0) + 1;
    counted += 1;
    const color = rgbColors[match]!;
    data[offset] = color.r;
    data[offset + 1] = color.g;
    data[offset + 2] = color.b;
    data[offset + 3] = alpha;
  }

  const paletteColors: PaletteColor[] = rgbColors
    .map((color, index) => ({
      color,
      hex: toHex(color),
      ratio: counted === 0 ? 0 : usage[index]! / counted,
    }))
    .filter((entry) => entry.ratio > 0)
    .sort((left, right) => right.ratio - left.ratio);

  return {
    data,
    width: input.width,
    height: input.height,
    layout: "rgba8",
    palette: { colors: paletteColors, sampled: counted },
  };
}
