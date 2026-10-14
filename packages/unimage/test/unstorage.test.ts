import { createStorage, type Driver } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vite-plus/test";

import { createImageProxy } from "../src/proxy";
import { unstorageStorage } from "../src/storage/unstorage";
import type { ImageCapabilities, ImageDriver, ImageRecipe } from "../src/types";

function createDriver(): ImageDriver {
  return {
    name: "test",
    capabilities: async (): Promise<ImageCapabilities> => ({
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
      operations: {},
    }),
    checkRecipe: async () => ({
      supported: true,
      driver: "test",
      missing: [],
      capabilities: {
        driver: "test",
        formats: {},
        metadataRead: true,
        operations: {},
      },
    }),
    metadata: async () => ({ width: 1, height: 1, format: "png" }),
    transform: async (_input, recipe: ImageRecipe) => ({
      kind: "encoded" as const,
      data: new Uint8Array([9, 9, 9]),
      format: recipe.output.format,
      mediaType: `image/${recipe.output.format}`,
      metadata: { width: 1, height: 1 },
    }),
  };
}

describe("unstorageStorage", () => {
  it("adapts a real unstorage instance for ImageProxy", async () => {
    const storage = createStorage({ driver: memoryDriver() });
    await storage.setItemRaw("/images/source.png", new Uint8Array([1, 2, 3]));

    const proxy = createImageProxy({
      driver: createDriver(),
      storage: unstorageStorage(storage),
    });
    const result = await proxy("images/source.png").process();
    expect(result.data).toEqual(new Uint8Array([9, 9, 9]));

    await expect(proxy("missing.png").process()).rejects.toMatchObject({
      status: 404,
      statusText: "UNIMAGE_NOT_FOUND",
    });
  });

  it("adapts bare drivers without storage metadata", async () => {
    const bare = {
      name: "bare",
      getItemRaw: async () => new Uint8Array([4, 5, 6]),
    };
    const adapted = unstorageStorage(bare as unknown as Driver);
    await expect(adapted.getMeta("source.png")).resolves.toEqual({});

    const proxy = createImageProxy({ driver: createDriver(), storage: adapted });
    await expect(proxy("source.png").process()).resolves.toMatchObject({
      data: new Uint8Array([9, 9, 9]),
    });
  });

  it("supports key prefixing", async () => {
    const storage = createStorage({ driver: memoryDriver() });
    await storage.setItemRaw("cdn:images/x.png", new Uint8Array([4]));
    const adapted = unstorageStorage(storage, { prefix: "cdn" });
    expect(await adapted.getData("images/x.png")).toEqual(new Uint8Array([4]));
  });
});
