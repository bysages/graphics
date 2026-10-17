import { describe, expect, it } from "vite-plus/test";

import {
  bestReadableColor,
  generateShades,
  generateTints,
  quantize,
  contrastRatio,
  darken,
  formatColor,
  generateColorScale,
  generateGradient,
  lighten,
  meetsContrast,
  mixColors,
  parseColor,
  parseRgba,
  readableTextColor,
  relativeLuminance,
  rotateHue,
  simulateColorVision,
} from "../src";

describe("extended color parsing", () => {
  it("parses expanded CSS and hex forms", () => {
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseColor("rgb(10 20 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor("hsl(120 50% 25%)")).toEqual({ r: 32, g: 96, b: 32 });
    expect(parseRgba("#abcd").a).toBeCloseTo(0.867, 3);
    expect(formatColor("#ff0000", "hsl")).toBe("hsl(0, 100%, 50%)");
  });

  it("rejects malformed colors", () => {
    expect(() => parseColor("nope")).toThrow(RangeError);
    expect(() => parseRgba("rgb(1, 2)")).toThrow(RangeError);
  });
});

describe("color transformation", () => {
  it("mixes colors in RGB and HSL spaces", () => {
    expect(mixColors("#000000", "#ffffff", { amount: 0.5 })).toEqual({
      r: 128,
      g: 128,
      b: 128,
      a: 1,
    });
    const hsl = mixColors("#ff0000", "#0000ff", { amount: 0.5, space: "hsl" });
    expect(hsl).toMatchObject({ r: 255, g: 0, b: 255 });
  });

  it("adjusts lightness, saturation, and hue", () => {
    expect(lighten("#000000", 0.5).g).toBeGreaterThan(100);
    expect(darken("#ffffff", 0.5).g).toBeLessThan(200);
    expect(rotateHue("#ff0000", 120).g).toBeGreaterThan(200);
  });
});

describe("accessibility utilities", () => {
  it("computes WCAG contrast and readable text", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(meetsContrast("#ffffff", "#000000", 4.5)).toBe(true);
    expect(readableTextColor("#000000")).toEqual({ r: 255, g: 255, b: 255 });
    expect(bestReadableColor("#ffffff", ["#ffffff", "#000000"])).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
  });
});

it("generates perceptual scales and caches palette matching", () => {
  const oklchScale = generateColorScale("#3366cc", {
    steps: 5,
    space: "oklch",
  });
  expect(oklchScale.colors).toHaveLength(5);
  expect(oklchScale.colors[2]?.hex).toBe("#3366cc");
  expect(generateShades("#3366cc", 3, "oklch").colors).toHaveLength(3);
  expect(generateTints("#3366cc", 3, "oklch").colors).toHaveLength(3);

  const input = {
    data: new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]),
    width: 2,
    height: 1,
  };
  const quantized = quantize(input, { colors: 2 });
  expect(Array.from(quantized.data.slice(0, 3))).toEqual([0, 0, 0]);
});

describe("palette utilities", () => {
  it("generates scales and gradients", () => {
    const scale = generateColorScale("#3366cc", { steps: 5 });
    expect(scale.colors).toHaveLength(5);
    expect(scale.colors[2]?.hex).toBe("#3366cc");
    const gradient = generateGradient(["#000000", "#ffffff"], { steps: 3 });
    expect(gradient[1]).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });
});

describe("color-vision simulation", () => {
  it("simulates achromatopsia with equal channels", () => {
    const color = simulateColorVision("#ff0000", "achromatopsia");
    expect(color.r).toBe(color.g);
    expect(color.g).toBe(color.b);
  });
});
