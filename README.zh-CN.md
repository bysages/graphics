# By Sages Graphics

[English](./README.md) | 简体中文

[![npm downloads](https://img.shields.io/npm/dm/unimage)](https://www.npmjs.com/package/unimage)
[![GitHub Stars](https://img.shields.io/github/stars/bysages/graphics)](https://github.com/bysages/graphics/stargazers)
![GitHub License](https://img.shields.io/github/license/bysages/graphics)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](https://www.contributorcovenant.org/version/2/1/code_of_conduct)

> Graphics 是 By Sages 的设计与媒体基础设施 monorepo：类型化、确定性的图像操作，由可插拔的运行时驱动执行——一份 recipe 契约，浏览器与 Node 通用。

[问题反馈](https://github.com/bysages/graphics/issues)

⭐ **如果 Graphics 对你有用，一个 star 能帮更多开发者发现它。**

## 为什么选择 Graphics？

- 🧾 **可序列化的 recipe** — 每次变换都是一份类型化、可序列化的操作数组加输出规格；同一份 recipe 在浏览器、服务端或队列里运行
- 🔌 **可插拔驱动** — sharp、`@napi-rs/image`、Canvas2D 与 SVGO 作为可选适配器，接在同一个稳定契约之后
- 🧩 **按能力组合** — 用 `overlayDriver` 叠加驱动，就像 [unstorage](https://github.com/unjs/unstorage) 叠加存储一样，并且能在运行时查询每层组合支持什么
- 🌐 **跨运行时 recipe** — 共享 RGBA 回退覆盖大部分操作，并显式暴露运行时能力
- 🖼 **ImageProxy 兼容服务** — 保留既有 `/w_320,f_webp/id` URL 的同时更换引擎；存储委托 unstorage，内建 SSRF 防护

## 包

| 包                                  | 版本                                           | 说明                           |
| ----------------------------------- | ---------------------------------------------- | ------------------------------ |
| [`unimage`](./packages/unimage)     | ![npm](https://img.shields.io/npm/v/unimage)   | 可插拔驱动的统一图像处理 API   |
| [`unpalette`](./packages/unpalette) | ![npm](https://img.shields.io/npm/v/unpalette) | 调色板提取、生成、量化与重映射 |

## 快速开始

按运行时选择驱动——recipe 契约和服务端适配器随包本身的导出一并可用：

```bash
pnpm add unimage sharp   # 或 @napi-rs/image，免编译的原生引擎
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

[unimage README](./packages/unimage/README.md) 记录了浏览器驱动、ImageProxy 兼容服务端、驱动对比与全部 modifier；[unpalette README](./packages/unpalette/README.md) 覆盖调色板的提取、生成与量化。

## 开发

### 环境要求

- **Node.js** 20.x 或更高
- **pnpm** 10.x 或更高（推荐包管理器）
- **Git** 用于版本控制

### 开始

1. **克隆仓库**：

   ```bash
   git clone https://github.com/bysages/graphics.git
   cd graphics
   ```

2. **安装依赖**：

   ```bash
   pnpm install
   ```

3. **构建所有包**：

   ```bash
   pnpm build
   ```

### 开发命令

```bash
pnpm build                                  # 构建所有包
pnpm dev                                    # 监听构建所有包
pnpm test                                   # 测试所有包
pnpm check                                  # Lint、格式化与类型检查
```

浏览器 playground 位于 `playground/browser`（在其中运行 `pnpm dev` 即在 `127.0.0.1:5173` 提供服务），对接工作区内的 `unimage`。

## 版本

本项目遵循[语义化版本](https://semver.org/)。在主版本为 `0`（1.0 之前）阶段，破坏性 API 变更以 **minor** 版本（`0.x.0`）发布而非 patch——公共 API 预计会持续演进，直到 `1.0.0` 稳定版发布。下游项目若需要在 minor 更新之间保持稳定，请锁定精确版本。

## 贡献

欢迎参与贡献！完整的贡献流程、编码规范与 PR 清单见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 支持与社区

- 📫 [问题反馈](https://github.com/bysages/graphics/issues)

如果 Graphics 对你有用，一个 [⭐ star](https://github.com/bysages/graphics/stargazers) 能帮更多开发者发现它。

## 相关项目

Graphics 是 By Sages 设计与媒体生态的一部分：

- [Elements](https://github.com/bysages/elements) — 设计系统与 UI 组件
- [Typography](https://github.com/bysages/typography) — 字体基础设施
- [Lens](https://github.com/bysages/lens) — 字体与 Web 媒体服务

## 许可证

本项目基于 MIT 许可证授权 - 详见 [LICENSE](./LICENSE) 文件。

---

由 [By Sages](https://www.bysages.com/) 用 ❤️ 构建
