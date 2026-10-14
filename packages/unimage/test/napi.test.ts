import { describe, expect, it } from "vite-plus/test";

import { napiDriver } from "../src/drivers/napi";
import type { ImageRecipe, RawImageData } from "../src/types";

const raw: RawImageData = {
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  width: 2,
  height: 1,
  layout: "rgba8",
};

const driver = napiDriver();

function recipe(
  operations: ImageRecipe["operations"],
  format: ImageRecipe["output"]["format"] = "png",
): ImageRecipe {
  return { operations, output: { format } };
}

describe("napiDriver", () => {
  it("reads metadata from raw pixels and encoded images", async () => {
    await expect(driver.metadata(raw)).resolves.toMatchObject({
      width: 2,
      height: 1,
      hasAlpha: true,
    });

    const png = await driver.transform(raw, recipe([]));
    await expect(driver.metadata(png.data)).resolves.toMatchObject({
      width: 2,
      height: 1,
      format: "png",
    });
  });

  it("encodes and resizes raw pixels", async () => {
    const result = await driver.transform(
      raw,
      recipe([{ type: "resize", width: 1, height: 1, fit: "fill" }]),
    );

    expect(result.metadata.width).toBe(1);
    expect(result.metadata.height).toBe(1);
    expect(Array.from(result.data.subarray(1, 4))).toEqual([80, 78, 71]);

    const heightOnly = await driver.transform(raw, recipe([{ type: "resize", height: 2 }]));
    expect(heightOnly.metadata).toMatchObject({ width: 4, height: 2 });
  });

  it("applies a pixel operation without changing dimensions", async () => {
    const result = await driver.transform(raw, recipe([{ type: "grayscale" }]));

    expect(result.metadata.width).toBe(2);
    expect(result.metadata.height).toBe(1);
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  it("applies pixel filters and canvas extension", async () => {
    const sharpened = await driver.transform(raw, recipe([{ type: "sharpen", sigma: 1 }]));
    expect(sharpened.data.byteLength).toBeGreaterThan(0);

    const modulated = await driver.transform(
      raw,
      recipe([{ type: "modulate", brightness: 1.2, saturation: 1.1, hue: 30, lightness: 5 }]),
    );
    expect(modulated.data.byteLength).toBeGreaterThan(0);

    const extended = await driver.transform(
      raw,
      recipe([{ type: "extend", top: 1, right: 1, bottom: 1, left: 1, background: "#ff0000" }]),
    );
    expect(extended.metadata).toMatchObject({ width: 4, height: 3 });
  });
  it("rejects metadata preservation and arbitrary rotations", async () => {
    await expect(
      driver.transform(raw, {
        operations: [],
        output: { format: "png", metadataPolicy: "preserve" },
      }),
    ).rejects.toMatchObject({ code: "UNIMAGE_UNSUPPORTED_OPERATION" });
    await expect(
      driver.transform(raw, recipe([{ type: "rotate", angle: 45 }])),
    ).rejects.toMatchObject({
      code: "UNIMAGE_UNSUPPORTED_OPERATION",
      operation: "rotate",
    });
  });

  it("rejects formats that the napi encoder does not support", async () => {
    await expect(driver.transform(raw, recipe([], "tiff"))).rejects.toMatchObject({
      code: "UNIMAGE_UNSUPPORTED_FORMAT",
      format: "tiff",
    });
  });

  it("rasterizes SVG input and parses SVG metadata without rasterizing", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="red"/></svg>`;
    const bytes = new TextEncoder().encode(svg);

    await expect(driver.metadata(bytes)).resolves.toMatchObject({
      format: "svg",
      width: 8,
      height: 4,
      hasAlpha: true,
    });

    const rasterized = await driver.transform(bytes, recipe([], "png"));
    expect(rasterized.format).toBe("png");
    expect(rasterized.metadata).toMatchObject({ width: 8, height: 4 });

    const resized = await driver.transform(
      bytes,
      recipe([{ type: "resize", width: 4, height: 2, fit: "fill" }], "png"),
    );
    expect(resized.metadata).toMatchObject({ width: 4, height: 2 });
  });
});
