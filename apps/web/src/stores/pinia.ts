import { createPinia } from "pinia";

/**
 * 全局唯一 Pinia 实例，供 main.ts 与路由守卫复用。
 */
export const pinia = createPinia();
