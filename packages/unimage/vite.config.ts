import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      alwaysBundle: ["ipdo"],
      onlyBundle: false,
    },
    entry: {
      index: "src/index.ts",

      server: "src/server.ts",
      "drivers/*": "src/drivers/*.ts",
    },
  },
});
