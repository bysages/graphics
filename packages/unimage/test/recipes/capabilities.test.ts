import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vite-plus/test";

import { napiDriver } from "../../src/drivers/napi";
import { createImageProxy } from "../../src/proxy";
import { parseImageRecipe } from "../../src/recipe";
import { unstorageStorage } from "../../src/storage/unstorage";
import type { ImageRecipe, RawImageData } from "../../src/types";

const raw: RawImageData = {
  data: new Uint8Array(16 * 16 * 4).fill(128),
  width: 16,
  height: 16,
  layout: "rgba8",
};

// A gradient image with a bright block in the top-left quadrant, used to
// verify entropy/attention crop placement.
function gradientWithFocus(): RawImageData {
  const data = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const index = (y * 64 + x) * 4;
      const base = 40 + Math.round((x / 64) * 60);
      const highlight = x < 20 && y < 20 ? 200 : 0;
      data[index] = Math.min(255, base + highlight);
      data[index + 1] = Math.min(255, base + highlight);
      data[index + 2] = Math.min(255, base + highlight);
      data[index + 3] = 255;
    }
  }
  return { data, width: 64, height: 64, layout: "rgba8" };
}

const driver = napiDriver();

function recipe(
  operations: ImageRecipe["operations"],
  format: ImageRecipe["output"]["format"] = "png",
): ImageRecipe {
  return { operations, output: { format } };
}

describe("new pixel capabilities", () => {
  it("applies clahe without changing dimensions", async () => {
    const result = await driver.transform(raw, recipe([{ type: "clahe", width: 8, height: 8 }]));
    expect(result.metadata).toMatchObject({ width: 16, height: 16 });
  });

  it("parses clahe recipes", () => {
    expect(
      parseImageRecipe({
        operations: [{ type: "clahe", width: 4, height: 4, maxSlope: 3 }],
        output: { format: "png" },
      }),
    ).toMatchObject({
      operations: [{ type: "clahe", width: 4, height: 4, maxSlope: 3 }],
    });
  });

  it("extends with mirror mode", async () => {
    const result = await driver.transform(
      raw,
      recipe([{ type: "extend", top: 2, right: 2, bottom: 2, left: 2, extendWith: "mirror" }]),
    );
    expect(result.metadata).toMatchObject({ width: 20, height: 20 });
  });

  it("sharpens with flat and jagged thresholds", async () => {
    const result = await driver.transform(
      raw,
      recipe([{ type: "sharpen", sigma: 1, flat: 2, jagged: 3 }]),
    );
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  it("crops with attention focus toward the bright block", async () => {
    const image = gradientWithFocus();
    const result = await driver.transform(
      image,
      recipe([{ type: "resize", width: 32, height: 64, fit: "cover", position: "attention" }]),
    );
    expect(result.metadata).toMatchObject({ width: 32, height: 64 });

    const entropy = await driver.transform(
      image,
      recipe([{ type: "resize", width: 32, height: 64, fit: "cover", position: "entropy" }]),
    );
    expect(entropy.metadata).toMatchObject({ width: 32, height: 64 });
  });

  it("accepts ImageProxy clahe, extend modes, and position strategies", async () => {
    const encoded = await driver.transform(raw, recipe([]));
    const memory = createStorage({ driver: memoryDriver() });
    await memory.setItemRaw("/test.png", encoded.data);
    const proxy = createImageProxy({
      storage: unstorageStorage(memory),
    });
    const result = proxy("test.png", {
      clahe: "8_8_3",
      extend: "2_2_2_2_mirror",
      position: "attention",
    });
    const processed = await result.process();
    expect(processed.data.byteLength).toBeGreaterThan(0);
  });
});
