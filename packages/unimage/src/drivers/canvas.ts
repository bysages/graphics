import { UnImageError } from "../errors";
import { checkRecipeCapabilities } from "../recipe";
import type {
  ImageCapabilities,
  ImageDecodeRequest,
  ImageDriver,
  ImageInput,
  ImageMetadata,
  ImageOperation,
  ImageCapabilityResult,
  ImagePipelineConfig,
  ImageResult,
  RawImageFrame,
  RawImageData,
} from "../types";
import { abortable, assertNotAborted } from "../utils/abort";
import { applyPixelFilter, parseColor, type RgbaImage } from "../utils/filters";
import { sniffImageFormat } from "../utils/format";
import { alignedOrigin, focusPoint } from "../utils/geometry";
import { isRawImageData } from "../utils/input";

interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface NodeContext2D {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  filter: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: unknown, ...arguments_: number[]): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageDataLike;
  putImageData(image: ImageDataLike, dx: number, dy: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
}

/** Structural subset of a `@napi-rs/canvas` surface used by this driver. */
interface NodeSurface {
  width: number;
  height: number;
  getContext(context: "2d"): NodeContext2D;
  encode(format: "webp" | "jpeg", quality?: number): Promise<ArrayBuffer>;
  encode(format: "png"): Promise<ArrayBuffer>;
  encode(format: "avif", config?: { quality?: number }): Promise<ArrayBuffer>;
  encode(format: "gif", quality?: number): Promise<ArrayBuffer>;
}

interface NodeCanvasModule {
  createCanvas(width: number, height: number): NodeSurface;
  loadImage(source: Uint8Array | ArrayBuffer | string): Promise<{ width: number; height: number }>;
  ImageData: new (data: Uint8ClampedArray, width: number, height: number) => ImageDataLike;
}

type Surface = OffscreenCanvas | HTMLCanvasElement | NodeSurface;

interface SurfaceContext2D {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  filter: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: Surface, ...arguments_: number[]): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageDataLike;
  putImageData(image: ImageDataLike, dx: number, dy: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
}

const mediaTypes: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

function toBlob(input: Exclude<ImageInput, RawImageData>): Blob {
  if (input instanceof Blob) return input;
  const bytes = new Uint8Array(input);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
}

let nodeCanvas: NodeCanvasModule | undefined;
let nodeCanvasModuleCache: Promise<NodeCanvasModule | undefined> | undefined;

function browserAvailable(): boolean {
  return typeof OffscreenCanvas === "function" || typeof document !== "undefined";
}

/**
 * unpdf-style lazy resolution: browsers use their native canvas, Node.js
 * resolves the optional `@napi-rs/canvas` peer on first use.
 */
async function resolveNodeCanvas(): Promise<NodeCanvasModule | undefined> {
  if (browserAvailable()) return undefined;
  nodeCanvasModuleCache ??= import("@napi-rs/canvas")
    .then((module_) => {
      const candidate = module_ as unknown as NodeCanvasModule & { default?: NodeCanvasModule };
      return candidate.createCanvas !== undefined
        ? candidate
        : (candidate.default as NodeCanvasModule);
    })
    .catch(() => undefined);
  nodeCanvas = await nodeCanvasModuleCache;
  return nodeCanvas;
}

function createSurface(width: number, height: number): Surface {
  if (nodeCanvas) return nodeCanvas.createCanvas(width, height);
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") {
    throw new UnImageError(
      "No canvas backend is available. Install @napi-rs/canvas in Node.js or run in a browser.",
      { code: "UNIMAGE_DRIVER_UNAVAILABLE" },
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function surfaceContext(surface: Surface): SurfaceContext2D {
  const context =
    "encode" in surface
      ? (surface.getContext("2d") as unknown as SurfaceContext2D)
      : (surface.getContext("2d", { willReadFrequently: true }) as unknown as SurfaceContext2D);
  if (!context) {
    throw new UnImageError("The runtime did not provide a 2D rendering context.", {
      code: "UNIMAGE_DECODE",
    });
  }
  return context;
}

function createImageData(data: Uint8ClampedArray, width: number, height: number): ImageDataLike {
  if (nodeCanvas) return new nodeCanvas.ImageData(data, width, height);
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
}

function parseAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

async function decodeSurface(
  input: ImageInput,
  autoOrient: boolean,
  signal?: AbortSignal,
): Promise<Surface> {
  assertNotAborted(signal, "decode");
  if (isRawImageData(input)) {
    if (input.layout !== "rgba8") {
      throw new UnImageError("Only rgba8 raw images are supported.", {
        code: "UNIMAGE_INVALID_INPUT",
      });
    }
    const expected = input.width * input.height * 4;
    if (input.data.length < expected) {
      throw new UnImageError("Raw image data is smaller than its declared dimensions.", {
        code: "UNIMAGE_INVALID_INPUT",
      });
    }
    const surface = createSurface(input.width, input.height);
    surfaceContext(surface).putImageData(
      createImageData(new Uint8ClampedArray(input.data), input.width, input.height),
      0,
      0,
    );
    return surface;
  }

  if (nodeCanvas) {
    try {
      const bytes =
        input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : (input as Uint8Array);
      const image = await abortable(nodeCanvas.loadImage(bytes), signal, "decode");
      const surface = nodeCanvas.createCanvas(image.width, image.height);
      surfaceContext(surface).drawImage(image as unknown as Surface, 0, 0);
      return surface;
    } catch (error) {
      if (signal?.aborted) {
        throw new UnImageError("Image decode was aborted.", {
          code: "UNIMAGE_ABORT",
          cause: error,
        });
      }
      throw new UnImageError("@napi-rs/canvas could not decode the image.", {
        code: "UNIMAGE_DECODE",
        cause: error,
      });
    }
  }

  try {
    const bitmap = await createImageBitmap(toBlob(input), {
      imageOrientation: autoOrient ? "from-image" : "none",
    });
    const surface = createSurface(bitmap.width, bitmap.height);
    surfaceContext(surface).drawImage(bitmap as unknown as Surface, 0, 0);
    bitmap.close();
    return surface;
  } catch (error) {
    if (signal?.aborted) {
      throw new UnImageError("Image decode was aborted.", { code: "UNIMAGE_ABORT", cause: error });
    }
    throw new UnImageError("The browser could not decode the image.", {
      code: "UNIMAGE_DECODE",
      cause: error,
    });
  }
}

function resizeDimensions(
  operation: Extract<ImageOperation, { type: "resize" }>,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const fit = operation.fit ?? "cover";

  if (operation.width !== undefined && operation.height !== undefined) {
    if (fit === "fill") return { width: operation.width, height: operation.height };
    if (fit === "outside") {
      const outsideScale = Math.max(operation.width / sourceWidth, operation.height / sourceHeight);
      if (operation.withoutEnlargement === true && outsideScale > 1)
        return { width: sourceWidth, height: sourceHeight };
      return {
        width: Math.max(1, Math.round(sourceWidth * outsideScale)),
        height: Math.max(1, Math.round(sourceHeight * outsideScale)),
      };
    }
    const scale =
      fit === "cover"
        ? Math.max(operation.width / sourceWidth, operation.height / sourceHeight)
        : Math.min(operation.width / sourceWidth, operation.height / sourceHeight);
    if (operation.withoutEnlargement === true && scale > 1)
      return { width: sourceWidth, height: sourceHeight };
    return { width: operation.width, height: operation.height };
  }

  const scale =
    operation.width === undefined
      ? (operation.height as number) / sourceHeight
      : operation.width / sourceWidth;
  if (operation.withoutEnlargement === true && scale > 1)
    return { width: sourceWidth, height: sourceHeight };
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function resizeSurface(
  surface: Surface,
  operation: Extract<ImageOperation, { type: "resize" }>,
): Surface {
  const sourceWidth = surface.width;
  const sourceHeight = surface.height;
  const { width, height } = resizeDimensions(operation, sourceWidth, sourceHeight);
  const fit = operation.fit ?? "cover";
  const target = createSurface(width, height);
  const context = surfaceContext(target);
  context.imageSmoothingEnabled = operation.kernel !== "nearest";
  context.imageSmoothingQuality = "high";
  const bothDimensions = operation.width !== undefined && operation.height !== undefined;
  if (bothDimensions && fit === "contain") {
    const [red, green, blue, alpha] = parseColor(operation.background ?? "#000000");
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
    context.fillRect(0, 0, width, height);
  }

  if (bothDimensions && fit === "cover") {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const [sourceX, sourceY] = smartCoverOrigin(
      surface,
      operation.position,
      sourceWidth * scale - width,
      sourceHeight * scale - height,
      width,
      height,
      scale,
    );
    context.drawImage(
      surface,
      sourceX / scale,
      sourceY / scale,
      width / scale,
      height / scale,
      0,
      0,
      width,
      height,
    );
  } else if (bothDimensions && fit === "contain") {
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const scaledWidth = Math.round(sourceWidth * scale);
    const scaledHeight = Math.round(sourceHeight * scale);
    const [x, y] = alignedOrigin(operation.position, width - scaledWidth, height - scaledHeight);
    context.drawImage(surface, x, y, scaledWidth, scaledHeight);
  } else {
    context.drawImage(surface, 0, 0, width, height);
  }

  return target;
}

function smartCoverOrigin(
  surface: Surface,
  position: import("../types").ImagePosition | undefined,
  excessWidth: number,
  excessHeight: number,
  targetWidth: number,
  targetHeight: number,
  scale: number,
): [number, number] {
  if (position !== "entropy" && position !== "attention")
    return alignedOrigin(position, excessWidth, excessHeight);
  const [focusX, focusY] = focusPoint(
    toRgbaImage(surface),
    position === "entropy" ? "entropy" : "attention",
  );
  const originX = Math.max(
    0,
    Math.min(excessWidth, focusX * surface.width * scale - targetWidth / 2),
  );
  const originY = Math.max(
    0,
    Math.min(excessHeight, focusY * surface.height * scale - targetHeight / 2),
  );
  return [originX, originY];
}

function toRgbaImage(surface: Surface): RgbaImage {
  const context = surfaceContext(surface);
  const frame = context.getImageData(0, 0, surface.width, surface.height);
  return { data: new Uint8Array(frame.data.buffer), width: frame.width, height: frame.height };
}

function fromRgbaImage(image: RgbaImage): Surface {
  const surface = createSurface(image.width, image.height);
  surfaceContext(surface).putImageData(
    createImageData(
      new Uint8ClampedArray(image.data.buffer as ArrayBuffer),
      image.width,
      image.height,
    ),
    0,
    0,
  );
  return surface;
}

function pixelFilterSurface(
  surface: Surface,
  operation: Parameters<typeof applyPixelFilter>[1],
): Surface {
  return fromRgbaImage(applyPixelFilter(toRgbaImage(surface), operation));
}
function cropSurface(
  surface: Surface,
  operation: Extract<ImageOperation, { type: "crop" }>,
): Surface {
  if (
    operation.x < 0 ||
    operation.y < 0 ||
    operation.x + operation.width > surface.width ||
    operation.y + operation.height > surface.height
  ) {
    throw new UnImageError("Crop rectangle is outside the image bounds.", {
      code: "UNIMAGE_INVALID_RECIPE",
      operation: "crop",
    });
  }
  const target = createSurface(operation.width, operation.height);
  surfaceContext(target).drawImage(
    surface,
    operation.x,
    operation.y,
    operation.width,
    operation.height,
    0,
    0,
    operation.width,
    operation.height,
  );
  return target;
}

function rotateSurface(
  surface: Surface,
  operation: Extract<ImageOperation, { type: "rotate" }>,
): Surface {
  const radians = (parseAngle(operation.angle) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const roundBoundingBox = (value: number): number =>
    Number.isInteger(Math.round(value)) ? Math.round(value) : Math.ceil(value);
  const width = roundBoundingBox(surface.width * cos + surface.height * sin);
  const height = roundBoundingBox(surface.width * sin + surface.height * cos);
  const target = createSurface(width, height);
  const context = surfaceContext(target);

  if (operation.background !== undefined) {
    context.fillStyle = operation.background;
    context.fillRect(0, 0, width, height);
  }
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.drawImage(surface, -surface.width / 2, -surface.height / 2);
  return target;
}

function flipSurface(surface: Surface, axis: "horizontal" | "vertical"): Surface {
  const target = createSurface(surface.width, surface.height);
  const context = surfaceContext(target);
  context.translate(
    axis === "horizontal" ? surface.width : 0,
    axis === "vertical" ? surface.height : 0,
  );
  context.scale(axis === "horizontal" ? -1 : 1, axis === "vertical" ? -1 : 1);
  context.drawImage(surface, 0, 0);
  return target;
}

function pixelMap(
  surface: Surface,
  transform: (red: number, green: number, blue: number) => [number, number, number],
): Surface {
  const context = surfaceContext(surface);
  const frame = context.getImageData(0, 0, surface.width, surface.height);
  const pixels = frame.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const [red, green, blue] = transform(
      pixels[index] as number,
      pixels[index + 1] as number,
      pixels[index + 2] as number,
    );
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
  }
  context.putImageData(frame, 0, 0);
  return surface;
}

function blurSurface(surface: Surface, sigma: number): Surface {
  const target = createSurface(surface.width, surface.height);
  const context = surfaceContext(target);
  if ((context as { filter?: unknown }).filter === undefined) {
    throw new UnImageError("This runtime does not support canvas blur.", {
      code: "UNIMAGE_UNSUPPORTED_OPERATION",
      operation: "blur",
    });
  }
  context.filter = `blur(${sigma}px)`;
  context.drawImage(surface, 0, 0);
  return target;
}

function applyOperation(surface: Surface, operation: ImageOperation): Surface {
  switch (operation.type) {
    case "autoOrient":
      return surface;
    case "resize":
      return resizeSurface(surface, operation);
    case "crop":
      return cropSurface(surface, operation);
    case "rotate":
      return rotateSurface(surface, operation);
    case "flip":
      return flipSurface(surface, operation.axis);
    case "grayscale":
      return pixelMap(surface, (red, green, blue) => {
        const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        return [value, value, value];
      });
    case "invert":
      return pixelMap(surface, (red, green, blue) => [255 - red, 255 - green, 255 - blue]);
    case "trim":
    case "extend":
    case "sharpen":
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
    case "opacity":
    case "contrast":
    case "convolve":
    case "colorMatrix":
    case "posterize":
    case "pixelate":
    case "removeAlpha":
    case "ensureAlpha":
      return pixelFilterSurface(surface, operation);
    case "tint":
      return pixelFilterSurface(surface, operation);
    case "blur":
      return blurSurface(surface, operation.sigma);
  }
}

function surfaceToBlob(
  surface: Surface,
  format: keyof typeof mediaTypes,
  quality?: number,
): Promise<Blob> {
  const type = mediaTypes[format] as string;
  if ("encode" in surface) {
    const promise =
      format === "webp" || format === "jpeg"
        ? surface.encode(format, quality)
        : format === "avif"
          ? surface.encode("avif", quality === undefined ? undefined : { quality })
          : format === "gif"
            ? quality === undefined
              ? surface.encode("gif")
              : surface.encode("gif", quality)
            : surface.encode("png");
    return promise.then((buffer) => new Blob([buffer], { type }));
  }
  if (surface instanceof OffscreenCanvas) {
    const options: { type: string; quality?: number } = { type };
    if (quality !== undefined) options.quality = quality / 100;
    return surface.convertToBlob(options);
  }
  return new Promise<Blob>((resolve, reject) => {
    surface.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`The browser could not encode ${type}.`));
      },
      type,
      quality === undefined ? undefined : quality / 100,
    );
  });
}

export interface CanvasDriverOptions {
  /**
   * Pre-resolved `@napi-rs/canvas` module. When omitted, the driver resolves
   * the optional peer through a dynamic import on first use in Node.js
   * (unpdf-style lazy resolution) and stays fully native in browsers.
   */
  nodeCanvas?: NodeCanvasModule;
}

const canvasOperationNames = [
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
  "dilate",
  "erode",
  "clahe",
  "flatten",
  "unflatten",
  "gamma",
  "normalize",
  "threshold",
  "linear",
  "modulate",
  "opacity",
  "tint",
  "contrast",
  "convolve",
  "colorMatrix",
  "posterize",
  "pixelate",
  "removeAlpha",
  "ensureAlpha",
] as const;

function unavailableCapabilities(driverName: string): ImageCapabilities {
  return {
    driver: driverName,
    formats: {},
    metadataRead: false,
    operations: Object.fromEntries(
      canvasOperationNames.map((operation) => [operation, { supported: false }]),
    ) as ImageCapabilities["operations"],
    notes: ["No canvas backend is available."],
  };
}

export function canvasDriver(options: CanvasDriverOptions = {}): ImageDriver {
  if (options.nodeCanvas !== undefined) nodeCanvas = options.nodeCanvas;
  return {
    name: "canvas",

    async capabilities(): Promise<ImageCapabilities> {
      nodeCanvas ??= await resolveNodeCanvas();
      if (nodeCanvas === undefined && !browserAvailable()) {
        return unavailableCapabilities("canvas");
      }

      const formats: Partial<ImageCapabilities["formats"]> = {};
      const surface = createSurface(1, 1);
      surfaceContext(surface).fillRect(0, 0, 1, 1);
      for (const format of ["png", "jpeg", "webp", "avif", "gif"] as const) {
        try {
          const blob = await surfaceToBlob(surface, format, 80);
          if (blob.type !== mediaTypes[format]) continue;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if ((await sniffImageFormat(bytes)) !== format) continue;
          formats[format] = {
            decode: {
              pixelFormats: ["rgba8"],
              frames: ["still"],
              orientation: nodeCanvas === undefined && format === "jpeg",
              rasterDensity: false,
              vector: false,
            },
            encode: {
              compressionModes: format === "png" || format === "gif" ? ["lossless"] : ["lossy"],
              quality: format !== "png" && format !== "gif",
              animation: false,
              metadataPolicies: ["strip"],
              sanitize: false,
            },
          };
        } catch {
          // Unsupported browsers are intentionally omitted from the capability matrix.
        }
      }

      return {
        driver: "canvas",
        formats,
        metadataRead: true,
        operations: {
          ...(Object.fromEntries(
            canvasOperationNames.map((operation) => [operation, { supported: true }]),
          ) as ImageCapabilities["operations"]),
          autoOrient: {
            supported: nodeCanvas === undefined,
            ...(nodeCanvas === undefined
              ? {}
              : { notes: ["Canvas image decoding does not apply EXIF orientation."] }),
          },
          blur: {
            supported: true,
            notes: ["Uses Canvas2D filter support; results may vary slightly between browsers."],
          },
        },
        notes: [
          "Canvas encoders strip incidental metadata.",
          "Capability detection is performed with a 1x1 canvas.",
          ...(nodeCanvas === undefined
            ? []
            : ["Node backend runs on @napi-rs/canvas; EXIF auto-orientation is ignored."]),
        ],
      };
    },

    async checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      const capabilities = await this.capabilities();
      return checkRecipeCapabilities(recipe, capabilities, (operation) => {
        const capability = capabilities.operations[operation.type];
        return capability ?? { supported: false };
      });
    },

    async metadata(input: ImageInput, context): Promise<ImageMetadata> {
      assertNotAborted(context?.signal, "metadata");
      if (isRawImageData(input)) {
        return {
          width: input.width,
          height: input.height,
          byteLength: input.data.byteLength,
          hasAlpha: input.layout === "rgba8",
        };
      }

      nodeCanvas ??= await resolveNodeCanvas();
      if (nodeCanvas) {
        const bytes =
          input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : (input as Uint8Array);
        const surface = await decodeSurface(input, false, context?.signal);
        const metadata: ImageMetadata = {
          width: surface.width,
          height: surface.height,
          byteLength: bytes.byteLength,
        };
        const format = await sniffImageFormat(input);
        if (format !== undefined) {
          metadata.format = format;
          metadata.mediaType =
            input instanceof Blob && input.type.startsWith("image/")
              ? input.type
              : (mediaTypes[format] ?? `image/${format}`);
        }
        return metadata;
      }

      try {
        const blob = toBlob(input);
        const bitmap = await abortable(createImageBitmap(blob), context?.signal, "metadata");
        const metadata: ImageMetadata = {
          width: bitmap.width,
          height: bitmap.height,
          byteLength: blob.size,
        };
        const sniffed = await sniffImageFormat(input);
        if (sniffed !== undefined) {
          metadata.format = sniffed;
          metadata.mediaType = mediaTypes[sniffed] ?? `image/${sniffed}`;
        } else if (blob.type.startsWith("image/")) {
          metadata.mediaType = blob.type;
        }
        if (sniffed === "png") metadata.hasAlpha = true;
        bitmap.close();
        return metadata;
      } catch (error) {
        if (context?.signal?.aborted) {
          throw new UnImageError("Image metadata was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        throw new UnImageError("The browser could not decode the image.", {
          code: "UNIMAGE_DECODE",
          cause: error,
        });
      }
    },

    async decode(input: ImageInput, request: ImageDecodeRequest): Promise<RawImageFrame> {
      assertNotAborted(request.signal, "decode");
      if (request.rasterDensity !== undefined) {
        throw new UnImageError("The canvas driver does not support raster density.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "rasterDensity",
        });
      }

      nodeCanvas ??= await resolveNodeCanvas();
      const surface = await decodeSurface(input, false, request.signal);
      const image = toRgbaImage(surface);
      const byteLength =
        input instanceof Blob
          ? input.size
          : input instanceof Uint8Array || input instanceof ArrayBuffer
            ? input.byteLength
            : image.data.byteLength;
      const format = await sniffImageFormat(input);
      return {
        data: image.data,
        width: image.width,
        height: image.height,
        layout: "rgba8",
        metadata: {
          ...(format === undefined ? {} : { format }),
          mediaType:
            format === undefined
              ? "application/octet-stream"
              : (mediaTypes[format] ?? `image/${format}`),
          width: image.width,
          height: image.height,
          byteLength,
          hasAlpha: true,
        },
      };
    },

    async transform(input, recipe, context): Promise<ImageResult> {
      assertNotAborted(context?.signal, "transform");
      nodeCanvas ??= await resolveNodeCanvas();
      if (recipe.input?.frames === "all" || recipe.input?.rasterDensity !== undefined) {
        throw new UnImageError("The canvas driver does not support this input option.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "input",
        });
      }
      if (recipe.output.metadataPolicy === "preserve") {
        throw new UnImageError("The browser driver cannot preserve metadata yet.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "metadata.preserve",
        });
      }

      let surface = await decodeSurface(
        input,
        recipe.operations.some((operation) => operation.type === "autoOrient"),
        context?.signal,
      );

      for (const operation of recipe.operations) {
        assertNotAborted(context?.signal, "transform");
        surface = applyOperation(surface, operation);
      }

      try {
        const blob = await abortable(
          surfaceToBlob(
            surface,
            recipe.output.format,
            "quality" in recipe.output ? recipe.output.quality : undefined,
          ),
          context?.signal,
          "encode",
        );
        const mediaType = mediaTypes[recipe.output.format] as string;
        const data = new Uint8Array(await blob.arrayBuffer());
        if ((await sniffImageFormat(data)) !== recipe.output.format) {
          throw new Error(`Canvas returned ${recipe.output.format} bytes in another format.`);
        }
        return {
          kind: "encoded",
          data,
          format: recipe.output.format,
          mediaType: mediaType,
          metadata: {
            format: recipe.output.format,
            mediaType,
            width: surface.width,
            height: surface.height,
            byteLength: data.byteLength,
            hasAlpha: recipe.output.format !== "jpeg",
          },
        };
      } catch (error) {
        if (context?.signal?.aborted) {
          throw new UnImageError("Image encode was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        throw new UnImageError("The browser could not encode the image.", {
          code: "UNIMAGE_ENCODE",
          format: recipe.output.format,
          cause: error,
        });
      }
    },
  };
}
