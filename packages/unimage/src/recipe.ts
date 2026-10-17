import { UnImageError } from "./errors";
import type {
  FitMode,
  ImagePosition,
  ResizeKernel,
  FrameSelection,
  ImageCapabilities,
  ImageCapabilityIssue,
  ImageCapabilityResult,
  ImageFormat,
  ImageOperation,
  ImageOperationType,
  ImagePipelineConfig,
  ImageRecipe,
  OperationCapability,
} from "./types";

const imageFormats: readonly ImageFormat[] = [
  "png",
  "jpeg",
  "webp",
  "avif",
  "gif",
  "svg",
  "tiff",
  "heif",
  "heic",
];
const fitModes: readonly FitMode[] = ["contain", "cover", "fill"];
const operationTypes: readonly ImageOperationType[] = [
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
  "removeAlpha",
  "ensureAlpha",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageFormat(value: unknown): value is ImageFormat {
  return typeof value === "string" && (imageFormats as readonly string[]).includes(value);
}

function isOperationType(value: unknown): value is ImageOperation["type"] {
  return typeof value === "string" && (operationTypes as readonly string[]).includes(value);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new UnImageError(`${field} must be a positive integer.`, {
      code: "UNIMAGE_INVALID_RECIPE",
    });
  }
  return value;
}

function parseNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new UnImageError(`${field} must be a finite number greater than or equal to zero.`, {
      code: "UNIMAGE_INVALID_RECIPE",
    });
  }
  return value;
}

function parseOperation(value: unknown): ImageOperation {
  if (!isRecord(value) || !isOperationType(value.type)) {
    throw new UnImageError("Unknown image operation.", { code: "UNIMAGE_INVALID_RECIPE" });
  }

  switch (value.type) {
    case "autoOrient":
    case "grayscale":
    case "invert":
      return { type: value.type };
    case "resize": {
      const operation: Extract<ImageOperation, { type: "resize" }> = { type: "resize" };
      if (value.width !== undefined) {
        operation.width = parsePositiveInteger(value.width, "resize.width");
      }
      if (value.height !== undefined) {
        operation.height = parsePositiveInteger(value.height, "resize.height");
      }
      if (value.fit !== undefined) {
        if (typeof value.fit !== "string" || !(fitModes as readonly string[]).includes(value.fit)) {
          throw new UnImageError("resize.fit is invalid.", {
            code: "UNIMAGE_INVALID_RECIPE",
            operation: "resize",
          });
        }
        operation.fit = value.fit as FitMode;
      }
      if (value.withoutEnlargement !== undefined) {
        operation.withoutEnlargement = value.withoutEnlargement === true;
      }
      const kernels: readonly ResizeKernel[] = [
        "nearest",
        "linear",
        "cubic",
        "mitchell",
        "lanczos2",
        "lanczos3",
      ];
      const positions: readonly ImagePosition[] = [
        "top",
        "right top",
        "right",
        "right bottom",
        "bottom",
        "left bottom",
        "left",
        "left top",
        "center",
        "entropy",
        "attention",
      ];
      if (typeof value.kernel === "string" && kernels.includes(value.kernel as ResizeKernel))
        operation.kernel = value.kernel as ResizeKernel;
      if (typeof value.position === "string" && positions.includes(value.position as ImagePosition))
        operation.position = value.position as ImagePosition;
      if (operation.width === undefined && operation.height === undefined) {
        throw new UnImageError("resize requires width, height, or both.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "resize",
        });
      }
      return operation;
    }
    case "crop":
      return {
        type: "crop",
        x: parseNonNegativeNumber(value.x, "crop.x"),
        y: parseNonNegativeNumber(value.y, "crop.y"),
        width: parsePositiveInteger(value.width, "crop.width"),
        height: parsePositiveInteger(value.height, "crop.height"),
      };
    case "rotate": {
      if (typeof value.angle !== "number" || !Number.isFinite(value.angle)) {
        throw new UnImageError("rotate.angle must be a finite number.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "rotate",
        });
      }
      const operation: Extract<ImageOperation, { type: "rotate" }> = {
        type: "rotate",
        angle: value.angle,
      };
      if (typeof value.background === "string") operation.background = value.background;
      return operation;
    }
    case "flip":
      if (value.axis !== "horizontal" && value.axis !== "vertical") {
        throw new UnImageError("flip.axis must be horizontal or vertical.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "flip",
        });
      }
      return { type: "flip", axis: value.axis };
    case "trim":
      return {
        type: "trim",
        ...(value.threshold === undefined
          ? {}
          : { threshold: parseNonNegativeNumber(value.threshold, "trim.threshold") }),
      };
    case "extend": {
      const operation: Extract<ImageOperation, { type: "extend" }> = {
        type: "extend",
        top: parseNonNegativeNumber(value.top, "extend.top"),
        right: parseNonNegativeNumber(value.right, "extend.right"),
        bottom: parseNonNegativeNumber(value.bottom, "extend.bottom"),
        left: parseNonNegativeNumber(value.left, "extend.left"),
      };
      if (typeof value.background === "string") operation.background = value.background;
      const extendModes: readonly string[] = ["background", "copy", "repeat", "mirror"];
      if (typeof value.extendWith === "string" && extendModes.includes(value.extendWith))
        operation.extendWith = value.extendWith as import("./types").ExtendMode;
      return operation;
    }
    case "sharpen": {
      const operation: Extract<ImageOperation, { type: "sharpen" }> = { type: "sharpen" };
      if (value.sigma !== undefined)
        operation.sigma = parseNonNegativeNumber(value.sigma, "sharpen.sigma");
      if (value.flat !== undefined)
        operation.flat = parseNonNegativeNumber(value.flat, "sharpen.flat");
      if (value.jagged !== undefined)
        operation.jagged = parseNonNegativeNumber(value.jagged, "sharpen.jagged");
      return operation;
    }
    case "median":
      return { type: "median", size: parsePositiveInteger(value.size, "median.size") };
    case "dilate":
    case "erode":
      return { type: value.type, size: parsePositiveInteger(value.size, `${value.type}.size`) };
    case "clahe": {
      const operation: Extract<ImageOperation, { type: "clahe" }> = {
        type: "clahe",
        width: parsePositiveInteger(value.width, "clahe.width"),
        height: parsePositiveInteger(value.height, "clahe.height"),
      };
      if (value.maxSlope !== undefined)
        operation.maxSlope = parseNonNegativeNumber(value.maxSlope, "clahe.maxSlope");
      return operation;
    }
    case "flatten": {
      const operation: Extract<ImageOperation, { type: "flatten" }> = { type: "flatten" };
      if (typeof value.background === "string") operation.background = value.background;
      return operation;
    }
    case "unflatten":
      return { type: "unflatten" };
    case "gamma": {
      const operation: Extract<ImageOperation, { type: "gamma" }> = {
        type: "gamma",
        gamma: parseNonNegativeNumber(value.gamma, "gamma"),
      };
      if (value.gammaOut !== undefined)
        operation.gammaOut = parseNonNegativeNumber(value.gammaOut, "gamma.gammaOut");
      return operation;
    }
    case "normalize": {
      const operation: Extract<ImageOperation, { type: "normalize" }> = { type: "normalize" };
      if (value.lower !== undefined)
        operation.lower = parseNonNegativeNumber(value.lower, "normalize.lower");
      if (value.upper !== undefined)
        operation.upper = parseNonNegativeNumber(value.upper, "normalize.upper");
      return operation;
    }
    case "threshold": {
      const operation: Extract<ImageOperation, { type: "threshold" }> = {
        type: "threshold",
        value: parseNonNegativeNumber(value.value, "threshold.value"),
      };
      if (value.grayscale !== undefined) operation.grayscale = value.grayscale === true;
      return operation;
    }
    case "linear": {
      const operation: Extract<ImageOperation, { type: "linear" }> = { type: "linear" };
      if (value.a !== undefined) operation.a = Number(value.a);
      if (value.b !== undefined) operation.b = Number(value.b);
      return operation;
    }
    case "modulate": {
      const operation: Extract<ImageOperation, { type: "modulate" }> = { type: "modulate" };
      if (value.brightness !== undefined)
        operation.brightness = parseNonNegativeNumber(value.brightness, "modulate.brightness");
      if (value.saturation !== undefined)
        operation.saturation = parseNonNegativeNumber(value.saturation, "modulate.saturation");
      if (value.hue !== undefined)
        operation.hue = parseNonNegativeNumber(value.hue, "modulate.hue");
      if (value.lightness !== undefined) operation.lightness = Number(value.lightness);
      return operation;
    }
    case "opacity":
      return { type: "opacity", factor: parseNonNegativeNumber(value.factor, "opacity.factor") };
    case "contrast": {
      if (
        typeof value.amount !== "number" ||
        !Number.isFinite(value.amount) ||
        value.amount < -100 ||
        value.amount > 100
      ) {
        throw new UnImageError("contrast.amount must be a finite number from -100 to 100.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "contrast",
        });
      }
      return { type: "contrast", amount: value.amount };
    }
    case "convolve": {
      if (!Array.isArray(value.kernel) || value.kernel.length === 0) {
        throw new UnImageError("convolve.kernel must be a non-empty numeric array.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "convolve",
        });
      }
      const kernel = value.kernel.map((item) => {
        if (typeof item !== "number" || !Number.isFinite(item)) {
          throw new UnImageError("convolve.kernel values must be finite numbers.", {
            code: "UNIMAGE_INVALID_RECIPE",
            operation: "convolve",
          });
        }
        return item;
      });
      const width = parsePositiveInteger(value.width, "convolve.width");
      const height = parsePositiveInteger(value.height, "convolve.height");
      if (kernel.length !== width * height) {
        throw new UnImageError("convolve.kernel length must equal width * height.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "convolve",
        });
      }
      const operation: Extract<ImageOperation, { type: "convolve" }> = {
        type: "convolve",
        kernel,
        width,
        height,
      };
      if (value.scale !== undefined)
        operation.scale = parseNonNegativeNumber(value.scale, "convolve.scale");
      if (value.offset !== undefined) operation.offset = Number(value.offset);
      if (value.border === "copy" || value.border === "mirror") operation.border = value.border;
      return operation;
    }
    case "removeAlpha":
      return { type: "removeAlpha" };
    case "ensureAlpha": {
      const operation: Extract<ImageOperation, { type: "ensureAlpha" }> = { type: "ensureAlpha" };
      if (value.alpha !== undefined) {
        const alpha = Number(value.alpha);
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
          throw new UnImageError("ensureAlpha.alpha must be between 0 and 1.", {
            code: "UNIMAGE_INVALID_RECIPE",
            operation: "ensureAlpha",
          });
        }
        operation.alpha = alpha;
      }
      return operation;
    }
    case "tint":
      if (typeof value.color !== "string") {
        throw new UnImageError("tint.color must be a CSS color string.", {
          code: "UNIMAGE_INVALID_RECIPE",
          operation: "tint",
        });
      }
      return { type: "tint", color: value.color };
    case "blur":
      return { type: "blur", sigma: parseNonNegativeNumber(value.sigma, "blur.sigma") };
  }
}

function invalidRecipe(message: string): UnImageError {
  return new UnImageError(message, { code: "UNIMAGE_INVALID_RECIPE" });
}

function assertUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw invalidRecipe(`The "${label}.${unknown}" option is not supported.`);
  }
}

function hasProperty(value: Record<string, unknown>, key: string): boolean {
  return value[key] !== undefined;
}

export function parseImageRecipe(value: unknown): ImageRecipe {
  if (!isRecord(value)) {
    throw invalidRecipe("Image recipe must be an object.");
  }
  if (!Array.isArray(value.operations)) {
    throw invalidRecipe("Image recipe operations must be an array.");
  }
  if (!isRecord(value.output) || !isImageFormat(value.output.format)) {
    throw invalidRecipe("Image recipe output format is required.");
  }

  assertUnknownKeys(value, ["input", "operations", "output"], "recipe");
  const format = value.output.format;
  assertUnknownKeys(value.output, ["format", "quality", "lossless", "metadataPolicy"], "output");

  if (hasProperty(value.output, "quality")) {
    const quality = value.output.quality;
    if (
      !Number.isInteger(quality) ||
      (quality as number) < 1 ||
      (quality as number) > 100 ||
      !["jpeg", "webp", "avif", "tiff", "heif", "heic", "jxl"].includes(format)
    ) {
      throw invalidRecipe("output.quality must be an integer between 1 and 100 for the format.");
    }
  }
  if (hasProperty(value.output, "lossless")) {
    if (
      typeof value.output.lossless !== "boolean" ||
      !["webp", "avif", "heif", "heic", "jxl"].includes(format)
    ) {
      throw invalidRecipe(
        "output.lossless is only supported as a boolean for WebP, AVIF, HEIF, and HEIC.",
      );
    }
    if (value.output.lossless === true && value.output.quality !== undefined) {
      throw invalidRecipe("output.quality cannot be combined with output.lossless.");
    }
  }
  if (hasProperty(value.output, "metadataPolicy")) {
    if (value.output.metadataPolicy !== "preserve" && value.output.metadataPolicy !== "strip") {
      throw invalidRecipe("output.metadataPolicy must be preserve or strip.");
    }
  }

  let input: ImageRecipe["input"];
  if (value.input !== undefined) {
    if (!isRecord(value.input)) {
      throw invalidRecipe("Image recipe input must be an object.");
    }
    assertUnknownKeys(value.input, ["format", "frames", "rasterDensity"], "input");
    input = {};
    if (hasProperty(value.input, "format")) {
      if (!isImageFormat(value.input.format)) {
        throw invalidRecipe("input.format is not a supported image format.");
      }
      input.format = value.input.format;
    }
    if (hasProperty(value.input, "frames")) {
      if (value.input.frames !== "first" && value.input.frames !== "all") {
        throw invalidRecipe('input.frames must be "first" or "all".');
      }
      input.frames = value.input.frames;
    }
    if (hasProperty(value.input, "rasterDensity")) {
      const density = value.input.rasterDensity;
      if (!Number.isInteger(density) || (density as number) < 1 || (density as number) > 10000) {
        throw invalidRecipe("input.rasterDensity must be an integer between 1 and 10000.");
      }
      input.rasterDensity = density as number;
    }
  }

  return {
    ...(input === undefined ? {} : { input }),
    operations: value.operations.map(parseOperation),
    output: {
      format,
      metadataPolicy:
        value.output.metadata === "preserve" || value.output.metadataPolicy === "preserve"
          ? "preserve"
          : "strip",
      ...(hasProperty(value.output, "quality") ? { quality: value.output.quality } : {}),
      ...(hasProperty(value.output, "lossless") ? { lossless: value.output.lossless } : {}),
    } as ImageRecipe["output"],
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function serializeRecipe(recipe: ImageRecipe): string {
  parseImageRecipe(recipe);
  return JSON.stringify(canonicalize(recipe));
}

export async function digestRecipe(recipe: ImageRecipe): Promise<string> {
  const bytes = new TextEncoder().encode(serializeRecipe(recipe));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeSupports(
  capability: ImageCapabilities["formats"][ImageFormat],
  condition:
    | { kind: "pixels" }
    | { kind: "vector" }
    | { kind: "frames"; value: Exclude<FrameSelection, undefined> }
    | { kind: "rasterDensity" },
): boolean {
  const decode = capability?.decode;
  if (decode === undefined) return false;
  switch (condition.kind) {
    case "pixels":
      return decode.pixelFormats.includes("rgba8");
    case "vector":
      return decode.vector;
    case "frames":
      return decode.frames.includes(condition.value === "all" ? "animated" : "still");
    case "rasterDensity":
      return decode.rasterDensity;
  }
}

function issue(section: ImageCapabilityIssue["section"], key: string): ImageCapabilityIssue {
  return { section, key, reason: "unsupported" };
}

export function checkRecipeCapabilities(
  recipe: ImagePipelineConfig,
  capabilities: ImageCapabilities,
  isOperationSupported: (operation: ImageOperation) => OperationCapability,
): ImageCapabilityResult {
  const missing: ImageCapabilityIssue[] = [];
  const format = recipe.input?.format;
  const inputCapability = format === undefined ? undefined : capabilities.formats[format];

  if (format !== undefined && inputCapability?.decode === undefined) {
    missing.push(issue("input", format));
  } else if (inputCapability?.decode !== undefined) {
    const rasterOutput = recipe.output.format !== "svg";
    const vectorOutput = recipe.output.format === "svg";
    if (rasterOutput && !decodeSupports(inputCapability, { kind: "pixels" }))
      missing.push(issue("input", format as ImageFormat));
    if (vectorOutput && !decodeSupports(inputCapability, { kind: "vector" }))
      missing.push(issue("input", format as ImageFormat));
    if (recipe.input?.frames === "all") {
      const frameSupport = format === "tiff" ? "pages" : "animated";
      if (
        !decodeSupports(inputCapability, { kind: "frames", value: "all" }) &&
        !(frameSupport === "pages" && inputCapability.decode.frames.includes("pages"))
      )
        missing.push(issue("input", format as ImageFormat));
    }
    if (
      recipe.input?.rasterDensity !== undefined &&
      !decodeSupports(inputCapability, { kind: "rasterDensity" })
    )
      missing.push(issue("input", format as ImageFormat));
  } else if (format === undefined) {
    if (
      recipe.output.format !== "svg" &&
      !Object.values(capabilities.formats).some((item) => decodeSupports(item, { kind: "pixels" }))
    ) {
      missing.push(issue("input", "raw"));
    }
  }

  const output = recipe.output;
  const outputCapability = capabilities.formats[output.format];
  if (outputCapability?.encode === undefined) {
    missing.push(issue("output", output.format));
  } else {
    const encode = outputCapability.encode;
    const quality = "quality" in output ? output.quality : undefined;
    const lossless = "lossless" in output ? output.lossless === true : false;
    if (quality !== undefined && !encode.quality) missing.push(issue("output", output.format));
    if (lossless && !encode.compressionModes.includes("lossless"))
      missing.push(issue("output", output.format));
    if (recipe.input?.frames === "all" && !encode.animation)
      missing.push(issue("output", output.format));
    if (!encode.metadataPolicies.includes(recipe.output.metadataPolicy ?? "strip"))
      missing.push(issue("output", output.format));
  }

  for (const operation of recipe.operations) {
    const capability = isOperationSupported(operation);
    if (!capability.supported) missing.push(issue("operations", operation.type));
  }

  return {
    supported: missing.length === 0,
    driver: capabilities.driver,
    missing,
    capabilities,
  };
}
