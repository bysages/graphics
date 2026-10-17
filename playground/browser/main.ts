import "@bysages/tokens/css";
import { applyTheme, attachDynamicLight, attachInkRipple } from "@bysages/vue";
import { createApp } from "vue";

import App from "./App.vue";

globalThis.Buffer ??= Buffer;

applyTheme({
  mode: "system",
  density: "default",
  scene: "auto",
  accent: "auto",
});
attachDynamicLight();
attachInkRipple();
createApp(App).mount("#app");
