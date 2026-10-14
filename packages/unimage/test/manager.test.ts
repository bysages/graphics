import { describe, expect, it } from "vite-plus/test";

import { UnImageError } from "../src/errors";
import { createImageManager } from "../src/manager";
import { checkRecipeCapabilities } from "../src/recipe";
import type { ImageCapabilities, ImageDriver, RawImageData } from "../src/types";

const raw: RawImageData = {
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
  width: 2,
  height: 1,
  layout: "rgba8",
};

function createDriver(overrides: Partial<ImageDriver> = {}): ImageDriver {
  const capabilities: ImageCapabilities = {
    driver: "test",
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
      webp: {
        decode: {
          pixelFormats: ["rgba8"],
          frames: ["still", "animated"],
          orientation: false,
          rasterDensity: false,
          vector: false,
        },
        encode: {
          compressionModes: ["lossy"],
          quality: true,
          animation: true,
          metadataPolicies: ["strip"],
          sanitize: false,
        },
      },
    },
    metadataRead: true,
    operations: {
      crop: { supported: true },
      grayscale: { supported: true },
    },
  };

  return {
    name: "test",
    capabilities: async () => capabilities,
    checkRecipe: async (recipe) =>
      checkRecipeCapabilities(
        { ...recipe, input: { format: "png", ...recipe.input } },
        capabilities,
        (operation) => capabilities.operations[operation.type] ?? { supported: false },
      ),
    metadata: async () => ({ width: 2, height: 1 }),
    transform: async (_input, recipe) => ({
      kind: "encoded",
      data: new Uint8Array([1, 2, 3]),
      format: recipe.output.format,
      mediaType: `image/${recipe.output.format}`,
      metadata: { width: 2, height: 1 },
    }),
    ...overrides,
  };
}

describe("createImageManager", () => {
  it("passes a parsed recipe to a capable driver", async () => {
    let observedOperationCount = Number.NaN;
    const manager = createImageManager({
      driver: createDriver({
        transform: async (_input, recipe) => {
          observedOperationCount = recipe.operations.length;
          return {
            kind: "encoded",
            data: new Uint8Array(),
            format: recipe.output.format,
            mediaType: "image/png",
            metadata: { width: 2, height: 1 },
          };
        },
      }),
    });

    const result = await manager.transform(raw, {
      operations: [{ type: "crop", x: 0, y: 0, width: 1, height: 1 }],
      output: { format: "png", metadataPolicy: "strip" },
    });

    expect(observedOperationCount).toBe(1);
    expect(result.format).toBe("png");
  });

  it("checks capability requests with the actual output configuration", async () => {
    const manager = createImageManager({ driver: createDriver() });

    const supported = await manager.isConfigSupported({
      input: { format: "png" },
      operations: [{ type: "crop", x: 0, y: 0, width: 1, height: 1 }],
      output: { format: "webp", quality: 80 },
    });
    expect(supported.supported).toBe(true);

    const unsupported = await manager.isConfigSupported({
      input: { format: "png" },
      operations: [{ type: "rotate", angle: 90 }],
      output: { format: "webp", lossless: true },
    });
    expect(unsupported.supported).toBe(false);
    expect(unsupported.missing).toEqual([
      { section: "output", key: "webp", reason: "unsupported" },
      { section: "operations", key: "rotate", reason: "unsupported" },
    ]);
  });

  it("rejects unsupported operations before calling the driver", async () => {
    const manager = createImageManager({ driver: createDriver() });

    await expect(
      manager.transform(raw, {
        operations: [{ type: "rotate", angle: 90 }],
        output: { format: "png", metadataPolicy: "strip" },
      }),
    ).rejects.toMatchObject({
      code: "UNIMAGE_UNSUPPORTED_OPERATION",
      operation: "rotate",
    });
  });

  it("wraps driver failures in a stable error", async () => {
    const manager = createImageManager({
      driver: createDriver({
        transform: async () => {
          throw new Error("boom");
        },
      }),
    });

    await expect(
      manager.transform(raw, {
        operations: [{ type: "grayscale" }],
        output: { format: "webp", metadataPolicy: "strip" },
      }),
    ).rejects.toBeInstanceOf(UnImageError);
  });
});
