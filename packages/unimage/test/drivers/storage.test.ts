import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { fsDriver } from "../../src/storage/fs";

describe("fsDriver directory arrays", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("searches multiple directories in order (ImageProxy dir: string[])", async () => {
    root = await mkdtemp(join(tmpdir(), "unimage-fs-"));
    const first = join(root, "a");
    const second = join(root, "b");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "only-a.png"), "A");
    await writeFile(join(second, "in-both.png"), "B");

    const driver = fsDriver({ dir: [first, second] });
    await expect(driver.getItemRaw?.("only-a.png", {})).resolves.toBeInstanceOf(Uint8Array);
    await expect(driver.getItemRaw?.("in-both.png", {})).resolves.toBeInstanceOf(Uint8Array);
    await expect(driver.getItemRaw?.("missing.png", {})).resolves.toBeNull();
    await expect(driver.hasItem?.("only-a.png", {})).resolves.toBe(true);
    await expect(driver.hasItem?.("missing.png", {})).resolves.toBe(false);
  });
});
