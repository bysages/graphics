import { UnImageError } from "../errors";
import { checkRecipeCapabilities } from "../recipe";
import type {
  ImageCapabilities,
  ImageDriver,
  ImageInput,
  ImageMetadata,
  ImagePipelineConfig,
  ImageCapabilityResult,
  ImageResult,
} from "../types";
import { decodeSvg, isSvgText, parseSvgMetadata } from "../utils/svg";

export interface SvgoRuntime {
  optimize: (input: string, config?: Record<string, unknown>) => { data: string };
}

export interface SvgoDriverOptions {
  runtime?: "browser" | "node";
  lib?: SvgoRuntime | (() => SvgoRuntime | Promise<SvgoRuntime>);
  config?: Record<string, unknown>;
  optimize?: boolean | Record<string, unknown>;
}

function loadRuntime(options: SvgoDriverOptions): Promise<SvgoRuntime> {
  if (typeof options.lib === "function") return Promise.resolve(options.lib());
  if (options.lib) return Promise.resolve(options.lib);
  if (options.runtime === "browser") return import("svgo/browser") as Promise<SvgoRuntime>;
  return import("svgo") as Promise<SvgoRuntime>;
}

export function svgoDriver(options: SvgoDriverOptions = {}): ImageDriver {
  async function load(input: ImageInput): Promise<{ svg: string; metadata: ImageMetadata }> {
    const svg = await decodeSvg(input);
    if (!isSvgText(svg)) {
      throw new UnImageError("Image input is not SVG.", { code: "UNIMAGE_INVALID_INPUT" });
    }
    return {
      svg,
      metadata: parseSvgMetadata(svg, input instanceof Blob ? input.size : undefined),
    };
  }

  return {
    name: "svgo",
    capabilities(): Promise<ImageCapabilities> {
      return Promise.resolve({
        driver: "svgo",
        formats: {
          svg: {
            decode: {
              pixelFormats: [],
              frames: ["still"],
              orientation: false,
              rasterDensity: false,
              vector: true,
            },
            encode: {
              compressionModes: ["lossless"],
              quality: false,
              animation: false,
              metadataPolicies: ["strip"],
              sanitize: true,
            },
          },
        },
        metadataRead: true,
        operations: {},
        notes: ["Optimizes vector input without raster operations."],
      });
    },
    async checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      const capabilities = await this.capabilities();
      return checkRecipeCapabilities(recipe, capabilities, () => ({ supported: false }));
    },

    async metadata(input): Promise<ImageMetadata> {
      return (await load(input)).metadata;
    },
    async transform(input, recipe): Promise<ImageResult> {
      if (recipe.output.format !== "svg" || recipe.output.metadataPolicy === "preserve") {
        throw new UnImageError("The SVGO driver can only output sanitized and optimized SVG.", {
          code: "UNIMAGE_UNSUPPORTED_FORMAT",
          format: recipe.output.format,
        });
      }
      if (recipe.operations.length > 0) {
        throw new UnImageError("The SVGO driver does not support raster operations.", {
          code: "UNIMAGE_UNSUPPORTED_OPERATION",
          operation: recipe.operations[0]?.type,
        });
      }

      const { svg } = await load(input);
      const runtime = await loadRuntime(options);
      if (options.optimize === false) {
        try {
          return encode(runtime.optimize(svg, { plugins: ["removeScripts"] }).data);
        } catch (error) {
          throw new UnImageError("The SVG could not be sanitized.", {
            code: "UNIMAGE_ENCODE",
            format: "svg",
            cause: error,
          });
        }
      }
      const userPlugins = Array.isArray(options.config?.plugins) ? options.config.plugins : [];
      const optimizePlugins =
        options.optimize &&
        typeof options.optimize === "object" &&
        Array.isArray(options.optimize.plugins)
          ? options.optimize.plugins
          : userPlugins;
      const config = {
        multipass: true,
        ...options.config,
        ...(options.optimize && typeof options.optimize === "object" ? options.optimize : {}),
        plugins: ["removeScripts", "preset-default", ...optimizePlugins],
      };
      try {
        return encode(runtime.optimize(svg, config).data);
      } catch (error) {
        throw new UnImageError("The SVG could not be optimized.", {
          code: "UNIMAGE_ENCODE",
          format: "svg",
          cause: error,
        });
      }
    },
  };
}

function encode(output: string): ImageResult {
  const data = new TextEncoder().encode(output);
  return {
    kind: "vector",
    data,
    format: "svg",
    mediaType: "image/svg+xml",
    metadata: parseSvgMetadata(output, data.byteLength),
  };
}
