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

export interface SvgoRuntime {
  optimize: (input: string, config?: Record<string, unknown>) => { data: string };
}

export interface SvgoDriverOptions {
  runtime?: "browser" | "node";
  lib?: SvgoRuntime | (() => SvgoRuntime | Promise<SvgoRuntime>);
  config?: Record<string, unknown>;
  optimize?: boolean | Record<string, unknown>;
}

const svgOpeningTag = /<svg\b[^>]*>/i;
const attribute = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i");

export async function decodeSvg(input: ImageInput): Promise<string> {
  if (input instanceof Blob) return await input.text();
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  if (input instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(input));
  throw new UnImageError("Raw pixel input cannot be optimized as SVG.", {
    code: "UNIMAGE_INVALID_INPUT",
  });
}

function lengthValue(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSvgMetadata(svg: string, byteLength?: number): ImageMetadata {
  const openingTag = svg.match(svgOpeningTag)?.[0] ?? "";
  const viewBox = openingTag.match(attribute("viewBox"))?.[1]?.trim().split(/\s+/);
  const widthText = openingTag.match(attribute("width"))?.[1];
  const heightText = openingTag.match(attribute("height"))?.[1];
  const fallbackWidth = viewBox?.[2] === undefined ? undefined : lengthValue(viewBox[2]);
  const fallbackHeight = viewBox?.[3] === undefined ? undefined : lengthValue(viewBox[3]);
  const width = widthText === undefined ? fallbackWidth : lengthValue(widthText);
  const height = heightText === undefined ? fallbackHeight : lengthValue(heightText);
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    throw new UnImageError("The SVG does not declare a usable width and height.", {
      code: "UNIMAGE_INVALID_INPUT",
    });
  }
  return {
    format: "svg",
    mediaType: "image/svg+xml",
    width,
    height,
    ...(byteLength === undefined ? {} : { byteLength }),
  };
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
    const normalized = svg.trim().toLowerCase();
    if (!normalized.startsWith("<?xml") && !normalized.startsWith("<svg")) {
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
    checkRecipe(recipe: ImagePipelineConfig): Promise<ImageCapabilityResult> {
      const capabilities: ImageCapabilities = {
        driver: this.name,
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
      };

      return Promise.resolve(
        checkRecipeCapabilities(recipe, capabilities, () => ({ supported: false })),
      );
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
      if (options.optimize === false) return encode(svg);
      const runtime = await loadRuntime(options);
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
