import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import { UnImageError } from "../../src/errors";
import { parseImageRecipe } from "../../src/recipe";
import type { ImageResult } from "../../src/types";
import { expectConsistentOperation } from "../fixtures/images";

const grayscaleMatrix = [
  0.299, 0.587, 0.114, 0, 0, 0.299, 0.587, 0.114, 0, 0, 0.299, 0.587, 0.114, 0, 0, 0, 0, 0, 1, 0,
];

async function pixels(result: ImageResult): Promise<Uint8Array> {
  if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
  const { data } = await sharp(result.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

describe("colorMatrix recipe", () => {
  it("mixes channels consistently across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "colorMatrix", matrix: grayscaleMatrix },
      {
        async validate(result, driverName) {
          const data = await pixels(result);
          for (let index = 0; index < data.length; index += 4) {
            expect([driverName, data[index], data[index + 1], data[index + 2]]).toEqual([
              driverName,
              data[index],
              data[index],
              data[index],
            ]);
            expect(data[index + 3], driverName).toBe(255);
          }
        },
      },
    );
    expect(results).toHaveLength(3);
  });

  it("validates the 4x5 matrix", () => {
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "colorMatrix", matrix: [1, 0, 0, 0, 0] }],
        output: { format: "png" },
      }),
    ).toThrow(UnImageError);
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "colorMatrix", matrix: [0, 0, 0, 0, Number.NaN] }],
        output: { format: "png" },
      } as never),
    ).toThrow(UnImageError);
  });
});
