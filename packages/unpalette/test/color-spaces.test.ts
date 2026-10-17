import { describe, expect, it } from "vite-plus/test";

import {
  formatColor,
  simulateColorVision,
  linearToRgb,
  mixColors,
  oklchToRgb,
  parseColor,
  parseRgba,
  rgbToLinear,
  rgbToOklab,
  rgbToOklch,
} from "../src";

describe("modern color spaces", () => {
  it("converts sRGB through linear, Oklab, and Oklch", () => {
    const oklab = rgbToOklab({ r: 255, g: 0, b: 0 });
    expect(oklab.L).toBeCloseTo(0.627955, 5);
    expect(oklab.a).toBeCloseTo(0.224863, 5);
    expect(oklab.b).toBeCloseTo(0.125846, 5);
    const oklch = rgbToOklch({ r: 255, g: 0, b: 0 });
    expect(oklch.l).toBeCloseTo(0.627955, 5);
    expect(oklch.c).toBeCloseTo(0.257683, 5);
    expect(oklch.h).toBeCloseTo(29.2338, 3);
    expect(linearToRgb(rgbToLinear({ r: 37, g: 88, b: 201 }))).toEqual({
      r: 37,
      g: 88,
      b: 201,
    });
    expect(oklchToRgb(rgbToOklch({ r: 37, g: 88, b: 201 }))).toEqual({
      r: 37,
      g: 88,
      b: 201,
    });
  });

  it("parses and formats modern CSS colors", () => {
    expect(parseColor("oklch(0.628 0.258 29.23)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseRgba("oklch(0.7 0.1 180 / 50%)").a).toBe(0.5);
    expect(formatColor("#ff0000", "oklch")).toBe("oklch(0.628 0.2577 29.23)");
  });

  it("interpolates through perceptual color spaces", () => {
    const black = "#000000";
    const white = "#ffffff";
    const midpoint = mixColors(black, white, { amount: 0.5, space: "oklab" });
    expect(midpoint.r).toBeGreaterThan(90);
    expect(midpoint.r).toBeLessThan(110);
    expect(midpoint.r).toBe(midpoint.g);
    expect(midpoint.g).toBe(midpoint.b);
    expect(mixColors(black, white, { amount: 0.5, space: "oklch" }).r).toBe(midpoint.r);
    expect(mixColors(black, white, { amount: 0.5, space: "linear-srgb" })).toMatchObject({
      a: 1,
    });
  });

  describe("color-vision severity", () => {
    it("supports partial dichromacy in linear light", () => {
      const original = { r: 255, g: 64, b: 64 };
      expect(simulateColorVision(original, "protanopia", { severity: 0 })).toEqual(original);
      const mild = simulateColorVision(original, "protanopia", { severity: 0.5 });
      const full = simulateColorVision(original, "protanopia");
      expect(mild.r).toBeGreaterThan(full.r);
      expect(mild).not.toEqual(original);
      expect(mild).not.toEqual(full);
      expect(simulateColorVision(original, "achromatopsia").r).toBe(
        simulateColorVision(original, "achromatopsia").g,
      );
      expect(() => simulateColorVision(original, "protanopia", { severity: 1.1 })).toThrow(
        RangeError,
      );
    });
  });

  it("normalizes negative Oklch hue", () => {
    const oklch = rgbToOklch({ r: 37, g: 88, b: 201 });
    expect(oklch.h).toBeGreaterThanOrEqual(0);
    expect(oklch.h).toBeLessThan(360);
    expect(formatColor({ r: 37, g: 88, b: 201 }, "oklch")).not.toContain(" -9");
  });
});
