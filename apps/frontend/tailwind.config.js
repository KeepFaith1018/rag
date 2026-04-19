/** @type {import('tailwindcss').Config} */
export default {
  // 开启类名策略的暗色模式，搭配 @vueuse/core 的 useDark 使用
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 背景层级 - 通过 CSS 变量支持明暗切换
        surface: "var(--color-surface)", // 基础画布
        "surface-container-lowest": "var(--color-surface-container-lowest)",
        "surface-container-low": "var(--color-surface-container-low)", // 侧边栏/区块
        "surface-container": "var(--color-surface-container)",
        "surface-container-high": "var(--color-surface-container-high)", // 卡片/悬浮区块
        "surface-container-highest": "var(--color-surface-container-highest)", // 极高亮层/输入框
        "surface-bright": "var(--color-surface-bright)",

        // 主色调 (电光靛蓝) - 通过 CSS 变量支持明暗切换
        primary: "var(--color-primary)",
        "primary-container": "var(--color-primary-container)",
        "on-primary-container": "var(--color-on-primary-container)",

        secondary: "var(--color-secondary)",
        "secondary-container": "var(--color-secondary-container)",
        "on-secondary-container": "var(--color-on-secondary-container)",
        "on-secondary-fixed-variant": "var(--color-on-secondary-fixed-variant)",

        tertiary: "var(--color-tertiary)",
        "tertiary-container": "var(--color-tertiary-container)",
        "on-tertiary-container": "var(--color-on-tertiary-container)",

        error: "var(--color-error)",
        "error-container": "var(--color-error-container)",
        "on-error-container": "var(--color-on-error-container)",

        // 边框与文字
        "outline-variant": "var(--color-outline-variant)", // Ghost Border 辅助线
        outline: "var(--color-outline)",
        "on-surface": "var(--color-on-surface)", // 主要文字
        "on-surface-variant": "var(--color-on-surface-variant)", // 次要文字
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"], // 大标题与数字
        body: ["Inter", "sans-serif"], // 正文阅读
        label: ["Inter", "sans-serif"], // 微小标签
      },
    },
  },
  plugins: [],
}
