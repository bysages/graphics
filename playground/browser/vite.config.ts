import nodePolyfills from "@rolldown/plugin-node-polyfills";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type PluginOption } from "vite-plus";

export default defineConfig({
  plugins: [vue(), nodePolyfills()] as PluginOption[],
  worker: {
    format: "es",
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
});
