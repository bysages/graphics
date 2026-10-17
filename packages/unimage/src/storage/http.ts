import { HTTPError } from "h3";
import {
  getIPVersion,
  ipInRange,
  isLoopbackIPv4,
  isLoopbackIPv6,
  isPrivateIPv4,
  isPrivateIPv6,
} from "ipdo";
import type { Driver } from "unstorage";

import { UnImageError } from "../errors";
import { normalizeMaxAge } from "../utils/cache";
import type { ProxyStorageOptions } from "./types";

export interface HTTPStorageOptions {
  fetchOptions?: RequestInit;
  maxAge?: number;
  /** Allow-list of hostnames. Requests to other hosts are rejected with 403. */
  domains?: string | string[];
  /** ImageProxy `allowAllDomains`: serve every host, ignoring `domains`. */
  allowAllDomains?: boolean;
  ignoreCacheControl?: boolean;
  /** Reject requests resolving to private/loopback addresses (SSRF guard). */
  blockPrivateIPs?: boolean;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 3;

type DnsModule = typeof import("node:dns/promises");

const reservedIPv4Ranges = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

const reservedIPv6Ranges = [
  "::/128",
  "64:ff9b::/96",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
  "2001:db8::/32",
  "2002::/16",
];

function isReservedIP(address: string): boolean {
  if (address === "localhost") return true;

  const version = getIPVersion(address);
  if (version === 4) {
    return (
      isPrivateIPv4(address) ||
      isLoopbackIPv4(address) ||
      reservedIPv4Ranges.some((range) => ipInRange(range, address))
    );
  }

  if (version === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isReservedIP(mapped[1]!);
    const nat64 = address.toLowerCase().match(/^64:ff9b::(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (nat64) return isReservedIP(nat64[1]!);
    return (
      isLoopbackIPv6(address) ||
      isPrivateIPv6(address) ||
      reservedIPv6Ranges.some((range) => ipInRange(range, address))
    );
  }

  return false;
}

function forbiddenIP(hostname: string): HTTPError {
  return new HTTPError({
    status: 403,
    statusText: "UNIMAGE_FORBIDDEN_IP",
    message: `Forbidden IP address: ${hostname}`,
  });
}

async function assertSafeAddress(hostname: string): Promise<void> {
  const { lookup } = (await import("node:dns/promises")) as DnsModule;
  if (getIPVersion(hostname) !== null) {
    if (isReservedIP(hostname)) throw forbiddenIP(hostname);
    return;
  }

  let addresses: readonly { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new HTTPError({
      status: 403,
      statusText: "UNIMAGE_FORBIDDEN_HOST",
      message: `Could not resolve host: ${hostname}`,
      cause: error,
    });
  }
  if (addresses.length === 0) throw forbiddenIP(hostname);
  const reserved = addresses.find((entry) => isReservedIP(entry.address));
  if (reserved !== undefined) throw forbiddenIP(`${hostname} (${reserved.address})`);
}

function parseMaxAge(cacheControl: string): number | undefined {
  if (/(?:^|,)\s*(?:no-store|private)\s*(?:,|$)/i.test(cacheControl)) return 0;
  const match = cacheControl.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);
  return match?.[1] === undefined ? undefined : normalizeMaxAge(match[1]);
}

/**
 * Read-only HTTP storage with SSRF guardrails: protocol and host allow-lists,
 * DNS and reserved-address checks, and per-hop validation across manual
 * redirects (automatic redirect following would bypass those checks).
 */
export const httpDriver = (options: HTTPStorageOptions): Driver => {
  const rawDomains = Array.isArray(options.domains)
    ? options.domains
    : (options.domains ?? "").split(",");
  const domains = new Set(
    rawDomains
      .map((domain) => domain.trim())
      .filter(Boolean)
      .map((domain) => new URL(/^https?:\/\//.test(domain) ? domain : `http://${domain}`).hostname),
  );
  const allowAllDomains = options.allowAllDomains === true;
  const defaultMaxAge = normalizeMaxAge(options.maxAge) ?? 300;

  async function validateURL(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new HTTPError({
        status: 403,
        statusText: "UNIMAGE_FORBIDDEN_PROTOCOL",
        message: `Forbidden protocol: ${url.protocol}`,
      });
    }
    if (!allowAllDomains && !domains.has(url.hostname)) {
      throw new HTTPError({
        status: 403,
        statusText: "UNIMAGE_FORBIDDEN_HOST",
        message: `Forbidden host: ${url.hostname}`,
      });
    }
    if (options.blockPrivateIPs === true) await assertSafeAddress(url.hostname);
  }

  function decodeSafe(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  async function pinnedRequest(
    url: URL,
    init?: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const [{ request: httpRequest }, { request: httpsRequest }, { lookup }, { isIP }] =
      await Promise.all([
        import("node:http") as Promise<typeof import("node:http")>,
        import("node:https") as Promise<typeof import("node:https")>,
        import("node:dns/promises") as Promise<DnsModule>,
        import("node:net"),
      ]);

    let addresses: readonly { address: string; family: number }[];
    if (isIP(url.hostname) !== 0) {
      addresses = [{ address: url.hostname, family: isIP(url.hostname) as 4 | 6 }];
    } else {
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    }
    const pinnedLookup: NonNullable<import("node:http").RequestOptions["lookup"]> = (
      _hostname,
      requestOptions,
      callback,
    ) => {
      const wanted =
        requestOptions.family === "IPv4"
          ? 4
          : requestOptions.family === "IPv6"
            ? 6
            : typeof requestOptions.family === "number"
              ? requestOptions.family
              : 0;
      const matched = wanted === 0 ? addresses : addresses.filter((item) => item.family === wanted);
      if (matched.length === 0) {
        callback(new Error(`No pinned address for ${url.hostname}`), "", 4);
        return;
      }
      if (requestOptions.all === true) {
        callback(null, [...matched]);
        return;
      }
      callback(null, matched[0]!.address, matched[0]!.family);
    };

    const incomingHeaders = new Headers(init?.headers);
    const configuredHeaders = new Headers(options.fetchOptions?.headers);
    const headers = new Headers();
    for (const [name, value] of incomingHeaders) headers.set(name, value);
    for (const [name, value] of configuredHeaders) headers.set(name, value);

    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requester({
      hostname: url.hostname,
      port: url.port === "" ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(headers),
      lookup: pinnedLookup,
      ...(url.protocol === "https:" ? { serverName: url.hostname } : {}),
      ...(signal === undefined ? {} : { signal }),
    });

    request.end();

    return await new Promise<Response>((resolve, reject) => {
      request.on("error", () => {});
      const abort = () => {
        request.destroy();
        reject(new DOMException("The request was aborted.", "AbortError"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      request.on("error", (error: Error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          signal?.removeEventListener("abort", abort);
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            } else if (value !== undefined) {
              responseHeaders.set(name, String(value));
            }
          }
          resolve(
            new Response(
              url.protocol === "http:" || response.statusCode === 204 ? undefined : body,
              {
                status: response.statusCode ?? 502,
                statusText: response.statusMessage ?? "",
                headers: responseHeaders,
              },
            ),
          );
        });
        response.on("error", (error: Error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        });
      });
    });
  }

  async function fetchURL(
    key: string,
    init?: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (options.fetchOptions?.redirect === "follow") {
      throw new HTTPError({
        status: 500,
        statusText: "UNIMAGE_INVALID_STORAGE_OPTIONS",
        message: "HTTP storage redirects must remain manually validated.",
      });
    }

    let url: URL;
    try {
      // ImageProxy decodes the id once more after URL parsing, so percent-encoded
      // source URLs behave the same on both stacks.
      url = new URL(decodeSafe(key));
      await validateURL(url);
    } catch (error) {
      if (error instanceof HTTPError) throw error;
      throw new HTTPError({
        status: 400,
        statusText: "UNIMAGE_INVALID_URL",
        message: `Invalid URL: ${key}`,
        cause: error,
      });
    }

    const manualRedirects = options.fetchOptions?.redirect === undefined;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await pinnedRequest(url, init, signal);
      if (!manualRedirects || !redirectStatuses.has(response.status)) {
        return response;
      }
      const location = response.headers.get("location");
      if (!location) return response;
      const nextURL = new URL(location, url);
      await validateURL(nextURL);
      url = nextURL;
    }

    throw new HTTPError({
      status: 502,
      statusText: "UNIMAGE_TOO_MANY_REDIRECTS",
      message: `Too many redirects while fetching: ${key}`,
    });
  }

  return {
    name: "proxy-http",
    async hasItem(key, request?: ProxyStorageOptions) {
      const response = await fetchURL(key, { method: "HEAD" }, request?.signal);
      return response.ok;
    },
    async getItem(key, request?: ProxyStorageOptions) {
      const response = await fetchURL(key, undefined, request?.signal);
      if (!response.ok) {
        throw new HTTPError({
          status: response.status,
          statusText: response.statusText || "UNIMAGE_FETCH_FAILED",
          message: `Failed to fetch ${key}.`,
        });
      }
      return response.text();
    },
    async getItemRaw(key, request?: ProxyStorageOptions) {
      const response = await fetchURL(key, undefined, request?.signal);
      if (!response.ok) {
        throw new HTTPError({
          status: response.status,
          statusText: response.statusText || "UNIMAGE_FETCH_FAILED",
          message: `Failed to fetch ${key}.`,
        });
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async getKeys() {
      return [];
    },
    async getMeta(key, request?: ProxyStorageOptions) {
      try {
        const response = await fetchURL(key, { method: "HEAD" }, request?.signal);
        if (!response.ok) return {};
        const cacheControl = response.headers.get("cache-control");
        const lastModified = response.headers.get("last-modified");
        const mtime = lastModified === null ? undefined : new Date(lastModified);
        const resolvedMaxAge =
          options.ignoreCacheControl === true || cacheControl === null
            ? defaultMaxAge
            : (parseMaxAge(cacheControl) ?? defaultMaxAge);
        return {
          ...(mtime === undefined || Number.isNaN(mtime.getTime()) ? {} : { mtime }),
          maxAge: resolvedMaxAge,
        };
      } catch (error) {
        if (request?.signal?.aborted) {
          throw new UnImageError("Image source lookup was aborted.", {
            code: "UNIMAGE_ABORT",
            cause: error,
          });
        }
        return {};
      }
    },
  };
};
