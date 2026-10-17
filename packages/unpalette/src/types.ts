export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type ColorInput = RGB | RGBA | string;

export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

export interface PaletteColor {
  color: RGB;
  /** Lowercase `#rrggbb`. */
  hex: string;
  /** Share of sampled pixels, 0..1. */
  ratio: number;
}

export interface Palette {
  /** Sorted by ratio, descending. */
  colors: PaletteColor[];
  /** Number of pixels the ratios were computed against. */
  sampled: number;
}

export interface PixelInput {
  /** RGBA8 bytes, `width * height * 4` long. */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface ColorStop {
  color: RGB;
  /** Lowercase `#rrggbb`. */
  hex: string;
}

/** Generated colors, such as harmony schemes and tonal scales. */
export interface ColorSequence {
  colors: ColorStop[];
}

export interface ExtractOptions {
  /** Palette size, 2..256. Default 8. */
  colors?: number;
  /** Visible pixels have `alpha >= 1`; this default ignores only fully transparent pixels. */
  alphaThreshold?: number;
  /** Uniformly sample down to at most this many pixels. Default 65536. */
  maxPixels?: number;
}

export interface QuantizedImage {
  data: Uint8Array;
  width: number;
  height: number;
  layout: "rgba8";
  palette: Palette;
}
