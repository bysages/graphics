import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import type { ImageDriver, ImageRecipe, ImageResult } from "../../src/types";
import { gradientImage, rasterDriverFactories } from "../fixtures/images";

async function rgba(result: ImageResult): Promise<Uint8Array> {
  if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
  const { data } = await sharp(result.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function averageDifference(left: Uint8Array, right: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index]! - right[index]!);
  }
  return total / left.length;
}

describe("cross-driver pixel parity", () => {
  it("keeps geometric operations close across drivers", async () => {
    for (const operation of [
      { type: "crop", x: 1, y: 1, width: 4, height: 3 },
      { type: "flip", axis: "vertical" },
      { type: "rotate", angle: 90 },
      { type: "invert" },
    ] as const) {
      const recipe: ImageRecipe = { operations: [operation], output: { format: "png" } };
      const outputs: Array<{ name: string; data: Uint8Array }> = [];
      for (const [name, factory] of rasterDriverFactories) {
        const driver: ImageDriver = factory();
        const result = await driver.transform(gradientImage(), recipe);
        if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
        outputs.push({ name, data: await rgba(result) });
        await driver.dispose?.();
      }
      for (let index = 1; index < outputs.length; index += 1) {
        const difference = averageDifference(outputs[0]!.data, outputs[index]!.data);
        expect([operation.type, outputs[index]!.name, difference]).toEqual([
          operation.type,
          outputs[index]!.name,
          expect.any(Number),
        ]);
        expect(difference).toBeLessThan(8);
      }
    }
  });
});
