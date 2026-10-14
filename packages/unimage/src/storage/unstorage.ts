import type { Driver, Storage } from "unstorage";

import type { ProxyStorage, ProxyStorageMeta, ProxyStorageOptions } from "./types";

export interface UnstorageStorageOptions {
  /**
   * Optional prefix placed in front of every key, useful to namespace a
   * shared storage instance.
   */
  prefix?: string;
}

/**
 * Adapt any unstorage instance (or bare driver) to the ProxyStorage interface.
 *
 * This is type-only integration: unstorage itself is not a runtime dependency,
 * the passed instance is used as-is.
 */
export function unstorageStorage(
  storage: Storage | Driver,
  options: UnstorageStorageOptions | string = {},
): ProxyStorage {
  const resolved = typeof options === "string" ? { prefix: options } : options;
  const resolveKey = (id: string) => (resolved.prefix ? `${resolved.prefix}:${id}` : id);

  return {
    name: `unimage:unstorage:${(storage as { name?: string }).name ?? "storage"}`,

    async getMeta(id: string, request: ProxyStorageOptions = {}) {
      if (storage.getMeta === undefined) return {};
      const meta = await storage.getMeta(resolveKey(id), request);
      if (meta === undefined || meta === null) return undefined;
      return meta as ProxyStorageMeta;
    },

    async getData(id: string, request: ProxyStorageOptions = {}) {
      if (storage.getItemRaw === undefined) return undefined;
      const data = await storage.getItemRaw(resolveKey(id), request);
      if (data === undefined || data === null) return undefined;
      if (typeof data === "string") return new TextEncoder().encode(data);
      if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
      return data as Uint8Array | ArrayBuffer;
    },
  };
}

export type StorageInput = ProxyStorage | Storage | Driver;

/**
 * Accept an ProxyStorage as-is, or adapt an unstorage instance / bare driver.
 */
export function normalizeStorage(input: StorageInput): ProxyStorage {
  if (typeof (input as ProxyStorage).getData === "function") return input as ProxyStorage;
  return unstorageStorage(input as Storage | Driver);
}
