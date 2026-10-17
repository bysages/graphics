import type { ColorInput, PixelInput, RGB, RGBA } from "./types";

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

/** Parse an RGB, RGBA, HSL, HSLA, or hex color to RGB. Alpha is discarded. */
function assertColorChannel(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer between 0 and 255, got ${value}.`);
  }
}

export function parseColor(input: RGB | string): RGB {
  const rgba = parseRgba(input);
  return { r: rgba.r, g: rgba.g, b: rgba.b };
}
export interface HSL {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  l: number;
}

export interface HSLA extends HSL {
  /** 0..1 */
  a: number;
}

export interface LinearRGB {
  /** Linear-light sRGB channels, 0..1. */
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  /** Perceptual lightness, 0..1. */
  L: number;
  a: number;
  b: number;
}

export interface Oklch {
  /** Perceptual lightness, 0..1. */
  l: number;
  /** Chroma; unbounded mathematically, usually below 0.4 for displayable sRGB colors. */
  c: number;
  /** Hue in degrees, normalized to 0..<360. */
  h: number;
}

const srgbToLinearChannel = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgbChannel = (value: number): number =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

export function rgbToLinear({ r, g, b }: RGB): LinearRGB {
  return {
    r: srgbToLinearChannel(r / 255),
    g: srgbToLinearChannel(g / 255),
    b: srgbToLinearChannel(b / 255),
  };
}

export function linearToRgb({ r, g, b }: LinearRGB): RGB {
  const convert = (value: number): number =>
    Math.round(linearToSrgbChannel(Math.max(0, Math.min(1, value))) * 255);
  return { r: convert(r), g: convert(g), b: convert(b) };
}

export type GamutMethod = "clip" | "chroma";

export interface GamutOptions {
  /** Out-of-gamut mapping. `chroma` preserves lightness and hue while reducing chroma. */
  method?: GamutMethod;
}

function rawOklabToLinear({ L, a, b }: Oklab): LinearRGB {
  const left = L + 0.3963377774 * a + 0.2158037573 * b;
  const middle = L - 0.1055613458 * a - 0.0638541728 * b;
  const right = L - 0.0894841775 * a - 1.291485548 * b;
  const leftCubed = left ** 3;
  const middleCubed = middle ** 3;
  const rightCubed = right ** 3;
  return {
    r: 4.0767416621 * leftCubed - 3.3077115913 * middleCubed + 0.2309699292 * rightCubed,
    g: -1.2684380046 * leftCubed + 2.6097574011 * middleCubed - 0.3413193965 * rightCubed,
    b: -0.0041960863 * leftCubed - 0.7034186147 * middleCubed + 1.707614701 * rightCubed,
  };
}

function isLinearInGamut({ r, g, b }: LinearRGB): boolean {
  const epsilon = 1e-7;
  return [r, g, b].every((channel) => channel >= -epsilon && channel <= 1 + epsilon);
}

function chromaInGamut(l: number, chroma: number, h: number): boolean {
  const radians = (h * Math.PI) / 180;
  return isLinearInGamut(
    rawOklabToLinear({ L: l, a: Math.cos(radians) * chroma, b: Math.sin(radians) * chroma }),
  );
}

/** Reduce chroma while preserving Oklch lightness and hue until RGB is displayable. */
export function toGamutOklch(color: Oklch, options: GamutOptions = {}): Oklch {
  const method = options.method ?? "chroma";
  if (method === "clip" || chromaInGamut(color.l, color.c, color.h) || color.c === 0) {
    return { ...color };
  }
  let lower = 0;
  let upper = color.c;
  for (let index = 0; index < 24; index += 1) {
    const middle = (lower + upper) / 2;
    if (chromaInGamut(color.l, middle, color.h)) lower = middle;
    else upper = middle;
  }
  return { ...color, c: lower };
}

export function rgbToOklab(color: RGB): Oklab {
  const { r, g, b } = rgbToLinear(color);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(color: Oklab, options: GamutOptions = {}): RGB {
  const linear = rawOklabToLinear(color);
  if (options.method === "chroma" && !isLinearInGamut(linear)) {
    const mapped = toGamutOklch(
      {
        l: color.L,
        c: Math.hypot(color.a, color.b),
        h: (Math.atan2(color.b, color.a) * 180) / Math.PI,
      },
      options,
    );
    const radians = (mapped.h * Math.PI) / 180;
    return linearToRgb(
      rawOklabToLinear({
        L: mapped.l,
        a: Math.cos(radians) * mapped.c,
        b: Math.sin(radians) * mapped.c,
      }),
    );
  }
  return linearToRgb(linear);
}

export function rgbToOklch(color: RGB): Oklch {
  const { L, a, b } = rgbToOklab(color);
  return {
    l: L,
    c: Math.hypot(a, b),
    h: ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360,
  };
}

export function oklchToRgb(color: Oklch, options: GamutOptions = {}): RGB {
  return oklabToRgb(
    (() => {
      const mapped = toGamutOklch(color, options);
      const radians = (mapped.h * Math.PI) / 180;
      return { L: mapped.l, a: Math.cos(radians) * mapped.c, b: Math.sin(radians) * mapped.c };
    })(),
  );
}

function isOklab(value: object): value is Oklab {
  return "L" in value && "a" in value && "b" in value;
}

function isOklch(value: object): value is Oklch {
  return "l" in value && "c" in value && "h" in value;
}

/** Test whether a color can be represented exactly in 8-bit sRGB. */
export function inGamut(color: RGB | RGBA | Oklab | Oklch | string): boolean {
  if (typeof color === "string" || "r" in color) {
    parseColor(color);
    return true;
  }
  if (isOklch(color)) return chromaInGamut(color.l, color.c, color.h);
  if (isOklab(color)) return isLinearInGamut(rawOklabToLinear(color));
  throw new RangeError(`Unsupported color: ${JSON.stringify(color)}.`);
}

/** Map a color to RGB, choosing chroma reduction or channel clipping for out-of-gamut input. */
export function toGamut(
  color: RGB | RGBA | Oklab | Oklch | string,
  options: GamutOptions = {},
): RGB {
  if (typeof color === "string" || "r" in color) return parseColor(color);
  if (isOklch(color)) return oklchToRgb(color, options);
  if (isOklab(color)) return oklabToRgb(color, options);
  throw new RangeError(`Unsupported color: ${JSON.stringify(color)}.`);
}

/**
 * Composite source over backdrop using non-premultiplied RGBA bytes.
 * The result is transparent when both inputs are transparent.
 */
export function compositeColors(source: ColorInput, backdrop: ColorInput): RGBA {
  const top = parseRgba(source);
  const bottom = parseRgba(backdrop);
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (topChannel: number, bottomChannel: number): number =>
    Math.round((topChannel * top.a + bottomChannel * bottom.a * (1 - top.a)) / alpha);
  return {
    r: channel(top.r, bottom.r),
    g: channel(top.g, bottom.g),
    b: channel(top.b, bottom.b),
    a: alpha,
  };
}

/** Flatten translucency against an opaque backdrop (default white). */
export function flattenAlpha(
  color: ColorInput,
  backdrop: ColorInput = { r: 255, g: 255, b: 255 },
): RGBA {
  const opaque = parseRgba(backdrop);
  return compositeColors(color, { ...opaque, a: 1 });
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
  return {
    h: (((hue * 60) % 360) + 360) % 360,
    s: Math.min(1, Math.max(0, saturation)),
    l: lightness,
  };
}

export function hslToRgb({ h: inputHue, s, l }: HSL): RGB {
  if (
    !Number.isFinite(inputHue) ||
    !Number.isFinite(s) ||
    !Number.isFinite(l) ||
    s < 0 ||
    s > 1 ||
    l < 0 ||
    l > 1
  ) {
    throw new RangeError("HSL values are out of range.");
  }
  const h = ((inputHue % 360) + 360) % 360;
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
export function assertPixelInput(input: PixelInput): void {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Expected pixel input.");
  }
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

export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch";

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) throw new RangeError(`Expected a finite number, got ${value}.`);
  return Math.max(0, Math.min(1, value));
};

function parseHexColor(input: string): RGB {
  const normalized = input.replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) {
    throw new RangeError(`Expected a hex color, got ${JSON.stringify(input)}.`);
  }
  const expand = (value: string) => Number.parseInt(value.repeat(2), 16);
  if (normalized.length === 3 || normalized.length === 4) {
    return {
      r: expand(normalized.slice(0, 1)),
      g: expand(normalized.slice(1, 2)),
      b: expand(normalized.slice(2, 3)),
    };
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function parseCssRgb(value: string): RGBA {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match?.[1]) {
    throw new RangeError(`Expected an rgb() or rgba() color, got ${JSON.stringify(value)}.`);
  }
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) {
    throw new RangeError(`Expected 3 or 4 RGB components, got ${JSON.stringify(value)}.`);
  }
  const channel = (input: string) => {
    if (input.endsWith("%")) return Math.round(clamp01(Number(input.slice(0, -1)) / 100) * 255);
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) throw new RangeError(`Invalid RGB component: ${input}`);
    return Math.max(0, Math.min(255, Math.round(parsed)));
  };
  return {
    r: channel(parts[0]!),
    g: channel(parts[1]!),
    b: channel(parts[2]!),
    a: parts[3] === undefined ? 1 : parseAlpha(parts[3]!),
  };
}

function parseAlpha(value: string): number {
  if (value.endsWith("%")) return clamp01(Number(value.slice(0, -1)) / 100);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid alpha: ${value}`);
  return clamp01(parsed);
}

function parseHue(value: string): number {
  const match = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(deg|grad|rad|turn)?$/i);
  if (!match) throw new RangeError(`Invalid hue: ${value}`);
  const amount = Number(match[1]);
  switch (match[2]?.toLowerCase()) {
    case "grad":
      return (amount / 400) * 360;
    case "rad":
      return (amount * 180) / Math.PI;
    case "turn":
      return amount * 360;
    default:
      return amount;
  }
}

function parseUnit01(value: string, label: string): number {
  if (value.endsWith("%")) return clamp01(Number(value.slice(0, -1)) / 100);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid ${label}: ${value}`);
  return clamp01(parsed);
}

function parseCssHsl(value: string): HSLA {
  const match = value.match(/^hsla?\(([^)]+)\)$/i);
  if (!match?.[1]) {
    throw new RangeError(`Expected an hsl() or hsla() color, got ${JSON.stringify(value)}.`);
  }
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) {
    throw new RangeError(`Expected 3 or 4 HSL components, got ${JSON.stringify(value)}.`);
  }
  return {
    h: (parseHue(parts[0]!) + 360) % 360,
    s: parseUnit01(parts[1]!, "saturation"),
    l: parseUnit01(parts[2]!, "lightness"),
    a: parts[3] === undefined ? 1 : parseAlpha(parts[3]!),
  };
}

function parseCssOklch(value: string): RGBA {
  const match = value.match(/^oklch\(([^)]+)\)$/i);
  if (!match?.[1]) {
    throw new RangeError(`Expected an oklch() color, got ${JSON.stringify(value)}.`);
  }
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) {
    throw new RangeError(`Expected 3 or 4 OKLCH components, got ${JSON.stringify(value)}.`);
  }
  const percentage = (input: string, label: string): number => {
    if (input.endsWith("%")) return clamp01(Number(input.slice(0, -1)) / 100);
    const parsed = Number(input);
    if (!Number.isFinite(parsed)) throw new RangeError(`Invalid ${label}: ${input}`);
    return parsed;
  };
  const lightness = percentage(parts[0]!, "lightness");
  const chromaText = parts[1]!;
  const chroma = chromaText.endsWith("%")
    ? Math.max(0, (Number(chromaText.slice(0, -1)) / 100) * 0.4)
    : Number(chromaText);
  if (!Number.isFinite(chroma) || chroma < 0) {
    throw new RangeError(`Invalid chroma: ${chromaText}`);
  }
  const hue = ((parseHue(parts[2]!) % 360) + 360) % 360;
  return {
    ...oklchToRgb({ l: lightness, c: chroma, h: hue }),
    a: parts[3] === undefined ? 1 : parseAlpha(parts[3]!),
  };
}

const namedColors: Record<string, RGB> = {
  transparent: { r: 0, g: 0, b: 0 },
  black: { r: 0, g: 0, b: 0 },
  silver: { r: 192, g: 192, b: 192 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  white: { r: 255, g: 255, b: 255 },
  maroon: { r: 128, g: 0, b: 0 },
  red: { r: 255, g: 0, b: 0 },
  purple: { r: 128, g: 0, b: 128 },
  fuchsia: { r: 255, g: 0, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  green: { r: 0, g: 128, b: 0 },
  lime: { r: 0, g: 255, b: 0 },
  olive: { r: 128, g: 128, b: 0 },
  yellow: { r: 255, g: 255, b: 0 },
  navy: { r: 0, g: 0, b: 128 },
  blue: { r: 0, g: 0, b: 255 },
  teal: { r: 0, g: 128, b: 128 },
  aqua: { r: 0, g: 255, b: 255 },
  cyan: { r: 0, g: 255, b: 255 },
  orange: { r: 255, g: 165, b: 0 },
  gold: { r: 255, g: 215, b: 0 },
  pink: { r: 255, g: 192, b: 203 },
  brown: { r: 165, g: 42, b: 42 },
  indigo: { r: 75, g: 0, b: 130 },
  violet: { r: 238, g: 130, b: 238 },
};

/**
 * Parse a color while preserving alpha.
 */
export function parseRgba(input: RGB | RGBA | string): RGBA {
  const named = typeof input === "string" ? namedColors[input.trim().toLowerCase()] : undefined;
  if (named !== undefined) {
    return { ...named, a: 1 };
  }

  if (typeof input !== "string") {
    for (const label of ["r", "g", "b"] as const) {
      assertColorChannel(input[label]!, label);
    }
    const alpha = "a" in input ? input.a : 1;
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new RangeError(`Alpha must be a number between 0 and 1, got ${alpha}.`);
    }
    return { ...input, a: alpha };
  }
  if (input.startsWith("#")) {
    const normalized = input.replace(/^#/, "");
    if (normalized.length === 4 || normalized.length === 8) {
      const rgb = parseHexColor(input);
      const alpha =
        normalized.length === 4
          ? Number.parseInt(normalized.slice(3, 4).repeat(2), 16) / 255
          : Number.parseInt(normalized.slice(6, 8), 16) / 255;
      return { ...rgb, a: alpha };
    }
    return { ...parseHexColor(input), a: 1 };
  }
  if (/^rgba?\(/i.test(input)) {
    const { r, g, b, a } = parseCssRgb(input);
    return { r, g, b, a };
  }
  if (/^hsla?\(/i.test(input)) {
    const { h, s, l, a } = parseCssHsl(input);
    return { ...hslToRgb({ h, s, l }), a };
  }
  if (/^oklch\(/i.test(input)) {
    return parseCssOklch(input);
  }
  throw new RangeError(`Unsupported color: ${JSON.stringify(input)}.`);
}

/** Format a color as #rrggbbaa. */
export function toHex8(input: RGB | RGBA): string {
  const { r, g, b } = input;
  const a = "a" in input ? Math.round(input.a * 255) : 255;
  const to2 = (value: number) => value.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}${to2(a)}`;
}

/** Format a color as a standard CSS representation. */
export function formatColor(input: RGB | RGBA | string, format: ColorFormat): string {
  const rgba = parseRgba(input);
  if (format === "hex") return rgba.a === 1 ? toHex(rgba) : toHex8(rgba);
  const rgb = { r: rgba.r, g: rgba.g, b: rgba.b };
  if (format === "rgb") {
    return rgba.a === 1
      ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
      : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgba.a})`;
  }
  if (format === "oklch") {
    const { l, c, h } = rgbToOklch(rgb);
    const lightness = Math.round(l * 10000) / 10000;
    const chroma = Math.round(c * 10000) / 10000;
    const hue = Math.round(h * 100) / 100;
    return rgba.a === 1
      ? `oklch(${lightness} ${chroma} ${hue})`
      : `oklch(${lightness} ${chroma} ${hue} / ${rgba.a})`;
  }
  const { h, s, l } = rgbToHsl(rgb);
  return rgba.a === 1
    ? `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
    : `hsla(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${rgba.a})`;
}
