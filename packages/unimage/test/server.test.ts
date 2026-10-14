import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vite-plus/test";

import { createImageProxy, modifiersToRecipe } from "../src/proxy";
import {
  createImageProxyFetchHandler,
  createImageProxyHandler,
  parseImageProxyURL,
} from "../src/server";
import { httpDriver } from "../src/storage/http";
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
      operations: {
        resize: { supported: true },
        crop: { supported: true },
        sharpen: { supported: true },
      },
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
    metadata: async () => ({ width: 4, height: 2, format: "png" }),
    transform: async (_input, recipe: ImageRecipe) => ({
      kind: "encoded",
      data: new Uint8Array([1, 2, 3]),
      format: recipe.output.format,
      mediaType: `image/${recipe.output.format}`,
      metadata: { width: 2, height: 1 },
    }),
  };
}

const memory = createStorage({ driver: memoryDriver() });
await memory.setItemRaw("/source.png", new Uint8Array([8, 8, 8, 8]));
const storage = unstorageStorage(memory);

describe("parseImageProxyURL", () => {
  it("parses ImageProxy-compatible modifier and identifier segments", () => {
    expect(parseImageProxyURL("http://localhost/w_100,f_webp/images/cat.png")).toEqual({
      id: "images/cat.png",
      modifiers: { w: "100", f: "webp" },
    });
  });
});

describe("createImageProxyFetchHandler", () => {
  it("processes a compatible URL and returns image response headers", async () => {
    const proxy = createImageProxy({
      driver: createDriver(),
      storage,
      alias: { "/images": "/source.png" },
      maxAge: 120,
    });
    const handler = createImageProxyFetchHandler(proxy);
    const response = await handler("http://localhost/w_2,h_1,f_png/images");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=120");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    await expect(response.text()).resolves.toHaveLength(3);
  });

  it("honours conditional requests with a content ETag", async () => {
    const proxy = createImageProxy({ driver: createDriver(), storage, maxAge: 120 });
    const handler = createImageProxyFetchHandler(proxy);
    const first = await handler("http://localhost/w_2,f_png/source.png");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await handler(
      new Request("http://localhost/w_2,f_png/source.png", {
        headers: { "if-none-match": etag as string },
      }),
    );
    expect(second.status).toBe(304);
  });

  it("works as an h3 event handler with conditional requests", async () => {
    const proxy = createImageProxy({ driver: createDriver(), storage, maxAge: 120 });
    const handler = createImageProxyHandler(proxy);
    const first = await handler.fetch("http://localhost/w_2,f_png/source.png");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await handler.fetch(
      new Request("http://localhost/w_2,f_png/source.png", {
        headers: { "if-none-match": etag as string },
      }),
    );
    expect(second.status).toBe(304);
  });

  it("maps ImageProxy fit aliases and rejects unsupported modifiers", async () => {
    const proxy = createImageProxy({ driver: createDriver(), storage, maxAge: 120 });
    const handler = createImageProxyFetchHandler(proxy);
    await expect(
      handler("http://localhost/w_2,fit_inside,f_png/source.png"),
    ).resolves.toMatchObject({ status: 200 });
    await expect(handler("http://localhost/sharpen_2,f_png/source.png")).resolves.toMatchObject({
      status: 200,
    });
    await expect(handler("http://localhost/clahe_10,f_png/source.png")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("blocks private hosts when requested", async () => {
    const proxy = createImageProxy({
      driver: createDriver(),
      storage,
      httpStorage: httpDriver({ blockPrivateIPs: true }),
    });
    const handler = createImageProxyFetchHandler(proxy);
    const response = await handler("http://localhost/_/http://127.0.0.1/secret.png");
    expect(response.status).toBe(403);
  });
});

describe("ImageProxy modifier compatibility", () => {
  const metadata = { width: 100, height: 50, format: "gif" as const };

  it("defaults s_WxH to cover like sharp (ImageProxy)", () => {
    const recipe = modifiersToRecipe({ s: "50x50" }, metadata, 8192);
    expect(recipe.operations[0]).toMatchObject({
      type: "resize",
      width: 50,
      height: 50,
      fit: "cover",
    });
  });

  it("falls back through requested format, source format, then jpeg (ImageProxy)", () => {
    expect(modifiersToRecipe({ f: "bogus" }, metadata, 8192).output.format).toBe("gif");
    expect(modifiersToRecipe({}, { width: 1, height: 1 }, 8192).output.format).toBe("jpeg");
    expect(modifiersToRecipe({ f: "tiff" }, metadata, 8192).output.format).toBe("tiff");
  });

  it("maps the animated modifier to decode frames (ImageProxy)", () => {
    expect(modifiersToRecipe({ a: "" }, metadata, 8192).input?.frames).toBe("all");
    expect(modifiersToRecipe({}, metadata, 8192).input?.frames).toBe("all");
  });

  it("applies operations in ImageProxy handler order (alphabetical)", () => {
    const recipe = modifiersToRecipe(
      { trim: "", blur: "2", crop: "0_0_50_50", s: "25x25", rotate: "90", sharpen: "2" },
      { width: 100, height: 100, format: "png" },
      8192,
    );
    expect(recipe.operations.map((operation) => operation.type)).toEqual([
      "blur",
      "crop",
      "resize",
      "rotate",
      "sharpen",
      "trim",
    ]);
  });
});
