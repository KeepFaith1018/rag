import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";

import "@/assets/style.css";

const app = createApp(App);

// 注册状态管理和路由
app.use(createPinia());
app.use(router);

app.mount("#app");
