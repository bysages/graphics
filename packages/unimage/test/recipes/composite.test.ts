import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";

import { canvasDriver } from "../../src/drivers/canvas";
import { sharpDriver } from "../../src/drivers/sharp";
import { UnImageError } from "../../src/errors";
import { createImageManager } from "../../src/manager";
import { parseImageRecipe, serializeRecipe } from "../../src/recipe";
import type { ImageDriver, ImageRecipe, ImageResult, RawImageData } from "../../src/types";
import { gradientImage, rasterDriverFactories } from "../fixtures/images";

function redLayer(): RawImageData {
  return {
    data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
    width: 2,
    height: 2,
    layout: "rgba8",
  };
}

async function rgba(result: ImageResult): Promise<Uint8Array> {
  if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
  const { data } = await sharp(result.data)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function runAll(
  operations: ImageRecipe["operations"],
): Promise<Array<{ name: string; pixels: Uint8Array }>> {
  const recipe: ImageRecipe = { operations, output: { format: "png" } };
  const outputs: Array<{ name: string; pixels: Uint8Array }> = [];
  for (const [name, factory] of rasterDriverFactories) {
    const driver: ImageDriver = factory();
    try {
      const result = await driver.transform(gradientImage(), recipe, {
        layers: { red: redLayer() },
      });
      if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
      outputs.push({ name, pixels: await rgba(result) });
    } finally {
      await driver.dispose?.();
    }
  }
  return outputs;
}

describe("composite recipe", () => {
  it("composites an opaque layer consistently over every raster driver", async () => {
    const outputs = await runAll([{ type: "composite", layer: "red", position: "center" }]);

    for (const output of outputs) {
      const index = (2 * 8 + 3) * 4;
      expect([
        output.name,
        output.pixels[index],
        output.pixels[index + 1],
        output.pixels[index + 2],
      ]).toEqual([output.name, 255, 0, 0]);
    }
    for (let index = 1; index < outputs.length; index += 1) {
      const left = outputs[0]!.pixels;
      const right = outputs[index]!.pixels;
      let difference = 0;
      for (let byte = 0; byte < left.length; byte += 1) {
        difference += Math.abs((left[byte] as number) - (right[byte] as number));
      }
      expect(difference / left.length, outputs[index]!.name).toBeLessThan(2);
    }
  });

  it("executes operations after composite in recipe order", async () => {
    const outputs = await runAll([
      { type: "composite", layer: "red", position: "center" },
      { type: "invert" },
    ]);
    for (const output of outputs) {
      const index = (2 * 8 + 3) * 4;
      expect([
        output.name,
        output.pixels[index],
        output.pixels[index + 1],
        output.pixels[index + 2],
      ]).toEqual([output.name, 0, 255, 255]);
    }
  });

  it("materializes composite before subsequent geometry operations", async () => {
    const outputs = await runAll([
      { type: "composite", layer: "red", position: "center" },
      { type: "crop", x: 0, y: 0, width: 4, height: 2 },
    ]);
    for (let index = 1; index < outputs.length; index += 1) {
      const left = outputs[0]!.pixels;
      const right = outputs[index]!.pixels;
      let difference = 0;
      for (let byte = 0; byte < left.length; byte += 1) {
        difference += Math.abs((left[byte] as number) - (right[byte] as number));
      }
      expect(difference / left.length, outputs[index]!.name).toBeLessThan(2);
    }
  });
  it("tiles a layer with a stable phase", async () => {
    const outputs = await runAll([{ type: "composite", layer: "red", tile: true }]);
    for (const output of outputs) {
      const index = (1 * 8 + 1) * 4;
      expect([
        output.name,
        output.pixels[index],
        output.pixels[index + 1],
        output.pixels[index + 2],
      ]).toEqual([output.name, 255, 0, 0]);
    }
  });

  it("supports native blend modes with opaque layers", async () => {
    const expectations: Record<string, [number, number, number]> = {
      add: [255, 102, 128],
      multiply: [109, 0, 0],
      clear: [0, 0, 0],
    };
    for (const [blend, expected] of Object.entries(expectations)) {
      const outputs = await runAll([
        {
          type: "composite",
          layer: "red",
          position: "center",
          blend: blend as import("../../src/types").CompositeBlend,
        },
      ]);
      if (expected === undefined) continue;
      const index = (2 * 8 + 3) * 4;
      for (const output of outputs) {
        expect([
          blend,
          output.name,
          output.pixels[index],
          output.pixels[index + 1],
          output.pixels[index + 2],
        ]).toEqual([blend, output.name, ...expected]);
      }
    }
  });

  it("keeps porter-duff footprint parity for opaque layers", async () => {
    for (const blend of [
      "clear",
      "source",
      "over",
      "in",
      "out",
      "atop",
      "dest-over",
      "dest-in",
      "dest-out",
      "dest-atop",
      "xor",
      "add",
    ] as const) {
      const outputs = await runAll([
        { type: "composite", layer: "red", position: "center", blend },
      ]);
      for (let index = 1; index < outputs.length; index += 1) {
        const left = outputs[0]!.pixels;
        const right = outputs[index]!.pixels;
        let difference = 0;
        for (let byte = 0; byte < left.length; byte += 1) {
          difference += Math.abs((left[byte] as number) - (right[byte] as number));
        }
        expect(difference / left.length, `${blend}/${outputs[index]!.name}`).toBeLessThan(2);
      }
    }
  });

  it("keeps footprint parity for clipped layers", async () => {
    for (const blend of ["in", "dest-in"] as const) {
      const outputs = await runAll([
        {
          type: "composite",
          layer: "red",
          x: -1,
          y: -1,
          blend,
        },
      ]);
      for (let index = 1; index < outputs.length; index += 1) {
        const left = outputs[0]!.pixels;
        const right = outputs[index]!.pixels;
        let difference = 0;
        for (let byte = 0; byte < left.length; byte += 1) {
          difference += Math.abs((left[byte] as number) - (right[byte] as number));
        }
        expect(difference / left.length, `${blend}/${outputs[index]!.name}`).toBeLessThan(2);
      }
    }
  });

  it("requires runtime layer bindings without embedding pixels in recipes", () => {
    const recipe = {
      operations: [{ type: "composite", layer: "red", opacity: 0.5 }],
      output: { format: "png" },
    } as const;
    const parsed = parseImageRecipe(recipe);
    expect(parsed.operations[0]).toMatchObject({ type: "composite", layer: "red", opacity: 0.5 });
    expect(serializeRecipe(recipe)).not.toContain("Uint8Array");

    const manager = createImageManager({ driver: canvasDriver() });
    return expect(manager.transform(gradientImage(), recipe)).rejects.toThrow(UnImageError);
  });

  it("rejects bindings whose byte length does not match dimensions", async () => {
    const manager = createImageManager({ driver: canvasDriver() });
    await expect(
      manager.transform(
        gradientImage(),
        {
          operations: [{ type: "composite", layer: "red" }],
          output: { format: "png" },
        },
        {
          layers: {
            red: {
              data: new Uint8Array(16 - 1),
              width: 2,
              height: 2,
              layout: "rgba8",
            },
          },
        },
      ),
    ).rejects.toThrow(UnImageError);
  });

  it("preserves metadata after sharp materializes a composite", async () => {
    const source = await sharp({
      create: { width: 4, height: 2, channels: 4, background: "blue" },
    })
      .withMetadata({ exif: { IFD0: { ImageDescription: "keep-me" } } })
      .png()
      .toBuffer();
    const driver = sharpDriver();
    try {
      const result = await driver.transform(
        source,
        {
          operations: [{ type: "composite", layer: "red", position: "center" }],
          output: { format: "png", metadataPolicy: "preserve" },
        },
        { layers: { red: redLayer() } },
      );
      if (result.kind !== "encoded") throw new TypeError("Expected encoded output.");
      const metadata = await sharp(result.data).metadata();
      expect(Buffer.from(metadata.exif!).toString("latin1")).toContain("keep-me");
    } finally {
      await driver.dispose?.();
    }
  });

  it("validates composite options", () => {
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "composite", layer: "red", x: 1 }],
        output: { format: "png" },
      }),
    ).toThrow(UnImageError);
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "composite", layer: "red", opacity: 2 }],
        output: { format: "png" },
      }),
    ).toThrow(UnImageError);
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "composite", layer: "red", opacity: "0.5" }],
        output: { format: "png" },
      } as never),
    ).toThrow(UnImageError);
    expect(() =>
      parseImageRecipe({
        operations: [{ type: "composite", layer: "red", position: "entropy" }],
        output: { format: "png" },
      } as never),
    ).toThrow(UnImageError);
  });
});
