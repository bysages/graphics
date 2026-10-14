import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",

      server: "src/server.ts",
      "drivers/*": "src/drivers/*.ts",
    },
  },
});
