import { UnImageError } from "../errors";
import { checkRecipeCapabilities } from "../recipe";
import type {
  DriverRequestContext,
  ImageCapabilities,
  ImageDecodeRequest,
  ImageDriver,
  ImageFormat,
  ImageInput,
  ImageMetadata,
  ImageOperation,
  ImagePipelineConfig,
  ImageResult,
  ImageRecipe,
  ImageCapabilityResult,
  OperationCapability,
  RawImageFrame,
  RawImageSequence,
} from "../types";
import { applyPixelFilter, parseColor } from "../utils/filters";
import { sniffImageFormat } from "../utils/format";

type SharpInstance = import("sharp").Sharp;
type SharpFactory = (typeof import("sharp"))["default"];

export interface SharpDriverOptions {
  lib?: SharpFactory | (() => SharpFactory | Promise<SharpFactory>);
  /** Extra sharp constructor options (ImageProxy `sharpOptions`), e.g. `limitInputPixels`. */
  sharpOptions?: Record<string, unknown>;
}

const nativeOperations = new Set<ImageOperation["type"]>([
  "autoOrient",
  "resize",
  "crop",
  "rotate",
  "flip",
  "grayscale",
  "invert",
  "blur",
  "trim",
  "extend",
  "sharpen",
  "median",
  "flatten",
  "gamma",
  "normalize",
  "threshold",
  "linear",
  "modulate",
  "tint",
]);

const fallbackOperations = new Set<ImageOperation["type"]>([
  "dilate",
  "erode",
  "clahe",
  "unflatten",
  "opacity",
]);

const sharpFormats: Record<string, ImageFormat> = {
  jpeg: "jpeg",
  jpg: "jpeg",
  png: "png",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  tiff: "tiff",
  tif: "tiff",
  heif: "heif",
  heic: "heic",
};

function toColorLike(value: string | undefined): {
  r: number;
  g: number;
  b: number;
  alpha: number;
} {
  const [r, g, b, a] = parseColor(value);
  return { r, g, b, alpha: a / 255 };
}

async function loadFactory(options: SharpDriverOptions): Promise<SharpFactory> {
  if (typeof options.lib === "function") return (await options.lib()) as SharpFactory;
  if (options.lib) return options.lib as SharpFactory;
  try {
    return (await import("sharp")).default as SharpFactory;
  } catch (error) {
    throw new UnImageError('The "sharp" driver dependency is unavailable in this runtime.', {
      code: "UNIMAGE_DRIVER_UNAVAILABLE",
      cause: error,
    });
  }
}

async function toBuffer(input: ImageInput): Promise<Uint8Array> {
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new UnImageError("Raw pixel input must declare its dimensions to the sharp driver.", {
    code: "UNIMAGE_INVALID_INPUT",
  });
}

function encoderFor(instance: SharpInstance, recipe: ImageRecipe): SharpInstance {
  const format = recipe.output.format;
  const quality = "quality" in recipe.output ? recipe.output.quality : undefined;
  const lossless = "lossless" in recipe.output ? recipe.output.lossless === true : undefined;
  switch (format) {
    case "png":
      return instance.png();
    case "jpeg":
      return instance.jpeg({ progressive: true, quality });
    case "webp":
      return instance.webp({ quality, lossless });
    case "avif":
      return instance.avif({ quality, lossless });
    case "tiff":
      return instance.tiff({ quality });
    case "heif":
    case "heic":
      return instance.heif({ compression: "hevc", quality, lossless });
    default:
      return instance.gif();
  }
}

async function createSharp(
  factory: SharpFactory,
  input: ImageInput,
  sharpOptions: { animated?: boolean; pages?: number; density?: number } = {},
  driverOptions: Record<string, unknown> = {},
): Promise<SharpInstance> {
  if (
    typeof input === "object" &&
    input !== null &&
    "data" in input &&
    "width" in input &&
    "height" in input
  ) {
    const raw = input as { data: Uint8Array; width: number; height: number };
    return factory(Buffer.from(raw.data), {
      raw: { width: raw.width, height: raw.height, channels: 4 },
    });
  }
  return factory(Buffer.from(await toBuffer(input)), { ...driverOptions, ...sharpOptions });
}

function resizePosition(
  operation: Extract<ImageOperation, { type: "resize" }>,
): string | undefined {
  const position = operation.position;
  if (position === undefined) return undefined;
  if (position === "center") return "centre";
  return position;
}

function applyNativeOperation(instance: SharpInstance, operation: ImageOperation): SharpInstance {
  switch (operation.type) {
    case "autoOrient":
      return instance.rotate();
    case "resize": {
      return instance.resize(operation.width, operation.height, {
        fit: operation.fit ?? "cover",
        kernel:
          operation.kernel === "linear"
            ? "cubic"
            : operation.kernel === undefined
              ? undefined
              : operation.kernel,
        position: resizePosition(operation),
        withoutEnlargement: operation.withoutEnlargement === true || undefined,
      });
    }
    case "crop":
      return instance.extract({
        left: operation.x,
        top: operation.y,
        width: operation.width,
        height: operation.height,
      });
    case "rotate":
      return instance.rotate(operation.angle, {
        background:
          operation.background === undefined ? undefined : toColorLike(operation.background),
      });
    case "flip":
      return operation.axis === "vertical" ? instance.flip() : instance.flop();
    case "grayscale":
      return instance.grayscale();
    case "invert":
      return instance.negate({ alpha: false });
    case "blur":
      return instance.blur(operation.sigma);
    case "trim":
      return instance.trim(
        operation.threshold === undefined ? undefined : { threshold: operation.threshold },
      );
    case "extend":
      return instance.extend({
        top: operation.top,
        bottom: operation.bottom,
        left: operation.left,
        right: operation.right,
        background:
          operation.background === undefined ? undefined : toColorLike(operation.background),
        extendWith: operation.extendWith ?? "background",
      });
    case "sharpen": {
      if (
        operation.sigma === undefined &&
        operation.flat === undefined &&
        operation.jagged === undefined
      )
        return instance.sharpen();
      const sharpenOptions = {
        ...(operation.sigma === undefined ? {} : { sigma: operation.sigma }),
        ...(operation.flat === undefined ? {} : { m1: operation.flat }),
        ...(operation.jagged === undefined ? {} : { m2: operation.jagged }),
      } as import("sharp").SharpenOptions;
      return instance.sharpen(sharpenOptions);
    }
    case "median":
      return instance.median(operation.size);
    case "flatten":
      return instance.flatten({
        background:
          operation.background === undefined ? undefined : toColorLike(operation.background),
      });
    case "gamma":
      return instance.gamma(operation.gamma, operation.gammaOut);
    case "normalize":
      return instance.normalise({ lower: operation.lower, upper: operation.upper });
    case "threshold":
      return instance.threshold(operation.value, {
        grayscale: operation.grayscale === true || undefined,
      });
    case "linear":
      return instance.linear(operation.a ?? 1, operation.b ?? 0);
    case "modulate":
      return instance.modulate({
        brightness: operation.brightness,
        saturation: operation.saturation,
        hue: operation.hue,
        lightness: operation.lightness,
      });
    case "tint": {
      const [r, g, b] = parseColor(operation.color);
      return instance.tint({ r, g, b });
    }
    default:
      throw new UnImageError(`The sharp driver cannot apply "${operation.type}" natively.`, {
        code: "UNIMAGE_UNSUPPORTED_OPERATION",
        operation: operation.type,
      });
  }
}

export function sharpDriver(options: SharpDriverOptions = {}): ImageDriver {
  const operationCapabilities: Partial<Record<ImageOperation["type"], OperationCapability>> = {};
  for (const operation of nativeOperations) operationCapabilities[operation] = { supported: true };
  for (const operation of fallbackOperations)
    operationCapabilities[operation] = {
      supported: true,
      notes: ["Applied through the built-in RGBA pixel pipeline."],
    };

  return {
    name: "sharp",

    capabilities(): Promise<ImageCapabilities> {
      return Promise.resolve({
        driver: "sharp",
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
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          jpeg: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: true,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          webp: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still", "animated"],
              orientation: true,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: true,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          avif: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: true,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          gif: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still", "animated"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy"],
              quality: false,
              animation: true,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          svg: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: false,
              rasterDensity: true,
              vector: true,
            },
            encode: {
              compressionModes: [],
              quality: false,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          tiff: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still", "pages"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          heif: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          heic: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
        },
        metadataRead: true,
        operations: operationCapabilities,
        notes: [
          "Explicit decode.frames controls multi-frame input; GIF output no longer changes it implicitly.",
          "Operations without a native sharp implementation run through the built-in RGBA fallback.",
        ],
      });
    },

    async metadata(input: ImageInput, _context?: DriverRequestContext): Promise<ImageMetadata> {
      const factory = await loadFactory(options);
      const instance = await createSharp(factory, input);
      try {
        const meta = await instance.metadata();
        if (meta.width === undefined || meta.height === undefined) {
          throw new UnImageError("The image metadata is incomplete.", {
            code: "UNIMAGE_INVALID_INPUT",
          });
        }
        const format = sharpFormats[meta.format ?? ""];
        const density = meta.density;
        return {
          ...(format === undefined ? {} : { format }),
          mediaType: format === undefined ? "application/octet-stream" : `image/${format}`,
          width: meta.width,
          height: meta.height,
          ...(meta.pages === undefined ? {} : { pages: meta.pages }),
          ...(meta.hasAlpha === undefined ? {} : { hasAlpha: meta.hasAlpha }),
          ...(meta.orientation === undefined
            ? {}
            : { orientation: meta.orientation as ImageMetadata["orientation"] }),
          ...(density === undefined
            ? {}
            : {
                density: {
                  x: density,
                  unit: "inch" as const,
                },
              }),
        } as ImageMetadata;
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        throw new UnImageError("The image could not be decoded by sharp.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }
    },

    async decode(input: ImageInput, request: ImageDecodeRequest): Promise<RawImageFrame> {
      const factory = await loadFactory(options);
      const instance = await createSharp(
        factory,
        input,
        {
          pages: 1,
          ...(request.rasterDensity === undefined ? {} : { density: request.rasterDensity }),
        },
        options.sharpOptions,
      );

      try {
        const meta = await instance.metadata();
        if (meta.width === undefined || meta.height === undefined) {
          throw new UnImageError("The image metadata is incomplete.", {
            code: "UNIMAGE_INVALID_INPUT",
          });
        }
        const { data, info } = await instance
          .ensureAlpha()
          .toColourspace("srgb")
          .raw()
          .toBuffer({ resolveWithObject: true });
        const format = sharpFormats[meta.format ?? ""];
        return {
          data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          width: info.width,
          height: info.height,
          layout: "rgba8",
          metadata: {
            ...(format === undefined ? {} : { format }),
            mediaType: format === undefined ? "application/octet-stream" : `image/${format}`,
            width: info.width,
            height: info.height,
            ...(meta.pages === undefined ? {} : { pages: meta.pages }),
            ...(meta.hasAlpha === undefined ? {} : { hasAlpha: meta.hasAlpha }),
          },
        };
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        throw new UnImageError("The image could not be decoded by sharp.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }
    },

    checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      const capabilities: ImageCapabilities = {
        driver: this.name,
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
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          jpeg: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: true,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          webp: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still", "animated"],
              orientation: true,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: true,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          avif: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: true,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          gif: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still", "animated"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy"],
              quality: false,
              animation: true,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          svg: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: false,
              rasterDensity: true,
              vector: true,
            },
            encode: {
              compressionModes: [],
              quality: false,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          tiff: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still", "pages"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          heif: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
          heic: {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: false,
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: ["lossy", "lossless"],
              quality: true,
              animation: false,
              metadataPolicies: ["strip", "preserve"],
              sanitize: false,
            },
          },
        },
        metadataRead: true,
        operations: operationCapabilities,
      };

      return Promise.resolve(
        checkRecipeCapabilities(recipe, capabilities, (operation) => {
          const capability = operationCapabilities[operation.type];
          if (operation.type === "resize" && operation.kernel === "linear") {
            return { supported: false, notes: ["linear is not a native sharp kernel."] };
          }
          return capability ?? { supported: false };
        }),
      );
    },

    async decodeFrames(input: ImageInput, request: ImageDecodeRequest): Promise<RawImageSequence> {
      const factory = await loadFactory(options);
      const sourceFormat = await sniffImageFormat(input);
      const instance = await createSharp(
        factory,
        input,
        {
          ...(sourceFormat === "tiff" ? { pages: -1 } : { animated: true }),
          ...(request.rasterDensity === undefined ? {} : { density: request.rasterDensity }),
        },
        options.sharpOptions,
      );

      try {
        const meta = await instance.metadata();
        const pages = meta.pages ?? 0;
        if (pages < 2) {
          throw new UnImageError("The image does not contain a frame sequence.", {
            code: "UNIMAGE_UNSUPPORTED_OPERATION",
            operation: "decodeFrames",
          });
        }

        const { data, info } = await instance
          .ensureAlpha()
          .toColourspace("srgb")
          .raw()
          .toBuffer({ resolveWithObject: true });
        if (info.height % pages !== 0) {
          throw new UnImageError("The decoder returned an invalid frame strip.", {
            code: "UNIMAGE_DECODE",
          });
        }

        const frameHeight = info.height / pages;
        const frameLength = info.width * frameHeight * 4;
        const format = sharpFormats[meta.format ?? ""] ?? "png";
        const frames = Array.from({ length: pages }, (_, index) => ({
          data: new Uint8Array(data.buffer, data.byteOffset + index * frameLength, frameLength),
          width: info.width,
          height: frameHeight,
          layout: "rgba8" as const,
          metadata: {
            format,
            mediaType: `image/${format}`,
            width: info.width,
            height: frameHeight,
            hasAlpha: true,
            pages,
          },
        }));

        return {
          frames,
          metadata: {
            format,
            mediaType: `image/${format}`,
            width: info.width,
            height: frameHeight,
            pages,
            hasAlpha: true,
          },
        };
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        throw new UnImageError("The frame sequence could not be decoded by sharp.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }
    },

    async transform(input: ImageInput, recipe, context): Promise<ImageResult> {
      void context;
      const factory = await loadFactory(options);
      const source = await createSharp(factory, input, {}, options.sharpOptions);
      let sourceMeta;
      try {
        sourceMeta = await source.metadata();
      } catch (error) {
        throw new UnImageError("The image could not be decoded by sharp.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }

      const allFrames = recipe.input?.frames === "all";
      const usesPages = sourceMeta.format === "tiff";
      const readOptions = allFrames
        ? usesPages
          ? { pages: -1 }
          : { animated: true }
        : { pages: 1 };
      const density = recipe.input?.rasterDensity;
      let instance = await createSharp(
        factory,
        input,
        { ...readOptions, ...(density === undefined ? {} : { density }) },
        options.sharpOptions,
      );
      if (recipe.output.metadataPolicy === "preserve") instance = instance.withMetadata();

      for (const operation of recipe.operations) {
        if (nativeOperations.has(operation.type)) {
          instance = applyNativeOperation(instance, operation);
          continue;
        }
        if (!fallbackOperations.has(operation.type)) {
          throw new UnImageError(`The sharp driver does not support "${operation.type}".`, {
            code: "UNIMAGE_UNSUPPORTED_OPERATION",
            operation: operation.type,
          });
        }
        const { data, info } = await instance.raw().toBuffer({ resolveWithObject: true });
        const filtered = applyPixelFilter(
          {
            data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            width: info.width,
            height: info.height,
          },
          operation as Extract<
            ImageOperation,
            { type: "dilate" | "erode" | "clahe" | "unflatten" | "opacity" }
          >,
        );
        instance = factory(Buffer.from(filtered.data), {
          raw: { width: filtered.width, height: filtered.height, channels: 4 },
        });
      }

      const encoded = await encoderFor(instance, recipe).toBuffer({
        resolveWithObject: true,
      });

      const meta2 = await (await createSharp(factory, encoded.data)).metadata();
      return {
        kind: "encoded",
        data: new Uint8Array(encoded.data),
        format: recipe.output.format,
        mediaType: `image/${recipe.output.format}`,
        metadata: {
          format: recipe.output.format,
          mediaType: `image/${recipe.output.format}`,
          width: meta2.width ?? encoded.info.width,
          height: meta2.height ?? encoded.info.height,
          byteLength: encoded.data.byteLength,
          ...(meta2.pages === undefined ? {} : { pages: meta2.pages }),
          ...(meta2.hasAlpha === undefined ? {} : { hasAlpha: meta2.hasAlpha }),
        },
      };
    },
  };
}
