import { defineEventHandler, HTTPError } from "h3";
import type { EventHandlerWithFetch } from "h3";

import { UnImageError } from "./errors";
import {
  SUPPORTED_FORMATS,
  type ImageProxy,
  type ImageProxyFormatModifier,
  type ImageProxyModifiers,
} from "./proxy";
import { mediaTypeForFormat } from "./utils/format";

export type ImageProxyAutoFormat =
  | "avif"
  | "webp"
  | "jpeg"
  | "jpg"
  | "png"
  | "gif"
  | "tiff"
  | "heif"
  | "heic";

export interface ImageProxyParsedURL {
  id: string;
  modifiers: Record<string, string>;
}

export type ImageProxyURLParser = (
  url: string,
) => ImageProxyParsedURL | Promise<ImageProxyParsedURL>;

export interface ImageProxyHandlerOptions {
  parseURL?: ImageProxyURLParser;
  autoFormats?: ImageProxyAutoFormat[];
}

export type FetchHandler = (request: Request | string | URL) => Response | Promise<Response>;

const defaultAutoFormats: readonly ImageProxyAutoFormat[] = ["avif", "webp", "jpeg", "png"];
const modifierSeparator = /[&,]/g;
const modifierValueSeparator = /[:=_]/;

export function parseImageProxyURL(url: string): ImageProxyParsedURL {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch (error) {
    throw new HTTPError({
      status: 400,
      statusText: "UNIMAGE_INVALID_URL",
      message: `Invalid request URL: ${url}`,
      cause: error,
    });
  }
  const [modifiersString = "", ...idSegments] = pathname.slice(1).split("/");

  const id = decodeURIComponentSafe(idSegments.join("/"));
  if (modifiersString === "") {
    throw new HTTPError({
      status: 400,
      statusText: "UNIMAGE_MISSING_MODIFIERS",
      message: "Modifiers are missing.",
    });
  }

  const modifiers: Record<string, string> = {};
  if (modifiersString !== "_") {
    for (const item of modifiersString.split(modifierSeparator)) {
      const [key = "", ...values] = item.split(modifierValueSeparator);
      modifiers[key] = values.map(decodeURIComponentSafe).join("_");
    }
  }

  return { id, modifiers };
}

/**
 * Create an h3 event handler (compatible with Nitro and h3 apps).
 *
 * The returned handler also exposes `.fetch`, so it can be used directly as a
 * fetch handler in runtimes without h3.
 */
export function createImageProxyHandler(
  proxy: ImageProxy,
  options: ImageProxyHandlerOptions = {},
): EventHandlerWithFetch {
  const parseURL = options.parseURL ?? parseImageProxyURL;
  const autoFormats = resolveAutoFormats(options.autoFormats);

  return defineEventHandler(async (event) => {
    const request = event.req;
    try {
      const parsed = await parseURL(request.url);
      const modifiers = applyAutoFormat(
        parsed.modifiers,
        request.headers.get("accept"),
        autoFormats,
      );
      const image = proxy(parsed.id, modifiers, { signal: request.signal });
      const sourceMeta = await image.getSourceMeta({ signal: request.signal });
      const processed = await image.process({ signal: request.signal });
      const etag = await createContentETag(processed.data);

      if (
        etagMatches(request.headers.get("if-none-match"), etag) ||
        modifiedSinceMatches(
          request.headers.get("if-modified-since"),
          sourceMeta.mtime,
          request.headers.get("if-none-match") !== null,
        )
      ) {
        return new Response(null, {
          status: 304,
          headers: responseHeaders(sourceMeta.maxAge, etag, undefined, sourceMeta.mtime),
        });
      }

      const mediaType = mediaTypeForFormat(processed.format);
      return new Response(new Blob([toBlobPart(processed.data)], { type: mediaType }), {
        headers: responseHeaders(sourceMeta.maxAge, etag, mediaType, sourceMeta.mtime),
      });
    } catch (error) {
      throw toHTTPError(error);
    }
  });
}

export function createImageProxyFetchHandler(
  proxy: ImageProxy,
  options: ImageProxyHandlerOptions = {},
): FetchHandler {
  const handler = createImageProxyHandler(proxy, options);
  return (request) => handler.fetch(request);
}

export {
  createImageProxy,
  type ImageProxy,
  type ImageProxyModifiers,
  type ImageProxyOptions,
  type ImageProxySourceMeta,
} from "./proxy";
export { fsDriver, type FSStorageOptions } from "./storage/fs";
export { httpDriver, type HTTPStorageOptions } from "./storage/http";
export { fromUnstorage, type UnstorageAdapterOptions } from "./storage/unstorage";
export type { ProxyStorage, ProxyStorageMeta } from "./storage/types";

function toHTTPError(error: unknown): unknown {
  if (error instanceof HTTPError) return error;
  if (error instanceof UnImageError) {
    const status =
      error.code === "UNIMAGE_DRIVER_UNAVAILABLE"
        ? 503
        : error.code === "UNIMAGE_ABORT"
          ? 408
          : 400;
    return new HTTPError({ status, statusText: error.code, message: error.message });
  }
  return new HTTPError({
    status: 500,
    statusText: "UNIMAGE_PROCESS_FAILED",
    message: "The image could not be processed.",
    cause: error,
  });
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveAutoFormats(
  input: readonly ImageProxyAutoFormat[] | undefined,
): readonly ImageProxyAutoFormat[] {
  const formats = (input ?? defaultAutoFormats).map((format) =>
    format === "jpg" ? "jpeg" : format,
  );
  const invalid = formats.filter((format) => !SUPPORTED_FORMATS.has(format));
  if (invalid.length > 0) {
    throw new Error(`Unsupported auto formats: ${invalid.join(", ")}`);
  }
  return formats as readonly ImageProxyAutoFormat[];
}

function applyAutoFormat(
  modifiers: Record<string, string>,
  acceptHeader: string | null,
  autoFormats: readonly ImageProxyAutoFormat[],
): Partial<ImageProxyModifiers> {
  const result: Partial<ImageProxyModifiers> = { ...modifiers };
  const key = result.format === undefined ? "f" : "format";
  if (result[key] !== "auto") return result;

  result[key] = negotiateFormat(acceptHeader ?? "", autoFormats);
  return result;
}

function negotiateFormat(
  acceptHeader: string,
  candidates: readonly ImageProxyAutoFormat[],
): ImageProxyFormatModifier {
  const preferences = acceptHeader
    .split(",")
    .map((item) => {
      const [mediaType = "", ...parameters] = item.trim().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qualityParameter === undefined ? 1 : Number(qualityParameter.trim().slice(2));
      return {
        mediaType: (mediaType ?? "").trim().toLowerCase(),
        quality: Number.isFinite(quality) ? Math.max(0, Math.min(1, quality)) : 0,
      };
    })
    .filter((item) => item.mediaType !== "" && item.quality > 0);

  const exact = new Map(preferences.map((item) => [item.mediaType, item.quality]));
  const wildcard = (type: string): number => {
    const mime = `image/${type}`;
    if (exact.has(mime)) return exact.get(mime)!;
    const imageWildcard = preferences.find((item) => item.mediaType === "image/*");
    if (imageWildcard !== undefined) return imageWildcard.quality;
    const anyWildcard = preferences.find((item) => item.mediaType === "*/*");
    if (anyWildcard !== undefined) return anyWildcard.quality;
    return 0;
  };

  let winner: ImageProxyAutoFormat | undefined;
  let winnerQuality = -1;
  for (const candidate of candidates) {
    const quality = wildcard(candidate);
    if (quality > winnerQuality) {
      winner = candidate;
      winnerQuality = quality;
    }
  }
  return winner ?? "jpeg";
}

function modifiedSinceMatches(
  header: string | null,
  mtime: Date | undefined,
  hasETagCondition: boolean,
): boolean {
  if (header === null || hasETagCondition || mtime === undefined) return false;
  const condition = new Date(header);
  return (
    !Number.isNaN(condition.getTime()) &&
    Math.floor(mtime.getTime() / 1000) <= Math.floor(condition.getTime() / 1000)
  );
}

function responseHeaders(
  maxAge: number | undefined,
  etag: string,
  contentType?: string,
  mtime?: Date,
): Headers {
  const headers = new Headers();
  if (contentType !== undefined) headers.set("content-type", contentType);
  headers.set("cache-control", `public, max-age=${maxAge ?? 60}`);
  headers.set("etag", etag);
  headers.set("vary", "Accept");
  headers.set("content-security-policy", "default-src 'none'");
  headers.set("x-content-type-options", "nosniff");
  if (mtime !== undefined) headers.set("last-modified", mtime.toUTCString());
  return headers;
}

async function createContentETag(data: Uint8Array): Promise<string> {
  const bytes = toBlobPart(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  const digestBytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of digestBytes) binary += String.fromCharCode(byte);
  return `W/"${btoa(binary).slice(0, 27)}"`;
}

function toBlobPart(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return bytes;
}

function opaqueTag(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch === "*") return true;
  return ifNoneMatch.split(",").some((item) => opaqueTag(item.trim()) === opaqueTag(etag));
}
