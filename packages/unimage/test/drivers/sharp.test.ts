import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vite-plus/test";

import { sharpDriver } from "../../src/drivers/sharp";
import type { ImageFormat, ImageRecipe, RawImageData } from "../../src/types";

const driver = sharpDriver();

function recipe(
  operations: ImageRecipe["operations"],
  format: ImageFormat = "png",
  animated?: boolean,
): ImageRecipe {
  return {
    ...(animated ? { input: { frames: "all" as const } } : {}),
    operations,
    output: { format, metadataPolicy: "strip" },
  };
}

async function animatedGif(): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(new URL("../fixtures/animated.gif", import.meta.url)));
}

describe("sharpDriver", () => {
  it("reports full raster capabilities including gif", async () => {
    const capabilities = await driver.capabilities();
    expect(capabilities.formats.gif?.encode?.animation).toBe(true);
    expect(capabilities.formats.gif?.decode?.frames).toContain("animated");
    expect(capabilities.operations.clahe?.supported).toBe(true);
    expect(capabilities.operations.resize?.supported).toBe(true);
  });

  it("reads metadata including pages", async () => {
    const gif = await animatedGif();
    const meta = await driver.metadata(gif);
    expect(meta.format).toBe("gif");
    expect(meta.width).toBe(160);
    expect(meta.height).toBe(72);
    expect(meta.pages).toBe(20);
  });

  it("resizes and keeps animation when output is animated", async () => {
    const gif = await animatedGif();
    const result = await driver.transform(
      gif,
      recipe([{ type: "resize", width: 80, height: 36 }], "gif", true),
    );
    expect(result.metadata).toMatchObject({ width: 80, height: 36, pages: 20 });
  });

  it("decodes raw pixels without encoding an image", async () => {
    const gif = await animatedGif();
    if (driver.decode === undefined) throw new Error("sharpDriver.decode is required");
    const decoded = await driver.decode(gif, {});
    expect(decoded.layout).toBe("rgba8");
    expect(decoded.width).toBe(160);
    expect(decoded.height).toBe(72);
    expect(decoded.metadata.width).toBe(160);
  });

  it("extracts the first frame for still output", async () => {
    const gif = await animatedGif();
    const result = await driver.transform(
      gif,
      recipe([{ type: "resize", width: 4, height: 4 }], "png"),
    );
    expect(result.metadata).toMatchObject({ width: 4, height: 4 });
    expect(result.metadata.pages).toBeUndefined();
  });

  it("rejects sharp work when the caller has already aborted", async () => {
    const signal = AbortSignal.abort();
    await expect(
      driver.metadata(
        {
          data: new Uint8Array(8 * 8 * 4).fill(120),
          width: 8,
          height: 8,
          layout: "rgba8",
        },
        { signal },
      ),
    ).rejects.toMatchObject({ code: "UNIMAGE_ABORT" });
    await expect(
      driver.transform(
        { data: new Uint8Array(8 * 8 * 4).fill(120), width: 8, height: 8, layout: "rgba8" },
        { operations: [], output: { format: "png" } },
        { signal },
      ),
    ).rejects.toMatchObject({ code: "UNIMAGE_ABORT" });
    await expect(
      driver.decode!(
        { data: new Uint8Array(8 * 8 * 4).fill(120), width: 8, height: 8, layout: "rgba8" },
        { signal },
      ),
    ).rejects.toMatchObject({ code: "UNIMAGE_ABORT" });
  });

  it("reports HEVC-dependent HEIF and HEIC encoding accurately", async () => {
    const capabilities = await driver.capabilities();
    const supported = (capabilities.formats.heic?.encode?.compressionModes.length ?? 0) > 0;
    expect(Boolean(capabilities.formats.heif?.encode?.compressionModes.length)).toBe(supported);
    if (!supported) {
      expect(capabilities.notes?.join(" ")).toContain("no HEVC encoder");
      await expect(
        driver.checkRecipe({
          input: { format: "heic", frames: "first" },
          operations: [],
          output: { format: "heic" },
        }),
      ).resolves.toMatchObject({ supported: false });
    }
  });

  it("uses native entropy and attention strategies", async () => {
    const png = Buffer.from(new Uint8Array(32 * 32 * 4).fill(200));
    const input = {
      data: png,
      width: 32,
      height: 32,
      layout: "rgba8",
    } as RawImageData;
    const entropy = await driver.transform(
      input,
      recipe([{ type: "resize", width: 16, height: 32, fit: "cover", position: "entropy" }]),
    );
    const attention = await driver.transform(
      input,
      recipe([{ type: "resize", width: 16, height: 32, fit: "cover", position: "attention" }]),
    );
    expect(entropy.metadata).toMatchObject({ width: 16, height: 32 });
    expect(attention.metadata).toMatchObject({ width: 16, height: 32 });
  });

  it("extends with native mirror mode", async () => {
    const input = {
      data: new Uint8Array(8 * 8 * 4).fill(90),
      width: 8,
      height: 8,
      layout: "rgba8",
    } as RawImageData;
    const result = await driver.transform(
      input,
      recipe([{ type: "extend", top: 2, right: 2, bottom: 2, left: 2, extendWith: "mirror" }]),
    );
    expect(result.metadata).toMatchObject({ width: 12, height: 12 });
  });

  it("rasterizes svg input through librsvg", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>`;
    const result = await driver.transform(new TextEncoder().encode(svg), recipe([], "png"));
    expect(result.metadata).toMatchObject({ width: 16, height: 16, format: "png" });
  });

  it("exposes animation timing metadata", async () => {
    const gif = await readFile(new URL("../fixtures/animated.gif", import.meta.url));
    const sequence = await driver.decodeFrames!(new Uint8Array(gif), {});
    expect(sequence.loop).toBe(0);
    expect(sequence.frames).toHaveLength(20);
    expect(sequence.frames[0]?.durationMs).toBe(250);
  });

  it("preserves TIFF pages with frames all", async () => {
    const input = new Uint8Array(
      await readFile(new URL("../fixtures/pages.tiff", import.meta.url)),
    );
    await expect(driver.metadata(input)).resolves.toMatchObject({ pages: 2 });
    await expect(
      driver.checkRecipe({
        input: { format: "tiff", frames: "all" },
        operations: [],
        output: { format: "tiff" },
      }),
    ).resolves.toMatchObject({ supported: true });
    const result = await driver.transform(input, {
      input: { frames: "all" },
      operations: [],
      output: { format: "tiff" },
    });
    expect(result.metadata.pages).toBe(2);
    await expect(
      driver.checkRecipe({
        input: { format: "tiff", frames: "all" },
        operations: [],
        output: { format: "jpeg" },
      }),
    ).resolves.toMatchObject({ supported: false });
  });

  it("applies clahe through the fallback pipeline", async () => {
    const input = {
      data: new Uint8Array(16 * 16 * 4).fill(128),
      width: 16,
      height: 16,
      layout: "rgba8",
    } as RawImageData;
    const result = await driver.transform(
      input,
      recipe([{ type: "clahe", width: 4, height: 4, maxSlope: 3 }]),
    );
    expect(result.metadata).toMatchObject({ width: 16, height: 16 });
  });

  it("keeps multi-frame output for webp when the animated flag is set", async () => {
    const gif = await animatedGif();
    const result = await driver.transform(
      gif,
      recipe([{ type: "resize", width: 80, height: 36 }], "webp", true),
    );
    expect(result.metadata.pages).toBeGreaterThan(1);
  });

  it("encodes tiff output", async () => {
    const input = {
      data: new Uint8Array(8 * 8 * 4).fill(10),
      width: 8,
      height: 8,
      layout: "rgba8",
    } as RawImageData;
    const result = await driver.transform(input, recipe([], "tiff"));
    expect(result.format).toBe("tiff");
    expect(result.mediaType).toBe("image/tiff");
    expect(result.metadata.format).toBe("tiff");
  });
});
