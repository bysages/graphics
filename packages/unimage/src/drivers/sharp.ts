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
  FrameSupport,
  CompressionMode,
  ImageRecipe,
  ImageCapabilityResult,
  OperationCapability,
  RawImageFrame,
  RawImageSequence,
} from "../types";
import { abortable, assertNotAborted } from "../utils/abort";
import { prepareCompositeLayer } from "../utils/composite";
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
  "contrast",
  "convolve",
  "removeAlpha",
  "ensureAlpha",
  "composite",
]);

const fallbackOperations = new Set<ImageOperation["type"]>([
  "colorMatrix",
  "posterize",
  "pixelate",
  "opacity",
  "dilate",
  "erode",
  "clahe",
  "unflatten",
]);

type PixelFallbackOperation = Extract<
  ImageOperation,
  {
    type:
      | "dilate"
      | "erode"
      | "clahe"
      | "unflatten"
      | "opacity"
      | "colorMatrix"
      | "posterize"
      | "pixelate";
  }
>;
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
  bmp: "bmp",
  ico: "ico",
  jxl: "jxl",
};

async function materializeSharp(
  factory: SharpFactory,
  instance: SharpInstance,
  preserveMetadata: boolean,
  signal: AbortSignal | undefined,
  reason: string,
): Promise<SharpInstance> {
  const normalized = instance.ensureAlpha().toColourspace("srgb");
  if (preserveMetadata) {
    // PNG carries source metadata across the stage boundary; raw pixels do not.
    const materialized = await abortable(normalized.png().toBuffer(), signal, reason);
    return factory(materialized).withMetadata();
  }
  const { data, info } = await abortable(
    normalized.raw().toBuffer({ resolveWithObject: true }),
    signal,
    reason,
  );
  return factory(Buffer.from(data), {
    raw: { width: info.width, height: info.height, channels: 4 },
  });
}

async function applyPixelFilterSharp(
  factory: SharpFactory,
  instance: SharpInstance,
  operation: PixelFallbackOperation,
  preserveMetadata: boolean,
  signal: AbortSignal | undefined,
): Promise<SharpInstance> {
  const normalized = instance.ensureAlpha().toColourspace("srgb");
  const { data, info } = await abortable(
    normalized.raw().toBuffer({ resolveWithObject: true }),
    signal,
    "pixel fallback",
  );
  const filtered = applyPixelFilter(
    {
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
    },
    operation,
  );

  if (!preserveMetadata) {
    return factory(Buffer.from(filtered.data), {
      raw: { width: filtered.width, height: filtered.height, channels: 4 },
    });
  }

  const carrier = factory(
    await abortable(normalized.png().toBuffer(), signal, "pixel fallback"),
  ).withMetadata();
  const materialized = await abortable(
    carrier
      .composite([
        {
          input: Buffer.from(filtered.data),
          raw: { width: filtered.width, height: filtered.height, channels: 4 },
          left: 0,
          top: 0,
          blend: "source",
        },
      ])
      .png()
      .toBuffer(),
    signal,
    "pixel fallback",
  );
  return factory(materialized).withMetadata();
}

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
    case "jxl": {
      const options: import("sharp").JxlOptions = {};
      if (quality !== undefined) options.quality = quality;
      if (lossless !== undefined) options.lossless = lossless;
      return instance.jxl(options);
    }
    case "bmp":
    case "ico":
    case "pnm":
    case "tga":
      throw new UnImageError(`The sharp driver cannot encode ${format}.`, {
        code: "UNIMAGE_UNSUPPORTED_FORMAT",
        format,
      });
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
        background:
          operation.background === undefined ? undefined : toColorLike(operation.background),
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
        ...(operation.brightness === undefined ? {} : { brightness: operation.brightness }),
        ...(operation.saturation === undefined ? {} : { saturation: operation.saturation }),
        ...(operation.hue === undefined ? {} : { hue: operation.hue }),
        ...(operation.lightness === undefined ? {} : { lightness: operation.lightness }),
      });
    case "contrast": {
      const amount = operation.amount / 100;
      return instance.linear(1 + amount, 128 * -amount);
    }
    case "convolve":
      return instance.convolve({
        kernel: [...operation.kernel],
        width: operation.width,
        height: operation.height,
        ...(operation.scale === undefined ? {} : { scale: operation.scale }),
        ...(operation.offset === undefined ? {} : { offset: operation.offset }),
      });
    case "removeAlpha":
      return instance.removeAlpha();
    case "ensureAlpha":
      return instance.ensureAlpha(operation.alpha);
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

async function probeSharpHevcEncoding(factory: SharpFactory): Promise<boolean> {
  try {
    await factory({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .heif({ compression: "hevc" })
      .toBuffer();
    return true;
  } catch {
    return false;
  }
}

function sharpCapabilityFormats(
  formatMap: Record<string, { input?: { buffer?: boolean }; output?: { buffer?: boolean } }>,
  hevcEncoding: boolean,
): ImageCapabilities["formats"] {
  const formatCapability = (
    format: ImageFormat,
    available: { input?: { buffer?: boolean }; output?: { buffer?: boolean } } | undefined,
    options: {
      frames: FrameSupport[];
      orientation?: boolean;
      density?: boolean;
      vector?: boolean;
      modes: CompressionMode[];
      quality?: boolean;
      animation?: boolean;
      requiresHevc?: boolean;
    },
  ): NonNullable<ImageCapabilities["formats"][ImageFormat]> => ({
    decode: {
      pixelFormats: available?.input?.buffer ? ["rgba8"] : [],
      frames: options.frames,
      orientation: options.orientation ?? false,
      rasterDensity: options.density ?? false,
      vector: options.vector ?? false,
    },
    encode: (() => {
      const encodeAvailable =
        available?.output?.buffer === true && (options.requiresHevc !== true || hevcEncoding);
      return {
        compressionModes: encodeAvailable ? options.modes : [],
        quality: encodeAvailable && options.quality === true,
        animation: encodeAvailable && options.animation === true,
        metadataPolicies: ["strip", "preserve"],
        sanitize: false,
      };
    })(),
  });
  const heif = formatMap.heif;
  const jxl = formatMap.jxl;
  return {
    png: formatCapability("png", formatMap.png, { frames: ["still"], modes: ["lossless"] }),
    jpeg: formatCapability("jpeg", formatMap.jpeg, {
      frames: ["still"],
      orientation: true,
      modes: ["lossy"],
      quality: true,
    }),
    webp: formatCapability("webp", formatMap.webp, {
      frames: ["still", "animated"],
      orientation: true,
      modes: ["lossy", "lossless"],
      quality: true,
      animation: true,
    }),
    avif: formatCapability("avif", heif, {
      frames: ["still"],
      orientation: true,
      modes: ["lossy", "lossless"],
      quality: true,
    }),
    gif: formatCapability("gif", formatMap.gif, {
      frames: ["still", "animated"],
      modes: ["lossy"],
      animation: true,
    }),
    svg: formatCapability("svg", formatMap.svg, {
      frames: ["still"],
      density: true,
      vector: true,
      modes: [],
    }),
    tiff: formatCapability("tiff", formatMap.tiff, {
      frames: ["still", "pages"],
      modes: ["lossy", "lossless"],
      quality: true,
      animation: true,
    }),
    heif: formatCapability("heif", heif, {
      frames: ["still"],
      modes: ["lossy", "lossless"],
      quality: true,
      requiresHevc: true,
    }),
    heic: formatCapability("heic", heif, {
      frames: ["still"],
      modes: ["lossy", "lossless"],
      quality: true,
      requiresHevc: true,
    }),
    jxl: formatCapability("jxl", jxl, {
      frames: ["still"],
      modes: ["lossy", "lossless"],
      quality: true,
    }),
  };
}

export function sharpDriver(options: SharpDriverOptions = {}): ImageDriver {
  let capabilitiesPromise: Promise<ImageCapabilities> | undefined;
  const operationCapabilities: Partial<Record<ImageOperation["type"], OperationCapability>> = {};
  for (const operation of nativeOperations) operationCapabilities[operation] = { supported: true };
  for (const operation of fallbackOperations)
    operationCapabilities[operation] = {
      supported: true,
      notes: ["Applied through the built-in RGBA pixel pipeline."],
    };

  operationCapabilities.composite = {
    supported: true,
    notes: [
      "Native compositing.",
      "The pipeline is materialized at each composite to preserve recipe order.",
      "Translucent layers with separable blends follow libvips premultiplied-alpha behavior.",
    ],
  };

  return {
    name: "sharp",

    async capabilities(): Promise<ImageCapabilities> {
      capabilitiesPromise ??= (async () => {
        const factory = await loadFactory(options);
        const formatMap = (
          factory as unknown as {
            format: Record<string, { input?: { buffer?: boolean }; output?: { buffer?: boolean } }>;
          }
        ).format;
        const hevcEncoding = await probeSharpHevcEncoding(factory);
        return {
          driver: "sharp",
          formats: sharpCapabilityFormats(formatMap, hevcEncoding),
          metadataRead: true,
          operations: operationCapabilities,
          notes: [
            "Explicit decode.frames controls multi-frame input; GIF output no longer changes it implicitly.",
            "Operations without a native sharp implementation run through the built-in RGBA fallback.",
            ...(hevcEncoding
              ? []
              : ["HEIF/HEIC encoding is unavailable because libvips has no HEVC encoder."]),
          ],
        } as ImageCapabilities;
      })();
      try {
        return await capabilitiesPromise;
      } catch (error) {
        capabilitiesPromise = undefined;
        throw error;
      }
    },

    async metadata(input: ImageInput, context?: DriverRequestContext): Promise<ImageMetadata> {
      const factory = await loadFactory(options);
      const instance = await createSharp(factory, input);
      try {
        const meta = await abortable(instance.metadata(), context?.signal, "metadata");
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
        const meta = await abortable(instance.metadata(), request.signal, "metadata");
        if (meta.width === undefined || meta.height === undefined) {
          throw new UnImageError("The image metadata is incomplete.", {
            code: "UNIMAGE_INVALID_INPUT",
          });
        }
        const { data, info } = await abortable(
          instance.ensureAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true }),
          request.signal,
          "decode",
        );
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

    async checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      const capabilities = await this.capabilities();
      return checkRecipeCapabilities(recipe, capabilities, (operation) => {
        const capability = capabilities.operations[operation.type];
        if (operation.type === "resize" && operation.kernel === "linear") {
          return { supported: false, notes: ["linear is not a native sharp kernel."] };
        }
        return capability ?? { supported: false };
      });
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

        const { data, info } = await abortable(
          instance.ensureAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true }),
          request.signal,
          "frame decode",
        );
        if (info.height % pages !== 0) {
          throw new UnImageError("The decoder returned an invalid frame strip.", {
            code: "UNIMAGE_DECODE",
          });
        }

        const frameHeight = info.height / pages;
        const frameLength = info.width * frameHeight * 4;
        const format = sharpFormats[meta.format ?? ""] ?? "png";
        const delaysMs = Array.isArray(meta.delay) ? meta.delay : undefined;
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
          ...(delaysMs?.[index] === undefined ? {} : { durationMs: delaysMs[index] }),
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
          ...(meta.loop === undefined ? {} : { loop: meta.loop }),
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
      assertNotAborted(context?.signal, "transform");
      const factory = await loadFactory(options);
      const source = await createSharp(factory, input, {}, options.sharpOptions);
      let sourceMeta;
      try {
        sourceMeta = await abortable(source.metadata(), context?.signal, "metadata");
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
        assertNotAborted(context?.signal, "transform");
        if (operation.type === "composite") {
          const currentMetadata = await instance.metadata();
          const layer = prepareCompositeLayer(
            { width: currentMetadata.width, height: currentMetadata.height },
            operation,
            context?.layers,
          );
          if (layer !== undefined) {
            instance = instance.composite([
              {
                input: Buffer.from(layer.image.data),
                raw: {
                  width: layer.image.width,
                  height: layer.image.height,
                  channels: 4,
                },
                left: layer.left,
                top: layer.top,
                blend: operation.blend ?? "over",
              },
            ]);
          }
          // Materialize immediately: sharp positions composite at the end of its
          // native pipeline, so deferred composition would reorder later operations.
          instance = await materializeSharp(
            factory,
            instance,
            recipe.output.metadataPolicy === "preserve",
            context?.signal,
            "composite",
          );
          continue;
        }
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
        instance = await applyPixelFilterSharp(
          factory,
          instance,
          operation as PixelFallbackOperation,
          recipe.output.metadataPolicy === "preserve",
          context?.signal,
        );
      }

      const encoded = await abortable(
        encoderFor(instance, recipe).toBuffer({ resolveWithObject: true }),
        context?.signal,
        "encode",
      );

      const meta2 = await abortable(
        (await createSharp(factory, encoded.data)).metadata(),
        context?.signal,
        "encode metadata",
      );
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
