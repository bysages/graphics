import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import type { ImageResult } from "../../src/types";
import { expectConsistentOperation, gradientImage } from "../fixtures/images";

async function pixelAt(
  result: ImageResult,
  _driverName: string,
  x: number,
  y: number,
): Promise<readonly number[]> {
  if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
  const { data, info } = await sharp(result.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const index = (y * info.width + x) * 4;
  return Array.from(data.slice(index, index + 4));
}

describe("resize recipe", () => {
  it("produces equivalent dimensions across raster drivers", async () => {
    const results = await expectConsistentOperation(
      {
        type: "resize",
        width: 4,
        height: 3,
        fit: "fill",
      },
      { width: 4, height: 3 },
    );
    expect(results).toHaveLength(3);
  });

  it("adds an exact contain canvas across raster drivers", async () => {
    await expectConsistentOperation(
      { type: "resize", width: 4, height: 4, fit: "contain" },
      {
        width: 4,
        height: 4,
        validate: async (result, driverName) => {
          await expect(pixelAt(result, driverName, 0, 3)).resolves.toEqual([0, 0, 0, 255]);
          await expect(pixelAt(result, driverName, 3, 3), driverName).resolves.toEqual([
            0, 0, 0, 255,
          ]);
        },
      },
    );
  });

  it("uses the requested contain background across raster drivers", async () => {
    await expectConsistentOperation(
      {
        type: "resize",
        width: 4,
        height: 4,
        fit: "contain",
        background: "#ff0000",
        position: "left",
      },
      {
        width: 4,
        height: 4,
        validate: async (result, driverName) => {
          await expect(pixelAt(result, driverName, 3, 3), driverName).resolves.toEqual([
            255, 0, 0, 255,
          ]);
        },
      },
    );
  });

  it("expands outside to the smallest covering size across raster drivers", async () => {
    await expectConsistentOperation(
      { type: "resize", width: 4, height: 4, fit: "outside" },
      { width: 5, height: 4 },
    );
  });

  it("keeps source dimensions with withoutEnlargement", async () => {
    await expectConsistentOperation(
      {
        type: "resize",
        width: 32,
        height: 32,
        fit: "outside",
        withoutEnlargement: true,
      },
      { input: gradientImage(), width: 8, height: 6 },
    );
  });
});
