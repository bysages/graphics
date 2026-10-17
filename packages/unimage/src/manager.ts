import { UnImageError } from "./errors";
import { parseImageRecipe } from "./recipe";
import type {
  ImageCapabilityResult,
  ImageCapabilities,
  ImageInput,
  ImageDecodeRequest,
  ImageInputDecodeOptions,
  ImageManager,
  ImageManagerOptions,
  ImageMetadata,
  ImagePipelineConfig,
  ImageRecipe,
  ImageResult,
  ImageTransformOptions,
  RawImageFrame,
  RawImageSequence,
} from "./types";
import { validateLayerBindings } from "./utils/composite";
import { sniffImageFormat } from "./utils/format";
import { isRawImageData } from "./utils/input";

function assertDecodeOptions(options?: ImageInputDecodeOptions): void {
  const density = options?.rasterDensity;
  if (density !== undefined && (!Number.isInteger(density) || density < 1 || density > 10000)) {
    throw new UnImageError("rasterDensity must be an integer between 1 and 10000.", {
      code: "UNIMAGE_INVALID_RECIPE",
    });
  }
}

function toDecodeRequest(
  config?: ImageInputDecodeOptions & { signal?: AbortSignal },
): ImageDecodeRequest {
  return {
    ...(config?.rasterDensity === undefined ? {} : { rasterDensity: config.rasterDensity }),
    ...(config?.signal === undefined ? {} : { signal: config.signal }),
  };
}

export function createImageManager(options: ImageManagerOptions): ImageManager {
  const driver = options.driver;
  let capabilitiesPromise: Promise<ImageCapabilities> | undefined;

  async function capabilities(): Promise<ImageCapabilities> {
    capabilitiesPromise ??= Promise.resolve(driver.capabilities()).catch((error: unknown) => {
      capabilitiesPromise = undefined;
      throw error;
    });
    return capabilitiesPromise;
  }

  function abortError(error: unknown, signal: AbortSignal | undefined): unknown {
    if (error instanceof UnImageError) return error;
    if (signal?.aborted) {
      return new UnImageError("Image processing was aborted.", {
        code: "UNIMAGE_ABORT",
        cause: error,
      });
    }
    return error;
  }

  const manager: ImageManager = {
    driverName: driver.name,

    capabilities,

    async isConfigSupported(config: ImageRecipe): Promise<ImageCapabilityResult> {
      const recipe = parseImageRecipe(config);
      return await driver.checkRecipe({ ...recipe, input: recipe.input ?? {} });
    },

    async metadata(input: ImageInput, config?: { signal?: AbortSignal }): Promise<ImageMetadata> {
      try {
        const metadata = await driver.metadata(input, { signal: config?.signal });
        if (config?.signal?.aborted) {
          throw new UnImageError("Image metadata was aborted.", { code: "UNIMAGE_ABORT" });
        }
        return metadata;
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        if (config?.signal?.aborted) {
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

    async decode(
      input: ImageInput,
      config?: ImageInputDecodeOptions & { signal?: AbortSignal },
    ): Promise<RawImageFrame> {
      assertDecodeOptions(config);
      if (driver.decode === undefined) {
        throw new UnImageError(`Driver "${driver.name}" cannot decode pixel frames.`, {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "decode",
        });
      }
      const request = toDecodeRequest(config);
      try {
        return await driver.decode(input, request);
      } catch (error) {
        throw abortError(error, config?.signal);
      }
    },

    async decodeFrames(
      input: ImageInput,
      config?: ImageInputDecodeOptions & { signal?: AbortSignal },
    ): Promise<RawImageSequence> {
      assertDecodeOptions(config);
      if (driver.decodeFrames === undefined) {
        throw new UnImageError(`Driver "${driver.name}" cannot decode frame sequences.`, {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: "decodeFrames",
        });
      }
      const request = toDecodeRequest(config);
      try {
        return await driver.decodeFrames(input, request);
      } catch (error) {
        throw abortError(error, config?.signal);
      }
    },

    async transform(
      input: ImageInput,
      recipe: ImageRecipe,
      config?: ImageTransformOptions,
    ): Promise<ImageResult> {
      const parsedRecipe = parseImageRecipe(recipe);
      const sourceFormat = isRawImageData(input) ? undefined : await sniffImageFormat(input);
      const declaredFormat = parsedRecipe.input?.format;
      if (declaredFormat !== undefined && declaredFormat !== sourceFormat) {
        throw new UnImageError("The declared input format does not match the source image.", {
          code: "UNIMAGE_INVALID_INPUT",
        });
      }

      const pipeline: ImagePipelineConfig = {
        input: {
          ...(sourceFormat === undefined ? {} : { format: sourceFormat }),
          ...(parsedRecipe.input === undefined ? {} : { ...parsedRecipe.input }),
        },
        operations: parsedRecipe.operations,
        output: parsedRecipe.output,
      };

      const capability = await driver.checkRecipe(pipeline);
      if (!capability.supported) {
        const issue = capability.missing[0];
        if (issue === undefined) {
          throw new UnImageError(`Driver "${driver.name}" cannot run this pipeline.`, {
            code: "UNIMAGE_UNSUPPORTED_FORMAT",
          });
        }
        throw new UnImageError(
          `Driver "${driver.name}" does not support ${issue.section} "${issue.key}".`,
          {
            code:
              issue.section === "operations"
                ? "UNIMAGE_UNSUPPORTED_OPERATION"
                : "UNIMAGE_UNSUPPORTED_FORMAT",
            operation: issue.section === "operations" ? issue.key : undefined,
            format: issue.section === "operations" ? undefined : issue.key,
          },
        );
      }

      validateLayerBindings(parsedRecipe.operations, config?.layers);

      try {
        const result = await driver.transform(input, parsedRecipe, {
          signal: config?.signal,
          layers: config?.layers,
        });
        if (config?.signal?.aborted) {
          throw new UnImageError("Image processing was aborted.", { code: "UNIMAGE_ABORT" });
        }
        return result;
      } catch (error) {
        if (error instanceof UnImageError) throw error;
        if (config?.signal?.aborted) {
          throw new UnImageError("Image processing was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        throw new UnImageError("Image transform failed.", {
          code: "UNIMAGE_ENCODE",
          cause: error,
        });
      }
    },

    async dispose(): Promise<void> {
      await driver.dispose?.();
    },
  };

  return manager;
}
