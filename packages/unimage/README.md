# unimage

![npm version](https://img.shields.io/npm/v/unimage)
![npm license](https://img.shields.io/npm/l/unimage)

> Unified image processing for browsers and Node.js — typed, serializable operation recipes executed by pluggable drivers, with an IPX-compatible server adapter.

## Features

- 🧾 **Serializable recipes** — every transformation is a serializable array of typed operations plus an output spec; the same recipe runs in the browser, on the server, or in a queue
- 🔌 **Pluggable drivers** — sharp, `@napi-rs/image`, Canvas2D, and SVGO ship in one package; capabilities are queryable at runtime so applications degrade gracefully
- 🧩 **Composable with `overlayDriver`** — stack drivers the way [unstorage](https://github.com/unjs/unstorage) stacks storage; supported routes execute in order and unavailable optional backends fall through
- 🌐 **Cross-runtime recipes** — shared RGBA fallbacks provide broad operation coverage, and capabilities expose backend limits
- 🎚 **Resource-aware composite** — declare layer operations in serializable recipes while binding RGBA pixels at runtime
- 🖼 **IPX-compatible server** — keep existing `/w_320,f_webp/id` URLs while swapping the engine; storage delegates to unstorage drivers, and the handler plugs straight into h3 and Nitro
- 🛡 **SSRF guardrails built in** — protocol and host allow-lists, DNS/reserved-address blocking, and per-hop redirect validation on remote storage

## Installation

```bash
# pnpm
pnpm add unimage

# npm
npm install unimage

# yarn
yarn add unimage

# bun
bun add unimage
```

The core runtime dependency is only `unpalette`. Image engines and server integrations are optional peer dependencies — install what you use. Small server-only utilities that do not expose shared contracts are bundled:

| You want                                                            | Install                               |
| ------------------------------------------------------------------- | ------------------------------------- |
| Node and Bun raster processing (recommended)                        | `pnpm add sharp`                      |
| Raster processing without native build steps                        | `pnpm add @napi-rs/image`             |
| napi WASI binding for browsers and Node fallback                    | `pnpm add @napi-rs/image-wasm32-wasi` |
| Canvas2D in the browser and Node                                    | `pnpm add @napi-rs/canvas`            |
| sharp WASM fallback for multi-threaded Wasm runtimes (not browsers) | `pnpm add sharp @img/sharp-wasm32`    |
| SVG optimization                                                    | `pnpm add svgo`                       |
| Server adapter (`unimage/server`)                                   | `pnpm add h3 unstorage@alpha`         |

## Quick Start

### Browser / Edge

```ts
import { createImageManager } from "unimage";
import { napiDriver } from "unimage/drivers/napi";

const image = createImageManager({
  driver: napiDriver({ napiImport: () => import("@napi-rs/image-wasm32-wasi") }),
});
```

The browser example uses `@napi-rs/image-wasm32-wasi`; install it and let the bundler emit its `.wasm` and worker assets.

### Node

```ts
import { createImageManager } from "unimage";
import { sharpDriver } from "unimage/drivers/sharp";

const image = createImageManager({ driver: sharpDriver() });

const result = await image.transform(input, {
  operations: [
    { type: "autoOrient" },
    { type: "resize", width: 1280, fit: "contain", withoutEnlargement: true },
    { type: "modulate", saturation: 0.9 },
  ],
  output: { format: "webp", quality: 82, metadataPolicy: "strip" },
});
```

Swap in `napiDriver({ napiImport: () => import("@napi-rs/image") })` from `unimage/drivers/napi` for a pure prebuilt-`.node` engine with no libvips.

### Browser and Node

```ts
import { createImageManager } from "unimage";
import { canvasDriver } from "unimage/drivers/canvas";

const image = createImageManager({ driver: canvasDriver() });

const result = await image.transform(file, {
  operations: [{ type: "autoOrient" }, { type: "resize", width: 1280 }],
  output: { format: "webp", quality: 82, metadataPolicy: "strip" },
});

const blob = new Blob([result.data], { type: result.mediaType });
```

In browsers, `canvasDriver` uses the native canvas backend and detects encoders through a 1×1 canvas. For Node.js, callers explicitly provide the Canvas import following [unpdf](https://github.com/unjs/unpdf)'s Canvas factory pattern, so the browser bundle never follows a Node-only module. Server exports inject the import for you.

The napi canvas backend ignores EXIF auto-orientation. To inject the backend explicitly:

```ts
import { canvasDriver } from "unimage/drivers/canvas";

const driver = canvasDriver({
  canvasImport: () => import("@napi-rs/canvas"),
});
```

### Server (IPX-compatible)

```ts
import {
  createImageProxy,
  createImageProxyFetchHandler,
  fsDriver,
  httpDriver,
} from "unimage/server";

const proxy = createImageProxy({
  storage: fsDriver({ dir: "./public" }),
  httpStorage: httpDriver({ domains: ["images.example.com"], blockPrivateIPs: true }),
  maxAge: 3600,
});

const response = await createImageProxyFetchHandler(proxy)(
  "https://example.com/w_320,f_webp/cat.png",
);
```

`createImageProxyHandler` returns an h3 `EventHandler`, so Nitro and h3 apps mount it directly:

```ts
app.use("/img", createImageProxyHandler(proxy));
```

#### Storage

Storage adapters delegate raw IO to unstorage. They support the unstorage 2 line used by Nitro 3 (`>=2.0.0-alpha.10`); in a Nitro app, use Nitro's shared storage instead of installing a second unstorage.

- `fsDriver({ dir })` — read-only filesystem storage on `unstorage/drivers/fs-lite`, plus a symlink-escape guard
- `httpDriver({ domains, blockPrivateIPs })` — remote storage with SSRF guardrails and per-hop redirect validation
- `fromUnstorage(storageOrDriver)` — adapt any unstorage instance or bare driver; `createImageProxy` also accepts one directly

```ts
import { createImageProxy, fromUnstorage } from "unimage/server";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";

const proxy = createImageProxy({
  storage: fromUnstorage(createStorage({ driver: memoryDriver() }), { prefix: "assets" }),
});
```

#### Composite layers

Composite recipes reference a layer by name; RGBA8 pixels are bound only when a pipeline runs. This keeps recipes small and cache keys stable while letting queues, proxies, and applications own resource IO.

```ts
const watermark = await image.decode(watermarkBytes);

await image.transform(
  sourceBytes,
  {
    operations: [
      { type: "resize", width: 1280 },
      {
        type: "composite",
        layer: "watermark",
        position: "right bottom",
        blend: "over",
        opacity: 0.85,
      },
    ],
    output: { format: "webp", quality: 82 },
  },
  {
    layers: {
      watermark: {
        data: watermark.data,
        width: watermark.width,
        height: watermark.height,
        layout: "rgba8",
      },
    },
  },
);
```

`layer` is a binding name, not image data. Bindings must be straight (non-premultiplied) RGBA8 pixels with dimensions matching `width * height * 4`. `x/y` are the top-left offset and take precedence over `position`; negative offsets are clipped to the destination. `tile` preserves the resolved anchor as its phase. `digestRecipe` identifies the recipe, not layer contents; HTTP responses from the server adapter use the final output for ETags.

Opaque layers have consistent geometry and alpha coverage across sharp, napi-image, and Canvas. Translucent layers with separable blend modes can differ between sharp/libvips premultiplied-alpha compositing and the straight-alpha W3C behavior used by napi-image and Canvas; capabilities expose this note. Porter-Duff operations apply to the whole destination according to the W3C formulas: `clear` replaces everything, and operations such as `in` clear the destination outside the layer footprint.

In ImageProxy URLs, `composite` accepts a simple alias or storage key and is always the final operation. Remote layer URLs are intentionally rejected; configure a layer alias instead:

```ts
const proxy = createImageProxy({
  storage,
  alias: { "/watermark": "/assets/watermark.png" },
});
```

```text
/composite_watermark,composite_opacity_0.85,w_1280,f_webp/photo.png
```

Layer failures propagate (a missing layer is 404, never a silently un-watermarked image). Conditional requests use the newest source/layer mtime, while cache lifetime is the minimum of both.

#### Recipes, decode, and capabilities

`decode` controls how input is read, not how output is encoded:

```ts
await image.transform(input, {
  input: { frames: "all", rasterDensity: 144 },
  operations: [{ type: "resize", width: 640 }],
  output: { format: "webp", quality: 82 },
});
```

`frames: "all"` is required for animation-aware transforms. `rasterDensity` applies to SVG rasterization. Quality applies only to encoders with meaningful lossy quality; PNG and GIF are lossless format targets in the cross-driver API.

For one still frame, use `decode()`; for every GIF/WebP frame or TIFF page, use `decodeFrames()`. With `transform()`, `input.frames: "all"` requires an animation-capable output such as WebP/GIF; TIFF preserves multipage output when TIFF is also the target format.

```ts
const frame = await image.decode(input, { rasterDensity: 144 });
const sequence = await image.decodeFrames(input, { rasterDensity: 144 });
```

Capabilities use the same shape as the operation they describe:

```ts
const capability = await image.isConfigSupported({
  input: { format: "gif", frames: "all" },
  operations: [{ type: "resize", width: 640 }],
  output: { format: "webp", quality: 82 },
});

if (!capability.supported) throw new Error("This runtime cannot run the pipeline.");
```

#### Modifiers

| Modifier                                          | Alias     | Example                         | Description                                                                                                                   |
| ------------------------------------------------- | --------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `format`                                          | `f`       | `f_webp`                        | Output format: `png`, `jpeg`, `webp`, `avif`, `gif`, `svg`, `tiff`, `heif`, `heic`, `bmp`, `ico`, `jxl`, `pnm`, `tga`, `auto` |
| `width` / `height`                                | `w` / `h` | `w_320,h_240`                   | Target dimensions                                                                                                             |
| `fit`                                             |           | `fit_cover`                     | `contain`, `cover`, `fill`, `outside`; IPX `inside`/`outside` are supported                                                   |
| `resize`                                          | `s`       | `s_320x240`                     | Shorthand for width/height/fit                                                                                                |
| `quality`                                         | `q`       | `q_80`                          | Encoder quality for JPEG, WebP, AVIF, TIFF, HEIF, HEIC, and JXL                                                               |
| `position`                                        | `pos`     | `pos_top`                       | Crop/cover anchor, including `entropy` and `attention`                                                                        |
| `kernel`                                          |           | `kernel_lanczos3`               | Resize kernel                                                                                                                 |
| `background`                                      | `b`       | `b_ff0000`                      | Background color for resize contain, rotate, extend, and flatten                                                              |
| `trim`                                            |           | `trim_10`                       | Trim border pixels within threshold                                                                                           |
| `extend`                                          |           | `extend_10_0_10_0`              | Pad edges with `background`, `copy`, `repeat`, or `mirror`                                                                    |
| `extract` / `crop`                                |           | `extract_left_top_right_bottom` | Crop a region                                                                                                                 |
| `rotate`                                          |           | `rotate_90`                     | Rotation angle                                                                                                                |
| `autoorient`                                      |           | `autoorient`                    | Honor EXIF orientation                                                                                                        |
| `flip` / `flop`                                   |           | `flip`                          | Vertical / horizontal mirror                                                                                                  |
| `grayscale`                                       |           | `grayscale`                     | Desaturate                                                                                                                    |
| `blur`                                            |           | `blur_2`                        | Gaussian blur by sigma                                                                                                        |
| `sharpen`                                         |           | `sharpen_1`                     | Sharpen by sigma                                                                                                              |
| `median`                                          |           | `median_3`                      | Median filter                                                                                                                 |
| `dilate` / `erode`                                |           | `erode_2`                       | Morphology                                                                                                                    |
| `clahe`                                           |           | `clahe_4_4`                     | Contrast-limited adaptive histogram equalization                                                                              |
| `gamma`                                           |           | `gamma_2.2`                     | Gamma correction                                                                                                              |
| `normalize`                                       |           | `normalize`                     | Stretch luminance to full range                                                                                               |
| `pixelate`                                        |           | `pixelate_8`                    | Average square blocks; size runs from 1 to 256                                                                                |
| `threshold`                                       |           | `threshold_128`                 | Binary threshold                                                                                                              |
| `linear`                                          |           | `linear_1.1_-10`                | Linear luminance transform                                                                                                    |
| `modulate`                                        |           | `modulate_brightness_1.1`       | Brightness/saturation/hue/lightness                                                                                           |
| `brightness` / `saturation` / `hue` / `lightness` |           | `brightness_1.1`                | Individual modulate channels                                                                                                  |
| `opacity`                                         |           | `opacity_0.5`                   | Scale alpha                                                                                                                   |
| `tint`                                            |           | `tint_ff8800`                   | Chromatic tint                                                                                                                |
| `contrast`                                        |           | `contrast_20`                   | Adjust contrast from `-100` to `100`                                                                                          |
| `removealpha`                                     |           | `removealpha`                   | Flatten alpha to fully opaque                                                                                                 |
| `ensurealpha`                                     |           | `ensurealpha`                   | Add an alpha channel                                                                                                          |
| `flatten` / `unflatten`                           |           | `flatten`                       | Merge/remove alpha against a background                                                                                       |
| `composite`                                       |           | `composite_watermark`           | Compose an alias/storage-key layer; options use the `composite_*` prefix and append last                                      |
| `animated`                                        | `a`       | `animated`                      | Decode every frame; GIF output uses all frames by default                                                                     |

Unknown modifiers are rejected rather than silently ignored. Alias keys match complete path segments, so `/blog` does not capture `/blog-2`.

Modifier-less URLs use a leading `_` segment: `/_/photos/cat.png`.

### SVG and driver composition

`overlayDriver` stacks drivers the way unstorage's overlay storage stacks backends: requests route to the first driver that can decode the input — preferring one that can also encode the requested output — and later drivers fill the capability gaps of earlier ones:

```ts
import { canvasDriver } from "unimage/drivers/canvas";
import { overlayDriver } from "unimage/drivers/overlay";
import { sharpDriver } from "unimage/drivers/sharp";
import { svgoDriver } from "unimage/drivers/svgo";

const image = overlayDriver(svgoDriver(), canvasDriver(), sharpDriver());

// SVG in, SVG out — routed to SVGO, sanitized and optimized.
await image.transform(svgBytes, { operations: [], output: { format: "svg" } });

// PNG in, PNG out — routed to sharp.
await image.transform(pngBytes, { operations: [], output: { format: "png" } });
```

`createImageProxy` wires `svgoDriver → canvasDriver → sharpDriver` by default. SVGO handles SVG-in/SVG-out; Canvas is preferred for common raster operations, while sharp remains the fallback for animated input, TIFF/HEIF/HEIC, metadata preservation, and other broader-format cases. If no driver supports the exact pipeline, the overlay reports it instead of silently returning a different format than requested.

## Driver comparison

|                       | sharp                                                                                                    | napi                                                                                         | canvas                                                | svgo             |
| --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------- |
| Environment           | Node · Bun · multi-threaded Wasm runtimes (not browsers)                                                 | Node · Browser via the WASI build                                                            | Browser (native Canvas2D) · Node (`@napi-rs/canvas`)  | Browser + Node   |
| Dependency            | `sharp` (prebuilt libvips); optional `@img/sharp-wasm32`                                                 | `@napi-rs/image` (prebuilt `.node`, no compile); browser build: `@napi-rs/image-wasm32-wasi` | None in browsers · optional `@napi-rs/canvas` in Node | `svgo` (pure JS) |
| Decode                | png · jpeg · webp · avif · gif · svg · tiff · heif/heic · bmp · ico · jxl                                | png · jpeg · webp · avif · svg (rasterized) · tiff · bmp · ico · pnm · heif/heic             | png · jpeg · webp · avif · gif                        | svg              |
| Encode                | png · jpeg · webp · avif · gif · tiff · heif/heic (HEVC detected at runtime) · jxl (detected at runtime) | png · jpeg · webp · avif · tiff · bmp · ico · pnm · tga · heic                               | png · jpeg · webp · avif · gif (detected at runtime)  | svg              |
| Animated input/output | ✓                                                                                                        | —                                                                                            | —                                                     | —                |
| autoOrient            | ✓                                                                                                        | ✓                                                                                            | Browser ✓ · Node —                                    | —                |
| resize                | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| crop                  | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| rotate                | ✓ any angle                                                                                              | ✓ 90° multiples                                                                              | ✓ any angle                                           | —                |
| flip                  | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| grayscale             | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| invert                | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| blur                  | ✓                                                                                                        | ✓                                                                                            | ✓ Canvas2D filter                                     | —                |
| trim                  | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| extend                | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| sharpen               | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| median                | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| dilate / erode        | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| clahe                 | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| flatten / unflatten   | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| gamma                 | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| normalize             | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| threshold             | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| linear                | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| modulate              | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| opacity               | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| tint                  | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| contrast              | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| convolve              | ✓                                                                                                        | ✓ native 3×3 · fallback for other kernels                                                    | ✓                                                     | —                |
| colorMatrix           | ✓ RGBA fallback                                                                                          | ✓ RGBA fallback                                                                              | ✓ RGBA fallback                                       | —                |
| posterize             | ✓ RGBA fallback                                                                                          | ✓ RGBA fallback                                                                              | ✓ RGBA fallback                                       | —                |
| pixelate              | ✓ RGBA fallback                                                                                          | ✓ RGBA fallback                                                                              | ✓ RGBA fallback                                       | —                |
| composite             | ✓ native                                                                                                 | ✓ native                                                                                     | ✓ Canvas2D · RGBA fallback for saturate               | —                |
| remove / ensure alpha | ✓                                                                                                        | ✓                                                                                            | ✓                                                     | —                |
| SVG optimize          | —                                                                                                        | —                                                                                            | —                                                     | ✓                |

Format availability is platform-dependent: HEIF/HEIC uses OS or libvips codecs; both drivers probe HEVC at runtime, JXL is experimental in sharp, and napi-image disables some published formats. `sharpDriver` also runs on Bun; for sharp WASM install `sharp` together with `@img/sharp-wasm32` — sharp requires a runtime with multi-threaded Wasm workers and explicitly does not support browsers. The napiDriver browser variant uses the [WASI build](https://image.napi.rs/docs#browser-webassembly) and requires a module Worker, a `Buffer` polyfill, and cross-origin isolation headers (`COOP`/`COEP`). The canvas driver resolves its optional Node peer lazily, so it is available as a cross-runtime fallback without forcing a native load in browsers.
Every cell is also queryable at runtime:

```ts
const { supported, missing } = await image.isConfigSupported({
  input: { format: "gif", frames: "all" },
  operations: [
    { type: "rotate", angle: 90 },
    { type: "clahe", width: 4, height: 4 },
  ],
  output: { format: "avif", quality: 82 },
});
```

## Architecture

```
recipe (typed operations)        what should happen — serializable
      ↓
driver                           how it happens — sharp · napi · canvas · svgo
      ↓ overlayDriver                  stack drivers by capability
server adapter                   IPX-compatible URLs over unstorage storage
```

The core owns no IO: storage delegates to unstorage, remote fetching lives in the explicitly configured HTTP driver, and no worker is started implicitly.

## Related Projects

- [Graphics](https://github.com/bysages/graphics) — the parent monorepo and ecosystem docs
- [unpalette](https://github.com/bysages/graphics/tree/main/packages/unpalette) — palette extraction, generation, quantization, and remapping
- [IPX](https://github.com/unjs/ipx) — the URL modifier API this server adapter targets
- [unstorage](https://github.com/unjs/unstorage) — the storage-driver model used by the server adapter
- [ipdo](https://github.com/funish/axis/tree/main/packages/ipdo) — IPv4/IPv6 and CIDR checks used by HTTP storage

## License

- [MIT](../../LICENSE) © [By Sages](https://www.bysages.com/)
