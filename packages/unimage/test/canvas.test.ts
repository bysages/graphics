import { describe, expect, it } from "vite-plus/test";

import { canvasDriver } from "../src/drivers/canvas";
import type { ImageRecipe } from "../src/types";

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
    const driver = canvasDriver();
    const capabilities = await driver.capabilities();
    expect(capabilities.driver).toBe("canvas");
    expect(capabilities.formats.png?.encode?.quality).toBe(false);
    expect(capabilities.formats.jpeg?.encode?.quality).toBe(true);
    expect(capabilities.notes?.join(" ")).toContain("@napi-rs/canvas");
  });

  it("reads metadata from encoded bytes", async () => {
    const driver = canvasDriver();
    const metadata = await driver.metadata(await redPng());
    expect(metadata).toMatchObject({ width: 8, height: 6, format: "png" });
  });

  it("transforms images through the napi surface", async () => {
    const driver = canvasDriver();
    const recipe: ImageRecipe = {
      operations: [{ type: "resize", width: 4, height: 3 }],
      output: { format: "png" },
    };
    const result = await driver.transform(await redPng(), recipe);
    expect(result.format).toBe("png");
    expect(result.metadata).toMatchObject({ width: 4, height: 3 });
  });

  it("covers instead of fitting when both dimensions are given", async () => {
    const driver = canvasDriver();
    const recipe: ImageRecipe = {
      operations: [{ type: "resize", width: 10, height: 10 }],
      output: { format: "png" },
    };
    const result = await driver.transform(await redPng(8, 6), recipe);
    expect(result.metadata).toMatchObject({ width: 10, height: 10 });
  });
});
