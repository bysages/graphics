import { UnImageError } from "../errors";
import type {
  ImageCapabilities,
  ImageCapabilityResult,
  ImageDecodeRequest,
  ImageDriver,
  ImageFormat,
  ImageInput,
  ImageMetadata,
  ImageOperation,
  ImagePipelineConfig,
  ImageRecipe,
  ImageResult,
  OperationCapability,
  RawImageFrame,
  RawImageSequence,
} from "../types";
import { sniffImageFormat, type SniffedImageFormat } from "../utils/format";

function formatCapabilities(
  capabilities: ImageCapabilities,
  format: ImageFormat,
): NonNullable<ImageCapabilities["formats"][ImageFormat]> | undefined {
  return capabilities.formats[format];
}

function supportsRead(capabilities: ImageCapabilities, inputFormat: SniffedImageFormat): boolean {
  if (inputFormat === undefined) {
    return Object.values(capabilities.formats).some(
      (capability) => capability?.decode?.pixelFormats.includes("rgba8") ?? false,
    );
  }

  const decode = formatCapabilities(capabilities, inputFormat)?.decode;
  return decode?.pixelFormats.includes("rgba8") === true || decode?.vector === true;
}

function supportsDecode(capabilities: ImageCapabilities, inputFormat: SniffedImageFormat): boolean {
  if (inputFormat === undefined) {
    return Object.values(capabilities.formats).some(
      (capability) => capability?.decode?.pixelFormats.includes("rgba8") ?? false,
    );
  }

  const decode = formatCapabilities(capabilities, inputFormat)?.decode;
  return decode?.pixelFormats.includes("rgba8") ?? false;
}

function supportsDecodeFrames(
  capabilities: ImageCapabilities,
  inputFormat: SniffedImageFormat,
): boolean {
  if (inputFormat === undefined) {
    return Object.values(capabilities.formats).some(
      (capability) =>
        (capability?.decode?.frames.includes("animated") ||
          capability?.decode?.frames.includes("pages")) ??
        false,
    );
  }

  const decode = formatCapabilities(capabilities, inputFormat)?.decode;
  return decode?.frames.includes("animated") || decode?.frames.includes("pages") || false;
}

/**
 * Stack drivers by their own complete recipe check. Execution tries every
 * supported route in order, so an optional native dependency can fall through
 * to the next driver even when its static capability check passed.
 */
export function overlayDriver(...drivers: ImageDriver[]): ImageDriver {
  if (drivers.length === 0) {
    throw new UnImageError("At least one driver is required.", {
      code: "UNIMAGE_INVALID_INPUT",
    });
  }

  async function pick(input: ImageInput, recipe?: ImageRecipe): Promise<ImageDriver[]> {
    const inputFormat = await sniffImageFormat(input);
    const selected: ImageDriver[] = [];

    for (const driver of drivers) {
      if (recipe === undefined) {
        const capabilities = await driver.capabilities();
        if (!supportsDecode(capabilities, inputFormat)) continue;
        selected.push(driver);
        continue;
      }

      const pipeline: ImagePipelineConfig = {
        input: {
          ...(inputFormat === undefined ? {} : { format: inputFormat }),
          ...(recipe.input === undefined ? {} : { ...recipe.input }),
        },
        operations: recipe.operations,
        output: recipe.output,
      };
      if (await driver.checkRecipe(pipeline).then((result) => result.supported))
        selected.push(driver);
    }

    if (selected.length > 0) return selected;
    throw new UnImageError(
      inputFormat === undefined
        ? "No driver in the overlay stack accepts this input."
        : `No driver in the overlay stack supports ${inputFormat} with the requested pipeline.`,
      { code: "UNIMAGE_DECODE", format: inputFormat },
    );
  }

  return {
    name: drivers.map((driver) => driver.name).join("+"),

    async capabilities(): Promise<ImageCapabilities> {
      const settled = await Promise.allSettled(drivers.map((driver) => driver.capabilities()));
      const all = settled
        .map((result) => (result.status === "fulfilled" ? result.value : undefined))
        .filter((capabilities): capabilities is ImageCapabilities => capabilities !== undefined);
      const unavailable = settled
        .map((result, index) =>
          result.status === "rejected"
            ? `${drivers[index]?.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
            : undefined,
        )
        .filter((note): note is string => note !== undefined);
      const operations: Partial<Record<ImageOperation["type"], OperationCapability>> = {};
      const formats: ImageCapabilities["formats"] = {};

      for (const capabilities of all) {
        for (const [operation, detail] of Object.entries(capabilities.operations)) {
          const key = operation as ImageOperation["type"];
          if (detail !== undefined && operations[key] === undefined) operations[key] = detail;
        }
        for (const [format, capability] of Object.entries(capabilities.formats)) {
          const key = format as ImageFormat;
          const current = formats[key];
          formats[key] = {
            decode: {
              pixelFormats: [
                ...new Set([
                  ...(current?.decode?.pixelFormats ?? []),
                  ...(capability?.decode?.pixelFormats ?? []),
                ]),
              ],
              frames: [
                ...new Set([
                  ...(current?.decode?.frames ?? []),
                  ...(capability?.decode?.frames ?? []),
                ]),
              ],
              orientation:
                current?.decode?.orientation === true || capability?.decode?.orientation === true,
              rasterDensity:
                current?.decode?.rasterDensity === true ||
                capability?.decode?.rasterDensity === true,
              vector: current?.decode?.vector === true || capability?.decode?.vector === true,
            },
            encode: {
              compressionModes: [
                ...new Set([
                  ...(current?.encode?.compressionModes ?? []),
                  ...(capability?.encode?.compressionModes ?? []),
                ]),
              ],
              quality: current?.encode?.quality === true || capability?.encode?.quality === true,
              animation:
                current?.encode?.animation === true || capability?.encode?.animation === true,
              metadataPolicies: [
                ...new Set([
                  ...(current?.encode?.metadataPolicies ?? []),
                  ...(capability?.encode?.metadataPolicies ?? []),
                ]),
              ],
              sanitize: current?.encode?.sanitize === true || capability?.encode?.sanitize === true,
            },
          };
        }
      }

      return {
        driver: this.name,
        formats,
        metadataRead: all.some((capabilities) => capabilities.metadataRead),
        operations,
        notes: [
          ...new Set(all.flatMap((capabilities) => capabilities.notes ?? [])),
          ...unavailable,
          "This summary is a union; execution uses each driver's complete recipe check.",
        ],
      };
    },

    async checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      for (const driver of drivers) {
        const result = await driver.checkRecipe(recipe);
        if (result.supported) return result;
      }
      const lastDriver = drivers[drivers.length - 1];
      if (lastDriver === undefined)
        throw new UnImageError("No drivers are available.", { code: "UNIMAGE_INVALID_INPUT" });
      return await lastDriver.checkRecipe(recipe);
    },

    async metadata(input: ImageInput, context?): Promise<ImageMetadata> {
      const inputFormat = await sniffImageFormat(input);
      for (const driver of drivers) {
        const capabilities = await driver.capabilities();
        if (supportsRead(capabilities, inputFormat)) return driver.metadata(input, context);
      }
      throw new UnImageError(
        inputFormat === undefined
          ? "No driver in the overlay stack can read this input."
          : `No driver in the overlay stack can read ${inputFormat}.`,
        { code: "UNIMAGE_DECODE", format: inputFormat },
      );
    },

    async decode(input: ImageInput, request: ImageDecodeRequest = {}): Promise<RawImageFrame> {
      const inputFormat = await sniffImageFormat(input);
      for (const driver of drivers) {
        const capabilities = await driver.capabilities();
        if (!supportsDecode(capabilities, inputFormat)) continue;
        if (driver.decode === undefined) continue;
        return await driver.decode(input, request);
      }
      throw new UnImageError(
        inputFormat === undefined
          ? "No driver in the overlay stack can decode this input to pixels."
          : `No driver in the overlay stack can decode ${inputFormat} to pixels.`,
        { code: "UNIMAGE_DECODE", format: inputFormat },
      );
    },

    async decodeFrames(
      input: ImageInput,
      request: ImageDecodeRequest = {},
    ): Promise<RawImageSequence> {
      const inputFormat = await sniffImageFormat(input);
      for (const driver of drivers) {
        const capabilities = await driver.capabilities();
        if (!supportsDecodeFrames(capabilities, inputFormat)) continue;
        if (driver.decodeFrames === undefined) continue;
        return await driver.decodeFrames(input, request);
      }
      throw new UnImageError(
        inputFormat === undefined
          ? "No driver in the overlay stack can decode this input as frames."
          : `No driver in the overlay stack can decode ${inputFormat} as frames.`,
        { code: "UNIMAGE_DECODE", format: inputFormat },
      );
    },

    async transform(input: ImageInput, recipe, context?): Promise<ImageResult> {
      const candidates = await pick(input, recipe);
      let lastError: unknown;
      for (const driver of candidates) {
        try {
          return await driver.transform(input, recipe, context);
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError !== undefined) throw lastError;
      throw new UnImageError("No driver in the overlay stack can process this input.", {
        code: "UNIMAGE_DECODE",
      });
    },

    ...(drivers.some((driver) => driver.dispose !== undefined)
      ? {
          async dispose(): Promise<void> {
            await Promise.all(drivers.map(async (driver) => await driver.dispose?.()));
          },
        }
      : {}),
  };
}
