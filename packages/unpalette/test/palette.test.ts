import { describe, expect, it } from "vite-plus/test";

import { applyPalette, extractPalette, quantize, toHex } from "../src";
import type { PixelInput } from "../src";
import { nearest } from "../src/color";

function solidPixels(width: number, height: number, rgb: [number, number, number]): PixelInput {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = rgb[0];
    data[index * 4 + 1] = rgb[1];
    data[index * 4 + 2] = rgb[2];
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe("extractPalette", () => {
  it("extracts dominant colors with ratios, sorted descending", () => {
    const data = new Uint8Array(8 * 4);
    // 6 red pixels, 2 blue pixels.
    for (let index = 0; index < 8; index += 1) {
      const [r, g, b] = index < 6 ? ([200, 0, 0] as const) : ([0, 0, 200] as const);
      data[index * 4] = r;
      data[index * 4 + 1] = g;
      data[index * 4 + 2] = b;
      data[index * 4 + 3] = 255;
    }
    const palette = extractPalette({ data, width: 8, height: 1 }, { colors: 2 });

    expect(palette.sampled).toBe(8);
    expect(palette.colors).toHaveLength(2);
    expect(palette.colors[0]?.hex).toBe("#c80000");
    expect(palette.colors[0]?.ratio).toBeCloseTo(0.75);
    expect(palette.colors[1]?.hex).toBe("#0000c8");
    expect(palette.colors[0]!.ratio).toBeGreaterThanOrEqual(palette.colors[1]!.ratio);
  });

  it("skips pixels below the alpha threshold", () => {
    const data = new Uint8Array(4 * 4);
    // 3 opaque red pixels, 1 fully transparent black pixel.
    for (let index = 0; index < 3; index += 1) {
      data[index * 4] = 255;
      data[index * 4 + 3] = 255;
    }
    const palette = extractPalette({ data, width: 4, height: 1 });
    expect(palette.sampled).toBe(3);
    expect(palette.colors).toHaveLength(1);
  });

  it("rejects invalid palette sizes and fully transparent input", () => {
    const input = solidPixels(2, 2, [0, 0, 0]);
    expect(() => extractPalette(input, { colors: 1 })).toThrow(RangeError);
    expect(() => extractPalette({ data: new Uint8Array(16), width: 2, height: 2 })).toThrow(
      RangeError,
    );
  });
});

describe("quantize and applyPalette", () => {
  it("remaps pixels onto the extracted palette and preserves alpha", () => {
    const input = solidPixels(4, 1, [128, 128, 128]);
    // Add one transparent pixel.
    input.data[12] = 10;
    input.data[13] = 20;
    input.data[14] = 30;
    input.data[15] = 0;

    const result = quantize(input, { colors: 2 });
    expect(result.data).toHaveLength(16);
    expect(result.palette.colors.length).toBeGreaterThan(0);
    // Opaque pixels are remapped; the transparent pixel keeps its RGBA.
    expect(result.data[15]).toBe(0);
    expect(result.data[12]).toBe(10);
  });

  it("remaps onto a fixed brand palette", () => {
    const result = applyPalette(solidPixels(2, 1, [250, 250, 250]), [
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
    ]);
    expect(result.data[0]).toBe(255);
    expect(result.data[1]).toBe(255);
    expect(result.data[2]).toBe(255);
    expect(toHex(result.palette.colors[0]!.color)).toBe("#ffffff");
  });

  it("finds the closest palette index", () => {
    expect(
      nearest({ r: 240, g: 240, b: 240 }, [
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 },
      ]),
    ).toBe(1);
  });
});
