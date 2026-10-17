import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import { napiDriver } from "../../src/drivers/napi";
import type { ImageRecipe, RawImageData } from "../../src/types";

const raw: RawImageData = {
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  width: 2,
  height: 1,
  layout: "rgba8",
};

const driver = napiDriver({ napiImport: () => import("@napi-rs/image") });

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

  it("normalizes non-RGBA source pixels for decode and fallback", async () => {
    const jpeg = await sharp({
      create: { width: 2, height: 1, channels: 3, background: { r: 20, g: 60, b: 120 } },
    })
      .jpeg()
      .toBuffer();
    const decoded = await driver.decode!(new Uint8Array(jpeg), {});
    expect(decoded.layout).toBe("rgba8");
    expect(decoded.data).toHaveLength(2 * 1 * 4);

    const result = await driver.transform(new Uint8Array(jpeg), {
      operations: [{ type: "ensureAlpha" }, { type: "tint", color: "#ff0000" }],
      output: { format: "png" },
    });
    expect(result.format).toBe("png");
    expect(result.metadata).toMatchObject({ width: 2, height: 1 });
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

  it("materializes napi composite before subsequent geometry operations", async () => {
    const source = await sharp({
      create: { width: 8, height: 4, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    const layer: RawImageData = {
      data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
      width: 2,
      height: 2,
      layout: "rgba8",
    };
    const result = await driver.transform(
      source,
      recipe([
        { type: "composite", layer: "red", position: "center" },
        { type: "resize", width: 4, height: 2, kernel: "nearest" },
      ]),
      { layers: { red: layer } },
    );
    if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");

    const { data, info } = await sharp(result.data)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(4);
    expect(info.height).toBe(2);
    let redPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index] as number) === 255 && (data[index + 2] as number) === 0) redPixels += 1;
    }
    expect(redPixels).toBe(1);
  });
  it("uses one capability source for formats and recipe checks", async () => {
    const capabilities = await driver.capabilities();
    for (const format of Object.keys(capabilities.formats) as Array<
      keyof typeof capabilities.formats
    >) {
      const capability = capabilities.formats[format];
      if (format === "svg" || capability?.encode?.compressionModes.length === 0) continue;
      await expect(
        driver.checkRecipe({
          input: { frames: "first" },
          operations: [],
          output: { format },
        }),
      ).resolves.toMatchObject({ supported: true });
    }
  });

  it("reports HEIF as decodable but not napi-encodable", async () => {
    const capabilities = await driver.capabilities();
    expect(capabilities.formats.heif?.decode?.pixelFormats).toContain("rgba8");
    expect(capabilities.formats.heif?.encode?.compressionModes).toHaveLength(0);
    await expect(
      driver.checkRecipe({
        input: { format: "heif", frames: "first" },
        operations: [],
        output: { format: "heif" },
      }),
    ).resolves.toMatchObject({ supported: false });
    await expect(driver.transform(raw, recipe([], "heif"))).rejects.toMatchObject({
      code: "UNIMAGE_UNSUPPORTED_FORMAT",
      format: "heif",
    });
  });

  it("encodes HEIC when the platform codec is available", async () => {
    const capabilities = await driver.capabilities();
    const supported = (capabilities.formats.heic?.encode?.compressionModes.length ?? 0) > 0;
    if (!supported) {
      await expect(driver.transform(raw, recipe([], "heic"))).rejects.toMatchObject({
        format: "heic",
      });
      return;
    }
    const result = await driver.transform(raw, recipe([], "heic"));
    expect(result.format).toBe("heic");
    expect(result.mediaType).toBe("image/heic");
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

  it("encodes additional native formats", async () => {
    const tiff = await driver.transform(raw, recipe([], "tiff"));
    expect(tiff.format).toBe("tiff");
    expect(tiff.mediaType).toBe("image/tiff");

    const bmp = await driver.transform(raw, recipe([], "bmp"));
    expect(bmp.format).toBe("bmp");

    const ico = await driver.transform(raw, recipe([], "ico"));
    expect(ico.format).toBe("ico");

    await expect(driver.transform(raw, recipe([], "jxl"))).rejects.toMatchObject({
      code: "UNIMAGE_UNSUPPORTED_FORMAT",
      format: "jxl",
    });
  });

  it("reports metadata formats for expanded native encoders", async () => {
    for (const format of ["tiff", "bmp", "ico", "pnm"] as const) {
      const encoded = await driver.transform(raw, recipe([], format));
      await expect(driver.metadata(encoded.data)).resolves.toMatchObject({ format });
    }
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
