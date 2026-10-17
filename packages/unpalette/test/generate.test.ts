import { describe, expect, it } from "vite-plus/test";

import { extractPaletteVariants, generatePalette } from "../src";
import { hslToRgb, rgbToHsl } from "../src/color";

describe("generatePalette", () => {
  it("generates a complementary pair from a base color", () => {
    const { colors } = generatePalette({ r: 255, g: 0, b: 0 }, "complementary");
    expect(colors).toHaveLength(2);
    expect(colors[0]?.hex).toBe("#ff0000");
    const second = rgbToHsl(colors[1]!.color);
    expect(second.h).toBeCloseTo(180, 0);
  });

  it("keeps saturation across hue-shifted schemes", () => {
    const base = { r: 64, g: 96, b: 255 };
    const baseHsl = rgbToHsl(base);
    for (const scheme of ["analogous", "triadic", "splitComplementary"] as const) {
      const { colors } = generatePalette(base, scheme);
      for (const entry of colors) {
        expect(rgbToHsl(entry.color).s).toBeCloseTo(baseHsl.s, 5);
      }
    }
  });

  it("walks a lightness scale for monochromatic", () => {
    const { colors } = generatePalette("#3366cc", "monochromatic");
    expect(colors).toHaveLength(5);
    const lightnesses = colors.map((entry) => rgbToHsl(entry.color).l);
    expect([...lightnesses].sort((a, b) => a - b)).toEqual(lightnesses);
  });

  it("accepts hex input and rejects malformed colors", () => {
    expect(generatePalette("#ff0000").colors).toHaveLength(2);
    expect(generatePalette("red").colors).toHaveLength(2);
  });
});

describe("extractPaletteVariants", () => {
  function pixelsWith(swatches: Array<{ rgb: [number, number, number]; count: number }>): {
    data: Uint8Array;
    width: number;
    height: number;
  } {
    const total = swatches.reduce((sum, swatch) => sum + swatch.count, 0);
    const data = new Uint8Array(total * 4);
    let index = 0;
    for (const { rgb, count } of swatches) {
      for (let n = 0; n < count; n += 1) {
        data[index * 4] = rgb[0];
        data[index * 4 + 1] = rgb[1];
        data[index * 4 + 2] = rgb[2];
        data[index * 4 + 3] = 255;
        index += 1;
      }
    }
    return { data, width: total, height: 1 };
  }

  it("separates vivid, muted, dark, and light swatches", () => {
    const variants = extractPaletteVariants(
      pixelsWith([
        { rgb: [230, 60, 60], count: 4 }, // vibrant
        { rgb: [140, 140, 150], count: 4 }, // muted
        { rgb: [20, 24, 30], count: 4 }, // dark
        { rgb: [240, 240, 250], count: 4 }, // light
      ]),
      { variantColors: 2 },
    );

    expect(variants.vibrant?.colors[0]?.hex).toBe("#e63c3c");
    expect(variants.muted?.colors[0]?.hex).toBe("#8c8c96");
    expect(variants.dark?.colors).toHaveLength(1);
    expect(variants.light?.colors).toHaveLength(1);
  });

  it("reports missing variants as undefined", () => {
    const variants = extractPaletteVariants(pixelsWith([{ rgb: [230, 60, 60], count: 4 }]));
    expect(variants.vibrant).toBeDefined();
    expect(variants.dark).toBeUndefined();
    expect(variants.light).toBeUndefined();
  });
});

describe("color conversions", () => {
  it("round-trips through HSL", () => {
    for (const rgb of [
      { r: 230, g: 60, b: 60 },
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 10, g: 132, b: 255 },
    ]) {
      expect(hslToRgb(rgbToHsl(rgb))).toEqual(rgb);
    }
  });
});
