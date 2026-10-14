import { describe, expect, it } from "vite-plus/test";

import { UnImageError } from "../src/errors";
import {
  checkRecipeCapabilities,
  digestRecipe,
  parseImageRecipe,
  serializeRecipe,
} from "../src/recipe";
import type { ImageCapabilities, ImageRecipe } from "../src/types";

const recipe: ImageRecipe = {
  operations: [
    { type: "autoOrient" },
    { type: "resize", width: 640, fit: "contain", withoutEnlargement: true },
  ],
  output: { format: "webp", quality: 82, metadataPolicy: "strip" },
};

describe("unimage recipes", () => {
  it("parses a valid recipe", () => {
    const parsed = parseImageRecipe(recipe);
    expect(parsed.output.format).toBe("webp");
    expect(parsed.operations).toHaveLength(2);
  });

  it("parses input frame selection", () => {
    const parsed = parseImageRecipe({
      input: { frames: "all" },
      operations: [],
      output: { format: "webp" },
    });
    expect(parsed.input?.frames).toBe("all");
  });

  it("rejects invalid operations", () => {
    expect(() =>
      parseImageRecipe({ operations: [{ type: "teleport" }], output: { format: "png" } }),
    ).toThrow(UnImageError);
    expect(() => parseImageRecipe({ operations: [], output: { format: "bitmap" } })).toThrow(
      UnImageError,
    );
    expect(() =>
      parseImageRecipe({
        input: { frames: "sometimes" },
        operations: [],
        output: { format: "webp" },
      }),
    ).toThrow(UnImageError);
  });

  it("serializes recipes deterministically regardless of key order", () => {
    const reordered = {
      output: { metadataPolicy: "strip", quality: 82, format: "webp" },
      operations: [
        { type: "autoOrient" },
        { fit: "contain", withoutEnlargement: true, width: 640, type: "resize" },
      ],
    } as const;

    expect(serializeRecipe(reordered)).toBe(serializeRecipe(recipe));
  });

  it("creates a stable digest", async () => {
    await expect(digestRecipe(recipe)).resolves.toHaveLength(64);
  });

  it("reports missing pipeline capabilities", () => {
    const capabilities: ImageCapabilities = {
      driver: "test",
      formats: {
        png: {
          decode: {
            pixelFormats: ["rgba8"],
            frames: ["still"],
            orientation: false,
            rasterDensity: false,
            vector: false,
          },
          encode: {
            compressionModes: ["lossless"],
            quality: false,
            animation: false,
            metadataPolicies: ["strip"],
            sanitize: false,
          },
        },
        webp: {
          decode: {
            pixelFormats: ["rgba8"],
            frames: ["still", "animated"],
            orientation: false,
            rasterDensity: false,
            vector: false,
          },
          encode: {
            compressionModes: ["lossy"],
            quality: true,
            animation: true,
            metadataPolicies: ["strip"],
            sanitize: false,
          },
        },
      },
      metadataRead: true,
      operations: {
        crop: { supported: true },
      },
    };
    const result = checkRecipeCapabilities(
      {
        input: { format: "avif", frames: "all" },
        operations: [
          { type: "crop", x: 0, y: 0, width: 1, height: 1 },
          { type: "rotate", angle: 90 },
        ],
        output: { format: "avif", quality: 80 },
      },
      capabilities,
      (operation) => capabilities.operations[operation.type] ?? { supported: false },
    );

    expect(result.supported).toBe(false);
    expect(result.missing).toEqual([
      { section: "input", key: "avif", reason: "unsupported" },
      { section: "output", key: "avif", reason: "unsupported" },
      { section: "operations", key: "rotate", reason: "unsupported" },
    ]);
  });
});
