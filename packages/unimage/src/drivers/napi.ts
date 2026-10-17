import { UnImageError } from "../errors";
import { checkRecipeCapabilities } from "../recipe";
import type {
  ImageCapabilities,
  ImageDecodeRequest,
  ImageDriver,
  ImageFormat,
  ImageInput,
  ImageMetadata,
  ImageOperation,
  ImageCapabilityResult,
  ImagePipelineConfig,
  ImageResult,
  RawImageFrame,
  RawImageData,
} from "../types";
import { assertNotAborted } from "../utils/abort";
import { applyPixelFilter, parseColor } from "../utils/filters";
import { sniffImageFormat } from "../utils/format";
import { decodeSvg, parseSvgMetadata } from "./svgo";

interface NapiTransformer {
  metadata(withExif?: boolean | null, signal?: AbortSignal | null): Promise<NapiImageMetadata>;
  rotate(orientation?: number | null): this;
  grayscale(): this;
  invert(): this;
  resize(
    widthOrOptions:
      | number
      | {
          width: number;
          height?: number;
          filter?: number;
          fit?: number;
        },
    height?: number | null,
    filter?: number | null,
    fit?: number | null,
  ): this;
  blur(sigma: number): this;
  unsharpen(sigma: number, threshold: number): this;
  filter3x3(kernel: number[]): this;
  adjustContrast(contrast: number): this;
  huerotate(hue: number): this;
  opacity(factor: number): this;
  fastResize(options: { width: number; height?: number; filter?: number; fit?: number }): this;
  rawPixels(signal?: AbortSignal | null): Promise<Uint8Array>;
  crop(x: number, y: number, width: number, height: number): this;
  png(options?: object | null, signal?: AbortSignal | null): Promise<Uint8Array>;
  jpeg(quality?: number | null, signal?: AbortSignal | null): Promise<Uint8Array>;
  webp(qualityFactor?: number | null, signal?: AbortSignal | null): Promise<Uint8Array>;
  webpLossless(signal?: AbortSignal | null): Promise<Uint8Array>;
  avif(options?: { quality?: number }, signal?: AbortSignal | null): Promise<Uint8Array>;
  heic(options?: { quality?: number }, signal?: AbortSignal | null): Promise<Uint8Array>;
  tiff(signal?: AbortSignal | null): Promise<Uint8Array>;
  bmp(signal?: AbortSignal | null): Promise<Uint8Array>;
  ico(signal?: AbortSignal | null): Promise<Uint8Array>;
  pnm(signal?: AbortSignal | null): Promise<Uint8Array>;
  tga(signal?: AbortSignal | null): Promise<Uint8Array>;
  farbfeld(signal?: AbortSignal | null): Promise<Uint8Array>;
}

interface NapiTransformerConstructor {
  new (input: Uint8Array): NapiTransformer;
  fromSvg(svg: string, background?: string): NapiTransformer;
  fromRgbaPixels(
    input: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ): NapiTransformer;
}

interface NapiImageMetadata {
  width: number;
  height: number;
  orientation?: number;
  format: string;
  colorType: number;
}

export interface NapiModule {
  Transformer: NapiTransformerConstructor;
}

export interface NapiDriverOptions {
  /**
   * Inject a resolved `@napi-rs/image` module. When omitted, the official
   * package loader selects the appropriate backend.
   */
  lib?: NapiModule | (() => NapiModule | Promise<NapiModule>);
}

const resizeFilterNearest = 0;
const resizeFilterTriangle = 1;
const resizeFilterCatmullRom = 2;
const resizeFilterLanczos3 = 4;
const resizeFitCover = 0;
const resizeFitFill = 1;
const orientationHorizontal = 1;
const orientationMirrorHorizontal = 2;
const orientationMirrorVertical = 4;
const orientationRotate180 = 3;
const orientationRotate90Cw = 6;
const orientationRotate270Cw = 8;
const alphaColorTypes = new Set([1, 3, 5, 7, 9]);

const formats: readonly ImageFormat[] = [
  "png",
  "jpeg",
  "webp",
  "avif",
  "tiff",
  "bmp",
  "ico",
  "pnm",
  "heif",
  "heic",
];
const mediaTypes: Record<ImageFormat, string> = {
  bmp: "image/bmp",
  ico: "image/x-icon",
  jxl: "image/jxl",
  pnm: "image/x-portable-anymap",
  tga: "image/x-tga",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

function isRawImage(input: ImageInput): input is RawImageData {
  return (
    typeof input === "object" &&
    input !== null &&
    "data" in input &&
    "width" in input &&
    "height" in input &&
    "layout" in input
  );
}

function formatFromNapi(value: string): ImageFormat | undefined {
  const normalized = value.trim().toLowerCase();
  return (formats as readonly string[]).includes(normalized)
    ? (normalized as ImageFormat)
    : undefined;
}

function normalizeNapiModule(module: unknown): NapiModule | undefined {
  const candidate = module as
    | NapiModule
    | { default?: NapiModule | { Transformer?: unknown } }
    | undefined;
  if (!candidate) return undefined;
  if ("Transformer" in candidate) return candidate as NapiModule;
  const fallback = candidate.default;
  return fallback && "Transformer" in fallback ? (fallback as NapiModule) : undefined;
}

let napiModuleCache: Promise<NapiModule> | undefined;

async function importNapiModule(name: string): Promise<NapiModule> {
  const normalized = normalizeNapiModule(await import(name));
  if (normalized === undefined) {
    throw new TypeError(`The "${name}" module does not export an image Transformer.`);
  }
  return normalized;
}

async function loadModule(options: NapiDriverOptions): Promise<NapiModule> {
  if (typeof options.lib === "function") return await options.lib();
  if (options.lib) return options.lib;
  napiModuleCache ??= importNapiModule("@napi-rs/image").catch((error: unknown) => {
    throw new UnImageError(
      'The "@napi-rs/image" loader could not select a backend. Install the optional "@napi-rs/image-wasm32-wasi" package for WASI support.',
      {
        code: "UNIMAGE_DRIVER_UNAVAILABLE",
        cause: error,
      },
    );
  });
  return napiModuleCache;
}

const nativeEndianLittle = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function normalizeRawToRgba(
  data: Uint8Array,
  width: number,
  height: number,
  colorType: number,
): Uint8Array {
  const pixels = width * height;
  if (colorType === 3) return data;
  const output = new Uint8Array(pixels * 4);
  const sixteenBit = colorType >= 4 && colorType <= 7;
  const view = sixteenBit ? new DataView(data.buffer, data.byteOffset, data.byteLength) : undefined;
  const channel = (index: number): number => {
    if (view !== undefined) {
      return Math.round(view.getUint16(index * 2, nativeEndianLittle) / 257);
    }
    return data[index]!;
  };
  const floatChannel = (index: number): number =>
    Math.max(0, Math.min(255, Math.round((data[index] ?? 0) * 255)));

  for (let index = 0; index < pixels; index += 1) {
    if (colorType === 0 || colorType === 4) {
      const value = channel(index);
      output.set([value, value, value, 255], index * 4);
      continue;
    }
    if (colorType === 1 || colorType === 5) {
      const value = channel(index);
      output.set([value, value, value, channel(pixels + index)], index * 4);
      continue;
    }
    if (colorType === 2 || colorType === 6) {
      const offset = colorType === 6 ? index * 4 : index * 3;
      output.set([channel(offset), channel(offset + 1), channel(offset + 2), 255], index * 4);
      continue;
    }
    if (colorType === 7) {
      const offset = index * 4;
      output.set(
        [channel(offset), channel(offset + 1), channel(offset + 2), channel(offset + 3)],
        index * 4,
      );
      continue;
    }
    if (colorType === 8) {
      output.set(
        [floatChannel(index * 3), floatChannel(index * 3 + 1), floatChannel(index * 3 + 2), 255],
        index * 4,
      );
      continue;
    }
    if (colorType === 9) {
      output.set(
        [
          floatChannel(index * 4),
          floatChannel(index * 4 + 1),
          floatChannel(index * 4 + 2),
          floatChannel(index * 4 + 3),
        ],
        index * 4,
      );
      continue;
    }
    throw new UnImageError("Napi-image returned an unsupported raw pixel layout.", {
      code: "UNIMAGE_DECODE",
    });
  }
  return output;
}

async function readRgbaState(
  transformer: NapiTransformer,
  signal: AbortSignal | undefined,
): Promise<{
  state: RawImageData;
  metadata: ImageMetadata;
  colorType: number;
}> {
  const nativeMetadata = await transformer.metadata(false, signal);
  const metadata = normalizeMetadata(nativeMetadata);
  const raw = new Uint8Array(await transformer.rawPixels(signal));
  return {
    colorType: nativeMetadata.colorType,
    metadata,
    state: {
      data: normalizeRawToRgba(raw, metadata.width, metadata.height, nativeMetadata.colorType),
      width: metadata.width,
      height: metadata.height,
      layout: "rgba8",
    },
  };
}

async function toRgbaState(
  transformer: NapiTransformer,
  signal: AbortSignal | undefined,
): Promise<RawImageData> {
  return (await readRgbaState(transformer, signal)).state;
}

async function filterPixels(
  transformer: NapiTransformer,
  signal: AbortSignal | undefined,
  operation: Parameters<typeof applyPixelFilter>[1],
) {
  const current = await toRgbaState(transformer, signal);
  return applyPixelFilter(current, operation);
}

async function createTransformer(module: NapiModule, input: ImageInput): Promise<NapiTransformer> {
  try {
    if (isRawImage(input)) {
      const expected = input.width * input.height * 4;
      if (input.layout !== "rgba8" || input.data.length < expected) {
        throw new UnImageError("Raw image data does not match its declared dimensions.", {
          code: "UNIMAGE_INVALID_INPUT",
        });
      }
      return module.Transformer.fromRgbaPixels(input.data, input.width, input.height);
    }

    const bytes =
      input instanceof Blob
        ? new Uint8Array(await input.arrayBuffer())
        : input instanceof Uint8Array
          ? input
          : new Uint8Array(input);
    if ((await sniffImageFormat(bytes)) === "svg") {
      const svg = await decodeSvg(bytes);
      const { width, height } = parseSvgMetadata(svg);
      // fromSvg rasterizes at a fixed oversampled scale, so restore the
      // declared SVG dimensions before any recipe operations run.
      return module.Transformer.fromSvg(svg).resize(
        width,
        height,
        resizeFilterLanczos3,
        resizeFitFill,
      );
    }
    return new module.Transformer(bytes);
  } catch (error) {
    if (error instanceof UnImageError) throw error;
    if (error instanceof Error && /Could not find module|Cannot find module/.test(error.message)) {
      throw new UnImageError(
        'The "@napi-rs/image" driver dependency is unavailable in this runtime.',
        { code: "UNIMAGE_DRIVER_UNAVAILABLE", cause: error },
      );
    }
    throw new UnImageError("The image could not be decoded.", {
      code: "UNIMAGE_DECODE",
      cause: error,
    });
  }
}

function normalizeMetadata(metadata: NapiImageMetadata, byteLength?: number): ImageMetadata {
  const normalized: ImageMetadata = {
    width: metadata.width,
    height: metadata.height,
  };
  const format = formatFromNapi(metadata.format);
  if (format !== undefined) normalized.format = format;
  normalized.mediaType = format === undefined ? "application/octet-stream" : mediaTypes[format];
  if (byteLength !== undefined) normalized.byteLength = byteLength;
  if (alphaColorTypes.has(metadata.colorType)) normalized.hasAlpha = true;
  if (
    metadata.orientation !== undefined &&
    metadata.orientation >= 1 &&
    metadata.orientation <= 8
  ) {
    normalized.orientation = metadata.orientation as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  }
  return normalized;
}

function resizeValues(
  operation: Extract<ImageOperation, { type: "resize" }>,
  width: number,
  height: number,
): { width: number; height: number } | undefined {
  const fit = operation.fit ?? "cover";

  if (operation.width === undefined || operation.height === undefined) {
    const targetWidth = operation.width;
    const targetHeight = operation.height;
    if (operation.withoutEnlargement === true) {
      if (targetWidth !== undefined && targetWidth >= width) return undefined;
      if (targetHeight !== undefined && targetHeight >= height) return undefined;
    }
    if (targetWidth === undefined) {
      return {
        width: Math.max(1, Math.round(width * ((targetHeight ?? height) / height))),
        height: Math.max(1, targetHeight ?? height),
      };
    }
    return {
      width: Math.max(1, targetWidth),
      height: Math.max(1, Math.round(height * (targetWidth / width))),
    };
  }

  if (fit === "outside") {
    const scale = Math.max(operation.width / width, operation.height / height);
    if (operation.withoutEnlargement === true && scale > 1) return undefined;
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  const scale =
    fit === "cover"
      ? Math.max(operation.width / width, operation.height / height)
      : Math.min(operation.width / width, operation.height / height);
  if (operation.withoutEnlargement === true && scale > 1) return undefined;
  return { width: operation.width, height: operation.height };
}

function assertCrop(
  operation: Extract<ImageOperation, { type: "crop" }>,
  width: number,
  height: number,
): void {
  if (operation.x + operation.width > width || operation.y + operation.height > height) {
    throw new UnImageError("Crop bounds extend beyond the current image.", {
      code: "UNIMAGE_INVALID_RECIPE",
      operation: "crop",
    });
  }
}

function rotateOrientation(angle: number): number | undefined {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 0) return orientationHorizontal;
  if (normalized === 90) return orientationRotate90Cw;
  if (normalized === 180) return orientationRotate180;
  if (normalized === 270) return orientationRotate270Cw;
  return undefined;
}

function coverCropOrigin(
  position:
    | "top"
    | "right top"
    | "right"
    | "right bottom"
    | "bottom"
    | "left bottom"
    | "left"
    | "left top"
    | "center"
    | "entropy"
    | "attention",
  scaledWidth: number,
  scaledHeight: number,
  targetWidth: number,
  targetHeight: number,
  focus?: readonly [number, number],
): [number, number] {
  if (focus) {
    const x = Math.round(focus[0] * scaledWidth - targetWidth / 2);
    const y = Math.round(focus[1] * scaledHeight - targetHeight / 2);
    return [
      Math.max(0, Math.min(scaledWidth - targetWidth, x)),
      Math.max(0, Math.min(scaledHeight - targetHeight, y)),
    ];
  }
  const x =
    position === "left" || position === "left top" || position === "left bottom"
      ? 0
      : position === "right" || position === "right top" || position === "right bottom"
        ? scaledWidth - targetWidth
        : Math.floor((scaledWidth - targetWidth) / 2);
  const y =
    position === "top" || position === "left top" || position === "right top"
      ? 0
      : position === "bottom" || position === "left bottom" || position === "right bottom"
        ? scaledHeight - targetHeight
        : Math.floor((scaledHeight - targetHeight) / 2);
  return [x, y];
}
function smartFocus(
  image: { data: Uint8Array; width: number; height: number },
  mode: "entropy" | "attention",
): [number, number] {
  const stride = Math.max(1, Math.ceil(Math.max(image.width, image.height) / 256));
  const smallWidth = Math.max(1, Math.floor(image.width / stride));
  const smallHeight = Math.max(1, Math.floor(image.height / stride));
  const scores = new Float64Array(smallWidth * smallHeight);
  const lumaAt = (x: number, y: number): number => {
    const index =
      (Math.max(0, Math.min(image.height - 1, y)) * image.width +
        Math.max(0, Math.min(image.width - 1, x))) *
      4;
    return (
      0.299 * (image.data[index] as number) +
      0.587 * (image.data[index + 1] as number) +
      0.114 * (image.data[index + 2] as number)
    );
  };
  for (let y = 0; y < smallHeight; y += 1) {
    for (let x = 0; x < smallWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, x * stride);
      const sourceY = Math.min(image.height - 1, y * stride);
      if (mode === "attention") {
        const left = lumaAt(sourceX - stride, sourceY);
        const right = lumaAt(sourceX + stride, sourceY);
        const up = lumaAt(sourceX, sourceY - stride);
        const down = lumaAt(sourceX, sourceY + stride);
        scores[y * smallWidth + x] = Math.abs(right - left) + Math.abs(down - up);
      } else {
        let entropy = 0;
        const histogram = new Map<number, number>();
        const radius = 4;
        let total = 0;
        for (let dy = -radius; dy <= radius; dy += radius) {
          for (let dx = -radius; dx <= radius; dx += radius) {
            const value = Math.round(lumaAt(sourceX + dx * stride, sourceY + dy * stride));
            histogram.set(value, (histogram.get(value) ?? 0) + 1);
            total += 1;
          }
        }
        for (const count of histogram.values()) {
          const probability = count / total;
          entropy -= probability * Math.log2(probability);
        }
        scores[y * smallWidth + x] = entropy;
      }
    }
  }

  const windowWidth = Math.max(1, Math.floor(smallWidth * 0.5));
  const windowHeight = Math.max(1, Math.floor(smallHeight * 0.5));
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestX = smallWidth / 2;
  let bestY = smallHeight / 2;
  for (let y = 0; y + windowHeight <= smallHeight; y += 1) {
    for (let x = 0; x + windowWidth <= smallWidth; x += 1) {
      let total = 0;
      for (let dy = 0; dy < windowHeight; dy += 1) {
        for (let dx = 0; dx < windowWidth; dx += 1)
          total += scores[(y + dy) * smallWidth + x + dx] as number;
      }
      if (total > bestScore) {
        bestScore = total;
        bestX = x + windowWidth / 2;
        bestY = y + windowHeight / 2;
      }
    }
  }
  return [bestX / smallWidth, bestY / smallHeight];
}

async function applyOperation(
  transformer: NapiTransformer,
  operation: ImageOperation,
  signal: AbortSignal | undefined,
): Promise<RawImageData | void> {
  assertNotAborted(signal, "transform");

  switch (operation.type) {
    case "autoOrient":
      transformer.rotate();
      return;
    case "resize": {
      const current = await transformer.metadata(false, signal);
      const target = resizeValues(operation, current.width, current.height);
      if (!target) return;
      const filter =
        operation.kernel === "nearest"
          ? resizeFilterNearest
          : operation.kernel === "linear"
            ? resizeFilterTriangle
            : operation.kernel === "cubic" || operation.kernel === "mitchell"
              ? resizeFilterCatmullRom
              : resizeFilterLanczos3;
      if (
        operation.fit === "cover" &&
        operation.position !== undefined &&
        operation.position !== "center" &&
        operation.width !== undefined &&
        operation.height !== undefined
      ) {
        const scale = Math.max(operation.width / current.width, operation.height / current.height);
        const scaledWidth = Math.max(target.width, Math.ceil(current.width * scale));
        const scaledHeight = Math.max(target.height, Math.ceil(current.height * scale));
        transformer.resize({
          width: scaledWidth,
          height: scaledHeight,
          filter,
          fit: resizeFitFill,
        });
        let focus: readonly [number, number] | undefined;
        if (operation.position === "entropy" || operation.position === "attention") {
          const scaled = await readRgbaState(transformer, signal);
          focus = smartFocus(
            { data: scaled.state.data, width: scaled.state.width, height: scaled.state.height },
            operation.position === "entropy" ? "entropy" : "attention",
          );
        }
        const [x, y] = coverCropOrigin(
          operation.position,
          scaledWidth,
          scaledHeight,
          target.width,
          target.height,
          focus,
        );
        transformer.crop(x, y, target.width, target.height);
        return;
      }
      if (operation.fit === "contain") {
        const scale = Math.min(target.width / current.width, target.height / current.height);
        const containedWidth = Math.max(1, Math.round(current.width * scale));
        const containedHeight = Math.max(1, Math.round(current.height * scale));
        transformer.resize({
          width: containedWidth,
          height: containedHeight,
          filter,
          fit: resizeFitFill,
        });
        const [red, green, blue, alpha] = parseColor(operation.background ?? "#000000");
        const position = operation.position;
        const x =
          position === "left" || position === "left top" || position === "left bottom"
            ? 0
            : position === "right" || position === "right top" || position === "right bottom"
              ? target.width - containedWidth
              : Math.floor((target.width - containedWidth) / 2);
        const y =
          position === "top" || position === "left top" || position === "right top"
            ? 0
            : position === "bottom" || position === "left bottom" || position === "right bottom"
              ? target.height - containedHeight
              : Math.floor((target.height - containedHeight) / 2);
        const padded = filterPixels(transformer, signal, {
          type: "extend",
          top: Math.max(0, y),
          right: Math.max(0, target.width - containedWidth - x),
          bottom: Math.max(0, target.height - containedHeight - y),
          left: Math.max(0, x),
          background: `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`,
        });
        return {
          ...(await padded),
          layout: "rgba8",
        };
      }
      const fit = (operation.fit ?? "cover") === "cover" ? resizeFitCover : resizeFitFill;
      transformer.resize({ width: target.width, height: target.height, filter, fit });
      return;
    }
    case "crop": {
      const current = await transformer.metadata(false, signal);
      assertCrop(operation, current.width, current.height);
      transformer.crop(operation.x, operation.y, operation.width, operation.height);
      return;
    }
    case "rotate": {
      const orientation = rotateOrientation(operation.angle);
      if (orientation === undefined) {
        throw new UnImageError("The napi driver only supports 90-degree rotations.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "rotate",
        });
      }
      transformer.rotate(orientation);
      return;
    }
    case "flip":
      transformer.rotate(
        operation.axis === "horizontal" ? orientationMirrorHorizontal : orientationMirrorVertical,
      );
      return;
    case "grayscale":
      transformer.grayscale();
      return;
    case "invert":
      transformer.invert();
      return;
    case "blur":
      transformer.blur(operation.sigma);
      return;
    case "sharpen":
      if (operation.flat !== undefined) {
        return {
          ...(await filterPixels(transformer, signal, operation)),
          layout: "rgba8",
        };
      }
      transformer.unsharpen(operation.sigma ?? 1, operation.jagged ?? 0);
      return;
    case "contrast":
      transformer.adjustContrast(operation.amount);
      return;
    case "convolve": {
      if (
        operation.width === 3 &&
        operation.height === 3 &&
        operation.border === undefined &&
        (operation.scale === undefined || operation.scale === 1) &&
        (operation.offset === undefined || operation.offset === 0)
      ) {
        transformer.filter3x3([...operation.kernel]);
        return;
      }
      return {
        ...(await filterPixels(transformer, signal, operation)),
        layout: "rgba8",
      };
    }
    case "removeAlpha":
    case "ensureAlpha": {
      const current = await toRgbaState(transformer, signal);
      const filtered = applyPixelFilter(
        current,
        operation as Extract<ImageOperation, { type: "removeAlpha" | "ensureAlpha" }>,
      );
      return {
        kind: undefined,
        data: filtered.data,
        width: filtered.width,
        height: filtered.height,
        layout: "rgba8",
      } as RawImageData;
    }
    case "opacity":
      transformer.opacity(operation.factor);
      return;
    case "trim":
    case "extend":
    case "median":
    case "dilate":
    case "erode":
    case "clahe":
    case "flatten":
    case "unflatten":
    case "gamma":
    case "normalize":
    case "threshold":
    case "linear":
    case "modulate":
    case "tint": {
      const current = await toRgbaState(transformer, signal);
      const filtered = applyPixelFilter(current, operation);
      return {
        kind: undefined,
        data: filtered.data,
        width: filtered.width,
        height: filtered.height,
        layout: "rgba8",
      } as RawImageData;
    }
  }
  return;
}

async function encode(
  transformer: NapiTransformer,
  format: ImageFormat,
  quality: number | undefined,
  lossless: boolean | undefined,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> {
  assertNotAborted(signal, "encode");

  if (format === "png") return await transformer.png(undefined, signal);
  if (format === "jpeg") return await transformer.jpeg(quality, signal);
  if (format === "webp") {
    return lossless
      ? await transformer.webpLossless(signal)
      : await transformer.webp(quality, signal);
  }

  if (format === "avif") {
    try {
      return quality === undefined
        ? await transformer.avif(undefined, signal)
        : await transformer.avif({ quality: lossless ? 100 : quality }, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw new UnImageError("Image encode was aborted.", {
          code: "UNIMAGE_ABORT",
          cause: error,
        });
      }
      throw new UnImageError("The image could not be encoded as AVIF.", {
        code: "UNIMAGE_ENCODE",
        format,
        cause: error,
      });
    }
  }

  if (format === "heic") {
    try {
      const heifOptions: import("@napi-rs/image").HeicConfig = {};
      if (quality !== undefined) heifOptions.quality = quality;
      return await transformer.heic(heifOptions, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw new UnImageError("Image encode was aborted.", {
          code: "UNIMAGE_ABORT",
          cause: error,
        });
      }
      throw new UnImageError(`The image could not be encoded as ${format}.`, {
        code: "UNIMAGE_ENCODE",
        format,
        cause: error,
      });
    }
  }
  if (format === "tiff") return await transformer.tiff(signal);
  if (format === "bmp") return await transformer.bmp(signal);
  if (format === "ico") return await transformer.ico(signal);
  if (format === "pnm") return await transformer.pnm(signal);
  if (format === "tga") return await transformer.tga(signal);

  throw new UnImageError("The image cannot be encoded as " + format + ".", {
    code: "UNIMAGE_UNSUPPORTED_FORMAT",
    format,
  });
}

export function napiDriver(options: NapiDriverOptions = {}): ImageDriver {
  let capabilitiesPromise: Promise<ImageCapabilities> | undefined;

  async function probeHeicEncoding(module: NapiModule): Promise<boolean> {
    try {
      const transformer = module.Transformer.fromRgbaPixels(new Uint8Array(2 * 2 * 4), 2, 2);
      await transformer.heic({ quality: 80 });
      return true;
    } catch {
      return false;
    }
  }

  return {
    name: "napi",

    async capabilities(): Promise<ImageCapabilities> {
      capabilitiesPromise ??= (async () => {
        const module = await loadModule(options);
        const heicEncoding = await probeHeicEncoding(module);
        return {
          driver: "napi",
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
                metadataPolicies: ["strip"],
                sanitize: false,
              },
            },
            webp: {
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
                metadataPolicies: ["strip"],
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
                metadataPolicies: ["strip"],
                sanitize: false,
              },
            },
            svg: {
              decode: {
                pixelFormats: ["rgba8"],
                frames: ["still"],
                orientation: false,
                rasterDensity: false,
                vector: true,
              },
              encode: {
                compressionModes: [],
                quality: false,
                animation: false,
                metadataPolicies: ["strip"],
                sanitize: false,
              },
            },
            tiff: {
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
            bmp: {
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
            ico: {
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
            pnm: {
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
            tga: {
              decode: {
                pixelFormats: [],
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
            heic: {
              decode: {
                pixelFormats: ["rgba8"],
                frames: ["still"],
                orientation: false,
                rasterDensity: false,
                vector: false,
              },
              encode: {
                compressionModes: heicEncoding ? ["lossy"] : [],
                quality: heicEncoding,
                animation: false,
                metadataPolicies: ["strip"],
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
              // napi-image exposes a HEIC encoder, but no independent general HEIF encoder.
              encode: {
                compressionModes: [],
                quality: false,
                animation: false,
                metadataPolicies: ["strip"],
                sanitize: false,
              },
            },
          },
          metadataRead: true,
          operations: {
            autoOrient: { supported: true },
            resize: { supported: true },
            crop: { supported: true },
            rotate: {
              supported: true,
              notes: ["Only multiples of 90 degrees are supported."],
            },
            flip: { supported: true },
            grayscale: { supported: true },
            invert: { supported: true },
            blur: { supported: true },
            trim: { supported: true },
            extend: { supported: true },
            sharpen: { supported: true },
            clahe: { supported: true },
            median: { supported: true },
            dilate: { supported: true },
            erode: { supported: true },
            flatten: { supported: true },
            unflatten: { supported: true },
            gamma: { supported: true },
            normalize: { supported: true },
            threshold: { supported: true },
            linear: { supported: true },
            modulate: { supported: true },
            opacity: { supported: true },
            tint: { supported: true },
            contrast: { supported: true },
            convolve: {
              supported: true,
              notes: ["Only unscaled 3×3 kernels are supported."],
            },
            removeAlpha: { supported: true },
            ensureAlpha: { supported: true },
          },
          notes: [
            "Operations are applied in recipe order through isolated stages.",
            "SVG input is rasterized with a transparent background before transforms.",
            "Metadata preservation is not supported yet.",
            ...(heicEncoding
              ? []
              : ["HEIC encoding is unavailable on this OS or codec installation."]),
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

    async decode(input: ImageInput, request: ImageDecodeRequest): Promise<RawImageFrame> {
      if (request.rasterDensity !== undefined) {
        throw new UnImageError("The napi driver does not support raster density.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "rasterDensity",
        });
      }

      const module = await loadModule(options);
      const transformer = await createTransformer(module, input);
      try {
        const { metadata: meta, state } = await readRgbaState(transformer, request.signal);
        const data = state.data;
        return {
          data,
          width: meta.width,
          height: meta.height,
          layout: "rgba8",
          metadata: {
            ...(meta.format === undefined ? {} : { format: meta.format }),
            mediaType:
              mediaTypes[meta.format as keyof typeof mediaTypes] ?? "application/octet-stream",
            width: meta.width,
            height: meta.height,
            byteLength: data.byteLength,
            ...(meta.hasAlpha === undefined ? {} : { hasAlpha: meta.hasAlpha }),
            ...(meta.orientation === undefined ? {} : { orientation: meta.orientation }),
          },
        };
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        if (request.signal?.aborted) {
          throw new UnImageError("Image decode was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        throw new UnImageError("The image could not be decoded by napi-image.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }
    },

    async checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      const capabilities = await this.capabilities();
      return checkRecipeCapabilities(recipe, capabilities, (operation) => {
        const capability = capabilities.operations[operation.type];
        if (operation.type === "rotate" && operation.angle % 90 !== 0) {
          return {
            supported: false,
            notes: ["Napi-image rotation only supports 90 degree multiples."],
          };
        }
        return capability ?? { supported: false };
      });
    },

    async metadata(input, context): Promise<ImageMetadata> {
      if (isRawImage(input)) {
        return normalizeMetadata(
          {
            width: input.width,
            height: input.height,
            format: "png",
            colorType: 3,
          },
          input.data.byteLength,
        );
      }

      if ((await sniffImageFormat(input)) === "svg") {
        const svg = await decodeSvg(input);
        const meta = parseSvgMetadata(svg, input instanceof Blob ? input.size : undefined);
        return { ...meta, hasAlpha: true };
      }

      const module = await loadModule(options);
      const transformer = await createTransformer(module, input);
      try {
        return normalizeMetadata(await transformer.metadata(false, context?.signal));
      } catch (error) {
        if (context?.signal?.aborted) {
          throw new UnImageError("Image metadata was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        throw new UnImageError("Image metadata could not be read.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }
    },

    async transform(input, recipe, context): Promise<ImageResult> {
      if (recipe.input?.frames === "all" || recipe.input?.rasterDensity !== undefined) {
        throw new UnImageError("The napi driver does not support this input option.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "input",
        });
      }
      if (recipe.output.metadataPolicy === "preserve") {
        throw new UnImageError("The napi driver cannot preserve metadata yet.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "metadata.preserve",
        });
      }

      const module = await loadModule(options);
      let state: ImageInput = input;
      for (const operation of recipe.operations) {
        const transformer = await createTransformer(module, state);
        try {
          const nextState = await applyOperation(transformer, operation, context?.signal);
          if (nextState) {
            state = nextState;
            continue;
          }
          state = await toRgbaState(transformer, context?.signal);
        } catch (error) {
          if (error instanceof UnImageError) throw error;
          if (context?.signal?.aborted) {
            throw new UnImageError("Image transform was aborted.", {
              code: "UNIMAGE_ABORT",
              cause: error,
            });
          }
          throw new UnImageError(`The "${operation.type}" operation failed.`, {
            code: "UNIMAGE_INVALID_RECIPE",
            operation: operation.type,
            cause: error,
          });
        }
      }

      const finalTransformer = await createTransformer(module, state);
      try {
        const sourceMetadata = await finalTransformer.metadata(false, context?.signal);
        const encoded = await encode(
          finalTransformer,
          recipe.output.format,
          "quality" in recipe.output ? recipe.output.quality : undefined,
          "lossless" in recipe.output ? recipe.output.lossless : undefined,
          context?.signal,
        );
        const metadata = normalizeMetadata(sourceMetadata, encoded.byteLength);
        metadata.format = recipe.output.format;
        metadata.mediaType = mediaTypes[recipe.output.format];

        return {
          kind: "encoded",
          data: encoded,
          format: recipe.output.format,
          mediaType: metadata.mediaType,
          metadata,
        };
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        if (context?.signal?.aborted) {
          throw new UnImageError("Image encode was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        throw new UnImageError("The image could not be encoded by napi-image.", {
          code: "UNIMAGE_ENCODE",
          format: recipe.output.format,
          cause: error,
        });
      }
    },
  };
}
