import { describe, expect, it } from "vite-plus/test";

import {
  extractPalette,
  generateColorScale,
  generateShades,
  generateTints,
  hslToRgb,
  parseColor,
  parseRgba,
  quantize,
  rotateHue,
} from "../src";

describe("color API contracts", () => {
  it("parses CSS alpha percentages without producing NaN", () => {
    expect(parseRgba("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseRgba("hsl(120 50% 25% / 25%)").a).toBe(0.25);
  });

  it("parses common CSS named colors and transparent", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseColor("Violet")).toEqual({ r: 238, g: 130, b: 238 });
    expect(parseRgba("rgb(255 0 0 / 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it("rejects unsupported colors with a deterministic range error", () => {
    expect(() => parseColor("nope")).toThrow(RangeError);
    expect(() => parseRgba("nope")).toThrow(RangeError);
  });

  it("normalizes HSL hues and keeps RGB output in gamut", () => {
    expect(hslToRgb({ h: -240, s: 1, l: 0.5 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(rotateHue("#3366cc", -1000)).toEqual(rotateHue("#3366cc", -280));
    expect(rotateHue("#3366cc", -1000)).toMatchObject({
      r: expect.any(Number),
      g: expect.any(Number),
      b: expect.any(Number),
    });
  });

  it("validates pixel and extraction options", () => {
    const input = { data: new Uint8Array(8), width: 1, height: 2 };
    expect(() => extractPalette(input, { maxPixels: 0 })).toThrow(RangeError);
    expect(() => extractPalette(input, { alphaThreshold: 256 })).toThrow(RangeError);
    expect(() => generateShades("#3366cc", 1)).toThrow(RangeError);
  });

  it("separates generated sequences from sampled palette statistics", () => {
    const scale = generateColorScale("#3366cc");
    expect(scale.colors).toHaveLength(9);
    expect("sampled" in scale).toBe(false);
    expect(scale.colors[0]?.hex).toBe("#ffffff");
    expect(scale.colors[8]?.hex).toBe("#000000");

    const shades = generateShades("#3366cc", 5);
    expect(shades.colors[0]?.hex).toBe("#3366cc");
    expect(shades.colors[4]?.hex).toBe("#000000");
    const tints = generateTints("#3366cc", 5);
    expect(tints.colors[0]?.hex).toBe("#3366cc");
    expect(tints.colors[4]?.hex).toBe("#ffffff");
  });

  it("keeps quantized output compatible with unimage raw input", () => {
    const data = new Uint8Array(2 * 1 * 4);
    data.set([255, 0, 0, 254]);
    data.set([0, 0, 255, 254], 4);
    const result = quantize({ data, width: 2, height: 1 }, { colors: 2 });
    expect(result.layout).toBe("rgba8");
    expect(result.palette.sampled).toBe(2);
  });

  it("includes near-opaque pixels by default", () => {
    const data = new Uint8Array(1 * 1 * 4);
    data.set([255, 0, 0, 254]);
    const palette = extractPalette({ data, width: 1, height: 1 });
    expect(palette.sampled).toBe(1);
  });
});
