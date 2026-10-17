import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import { UnImageError } from "../../src/errors";
import { parseImageRecipe } from "../../src/recipe";
import type { ImageResult } from "../../src/types";
import { expectConsistentOperation } from "../fixtures/images";

async function pixels(result: ImageResult): Promise<Uint8Array> {
  if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
  const { data } = await sharp(result.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

describe("pixelate recipe", () => {
  it("makes each aligned block uniform across raster drivers", async () => {
    const results = await expectConsistentOperation(
      { type: "pixelate", size: 3 },
      {
        async validate(result, driverName) {
          const data = await pixels(result);
          for (let y = 0; y < 6; y += 3) {
            for (let x = 0; x < 8; x += 3) {
              const width = Math.min(3, 8 - x);
              const height = Math.min(3, 6 - y);
              const index = (y * 8 + x) * 4;
              const expected = Array.from(data.subarray(index, index + 4));
              for (let pixelY = y; pixelY < y + height; pixelY += 1) {
                for (let pixelX = x; pixelX < x + width; pixelX += 1) {
                  const current = (pixelY * 8 + pixelX) * 4;
                  expect(Array.from(data.subarray(current, current + 4)), driverName).toEqual(
                    expected,
                  );
                }
              }
            }
          }
        },
      },
    );
    expect(results).toHaveLength(3);
  });

  it("requires a positive block size", () => {
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "pixelate", size: 0 }],
        output: { format: "png" },
      }),
    ).toThrow(UnImageError);
  });
});
