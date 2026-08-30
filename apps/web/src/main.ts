import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { setApiAuthFailureHandler } from "@/api/api";
import { useAuthStore } from "@/stores/auth";
import { pinia } from "@/stores/pinia";
import { useMessage } from "@/composables/useMessage";

import "@/assets/fonts/fonts.css";
import "@/assets/fonts/outlined.css";

import "@/styles/tailwind.css";
import "@/styles/index.scss";

const app = createApp(App);
const authStore = useAuthStore(pinia);
const message = useMessage();

/**
 * 初始化认证状态与全局副作用，再挂载应用。
 */
async function bootstrap() {
  setApiAuthFailureHandler(async () => {
    authStore.clearAuthState({ clearTokenStorage: false });

    if (router.currentRoute.value.name !== "login") {
      await router.replace("/login");
      message.warning("登录状态已失效，请重新登录");
    }
  });

  await authStore.bootstrap();

  // 注册状态管理和路由
  app.use(pinia);
  app.use(router);

  app.mount("#app");
}

void bootstrap();
