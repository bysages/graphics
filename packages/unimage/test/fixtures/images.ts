import { expect } from "vite-plus/test";

import { canvasDriver } from "../../src/drivers/canvas";

const nodeNapiDriver = (): ReturnType<typeof napiDriver> =>
  napiDriver({ napiImport: () => import("@napi-rs/image") });

const nodeCanvasDriver = (): ReturnType<typeof canvasDriver> =>
  canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
import { napiDriver } from "../../src/drivers/napi";
import { sharpDriver } from "../../src/drivers/sharp";
import type { ImageDriver, ImageOperation, ImageResult, RawImageData } from "../../src/types";

export type RasterDriverFactory = () => ImageDriver;

export const rasterDriverFactories = [
  ["sharp", sharpDriver],
  ["napi", nodeNapiDriver],
  ["canvas", nodeCanvasDriver],
] as const;

export function gradientImage(width = 8, height = 6): RawImageData {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = Math.round((x / Math.max(1, width - 1)) * 255);
      data[index + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }
  return { data, width, height, layout: "rgba8" };
}

export function borderedGradientImage(): RawImageData {
  const image = gradientImage();
  const transparent = new Uint8Array(image.data.length);
  for (let y = 1; y < image.height - 1; y += 1) {
    const start = (y * image.width + 1) * 4;
    const end = (y * image.width + image.width - 1) * 4;
    transparent.set(image.data.subarray(start, end), start);
  }
  return { data: transparent, width: image.width, height: image.height, layout: "rgba8" };
}

/** Run one operation through every raster driver and reject silent capability drift. */
export async function expectConsistentOperation(
  operation: ImageOperation,
  validate?:
    | ((result: ImageResult, driverName: string) => void | Promise<void>)
    | {
        input?: RawImageData;
        width?: number;
        height?: number;
        validate?: (result: ImageResult, driverName: string) => void | Promise<void>;
        allowUnsupported?: readonly string[];
      },
): Promise<ImageResult[]> {
  const input =
    typeof validate === "object" && validate.input !== undefined ? validate.input : gradientImage();
  const expectedWidth = typeof validate === "object" ? validate.width : undefined;
  const expectedHeight = typeof validate === "object" ? validate.height : undefined;
  const allowedUnsupported = typeof validate === "object" ? (validate.allowUnsupported ?? []) : [];
  const recipe = {
    input: { frames: "first" as const },
    operations: [operation],
    output: { format: "png" as const },
  };
  const results: ImageResult[] = [];
  const unsupported: string[] = [];

  for (const [name, factory] of rasterDriverFactories) {
    const driver = factory();
    try {
      const check = await driver.checkRecipe(recipe);
      if (!check.supported) {
        unsupported.push(
          `${name}: ${check.missing.map((issue) => `${issue.section}/${issue.key}`).join(", ")}`,
        );
        continue;
      }
      const result = await driver.transform(input, recipe);
      expect(result.kind, name).toBe("encoded");
      if (result.kind !== "encoded") continue;
      expect(result.format, name).toBe("png");
      expect(result.metadata.width, name).toBe(expectedWidth ?? input.width);
      expect(result.metadata.height, name).toBe(expectedHeight ?? input.height);
      results.push(result);
      const custom = typeof validate === "function" ? validate : validate?.validate;
      await custom?.(result, name);
    } finally {
      await driver.dispose?.();
    }
  }

  const unexpected = unsupported.filter(
    (item) => !allowedUnsupported.some((name) => item.startsWith(`${name}:`)),
  );
  expect(unexpected, `drivers do not agree on ${operation.type}`).toEqual([]);
  expect(results).toHaveLength(rasterDriverFactories.length - allowedUnsupported.length);
  return results;
}
