import { HTTPError } from "h3";

import { canvasDriver, type CanvasDriverOptions } from "./drivers/canvas";
import { overlayDriver } from "./drivers/overlay";
import { sharpDriver } from "./drivers/sharp";
import { svgoDriver, type SvgoDriverOptions } from "./drivers/svgo";
import { createImageManager } from "./manager";
import type { ProxyStorage } from "./storage/types";
import { normalizeStorage, type ProxyStorageInput } from "./storage/unstorage";
import type { FitMode, ImageFormat, ImageMetadata, ImageOperation, ImageManager } from "./types";
import { normalizeMaxAge } from "./utils/cache";

export type ImageProxySourceMeta = {
  mtime?: Date;
  maxAge?: number;
};

export type FlagModifier = true | "true" | "";

export type ImageProxyFormatModifier =
  | "jpeg"
  | "jpg"
  | "png"
  | "webp"
  | "avif"
  | "gif"
  | "tiff"
  | "heif"
  | "heic"
  | "auto"
  | (string & {});

export type ImageProxyFitModifier =
  | "contain"
  | "cover"
  | "fill"
  | "inside"
  | "outside"
  | (string & {});

export type ImageProxyKernelModifier =
  | "nearest"
  | "cubic"
  | "mitchell"
  | "lanczos2"
  | "lanczos3"
  | (string & {});

export interface ImageProxyModifiers {
  format?: ImageProxyFormatModifier;
  f?: ImageProxyFormatModifier;
  fit?: ImageProxyFitModifier;
  resize?: string;
  s?: string;
  quality?: number | string;
  q?: number | string;
  background?: string;
  b?: string;
  position?: string;
  pos?: string;
  enlarge?: FlagModifier | false | "false";
  kernel?: ImageProxyKernelModifier;
  trim?: number | string;
  extend?: string;
  extract?: string;
  crop?: string;
  rotate?: number | string;
  autoorient?: FlagModifier;
  flip?: FlagModifier;
  flop?: FlagModifier;
  sharpen?: number | string;
  median?: number | string;
  blur?: number | string;
  dilate?: number | string;
  erode?: number | string;
  clahe?: number | string;
  contrast?: number | string;
  removealpha?: FlagModifier;
  ensurealpha?: number | string;
  flatten?: FlagModifier;
  unflatten?: FlagModifier;
  gamma?: string;
  negate?: boolean | string;
  normalize?: boolean | string;
  threshold?: number | string;
  linear?: string;
  modulate?: string;
  brightness?: number | string;
  saturation?: number | string;
  hue?: number | string;
  lightness?: number | string;
  opacity?: number | string;
  tint?: number | string;
  grayscale?: FlagModifier;
  animated?: FlagModifier;
  a?: FlagModifier;
  width?: number | string;
  w?: number | string;
  height?: number | string;
  h?: number | string;
}

const supportedImageFormats: readonly ImageFormat[] = [
  "png",
  "jpeg",
  "webp",
  "avif",
  "gif",
  "svg",
  "tiff",
  "heif",
  "heic",
  "bmp",
  "ico",
  "jxl",
  "pnm",
  "tga",
];

export const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(supportedImageFormats);
export interface ImageProxyOptions {
  driver?: import("./types").ImageDriver;
  svgo?: boolean | SvgoDriverOptions;
  /** Options for the default Canvas2D driver. */
  canvasOptions?: CanvasDriverOptions;
  /** Options for the fallback sharp driver. */
  sharpOptions?: Record<string, unknown>;
  maxAge?: number;
  maxOutputDimension?: number | false;
  alias?: Record<string, string>;
  storage: ProxyStorageInput;
  httpStorage?: ProxyStorageInput;
}

export interface ImageProxyRequestOptions {
  signal?: AbortSignal | undefined;
}

export type ImageProxy = (
  id: string,
  modifiers?: Partial<ImageProxyModifiers>,
  requestOptions?: ImageProxyRequestOptions,
) => {
  getSourceMeta: (options?: ImageProxyRequestOptions) => Promise<ImageProxySourceMeta>;
  process: (options?: ImageProxyRequestOptions) => Promise<{
    data: Uint8Array;
    format: ImageFormat;
    metadata: ImageMetadata;
  }>;
};

const defaultMaxOutputDimension = 8192;
const knownModifiers = new Set<string>([
  "format",
  "f",
  "fit",
  "resize",
  "s",
  "quality",
  "q",
  "background",
  "b",
  "position",
  "pos",
  "enlarge",
  "kernel",
  "trim",
  "extend",
  "extract",
  "crop",
  "rotate",
  "autoorient",
  "flip",
  "flop",
  "sharpen",
  "median",
  "blur",
  "dilate",
  "erode",
  "clahe",
  "contrast",
  "removealpha",
  "ensurealpha",
  "flatten",
  "unflatten",
  "gamma",
  "negate",
  "normalize",
  "threshold",
  "linear",
  "modulate",
  "brightness",
  "saturation",
  "hue",
  "lightness",
  "opacity",
  "tint",
  "grayscale",
  "animated",
  "a",
  "width",
  "w",
  "height",
  "h",
]);

function invalidModifier(name: string, reason: string): HTTPError {
  return new HTTPError({
    status: 400,
    statusText: "UNIMAGE_INVALID_MODIFIER",
    message: `The "${name}" modifier ${reason}.`,
  });
}

function normalizeFit(value: ImageProxyFitModifier): FitMode {
  if (value === "inside") return "contain";
  if (value === "outside") return "outside";
  if (value === "contain") return "contain";
  if (value === "cover") return "cover";
  if (value === "fill") return "fill";
  return "contain";
}

function toFlag(value: unknown): boolean {
  return value !== undefined && value !== false && value !== "false";
}

function parseNumber(value: unknown, name: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw invalidModifier(name, "is invalid");
  }
  return parsed;
}

function parseDimension(value: string, name: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw invalidModifier(name, "must be a positive integer");
  }
  return parsed;
}

function parseResizeSize(
  value: string,
  name: string,
): {
  width?: number;
  height?: number;
} {
  const [rawWidth = "", rawHeight = ""] = value.toLowerCase().split("x");
  if (value === "" || value.toLowerCase().split("x").length > 2) {
    throw invalidModifier(name, "is invalid");
  }
  const width = parseDimension(rawWidth, `${name}.width`);
  const height = parseDimension(rawHeight, `${name}.height`);
  if (width === undefined && height === undefined) {
    throw invalidModifier(name, "requires a width, height, or both");
  }
  const size: { width?: number; height?: number } = {};
  if (width !== undefined) size.width = width;
  if (height !== undefined) size.height = height;
  return size;
}

function parseCrop(value: string): ImageOperation {
  const [x = "", y = "", width = "", height = ""] = value.split("_");
  const crop = {
    type: "crop",
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
  } as const;

  if (
    value.split("_").length !== 4 ||
    !Number.isInteger(crop.x) ||
    crop.x < 0 ||
    !Number.isInteger(crop.y) ||
    crop.y < 0 ||
    !Number.isInteger(crop.width) ||
    crop.width <= 0 ||
    !Number.isInteger(crop.height) ||
    crop.height <= 0
  ) {
    throw invalidModifier("crop", "must use left_top_width_height");
  }
  return crop;
}

function clampDimension(value: number, max: number): number {
  return Math.max(1, Math.min(value, max));
}

function modifierParts(value: string, maximum: number): (string | undefined)[] {
  const parts = value.split("_");
  if (parts.length > maximum) {
    throw invalidModifier(value, "has too many arguments");
  }
  return Array.from({ length: maximum }, (_, index) => parts[index] || undefined);
}

function optionalNumber(value: string | undefined, name: string): number | undefined {
  return value === undefined ? undefined : parseNumber(value, name);
}

function modifierNumber(value: string, name: string): number {
  return parseNumber(value, name);
}

function parseMorphologySize(value: number | string, name: string): number {
  const size = parseNumber(value, name);
  if (!Number.isInteger(size) || size < 1 || size > 15) {
    throw new HTTPError({
      status: 400,
      statusText: "UNIMAGE_UNSUPPORTED_MODIFIER",
      message: `The "${name}" size must be an integer from 1 to 15.`,
    });
  }
  return size;
}

function parseKernel(value: string): import("./types").ResizeKernel {
  const kernels = ["nearest", "linear", "cubic", "mitchell", "lanczos2", "lanczos3"];
  if (!(kernels as string[]).includes(value)) {
    throw invalidModifier("kernel", `is invalid: ${value}`);
  }
  return value as import("./types").ResizeKernel;
}
function parsePosition(value: string): import("./types").ImagePosition {
  const normalized = value.replace(/-/g, " ").toLowerCase();
  if (normalized === "entropy" || normalized === "attention")
    return normalized as import("./types").ImagePosition;
  const byName: Record<string, import("./types").ImagePosition> = {
    top: "top",
    north: "top",
    "right top": "right top",
    northeast: "right top",
    right: "right",
    east: "right",
    "right bottom": "right bottom",
    southeast: "right bottom",
    bottom: "bottom",
    south: "bottom",
    "left bottom": "left bottom",
    southwest: "left bottom",
    left: "left",
    west: "left",
    "left top": "left top",
    northwest: "left top",
    center: "center",
    centre: "center",
  };
  if (normalized in byName) return byName[normalized] as import("./types").ImagePosition;
  const gravity = Number(normalized);
  const byGravity = [
    "top",
    "right top",
    "right",
    "right bottom",
    "bottom",
    "left bottom",
    "left",
    "left top",
    "center",
  ] as const;
  if (Number.isInteger(gravity) && gravity >= 0 && gravity <= 8) {
    return byGravity[gravity] as import("./types").ImagePosition;
  }
  throw invalidModifier("position", `is invalid: ${value}`);
}
export function modifiersToRecipe(
  modifiers: Partial<ImageProxyModifiers>,
  metadata: ImageMetadata,
  maxOutputDimension: number | false,
): import("./types").ImageRecipe {
  const unsupported = Object.keys(modifiers)
    .filter((key) => modifiers[key as keyof ImageProxyModifiers] !== undefined)
    .filter((key) => !knownModifiers.has(key));
  if (unsupported.length > 0) {
    throw new HTTPError({
      status: 400,
      statusText: "UNIMAGE_UNSUPPORTED_MODIFIER",
      message: `Unsupported image modifiers: ${unsupported.join(", ")}`,
    });
  }

  const max = maxOutputDimension === false ? Number.POSITIVE_INFINITY : maxOutputDimension;
  const operations: ImageOperation[] = [];
  const background = modifiers.background ?? modifiers.b;
  if (toFlag(modifiers.autoorient)) operations.push({ type: "autoOrient" });

  if (modifiers.blur !== undefined) {
    operations.push({ type: "blur", sigma: parseNumber(modifiers.blur, "blur") });
  }
  if (modifiers.brightness !== undefined)
    operations.push({
      type: "modulate",
      brightness: parseNumber(modifiers.brightness, "brightness"),
    });
  if (modifiers.clahe !== undefined) {
    const parts = modifierParts(String(modifiers.clahe), 3);
    const width = optionalNumber(parts[0], "clahe.width");
    const height = optionalNumber(parts[1], "clahe.height");
    if (
      width === undefined ||
      height === undefined ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      throw invalidModifier("clahe", "requires positive integer tiles, e.g. clahe=8:8:3");
    }
    const maxSlope = optionalNumber(parts[2], "clahe.maxSlope");
    if (maxSlope !== undefined && (!Number.isInteger(maxSlope) || maxSlope < 1)) {
      throw invalidModifier("clahe", "maxSlope must be a positive integer");
    }
    operations.push({
      type: "clahe",
      width,
      height,
      ...(maxSlope === undefined ? {} : { maxSlope }),
    });
  }
  if (modifiers.contrast !== undefined) {
    const amount = parseNumber(modifiers.contrast, "contrast");
    if (amount < -100 || amount > 100) {
      throw invalidModifier("contrast", "must be between -100 and 100");
    }
    operations.push({ type: "contrast", amount });
  }
  if (modifiers.extract !== undefined || modifiers.crop !== undefined) {
    operations.push(parseCrop((modifiers.extract ?? modifiers.crop) as string));
  }

  if (modifiers.dilate !== undefined) {
    operations.push({ type: "dilate", size: parseMorphologySize(modifiers.dilate, "dilate") });
  }
  if (modifiers.erode !== undefined) {
    operations.push({ type: "erode", size: parseMorphologySize(modifiers.erode, "erode") });
  }
  if (toFlag(modifiers.ensurealpha)) {
    const alphaValue = modifiers.ensurealpha === "" ? undefined : Number(modifiers.ensurealpha);
    if (
      alphaValue !== undefined &&
      (!Number.isFinite(alphaValue) || alphaValue < 0 || alphaValue > 1)
    ) {
      throw invalidModifier("ensurealpha", "must be between 0 and 1");
    }
    operations.push({
      type: "ensureAlpha",
      ...(alphaValue === undefined ? {} : { alpha: alphaValue }),
    });
  }
  if (modifiers.extend !== undefined) {
    const parts = modifierParts(modifiers.extend, 5);
    const mode = parts[4];
    const edges = [parts[0], parts[1], parts[2], parts[3]].map((value) => {
      const amount = optionalNumber(value, `extend.edge`) ?? 0;
      if (!Number.isInteger(amount) || amount < 0) {
        throw invalidModifier("extend", "edge sizes must be non-negative integers");
      }
      return amount;
    });
    const extendModes = ["background", "copy", "repeat", "mirror"] as const;
    if (mode !== undefined && !extendModes.includes(mode as (typeof extendModes)[number])) {
      throw new HTTPError({
        status: 400,
        statusText: "UNIMAGE_UNSUPPORTED_MODIFIER",
        message: `The "extend" mode is unsupported: ${mode}`,
      });
    }
    operations.push({
      type: "extend",
      top: edges[0]!,
      right: edges[1]!,
      bottom: edges[2]!,
      left: edges[3]!,
      ...(background === undefined ? {} : { background }),
      ...(mode === undefined || mode === "background"
        ? {}
        : { extendWith: mode as import("./types").ExtendMode }),
    });
  }
  if (toFlag(modifiers.flatten))
    operations.push({ type: "flatten", ...(background === undefined ? {} : { background }) });
  if (toFlag(modifiers.flip)) operations.push({ type: "flip", axis: "vertical" });
  if (toFlag(modifiers.flop)) operations.push({ type: "flip", axis: "horizontal" });
  if (modifiers.gamma !== undefined) {
    const parts = modifierParts(String(modifiers.gamma), 2);
    const gamma: Extract<ImageOperation, { type: "gamma" }> = {
      type: "gamma",
      gamma: optionalNumber(parts[0], "gamma") ?? 1,
    };
    if (parts[1] !== undefined) gamma.gammaOut = modifierNumber(parts[1], "gamma.gammaOut");
    operations.push(gamma);
  }
  if (toFlag(modifiers.grayscale)) operations.push({ type: "grayscale" });
  if (modifiers.hue !== undefined)
    operations.push({ type: "modulate", hue: parseNumber(modifiers.hue, "hue") });
  if (modifiers.lightness !== undefined)
    operations.push({ type: "modulate", lightness: parseNumber(modifiers.lightness, "lightness") });
  if (modifiers.linear !== undefined) {
    const parts = modifierParts(String(modifiers.linear), 2);
    const linear: Extract<ImageOperation, { type: "linear" }> = { type: "linear" };
    if (parts[0] !== undefined) linear.a = modifierNumber(parts[0], "linear.a");
    if (parts[1] !== undefined) linear.b = modifierNumber(parts[1], "linear.b");
    operations.push(linear);
  }
  if (modifiers.median !== undefined) {
    const size = optionalNumber(String(modifiers.median), "median");
    if (size === undefined || !Number.isInteger(size) || size < 1 || size > 15) {
      throw new HTTPError({
        status: 400,
        statusText: "UNIMAGE_UNSUPPORTED_MODIFIER",
        message: "The median size must be an integer from 1 to 15.",
      });
    }
    operations.push({ type: "median", size });
  }
  if (modifiers.modulate !== undefined) {
    const parts = modifierParts(String(modifiers.modulate), 4);
    const modulate: Extract<ImageOperation, { type: "modulate" }> = { type: "modulate" };
    if (parts[0] !== undefined)
      modulate.brightness = modifierNumber(parts[0], "modulate.brightness");
    if (parts[1] !== undefined)
      modulate.saturation = modifierNumber(parts[1], "modulate.saturation");
    if (parts[2] !== undefined) modulate.hue = modifierNumber(parts[2], "modulate.hue");
    if (parts[3] !== undefined) modulate.lightness = modifierNumber(parts[3], "modulate.lightness");
    operations.push(modulate);
  }
  if (toFlag(modifiers.negate)) operations.push({ type: "invert" });
  if (modifiers.normalize !== undefined) {
    const parts = modifierParts(String(modifiers.normalize), 2);
    const normalize: Extract<ImageOperation, { type: "normalize" }> = { type: "normalize" };
    if (parts[0] !== undefined) normalize.lower = modifierNumber(parts[0], "normalize.lower");
    if (parts[1] !== undefined) normalize.upper = modifierNumber(parts[1], "normalize.upper");
    operations.push(normalize);
  }
  if (modifiers.opacity !== undefined)
    operations.push({ type: "opacity", factor: parseNumber(modifiers.opacity, "opacity") });
  if (toFlag(modifiers.removealpha)) operations.push({ type: "removeAlpha" });
  const size =
    (modifiers.resize ?? modifiers.s)
      ? parseResizeSize(
          (modifiers.resize ?? modifiers.s) as string,
          modifiers.resize ? "resize" : "s",
        )
      : {
          width:
            (modifiers.width ?? modifiers.w === undefined)
              ? undefined
              : parseDimension(String(modifiers.width ?? modifiers.w), "width"),
          height:
            (modifiers.height ?? modifiers.h === undefined)
              ? undefined
              : parseDimension(String(modifiers.height ?? modifiers.h), "height"),
        };
  const width = size.width === undefined ? undefined : clampDimension(size.width, max);
  const height = size.height === undefined ? undefined : clampDimension(size.height, max);

  if (width !== undefined || height !== undefined) {
    const fit = modifiers.fit ?? "cover";
    if (
      fit !== "contain" &&
      fit !== "cover" &&
      fit !== "fill" &&
      fit !== "inside" &&
      fit !== "outside"
    ) {
      throw invalidModifier("fit", `is invalid: ${fit}`);
    }
    operations.push({
      type: "resize",
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      fit: normalizeFit(fit),
      withoutEnlargement: !toFlag(modifiers.enlarge),
      ...(modifiers.kernel === undefined ? {} : { kernel: parseKernel(String(modifiers.kernel)) }),
      ...(modifiers.position === undefined && modifiers.pos === undefined
        ? {}
        : { position: parsePosition(String(modifiers.position ?? modifiers.pos)) }),
    });
  }

  if (modifiers.rotate !== undefined) {
    operations.push({
      type: "rotate",
      angle: parseNumber(modifiers.rotate, "rotate"),
      ...(background === undefined ? {} : { background }),
    });
  }
  if (modifiers.saturation !== undefined)
    operations.push({
      type: "modulate",
      saturation: parseNumber(modifiers.saturation, "saturation"),
    });
  if (modifiers.sharpen !== undefined) {
    const parts = modifierParts(String(modifiers.sharpen), 6);
    const sharpen: Extract<ImageOperation, { type: "sharpen" }> = { type: "sharpen" };
    if (parts[0] !== undefined) sharpen.sigma = modifierNumber(parts[0], "sharpen.sigma");
    if (parts[1] !== undefined) sharpen.flat = modifierNumber(parts[1], "sharpen.flat");
    if (parts[2] !== undefined) sharpen.jagged = modifierNumber(parts[2], "sharpen.jagged");
    operations.push(sharpen);
  }
  if (modifiers.threshold !== undefined) {
    const parts = modifierParts(String(modifiers.threshold), 2);
    operations.push({
      type: "threshold",
      value: optionalNumber(parts[0], "threshold") ?? 0,
      ...(parts[1] === undefined ? {} : { grayscale: toFlag(parts[1]) }),
    });
  }
  if (modifiers.tint !== undefined)
    operations.push({ type: "tint", color: String(modifiers.tint) });
  if (modifiers.trim !== undefined) {
    const trim: Extract<ImageOperation, { type: "trim" }> = { type: "trim" };
    if (modifiers.trim !== "") trim.threshold = modifierNumber(String(modifiers.trim), "trim");
    operations.push(trim);
  }
  if (toFlag(modifiers.unflatten)) operations.push({ type: "unflatten" });
  const requestedFormat = modifiers.format ?? modifiers.f;
  const sourceFormat = metadata.format;
  // ImageProxy semantics: an unknown requested format silently falls back to the
  // source format, then to JPEG — it never rejects the URL.
  const requested =
    requestedFormat === "jpg" ? "jpeg" : requestedFormat === "auto" ? undefined : requestedFormat;
  const normalizedFormat: ImageFormat =
    requested !== undefined && SUPPORTED_FORMATS.has(requested)
      ? (requested as ImageFormat)
      : sourceFormat !== undefined && SUPPORTED_FORMATS.has(sourceFormat)
        ? sourceFormat
        : "jpeg";

  const rawQuality = modifiers.quality === undefined ? modifiers.q : modifiers.quality;
  const quality = rawQuality === undefined ? undefined : parseNumber(rawQuality, "quality");
  if (quality !== undefined && (!Number.isInteger(quality) || quality < 1 || quality > 100)) {
    throw invalidModifier("quality", "must be an integer between 1 and 100");
  }

  // ImageProxy semantics: `a`/`animated` forces all input frames. GIF output is
  // animated by default for compatibility with existing URLs.
  const frames =
    modifiers.animated !== undefined || modifiers.a !== undefined || normalizedFormat === "gif"
      ? ("all" as const)
      : undefined;

  return {
    operations,
    ...(frames === undefined ? {} : { input: { frames } }),
    output: {
      format: normalizedFormat,
      ...(quality === undefined ||
      !["jpeg", "webp", "avif", "tiff", "heif", "heic"].includes(normalizedFormat)
        ? {}
        : { quality }),
      metadataPolicy: "strip",
    },
  };
}

export function createImageProxy(userOptions: ImageProxyOptions): ImageProxy {
  const options = {
    ...userOptions,
    maxAge: normalizeMaxAge(userOptions.maxAge) ?? 60,
    maxOutputDimension: userOptions.maxOutputDimension ?? defaultMaxOutputDimension,
    alias: normalizeAlias(userOptions.alias),
  };
  const rasterDriver =
    options.driver ??
    overlayDriver(
      canvasDriver(options.canvasOptions),
      options.sharpOptions === undefined
        ? sharpDriver()
        : sharpDriver({ sharpOptions: options.sharpOptions }),
    );
  const storage = options.storage === undefined ? undefined : normalizeStorage(options.storage);
  const httpStorage =
    options.httpStorage === undefined ? undefined : normalizeStorage(options.httpStorage);
  const driver =
    options.svgo === false
      ? rasterDriver
      : overlayDriver(
          svgoDriver({
            runtime: typeof window === "undefined" ? "node" : "browser",
            ...(options.svgo === true ? {} : options.svgo),
          }),
          rasterDriver,
        );
  const manager: ImageManager = createImageManager({ driver });

  return function proxy(id, modifiers = {}, requestOptions = {}) {
    if (id === "") {
      throw new HTTPError({
        status: 400,
        statusText: "UNIMAGE_MISSING_ID",
        message: "Resource id is missing.",
      });
    }

    const normalizedId = hasProtocol(id) ? id : `/${id.replace(/^\/+/, "")}`;
    const resolvedId = resolveAlias(normalizedId, options.alias);
    const source = hasProtocol(resolvedId) ? (httpStorage ?? storage) : (storage ?? httpStorage);
    if (!source) {
      throw new HTTPError({
        status: 500,
        statusText: "UNIMAGE_NO_STORAGE",
        message: "No image storage is configured.",
      });
    }
    const resolvedStorage: ProxyStorage = source;

    let sourceMetadata: Promise<ImageMetadata> | undefined;
    let sourceMeta: Promise<ImageProxySourceMeta> | undefined;
    let sourceData: Promise<Uint8Array | ArrayBuffer> | undefined;

    async function getSourceMetadata() {
      sourceMetadata ??= manager.metadata(
        await awaitData(),
        requestOptions.signal === undefined ? {} : { signal: requestOptions.signal },
      );
      return sourceMetadata;
    }

    function awaitData(): Promise<Uint8Array | ArrayBuffer> {
      sourceData ??= (async () => {
        const data = await resolvedStorage.getData(
          resolvedId,
          requestOptions.signal === undefined ? {} : { signal: requestOptions.signal },
        );
        if (data === undefined) {
          throw new HTTPError({
            status: 404,
            statusText: "UNIMAGE_NOT_FOUND",
            message: `Resource not found: ${resolvedId}`,
          });
        }
        return data;
      })();
      return sourceData;
    }

    return {
      getSourceMeta(requestOptions?: ImageProxyRequestOptions) {
        sourceMeta ??= (async () => {
          const signal = requestOptions?.signal;
          const metadata = await resolvedStorage.getMeta(
            resolvedId,
            signal === undefined ? {} : { signal },
          );
          if (metadata === undefined) {
            throw new HTTPError({
              status: 404,
              statusText: "UNIMAGE_NOT_FOUND",
              message: `Resource not found: ${resolvedId}`,
            });
          }
          const mtime = metadata.mtime === undefined ? undefined : new Date(metadata.mtime);
          const maxAge = normalizeMaxAge(metadata.maxAge) ?? options.maxAge;
          return {
            ...(mtime === undefined ? {} : { mtime }),
            maxAge,
          };
        })();
        return sourceMeta;
      },

      async process(requestOptions?: ImageProxyRequestOptions) {
        const signal = requestOptions?.signal;
        const metadata = await getSourceMetadata();
        const recipe = modifiersToRecipe(modifiers, metadata, options.maxOutputDimension);
        const result = await manager.transform(
          await awaitData(),
          recipe,
          signal === undefined ? {} : { signal },
        );
        return {
          data: result.data,
          format: result.format,
          metadata: result.metadata,
        };
      },
    };
  };
}

function hasProtocol(id: string): boolean {
  return /^[a-z][a-z\d+\-.]*:/i.test(id);
}

function normalizeAlias(alias: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(alias ?? {}).map(([key, value]) => [
      key.startsWith("/") ? key : `/${key}`,
      value,
    ]),
  );
}

function resolveAlias(id: string, alias: Record<string, string>): string {
  for (const [key, value] of Object.entries(alias)) {
    if (id === key || id.startsWith(`${key}/`)) {
      const suffix = id.slice(key.length).replace(/^\/+/, "");
      const base = value.replace(/\/+$/, "");
      return suffix === "" ? base : `${base}/${suffix}`;
    }
  }
  return id;
}
