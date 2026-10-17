import { describe, expect, it } from "vite-plus/test";

import { overlayDriver } from "../../src/drivers/overlay";
import { svgoDriver } from "../../src/drivers/svgo";
import type { ImageCapabilities, ImageDriver } from "../../src/types";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="red"/></svg>`;

function fakeRasterDriver(): ImageDriver {
  return {
    name: "raster",
    capabilities: async (): Promise<ImageCapabilities> => ({
      driver: "raster",
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
      operations: { resize: { supported: true } },
    }),
    checkRecipe: async (recipe) => ({
      supported: !(recipe.input?.format === "svg" && recipe.output.format !== "svg"),
      driver: "raster",
      missing: [],
      capabilities: {
        driver: "raster",
        formats: {},
        metadataRead: true,
        operations: {},
      },
    }),
    metadata: async () => ({ width: 2, height: 1, format: "png" }),
    transform: async (_input, recipe) => ({
      kind: "encoded",
      data: new Uint8Array([1]),
      format: recipe.output.format,
      mediaType: `image/${recipe.output.format}`,
      metadata: { width: 2, height: 1 },
    }),
  };
}

describe("overlayDriver", () => {
  it("merges capabilities from stacked drivers", async () => {
    const overlay = overlayDriver(svgoDriver({ runtime: "node" }), fakeRasterDriver());
    const capabilities = await overlay.capabilities();
    expect(capabilities.driver).toBe("svgo+raster");
    expect(capabilities.formats.svg?.decode?.vector).toBe(true);
    expect(capabilities.formats.png?.decode?.pixelFormats).toContain("rgba8");
    expect(capabilities.operations.resize?.supported).toBe(true);
  });

  it("routes by input format, preferring one that also encodes the output", async () => {
    const overlay = overlayDriver(svgoDriver({ runtime: "node" }), fakeRasterDriver());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await overlay.transform(png, {
      operations: [],
      output: { format: "png" },
    });
    expect(result.format).toBe("png");

    const vector = await overlay.transform(new TextEncoder().encode(svg), {
      operations: [],
      output: { format: "svg" },
    });
    expect(vector.kind).toBe("vector");
  });

  it("rejects an impossible input/output route before calling a driver", async () => {
    const overlay = overlayDriver(svgoDriver({ runtime: "node" }), fakeRasterDriver());
    await expect(
      overlay.transform(new TextEncoder().encode(svg), {
        operations: [],
        output: { format: "png" },
      }),
    ).rejects.toThrow();
  });
});
