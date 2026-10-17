import { describe, expect, it } from "vite-plus/test";

import {
  analyzePaletteContrast,
  oklabToRgb,
  bestReadableColor,
  compositeColors,
  contrastRatio,
  flattenAlpha,
  inGamut,
  oklchToRgb,
  readableTextColor,
  toGamut,
  toGamutOklch,
} from "../src";

describe("alpha compositing", () => {
  it("composites source over an opaque backdrop", () => {
    expect(compositeColors("rgba(255, 0, 0, 0.5)", "#ffffff")).toEqual({
      r: 255,
      g: 128,
      b: 128,
      a: 1,
    });
    expect(compositeColors("rgba(0, 0, 0, 0)", "#000000")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(compositeColors("#ff0000", "rgba(0, 0, 255, 0)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(compositeColors("rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)")).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });

  it("flattens translucency without discarding alpha", () => {
    expect(flattenAlpha("rgba(255, 0, 0, 0.5)", "#000000")).toEqual({
      r: 128,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(flattenAlpha("#3366cc")).toEqual({ r: 51, g: 102, b: 204, a: 1 });
  });

  it("uses rendered colors for WCAG contrast", () => {
    expect(contrastRatio("rgba(0, 0, 0, 0)", "#000000")).toBeCloseTo(1, 5);
    expect(readableTextColor("rgba(0, 0, 0, 0.5)", { backdrop: "#ffffff" })).toEqual({
      r: 17,
      g: 17,
      b: 17,
    });
    expect(bestReadableColor("#ffffff", ["rgba(255, 255, 255, 0)", "#000000"])).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(analyzePaletteContrast(["rgba(0, 0, 0, 0)"], "#000000")[0]?.ratio).toBeCloseTo(1, 5);
  });
});

describe("RGB gamut mapping", () => {
  const outOfGamut = { l: 0.8, c: 0.4, h: 0 };

  it("distinguishes in-gamut and out-of-gamut Oklch", () => {
    expect(inGamut("#ff0000")).toBe(true);
    expect(inGamut({ l: 0.7, c: 0.1, h: 180 })).toBe(true);
    expect(inGamut(outOfGamut)).toBe(false);
  });

  it("maps out-of-gamut Oklch while preserving lightness and hue", () => {
    const mapped = toGamutOklch(outOfGamut);
    expect(mapped.c).toBeLessThan(outOfGamut.c);
    expect(mapped.l).toBeCloseTo(outOfGamut.l, 5);
    expect(mapped.h).toBeCloseTo(outOfGamut.h, 5);
    expect(inGamut(mapped)).toBe(true);

    const rgb = toGamut(outOfGamut);
    expect(inGamut(rgb)).toBe(true);
    expect(toGamut(outOfGamut, { method: "clip" })).not.toEqual(rgb);
    expect(oklchToRgb(outOfGamut)).toEqual(rgb);
    expect(toGamut("#3366cc")).toEqual({ r: 51, g: 102, b: 204 });
  });

  it("maps out-of-gamut Oklab without returning NaN channels", () => {
    const mapped = oklabToRgb({ L: 1, a: 0.5, b: 0 }, { method: "chroma" });
    expect([mapped.r, mapped.g, mapped.b]).toEqual(
      [mapped.r, mapped.g, mapped.b].map((channel) => Math.round(channel)),
    );
    expect(mapped.r).toBeLessThanOrEqual(255);
    expect(mapped.g).toBeGreaterThanOrEqual(0);
    expect(mapped.b).toBeGreaterThanOrEqual(0);
  });
});
