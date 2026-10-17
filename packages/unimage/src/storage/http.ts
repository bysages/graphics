import { HTTPError } from "h3";
import { defineDriver, type Driver } from "unstorage";

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
type NetModule = typeof import("node:net");

function ipv4ToNumber(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const byte = Number(part);
    if (byte > 255) return undefined;
    value = value * 256 + byte;
  }
  return value;
}

function inIPv4Cidr(address: string, cidr: string): boolean {
  const value = ipv4ToNumber(address);
  const [network, prefix] = cidr.split("/");
  const bits = Number(prefix);
  if (value === undefined || network === undefined || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const networkValue = ipv4ToNumber(network);
  return networkValue !== undefined && (value & mask) === (networkValue & mask);
}

function parseIPv6(address: string): bigint | undefined {
  const [body = "", zone = ""] = address.split("%");
  if (zone !== "" || body === "") return undefined;
  const separator = body.indexOf("::");
  if (separator !== -1 && separator !== body.lastIndexOf("::")) return undefined;
  const sides = separator === -1 ? [body] : [body.slice(0, separator), body.slice(separator + 2)];
  const groups: number[] = [];
  for (const [index, side] of sides.entries()) {
    if (side === "") {
      if (index === 1 && separator === body.length - 2) groups.push(0);
      continue;
    }
    for (const group of side.split(":")) {
      if (group.includes(".")) {
        const ipv4 = ipv4ToNumber(group);
        if (ipv4 === undefined) return undefined;
        groups.push(Math.floor(ipv4 / 0x10000), ipv4 % 0x10000);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
      groups.push(Number.parseInt(group, 16));
    }
  }
  if (separator !== -1) {
    const missing = 8 - groups.length;
    if (missing < 1) return undefined;
    groups.splice(
      sides[0] === "" ? 0 : groups.length,
      0,
      ...Array.from({ length: missing }, () => 0),
    );
  }
  if (groups.length !== 8) return undefined;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function inIPv6Cidr(address: bigint, network: string): boolean {
  const [networkAddress = "", prefixText = ""] = network.split("/");
  const prefix = Number(prefixText);
  const networkValue = parseIPv6(networkAddress);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128 || networkValue === undefined) {
    return false;
  }
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
  return (address & mask) === (networkValue & mask);
}

function isPrivateIP(address: string): boolean {
  if (address === "localhost") return true;
  if (address.includes(":")) {
    const value = parseIPv6(address.toLowerCase());
    if (value === undefined) return true;
    const mapped = value & 0xffffffffn;
    if (value >> 32n === 0xffffn) {
      const ipv4 = mapped.toString();
      return isPrivateIP(ipv4);
    }
    return (
      value === 0n ||
      value === 1n ||
      inIPv6Cidr(value, "fc00::/7") ||
      inIPv6Cidr(value, "fe80::/10") ||
      inIPv6Cidr(value, "ff00::/8") ||
      inIPv6Cidr(value, "::ffff:0:0/96") ||
      inIPv6Cidr(value, "64:ff9b::/96") ||
      inIPv6Cidr(value, "2001:db8::/32") ||
      inIPv6Cidr(value, "2002::/16")
    );
  }
  return (
    inIPv4Cidr(address, "0.0.0.0/8") ||
    inIPv4Cidr(address, "10.0.0.0/8") ||
    inIPv4Cidr(address, "100.64.0.0/10") ||
    inIPv4Cidr(address, "127.0.0.0/8") ||
    inIPv4Cidr(address, "169.254.0.0/16") ||
    inIPv4Cidr(address, "172.16.0.0/12") ||
    inIPv4Cidr(address, "192.0.0.0/24") ||
    inIPv4Cidr(address, "192.0.2.0/24") ||
    inIPv4Cidr(address, "192.168.0.0/16") ||
    inIPv4Cidr(address, "198.18.0.0/15") ||
    inIPv4Cidr(address, "198.51.100.0/24") ||
    inIPv4Cidr(address, "203.0.113.0/24") ||
    inIPv4Cidr(address, "224.0.0.0/4") ||
    inIPv4Cidr(address, "240.0.0.0/4")
  );
}

function forbiddenIP(hostname: string): HTTPError {
  return new HTTPError({
    status: 403,
    statusText: "UNIMAGE_FORBIDDEN_IP",
    message: `Forbidden IP address: ${hostname}`,
  });
}

async function assertSafeAddress(hostname: string): Promise<void> {
  const [{ lookup }, { isIP }] = await Promise.all([
    import("node:dns/promises") as Promise<DnsModule>,
    import("node:net") as Promise<NetModule>,
  ]);
  if (isIP(hostname) !== 0) {
    if (isPrivateIP(hostname)) throw forbiddenIP(hostname);
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
  const reserved = addresses.find((entry) => isPrivateIP(entry.address));
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
        import("node:net") as Promise<NetModule>,
      ]);

    let addresses: readonly { address: string; family: number }[];
    if (isIP(url.hostname) !== 0) {
      addresses = [{ address: url.hostname, family: isIP(url.hostname) as 4 | 6 }];
    } else {
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    }
    const pinnedLookup: NonNullable<import("node:http").RequestOptions["lookup"]> = (
      _hostname,
      requestFamily,
      callback,
    ) => {
      const wanted = typeof requestFamily === "number" ? requestFamily : 0;
      const address =
        wanted === 0
          ? addresses[0]
          : (addresses.find((item) => item.family === wanted) ?? addresses[0]);
      if (address === undefined) {
        callback(new Error(`No pinned address for ${url.hostname}`), "", 4);
        return;
      }
      callback(null, address.address, address.family);
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
      request.on("error", (error) => {
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
              responseHeaders.set(name, value);
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
        response.on("error", (error) => {
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
});
