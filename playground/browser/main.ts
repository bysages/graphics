import "@bysages/tokens/css";
import { applyTheme, attachDynamicLight, attachInkRipple } from "@bysages/vue";
import { createApp } from "vue";

import App from "./App.vue";

applyTheme({
  mode: "system",
  scene: "studio",
  accent: "celadon",
  density: "comfortable",
});
attachDynamicLight();
attachInkRipple();
createApp(App).mount("#app");
