import { readFile } from "node:fs/promises";

import { createCanvas } from "@napi-rs/canvas";
import { canvasDriver } from "unimage/drivers/canvas";
import { napiDriver } from "unimage/drivers/napi";
import { sharpDriver } from "unimage/drivers/sharp";
import { svgoDriver } from "unimage/drivers/svgo";
import { beforeAll, describe, test } from "vite-plus/test";

const sharp = sharpDriver();
const napi = napiDriver({ napiImport: () => import("@napi-rs/image") });
const canvas = canvasDriver({ canvasImport: () => import("@napi-rs/canvas") });
const svgo = svgoDriver({ runtime: "node" });

function requireDecode(driver: {
  decode?: (input: Uint8Array, request: {}) => unknown;
}): (input: Uint8Array) => Promise<unknown> {
  const decode = driver.decode;
  if (decode === undefined) throw new Error("Driver does not support raw decoding.");
  return (input) => decode.call(driver, input, {}) as Promise<unknown>;
}

let sourcePng: Uint8Array;
let sourceSvg: Uint8Array;
let animatedGif: Uint8Array;

beforeAll(async () => {
  const width = 1920;
  const height = 1080;
  const canvas2d = createCanvas(width, height);
  const context = canvas2d.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f8fafc");
  gradient.addColorStop(0.35, "#38bdf8");
  gradient.addColorStop(0.7, "#a855f7");
  gradient.addColorStop(1, "#0f172a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 48; index += 1) {
    const x = (index * 97) % width;
    const y = (index * 193) % height;
    context.globalAlpha = 0.08 + (index % 5) * 0.03;
    context.fillStyle = index % 2 === 0 ? "#ffffff" : "#f97316";
    context.beginPath();
    context.arc(x, y, 16 + ((index * 13) % 72), 0, Math.PI * 2);
    context.fill();
  }

  sourcePng = new Uint8Array(await canvas2d.encode("png"));
  sourceSvg = new TextEncoder()
    .encode(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0f172a"/>
        <stop offset="0.5" stop-color="#38bdf8"/>
        <stop offset="1" stop-color="#f97316"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#g)"/>
    ${Array.from({ length: 180 }, (_, index) => `<circle cx="${(index * 89) % 1024}" cy="${(index * 173) % 1024}" r="${18 + (index % 42)}" fill="#ffffff" opacity="0.08"/>`).join("")}
  </svg>`);
  animatedGif = new Uint8Array(
    await readFile(new URL("../fixtures/animated.gif", import.meta.url)),
  );
});

const benchOptions = { time: 800, iterations: 8 };

describe("unimage drivers", () => {
  test("metadata probe", async ({ bench }) => {
    await bench.compare(
      bench("sharp metadata", () => sharp.metadata(sourcePng)),
      bench("napi metadata", () => napi.metadata(sourcePng)),
      bench("canvas metadata", () => canvas.metadata(sourcePng)),
      benchOptions,
    );
  });

  test("decode PNG to RGBA8", async ({ bench }) => {
    await bench.compare(
      bench("sharp decode", () => requireDecode(sharp)(sourcePng)),
      bench("napi decode", () => requireDecode(napi)(sourcePng)),
      bench("canvas decode", () => requireDecode(canvas)(sourcePng)),
      benchOptions,
    );
  });

  test("resize to WebP", async ({ bench }) => {
    const recipe = {
      operations: [{ type: "resize", width: 1280 }],
      output: { format: "webp", quality: 80, metadataPolicy: "strip" },
    } as const;

    await bench.compare(
      bench("sharp WebP", () => sharp.transform(sourcePng, recipe)),
      bench("napi WebP", () => napi.transform(sourcePng, recipe)),
      bench("canvas WebP", () => canvas.transform(sourcePng, recipe)),
      benchOptions,
    );
  });

  test("resize + grayscale + blur to JPEG", async ({ bench }) => {
    const recipe = {
      operations: [
        { type: "resize", width: 1280 },
        { type: "grayscale" },
        { type: "blur", sigma: 2 },
      ],
      output: { format: "jpeg", quality: 85, metadataPolicy: "strip" },
    } as const;

    await bench.compare(
      bench("sharp JPEG", () => sharp.transform(sourcePng, recipe)),
      bench("napi JPEG", () => napi.transform(sourcePng, recipe)),
      bench("canvas JPEG", () => canvas.transform(sourcePng, recipe)),
      benchOptions,
    );
  });

  test("resize to AVIF", async ({ bench }) => {
    const recipe = {
      operations: [{ type: "resize", width: 1280 }],
      output: { format: "avif", quality: 60, metadataPolicy: "strip" },
    } as const;

    await bench.compare(
      bench("sharp AVIF", () => sharp.transform(sourcePng, recipe)),
      bench("napi AVIF", () => napi.transform(sourcePng, recipe)),
      { ...benchOptions, time: 100, iterations: 2 },
    );
  }, 120_000);

  test("rasterize SVG to PNG", async ({ bench }) => {
    const recipe = {
      operations: [{ type: "resize", width: 512 }],
      output: { format: "png", metadataPolicy: "strip" },
    } as const;

    await bench.compare(
      bench("sharp SVG", () => sharp.transform(sourceSvg, recipe)),
      bench("napi SVG", () => napi.transform(sourceSvg, recipe)),
      bench("canvas SVG", () => canvas.transform(sourceSvg, recipe)),
      benchOptions,
    );
  });

  test("animated GIF to WebP", async ({ bench }) => {
    const recipe = {
      input: { frames: "all" },
      operations: [{ type: "resize", width: 160 }],
      output: { format: "webp", quality: 80, metadataPolicy: "strip" },
    } as const;

    await bench("sharp animated WebP", () => sharp.transform(animatedGif, recipe)).run();
  });

  test("optimize SVG", async ({ bench }) => {
    const recipe = {
      operations: [],
      output: { format: "svg", metadataPolicy: "strip" },
    } as const;

    await bench("SVGO", () => svgo.transform(sourceSvg, recipe)).run();
  });
});
