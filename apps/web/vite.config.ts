import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      // 核心目录别名
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@components": fileURLToPath(
        new URL("./src/components", import.meta.url),
      ),
      "@views": fileURLToPath(new URL("./src/views", import.meta.url)),
      "@stores": fileURLToPath(new URL("./src/stores", import.meta.url)),
      "@assets": fileURLToPath(new URL("./src/assets", import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('vue-router') || id.includes('pinia') || id.includes('@vueuse')) {
              return 'vue-vendor';
            }
            if (id.includes('shiki') || id.includes('@shikijs')) {
              return 'shiki-vendor';
            }
            if (id.includes('marked') || id.includes('@incremark')) {
              return 'markdown-vendor';
            }
          }
        },
      },
    },
  },
});
