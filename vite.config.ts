import nodePolyfills from "@rolldown/plugin-node-polyfills";
import { defineConfig, type PluginOption } from "vite-plus";

export default defineConfig({
  pack: {
    plugins: [nodePolyfills()] as PluginOption[],
  },
  test: {
    include: ["packages/**/*.{spec,test}.ts"],
    benchmark: {
      include: ["packages/**/*.bench.ts"],
    },
    sequence: {
      concurrent: true,
    },
  },
  fmt: {
    sortImports: {
      type: "natural",
    },
    sortPackageJson: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    "*": "vp check --fix",
  },
});
