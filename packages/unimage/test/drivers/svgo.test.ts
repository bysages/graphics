import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vite-plus/test";

import { overlayDriver } from "../../src/drivers/overlay";
import { svgoDriver } from "../../src/drivers/svgo";
import { createImageProxy } from "../../src/proxy";
import { fromUnstorage } from "../../src/storage/unstorage";
import type { ImageCapabilities, ImageDriver } from "../../src/types";

const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" viewBox="0 0 24 12"><script>alert(1)</script><rect width="24" height="12" fill="blue"/></svg>`;

describe("svgoDriver", () => {
  it("sanitizes and optimizes SVG", async () => {
    const driver = svgoDriver({ runtime: "node" });
    const result = await driver.transform(new TextEncoder().encode(svg), {
      operations: [],
      output: { format: "svg" },
    });

    expect(result.kind).toBe("vector");
    const text = new TextDecoder().decode(result.data);
    expect(text).not.toContain("<script");
    expect(text).toContain("viewBox");
    await expect(driver.metadata(result.data)).resolves.toMatchObject({
      format: "svg",
      width: 24,
      height: 12,
    });
  });
});

describe("ImageProxy SVG passthrough", () => {
  it("returns optimized SVG through the storage source", async () => {
    const proxy = createImageProxy({
      storage: fromUnstorage(
        await (async () => {
          const memory = createStorage({ driver: memoryDriver() });
          await memory.setItemRaw("/source.svg", svg);
          return memory;
        })(),
      ),
      svgo: { runtime: "node" },
    });
    const handler = (await import("../../src/server")).createImageProxyFetchHandler(proxy);
    const response = await handler("http://localhost/f_svg/source.svg");

    if (response.status !== 200)
      process.stderr.write(
        JSON.stringify({ status: response.status, body: await response.text() }) + "\n",
      );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    const text = await response.text();
    expect(text).not.toContain("<script");
  });
});

describe("composite metadata", () => {
  it("routes SVG metadata to SVGO and raster metadata to the raster driver", async () => {
    const raster: ImageDriver = {
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
      metadata: async () => ({ width: 2, height: 1, format: "png" }),
      transform: async () => {
        throw new Error("should not raster");
      },
    };
    const composite = overlayDriver(svgoDriver({ runtime: "node" }), raster);
    const capabilities = await composite.capabilities();
    expect(capabilities.formats.svg?.encode?.sanitize).toBe(true);
    await expect(composite.metadata(new TextEncoder().encode(svg))).resolves.toMatchObject({
      format: "svg",
    });
  });
  it("loads the browser bundle in a supported runtime", async () => {
    const driver = svgoDriver({ runtime: "browser" });
    const result = await driver.transform(new TextEncoder().encode(svg), {
      operations: [],
      output: { format: "svg" },
    });
    expect(new TextDecoder().decode(result.data)).not.toContain("<script");
  });
});
