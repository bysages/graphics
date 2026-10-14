export interface RGB {
  r: number;
  g: number;
  b: number;
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

export interface ExtractOptions {
  /** Palette size, 2..256. Default 8. */
  colors?: number;
  /** Pixels with alpha below this value are excluded from statistics. Default 255. */
  alphaThreshold?: number;
  /** Uniformly sample down to at most this many pixels. Default 65536. */
  maxPixels?: number;
}

export interface QuantizedImage {
  data: Uint8Array;
  width: number;
  height: number;
  palette: Palette;
}
