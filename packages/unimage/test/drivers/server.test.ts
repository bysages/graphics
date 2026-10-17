import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vite-plus/test";

import { createImageProxy, modifiersToRecipe } from "../../src/proxy";
import {
  createImageProxyFetchHandler,
  createImageProxyHandler,
  parseImageProxyURL,
} from "../../src/server";
import { httpDriver } from "../../src/storage/http";
import { unstorageStorage } from "../../src/storage/unstorage";
import type { ImageCapabilities, ImageDriver, ImageRecipe } from "../../src/types";

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

  it("negotiates exact and wildcard Accept preferences", async () => {
    const proxy = createImageProxy({ driver: createDriver(), storage });
    const handler = createImageProxyFetchHandler(proxy);
    const exact = await handler(
      new Request("http://localhost/f_auto/source.png", {
        headers: { accept: "image/webp;q=0.2, image/png;q=0.8" },
      }),
    );
    expect(exact.headers.get("content-type")).toBe("image/png");

    const wildcard = await handler(
      new Request("http://localhost/f_auto/source.png", {
        headers: { accept: "image/*" },
      }),
    );
    expect(wildcard.headers.get("content-type")).toBe("image/avif");
  });

  it("honours If-Modified-Since when source metadata has mtime", async () => {
    const mtime = new Date("2024-01-01T00:00:00.000Z");
    const proxy = createImageProxy({
      driver: createDriver(),
      storage: {
        name: "test-meta",
        getMeta: () => ({ mtime, maxAge: 60 }),
        getData: () => new Uint8Array([9, 9, 9]),
      },
    });
    const handler = createImageProxyFetchHandler(proxy);
    const response = await handler(
      new Request("http://localhost/w_2,f_png/source.png", {
        headers: { "if-modified-since": "Mon, 01 Jan 2024 00:00:01 GMT" },
      }),
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("last-modified")).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("maps aborted requests and invalid URLs to stable HTTP errors", async () => {
    const proxy = createImageProxy({ driver: createDriver(), storage });
    const handler = createImageProxyFetchHandler(proxy);
    const controller = new AbortController();
    controller.abort();
    const aborted = await handler(
      new Request("http://localhost/w_2,f_png/source.png", { signal: controller.signal }),
    );
    expect(aborted.status).toBe(408);
    await expect(handler("not-a-url")).resolves.toMatchObject({ status: 400 });
  });

  it("rejects unknown modifiers and unsafe extension sizes", async () => {
    const proxy = createImageProxy({ driver: createDriver(), storage, maxOutputDimension: 64 });
    const handler = createImageProxyFetchHandler(proxy);
    await expect(handler("http://localhost/noise_10,f_png/source.png")).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      handler("http://localhost/extend_-1_0_0_0,f_png/source.png"),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      handler("http://localhost/extend_128_0_0_0,f_png/source.png"),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("matches aliases only on path boundaries", async () => {
    await memory.setItemRaw("/assets/cat.png", new Uint8Array([7, 7, 7]));
    const proxy = createImageProxy({
      driver: createDriver(),
      storage,
      alias: { "/blog": "/assets" },
    });
    await expect(proxy("/blog/cat.png", { f: "png" }).process()).resolves.toMatchObject({
      format: "png",
    });
    await expect(proxy("/blog-2/cat.png", { f: "png" }).process()).rejects.toMatchObject({
      status: 404,
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
