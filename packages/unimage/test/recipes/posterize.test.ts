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

describe("posterize recipe", () => {
  it("reduces RGB levels while preserving alpha", async () => {
    const results = await expectConsistentOperation(
      { type: "posterize", levels: 3 },
      {
        async validate(result, driverName) {
          const data = await pixels(result);
          const values = new Set<number>();
          for (let index = 0; index < data.length; index += 4) {
            values.add(data[index]!);
            values.add(data[index + 1]!);
            values.add(data[index + 2]!);
            expect(data[index + 3], driverName).toBe(255);
          }
          expect(values.size, driverName).toBeLessThanOrEqual(3);
        },
      },
    );
    expect(results).toHaveLength(3);
  });

  it("requires at least two levels", () => {
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "posterize", levels: 1 }],
        output: { format: "png" },
      }),
    ).toThrow(UnImageError);
  });
});
