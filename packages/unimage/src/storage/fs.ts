import { join, resolve } from "node:path";

import { HTTPError } from "h3";
import { defineDriver, type Driver } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

import { assertNotAborted } from "../utils/abort";
import { abortable } from "../utils/abort";
import { normalizeMaxAge } from "../utils/cache";
import type { ProxyStorageOptions } from "./types";

export interface FSStorageOptions {
  /**
   * Base directories. Keys resolve inside these directories only; with
   * multiple directories they are searched in order (ImageProxy `dir: string[]`).
   */
  dir: string | string[];
  /**
   * Allow keys that resolve through symbolic links pointing outside `dir`.
   * Disabled by default: symlink escape is rejected with a 403.
   */
  allowSymlinksOutsideDir?: boolean;
  maxAge?: number;
}

/**
 * Read-only filesystem storage built on the unstorage fs driver, with an
 * additional symlink-escape guard the stock driver does not provide.
 */

let fsPromisesModuleCache: Promise<typeof import("node:fs/promises") | undefined> | undefined;

async function loadFsPromises(): Promise<typeof import("node:fs/promises") | undefined> {
  fsPromisesModuleCache ??= import("node:fs/promises").catch(() => undefined);
  return await fsPromisesModuleCache;
}

export const fsDriver = defineDriver((options: FSStorageOptions): Driver => {
  const bases = (Array.isArray(options.dir) ? options.dir : [options.dir]).map((dir) =>
    resolve(dir),
  );
  const maxAge = normalizeMaxAge(options.maxAge);
  const drivers = bases.map((base) => fsLiteDriver({ base, readOnly: true }));

  async function assertInsideBase(
    base: string,
    key: string,
    request?: ProxyStorageOptions,
  ): Promise<void> {
    if (options.allowSymlinksOutsideDir === true) return;
    const fs = await loadFsPromises();
    if (fs === undefined) return;
    const [realKey, realBase] = await abortable(
      Promise.all([
        fs.realpath(join(base, key)).catch(() => undefined),
        fs.realpath(base).catch(() => base),
      ]),
      request?.signal,
      "filesystem lookup",
    );
    if (realKey !== undefined) {
      const normalizedKey = realKey.toLowerCase().replace(/\\/g, "/");
      const normalizedBase = `${realBase.toLowerCase().replaceAll("\\", "/").replace(/\/+$/, "")}`;
      const inside =
        normalizedKey === normalizedBase || normalizedKey.startsWith(`${normalizedBase}/`);
      if (!inside) {
        throw new HTTPError({
          status: 403,
          statusText: "UNIMAGE_FORBIDDEN_SYMLINK",
          message: `Forbidden symlink: ${key}`,
        });
      }
    }
  }

  async function readRaw(
    key: string,
    request?: ProxyStorageOptions,
  ): Promise<Uint8Array | string | null> {
    for (const [index, driver] of drivers.entries()) {
      await assertInsideBase(bases[index]!, key, request);
      const data = await abortable(
        Promise.resolve(driver.getItemRaw?.(key, { ...request })),
        request?.signal,
        "filesystem read",
      );
      if (typeof data === "string" || data instanceof Uint8Array) return data;
    }
    return null;
  }

  return {
    name: "proxy-fs",
    async hasItem(key, request?: ProxyStorageOptions) {
      assertNotAborted(request?.signal, "filesystem lookup");
      for (const [index, driver] of drivers.entries()) {
        await assertInsideBase(bases[index]!, key, request);
        if (
          await abortable(
            Promise.resolve(driver.hasItem(key, { ...request })),
            request?.signal,
            "filesystem lookup",
          )
        )
          return true;
      }
      return false;
    },
    async getItem(key, request?: ProxyStorageOptions) {
      for (const [index, driver] of drivers.entries()) {
        await assertInsideBase(bases[index]!, key, request);
        const data = await abortable(
          Promise.resolve(driver.getItem(key, { ...request })),
          request?.signal,
          "filesystem read",
        );
        if (data !== null) return data;
      }
      return null;
    },
    async getItemRaw(key, request?: ProxyStorageOptions) {
      return await readRaw(key, request);
    },
    async getKeys(base) {
      const keys: string[] = [];
      for (const driver of drivers) {
        keys.push(...(await driver.getKeys(base, {})));
      }
      return [...new Set(keys)];
    },
    async getMeta(key, request?: ProxyStorageOptions) {
      for (const [index, driver] of drivers.entries()) {
        await assertInsideBase(bases[index]!, key, request);
        const meta = (await abortable(
          Promise.resolve(driver.getMeta?.(key, { ...request })),
          request?.signal,
          "filesystem metadata",
        )) as {
          mtime?: Date;
          maxAge?: number;
        };
        if (meta.mtime !== undefined || meta.maxAge !== undefined) {
          return {
            ...(meta.mtime === undefined ? {} : { mtime: meta.mtime }),
            ...(maxAge === undefined ? {} : { maxAge }),
          };
        }
      }
      return maxAge === undefined ? {} : { maxAge };
    },
  };
});
