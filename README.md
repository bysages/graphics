# By Sages Graphics

English | [简体中文](./README.zh-CN.md)

[![npm downloads](https://img.shields.io/npm/dm/unimage)](https://www.npmjs.com/package/unimage)
[![GitHub Stars](https://img.shields.io/github/stars/bysages/graphics)](https://github.com/bysages/graphics/stargazers)
![GitHub License](https://img.shields.io/github/license/bysages/graphics)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributorcovenant.org/version/2/1/code_of_conduct)

> Graphics is the By Sages monorepo for design and media infrastructure: typed, deterministic image operations executed by pluggable runtime drivers — one recipe contract, served in the browser and on Node.

[Report Issues](https://github.com/bysages/graphics/issues)

⭐ **If Graphics is useful to you, a star helps other developers find it.**

## Why Graphics?

- 🧾 **Serializable recipes** — every transformation is a typed, serializable array of operations plus an output spec; the same recipe runs in the browser, on the server, or in a queue
- 🔌 **Pluggable drivers** — sharp, `@napi-rs/image`, Canvas2D, and SVGO ship as optional adapters behind one stable contract
- 🧩 **Composable by capability** — stack drivers with `overlayDriver` the way [unstorage](https://github.com/unjs/unstorage) stacks storage, and query what each stack supports at runtime
- 🌐 **Cross-runtime recipes** — shared RGBA fallbacks provide broad operation coverage, with runtime capabilities exposed explicitly
- 🖼 **IPX-compatible serving** — keep existing `/w_320,f_webp/id` URLs while swapping engines; storage delegates to unstorage with SSRF guardrails built in

## Packages

| Package                             | Version                                        | Description                                                       |
| ----------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| [`unimage`](./packages/unimage)     | ![npm](https://img.shields.io/npm/v/unimage)   | Unified image processing API with pluggable drivers               |
| [`unpalette`](./packages/unpalette) | ![npm](https://img.shields.io/npm/v/unpalette) | Color palette extraction, generation, quantization, and remapping |

## Quick Start

Pick the driver for your runtime — the recipe contract and the server adapter ride along as the package's own exports:

```bash
pnpm add unimage sharp   # or @napi-rs/image for a no-compile native engine
```

```ts
import { createImageManager } from "unimage";
import { sharpDriver } from "unimage/drivers/sharp";

const image = createImageManager({ driver: sharpDriver() });

const result = await image.transform(input, {
  operations: [{ type: "autoOrient" }, { type: "resize", width: 1280 }],
  output: { format: "webp", quality: 82 },
});
```

The [unimage README](./packages/unimage/README.md) documents the browser driver, the IPX-compatible server, driver comparison, and every modifier; the [unpalette README](./packages/unpalette/README.md) covers palette extraction, generation, and quantization.

## Development

### Prerequisites

- **Node.js** 20.x or higher
- **pnpm** 10.x or higher (recommended package manager)
- **Git** for version control

### Getting Started

1. **Clone the repository**:

   ```bash
   git clone https://github.com/bysages/graphics.git
   cd graphics
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Build all packages**:

   ```bash
   pnpm build
   ```

### Development Commands

```bash
pnpm build                                  # Build all packages
pnpm dev                                    # Watch-build all packages
pnpm test                                   # Test all packages
pnpm check                                  # Lint, format & type check
```

The browser playground runs from `playground/browser` (`pnpm dev` inside it serves `127.0.0.1:5173`) against the workspace `unimage`.

## Versioning

This project follows [Semantic Versioning](https://semver.org/). While the major version is `0` (pre-1.0), breaking API changes are released as **minor** version bumps (`0.x.0`) rather than patch releases — the public API is expected to keep evolving until the `1.0.0` stabilization release. Pin exact versions in downstream projects if you require stability between minor updates.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contribution workflow, coding standards, and PR checklist.

## Support & Community

- 📫 [Report Issues](https://github.com/bysages/graphics/issues)

If Graphics is useful to you, a [⭐ star](https://github.com/bysages/graphics/stargazers) helps other developers find it.

## Related Projects

Graphics is part of the By Sages design and media ecosystem:

- [Elements](https://github.com/bysages/elements) — design system and UI components
- [Typography](https://github.com/bysages/typography) — typography infrastructure
- [Lens](https://github.com/bysages/lens) — font and web media services

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

Built with ❤️ by [By Sages](https://www.bysages.com/)
