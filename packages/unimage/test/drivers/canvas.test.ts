import { describe, expect, it } from "vite-plus/test";

import { canvasDriver } from "../../src/drivers/canvas";
import type { ImageRecipe } from "../../src/types";

async function redPng(width = 8, height = 6): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "red";
  context.fillRect(0, 0, width, height);
  return new Uint8Array(await canvas.encode("png"));
}

describe("canvasDriver on Node.js (@napi-rs/canvas backend)", () => {
  it("resolves the optional peer and reports capabilities", async () => {
    const driver = canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
    const capabilities = await driver.capabilities();
    expect(capabilities.driver).toBe("canvas");
    expect(capabilities.formats.png?.encode?.quality).toBe(false);
    expect(capabilities.formats.jpeg?.encode?.quality).toBe(true);
    expect(capabilities.notes?.join(" ")).toContain("@napi-rs/canvas");
  });

  it("reads metadata from encoded bytes", async () => {
    const driver = canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
    const metadata = await driver.metadata(await redPng());
    expect(metadata).toMatchObject({ width: 8, height: 6, format: "png" });
  });

  it("transforms images through the napi surface", async () => {
    const driver = canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
    const recipe: ImageRecipe = {
      operations: [{ type: "resize", width: 4, height: 3 }],
      output: { format: "png" },
    };
    const result = await driver.transform(await redPng(), recipe);
    expect(result.format).toBe("png");
    expect(result.metadata).toMatchObject({ width: 4, height: 3 });
  });

  it("covers instead of fitting when both dimensions are given", async () => {
    const driver = canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
    const recipe: ImageRecipe = {
      operations: [{ type: "resize", width: 10, height: 10 }],
      output: { format: "png" },
    };
    const result = await driver.transform(await redPng(8, 6), recipe);
    expect(result.metadata).toMatchObject({ width: 10, height: 10 });
  });

  it("encodes real GIF bytes instead of PNG data", async () => {
    const result = await canvasDriver({ canvasImport: () => import("@napi-rs/canvas") }).transform(
      { data: new Uint8Array(8 * 8 * 4).fill(180), width: 8, height: 8, layout: "rgba8" },
      { operations: [], output: { format: "gif" } },
    );
    expect(result.format).toBe("gif");
    expect(result.mediaType).toBe("image/gif");
    expect([...result.data.subarray(0, 4)]).toEqual([0x47, 0x49, 0x46, 0x38]);
    const capabilities = await canvasDriver({
      canvasImport: () => import("@napi-rs/canvas"),
    }).capabilities();
    expect(capabilities.formats.gif?.encode?.compressionModes).toContain("lossless");
  });

  it("rejects canvas work when the caller has already aborted", async () => {
    const driver = canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
    const signal = AbortSignal.abort();
    const raw: import("../../src/types").RawImageData = {
      data: new Uint8Array(8 * 8 * 4).fill(160),
      width: 8,
      height: 8,
      layout: "rgba8",
    };
    await expect(driver.metadata(raw, { signal })).rejects.toMatchObject({
      code: "UNIMAGE_ABORT",
    });
    await expect(
      driver.transform(raw, { operations: [], output: { format: "png" } }, { signal }),
    ).rejects.toMatchObject({ code: "UNIMAGE_ABORT" });
    await expect(driver.decode!(raw, { signal })).rejects.toMatchObject({
      code: "UNIMAGE_ABORT",
    });
  });
});
