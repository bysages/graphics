import { join, resolve } from "node:path";

import { HTTPError } from "h3";
import { defineDriver, type Driver } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

import { normalizeMaxAge } from "../proxy";

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
let fsPromises: typeof import("node:fs/promises") | undefined;
let fsPromisesPromise: Promise<typeof import("node:fs/promises") | undefined> | undefined;

async function loadFsPromises(): Promise<typeof import("node:fs/promises") | undefined> {
  fsPromisesPromise ??= import("node:fs/promises").catch(() => undefined);
  fsPromises = await fsPromisesPromise;
  return fsPromises;
}

export const fsDriver = defineDriver((options: FSStorageOptions): Driver => {
  const bases = (Array.isArray(options.dir) ? options.dir : [options.dir]).map((dir) =>
    resolve(dir),
  );
  const maxAge = normalizeMaxAge(options.maxAge);
  const drivers = bases.map((base) => fsLiteDriver({ base, readOnly: true }));

  async function assertInsideBase(base: string, key: string): Promise<void> {
    if (options.allowSymlinksOutsideDir === true) return;
    const fs = await loadFsPromises();
    if (fs === undefined) return;
    const [realKey, realBase] = await Promise.all([
      fs.realpath(join(base, key)).catch(() => undefined),
      fs.realpath(base).catch(() => base),
    ]);
    if (
      realKey !== undefined &&
      !realKey.toLowerCase().startsWith(`${realBase.toLowerCase()}\\`) &&
      !realKey.toLowerCase().startsWith(`${realBase.toLowerCase()}/`)
    ) {
      throw new HTTPError({
        status: 403,
        statusText: "UNIMAGE_FORBIDDEN_SYMLINK",
        message: `Forbidden symlink: ${key}`,
      });
    }
  }

  async function readRaw(key: string): Promise<Uint8Array | string | null> {
    for (const [index, driver] of drivers.entries()) {
      await assertInsideBase(bases[index]!, key);
      const data = await driver.getItemRaw?.(key, {});
      if (typeof data === "string" || data instanceof Uint8Array) return data;
    }
    return null;
  }

  return {
    name: "proxy-fs",
    async hasItem(key) {
      for (const [index, driver] of drivers.entries()) {
        await assertInsideBase(bases[index]!, key);
        if (await driver.hasItem(key, {})) return true;
      }
      return false;
    },
    async getItem(key) {
      for (const [index, driver] of drivers.entries()) {
        await assertInsideBase(bases[index]!, key);
        const data = await driver.getItem(key);
        if (data !== null) return data;
      }
      return null;
    },
    async getItemRaw(key) {
      return await readRaw(key);
    },
    async getKeys(base) {
      const keys: string[] = [];
      for (const driver of drivers) {
        keys.push(...(await driver.getKeys(base, {})));
      }
      return [...new Set(keys)];
    },
    async getMeta(key) {
      for (const [index, driver] of drivers.entries()) {
        await assertInsideBase(bases[index]!, key);
        const meta = (await driver.getMeta?.(key, {})) as {
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
