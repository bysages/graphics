import { HTTPError } from "h3";
import { defineDriver, type Driver } from "unstorage";

import { normalizeMaxAge } from "../proxy";

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

function isPrivateIP(hostname: string): boolean {
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname)) return true;
  const parts = hostname.split(".");
  const [first = 0, second = 0] = parts.map(Number);
  if (parts.length === 4 && Number.isInteger(first) && Number.isInteger(second)) {
    return first === 172 && second >= 16 && second <= 31;
  }
  return (
    hostname === "::1" ||
    hostname === "localhost" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
}

function parseMaxAge(cacheControl: string): number | undefined {
  const match = cacheControl.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);
  return match?.[1] === undefined ? undefined : normalizeMaxAge(match[1]);
}

/**
 * Read-only HTTP storage with SSRF guardrails: protocol and host allow-lists,
 * private-address blocking, and per-hop validation across manual redirects
 * (automatic redirect following would bypass the host checks).
 */
export const httpDriver = defineDriver((options: HTTPStorageOptions): Driver => {
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

  function validateURL(url: URL): void {
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
    if (options.blockPrivateIPs === true && isPrivateIP(url.hostname)) {
      throw new HTTPError({
        status: 403,
        statusText: "UNIMAGE_FORBIDDEN_IP",
        message: `Forbidden IP address: ${url.hostname}`,
      });
    }
  }

  function decodeSafe(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  async function fetchURL(key: string, init?: RequestInit): Promise<Response> {
    let url: URL;
    try {
      // ImageProxy decodes the id once more after URL parsing, so percent-encoded
      // source URLs behave the same on both stacks.
      url = new URL(decodeSafe(key));
      validateURL(url);
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
      const response = await fetch(url, {
        ...options.fetchOptions,
        ...init,
        redirect: options.fetchOptions?.redirect ?? "manual",
      });
      if (!manualRedirects || !redirectStatuses.has(response.status)) {
        return response;
      }
      const location = response.headers.get("location");
      if (!location) return response;
      const nextURL = new URL(location, url);
      validateURL(nextURL);
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
    async hasItem(key) {
      const response = await fetchURL(key, { method: "HEAD" });
      return response.ok;
    },
    async getItem(key) {
      const response = await fetchURL(key);
      if (!response.ok) {
        throw new HTTPError({
          status: response.status,
          statusText: response.statusText || "UNIMAGE_FETCH_FAILED",
          message: `Failed to fetch ${key}.`,
        });
      }
      return response.text();
    },
    async getItemRaw(key) {
      const response = await fetchURL(key);
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
    async getMeta(key) {
      try {
        const response = await fetchURL(key, { method: "HEAD" });
        if (!response.ok) return {};
        const cacheControl = response.headers.get("cache-control");
        const lastModified = response.headers.get("last-modified");
        return {
          ...(lastModified === null ? {} : { mtime: new Date(lastModified) }),
          maxAge:
            options.ignoreCacheControl === true || cacheControl === null
              ? defaultMaxAge
              : (parseMaxAge(cacheControl) ?? defaultMaxAge),
        };
      } catch {
        return {};
      }
    },
  };
});
