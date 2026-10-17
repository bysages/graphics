import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import { canvasDriver } from "../../src/drivers/canvas";
import { overlayDriver } from "../../src/drivers/overlay";
import { sharpDriver } from "../../src/drivers/sharp";
import { svgoDriver } from "../../src/drivers/svgo";
import { parseImageRecipe } from "../../src/recipe";
import { httpDriver } from "../../src/storage/http";
import { sniffImageFormat } from "../../src/utils/format";

const doctypeSvg = `<?xml version="1.0"?><!-- generated --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><script>alert(1)</script><rect width="8" height="4" fill="red"/></svg>`;
import { applyPixelFilter, parseColor } from "../../src/utils/filters";

function image(width: number, height: number, fill: readonly [number, number, number, number]) {
  return {
    width,
    height,
    data: new Uint8Array(
      Array.from({ length: width * height * 4 }, (_, index) => fill[index % 4]!),
    ),
  };
}
import type { ImageCapabilities, ImageDriver } from "../../src/types";

function failingDriver(): ImageDriver {
  return {
    name: "failing",
    capabilities: async (): Promise<ImageCapabilities> => ({
      driver: "failing",
      formats: {
        png: {
          decode: {
            pixelFormats: ["rgba8"],
            frames: ["still"],
            orientation: false,
            rasterDensity: false,
            vector: false,
          },
          encode: {
            compressionModes: ["lossless"],
            quality: false,
            animation: false,
            metadataPolicies: ["strip"],
            sanitize: false,
          },
        },
      },
      metadataRead: true,
      operations: {},
    }),
    checkRecipe: async () => ({
      supported: true,
      driver: "failing",
      missing: [],
      capabilities: { driver: "failing", formats: {}, metadataRead: true, operations: {} },
    }),
    metadata: async () => ({ width: 1, height: 1 }),
    transform: async () => {
      throw new Error("native dependency is unavailable");
    },
  };
}

function succeedingDriver(): ImageDriver {
  const driver = failingDriver();
  return {
    ...driver,
    name: "succeeding",
    transform: async (_input, recipe) => ({
      kind: "encoded",
      data: new Uint8Array([2]),
      format: recipe.output.format,
      mediaType: `image/${recipe.output.format}`,
      metadata: { width: 1, height: 1 },
    }),
  };
}

describe("public API stability", () => {
  it("parses every declared format and resize fit", () => {
    const formats = [
      "png",
      "jpeg",
      "webp",
      "avif",
      "gif",
      "svg",
      "tiff",
      "heif",
      "heic",
      "bmp",
      "ico",
      "jxl",
      "pnm",
      "tga",
    ] as const;
    for (const format of formats) {
      expect(() => parseImageRecipe({ operations: [], output: { format } })).not.toThrow();
    }
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "resize", width: 1, fit: "outside" }],
        output: { format: "png" },
      }),
    ).not.toThrow();
  });

  it("falls through when an overlay driver cannot execute", async () => {
    const overlay = overlayDriver(failingDriver(), succeedingDriver());
    const result = await overlay.transform(new Uint8Array([1, 2, 3, 4]), {
      operations: [],
      output: { format: "png" },
    });
    expect(result.metadata.width).toBe(1);
  });

  it("keeps capability aggregation usable when optional drivers fail", async () => {
    const failing = failingDriver();
    const overlay = overlayDriver(
      {
        ...failing,
        capabilities: async () => {
          throw new Error("module not found");
        },
      },
      succeedingDriver(),
    );
    await expect(overlay.capabilities()).resolves.toMatchObject({
      driver: "failing+succeeding",
      metadataRead: true,
    });
  });

  it("normalizes sharp raw fallback input to RGBA", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 6, channels: 3, background: { r: 20, g: 80, b: 160 } },
    })
      .jpeg()
      .toBuffer();
    const driver = sharpDriver();
    const result = await driver.transform(new Uint8Array(jpeg), {
      operations: [{ type: "dilate", size: 1 }],
      output: { format: "png" },
    });
    expect(result.format).toBe("png");
    expect(result.metadata.width).toBe(8);
    expect(result.metadata.height).toBe(6);
  });

  it("exposes an unavailable canvas backend instead of failing capability queries", async () => {
    const capabilities = await canvasDriver().capabilities();
    expect(capabilities.driver).toBe("canvas");
    expect(capabilities.operations.resize).toBeDefined();
  });

  it("validates DNS resolution before fetching private HTTP sources", async () => {
    const driver = httpDriver({ allowAllDomains: true, blockPrivateIPs: true });
    await expect(driver.getItemRaw?.("http://localhost/source.png", {})).rejects.toMatchObject({
      status: 403,
    });
  });

  it("passes pinned DNS addresses to Node fetchers", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "image/png");
      response.setHeader("connection", "close");
      response.end(new Uint8Array([137, 80, 78, 71]));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, () => resolve());
    });
    try {
      const { port } = server.address() as AddressInfo;
      const driver = httpDriver({ allowAllDomains: true });
      const data = await driver.getItemRaw?.(`http://localhost:${port}/source.png`, {});
      expect(data).toBeInstanceOf(Uint8Array);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("shared RGBA operations", () => {
  it("trims transparent borders using the reference alpha", () => {
    const source = { width: 4, height: 4, data: new Uint8Array(64) };
    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 3; x += 1) {
        const index = (y * 4 + x) * 4;
        source.data.set([255, 0, 0, 255], index);
      }
    }
    expect(applyPixelFilter(source, { type: "trim" })).toMatchObject({ width: 2, height: 2 });
  });

  it("copies edge pixels into every extend border", () => {
    const extended = applyPixelFilter(image(1, 1, [10, 20, 30, 255]), {
      type: "extend",
      top: 1,
      right: 1,
      bottom: 1,
      left: 1,
      extendWith: "copy",
    });
    expect(extended.width).toBe(3);
    expect(extended.height).toBe(3);
    expect([...extended.data]).toEqual(
      Array.from({ length: 36 }, (_, index) => [10, 20, 30, 255][index % 4]!),
    );
  });

  it("uses edge clamping for copy-bordered convolution", () => {
    const filtered = applyPixelFilter(image(3, 3, [100, 100, 100, 255]), {
      type: "convolve",
      width: 3,
      height: 3,
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      border: "copy",
    });
    expect([...filtered.data]).toEqual(
      Array.from({ length: 36 }, (_, index) => [100, 100, 100, 255][index % 4]!),
    );
  });

  it("parses CSS alpha percentages through unpalette", () => {
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 128]);
  });
});

describe("SVG handling", () => {
  it("sniffs SVG after XML, comments, and doctype", async () => {
    await expect(sniffImageFormat(new TextEncoder().encode(doctypeSvg))).resolves.toBe("svg");
  });

  it("sanitizes even when optimization is disabled", async () => {
    const result = await svgoDriver({ optimize: false }).transform(
      new TextEncoder().encode(doctypeSvg),
      { operations: [], output: { format: "svg" } },
    );
    expect(result.kind).toBe("vector");
    expect(new TextDecoder().decode(result.data)).not.toContain("<script");
  });
});
