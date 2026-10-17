import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { fsDriver } from "../../src/storage/fs";
import { httpDriver } from "../../src/storage/http";

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

describe("storage cancellation", () => {
  it("propagates aborted HTTP metadata requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const driver = httpDriver({ allowAllDomains: true });
    await expect(
      driver.getMeta?.("http://127.0.0.1/source.png", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "UNIMAGE_ABORT" });
  });

  it("propagates aborted filesystem reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "unimage-abort-"));
    await writeFile(join(root, "source.png"), "image");
    const controller = new AbortController();
    controller.abort();
    const driver = fsDriver({ dir: root });
    await expect(
      driver.getItemRaw?.("source.png", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "UNIMAGE_ABORT" });
    await rm(root, { recursive: true, force: true });
  });
});
