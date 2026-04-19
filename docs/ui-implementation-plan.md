# 前端静态页面实现规划 - Kinetic Blueprint 架构

本文档基于 `docs/ui` 目录下的设计稿 (`auth.html`, `main-chat.html`, `main-kb.html` 以及 `DESIGN.md`) 规划出前端从零到一的实现步骤。

## 1. 技术栈与框架选择

为了完美还原 "The Kinetic Blueprint" (高科技、高精度、类编辑器的极简暗黑风) 的设计，推荐以下技术栈组合：

- **核心框架**: **Vue 3 (Composition API) + TypeScript + Vite**。Vue 3 提供了轻量且高性能的组件化能力，配合 Vite 实现极速的本地开发体验。由于采用 SPA 模式，Vite + Vue-Router 是最佳选择。
- **路由管理**: **Vue Router 4**。负责管理 `/login`, `/chat`, `/kb` 等单页路由。
- **样式引擎**: **Tailwind CSS v3/v4**。设计稿中高度依赖了 Tailwind 的实用类（如大量的色彩定制和背景模糊 `backdrop-blur`）。
- **状态管理**: **Pinia**。Vue 生态下最直观、轻量级的状态管理，用于控制侧边栏折叠、明暗主题切换、Command Palette（全局命令面板）的呼出状态等。
- **图标库**: **Material Symbols Outlined** (设计稿原生使用) 或者直接在 `index.html` 中引入对应的 Google Font 链接。
- **动效库 (可选)**: **@vueuse/motion** 或直接使用 **Vue 原生的 `<Transition>`**。对于 Command Palette 的弹出、卡片的悬浮缩放（`active:scale-[0.98]`）、聊天打字机效果等，提供更平滑的弹簧物理动效。

## 2. 全局颜色与主题配置

设计规范基于一套极致深色调（Dark Mode Only）与“电光靛蓝”（Electric Indigo）的点缀。

**在 `tailwind.config.js` 中的核心配置：**

```javascript
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 背景层级
        surface: "#131315", // 基础画布 (Canvas)
        "surface-container-lowest": "#0e0e10",
        "surface-container-low": "#1c1b1d", // 侧边栏/区块
        "surface-container-high": "#2a2a2c", // 卡片/悬浮区块
        "surface-container-highest": "#353437", // 极高亮层/输入框

        // 主色调 (电光靛蓝)
        primary: "#c3c0ff", // 亮色文字点缀
        "primary-container": "#4f46e5", // 按钮/关键色块
        "on-primary-container": "#dad7ff", // 按钮文字

        // 边框与文字
        "outline-variant": "#464555", // Ghost Border 辅助线
        outline: "#918fa1",
        "on-surface": "#e5e1e4", // 主要文字
        "on-surface-variant": "#c7c4d8", // 次要文字
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"], // 大标题与数字
        body: ["Inter", "sans-serif"], // 正文阅读
        label: ["Inter", "sans-serif"], // 微小标签
      },
    },
  },
};
```

**全局纹理（CSS实现）**：

- `grain-overlay`: 添加一个 2-3% 透明度的噪点图片，全屏覆盖 `pointer-events-none`。
- `blueprint-grid`: 使用 `radial-gradient` 或 `linear-gradient` 实现 24px/40px 的隐约网格底纹。

## 3. 路由拆分与页面定义

基于设计稿的 HTML 文件，应用可以拆分为以下路由结构：

- **`/login`** (对应 `auth.html`):
  - 左侧品牌视觉区（带动态渐变球和蓝图网格）。
  - 右侧表单区（登录、注册等状态切换）。
- **`/chat`** (对应 `main-chat.html`):
  - Agentic RAG 问答主界面。
  - 中心对齐的聊天流，底部毛玻璃效果的固定输入框。
- **`/kb`** (对应 `main-kb.html`):
  - 知识库列表页面。顶部数据统计，主体为 Bento 风格的知识库卡片。
- **`/kb/[id]`** (对应 `main-kb-i.html`):
  - 单个知识库的内部详情页（文档列表、状态、切片进度等）。

## 4. 组件拆分与复用规划

采用 Atomic Design 的思想，自下而上构建。

### 4.1 布局组件 (Layout)

- **`AppLayout`**: 包含全局的噪点纹理 (`grain-overlay`) 和网格底纹 (`blueprint-grid`)。
- **`Sidebar`**: 左侧导航栏。桌面端固定（`w-64`），移动端可以转为 Drawer 抽屉。
- **`TopNavBar`**: 顶部标题与面包屑。包含毛玻璃背景 (`backdrop-blur-xl`)。

### 4.2 基础 UI 元素 (Elements)

- **`Button`**: 封装 Primary 样式与 outline 样式，必须包含 `active:scale-[0.98]` 和 `transition-all duration-200` 以体现“精密仪器”的按压手感。
- **`Input`**: 去掉外边框，背景使用 `surface-container-highest`，Focus 时边框亮起 `primary` 颜色（Ghost Border 模式）。
- **`Card`**: 使用层级颜色 `surface-container-low` 到 `high` 的过渡，拒绝生硬的 1px solid 描边。
- **`Avatar`**: 用户/模型头像封装，支持重叠堆叠显示（知识库成员展示）。

### 4.3 核心业务组件 (Features)

- **`CommandPalette`** (全局搜索/命令面板):
  - 设计稿的灵魂组件（隐藏层）。高斯模糊 (`blur-[25px]`) + `surface-container-highest` 80%透明度。按下 `Cmd+K` 或点击顶部搜索框触发。
- **`ChatStream` & `MessageBubble`**:
  - AI 回复与用户输入。包含底部的状态指示器（如“正在检索本地知识库...”的 Pulse 动画和 Shimmer 进度条）。
- **`ChatInputArea`**:
  - 底部聊天框。带强烈的毛玻璃投影，包含模型选择、联网搜索等元数据快捷入口。
- **`KnowledgeBaseCard`**:
  - 知识库卡片，包含图标、类型标签（私有/共享）、统计数据和成员头像叠加区。

## 5. 详细实现步骤与路线图

### Phase 1: 基础设施搭建 (1-2天)

- **依赖安装**:
  - 使用 Vite 快速初始化 Vue 3 项目: `npm create vite@latest frontend -- --template vue-ts`
  - `cd frontend`
  - 安装核心生态: `npm install vue-router@4 pinia`
  - 安装样式与工具库: `npm install -D tailwindcss postcss autoprefixer @vueuse/core clsx tailwind-merge`
  - 初始化 Tailwind: `npx tailwindcss init -p`
- **主题与状态配置 (Pinia & VueUse)**:
  - 使用 `@vueuse/core` 中的 `useDark` 和 `useToggle` 来控制 `html` 标签上的 `dark` / `light` 类名。
  - 在 `src/stores/app.ts` (Pinia) 中集中管理全局的亮暗主题状态、侧边栏开闭状态。
  - 在 `tailwind.config.js` 中配置 `darkMode: 'class'`，并补充 Light/Dark 对应的色阶映射。
- **全局样式与字体**:
  - 在 `index.html` 中引入 Google Fonts (`Space Grotesk`, `Inter`)。
  - 在 `src/style.css` 中编写 `.grain-overlay` 和 `.blueprint-grid` 全局样式，并根据明暗模式变量调整纹理透明度。

### Phase 2: 布局与通用组件封装 (2天)

**建立 `src/components` 目录树：**

- `ui/BaseButton.vue`: 封装 Primary/Outline/Ghost 样式，利用 `<slot>` 插槽和动态 Class。
- `ui/BaseInput.vue`: 封装无边框、Focus 提亮的输入框。
- `ui/BaseCard.vue`: 封装带有 `surface-container` 层级过渡的 Bento 卡片。
- `layout/AppSidebar.vue`: 左侧导航栏。
  - **移动端适配**: 监听窗口大小（如使用 `useWindowSize`），当 `< 768px` 时转为 Drawer 抽屉。配合 Vue 的 `<Transition name="slide">` 制作滑出动效，通过顶部 NavBar 的汉堡菜单唤出。
- `layout/TopNavBar.vue`: 顶部毛玻璃导航条，包含暗/亮色切换按钮（触发 Pinia store）。
- `features/CommandPalette.vue`: 快捷命令面板，使用 Vue `<Transition>` 结合 Tailwind 的 `scale/opacity` 类实现平滑弹出。

### Phase 3: Auth 登录页集成 (1天)

- **页面建立**: `src/views/auth/LoginView.vue`
- **路由配置**: 在 `src/router/index.ts` 中配置 `/login` 路由。
- **实现内容**:
  - 还原 `auth.html` 的双栏布局。
  - 左侧：动态渐变球 (`blur-[120px]`) 和蓝图网格背景。
  - 右侧：表单区。注意移动端下隐藏左侧视觉区，表单区满宽显示。

### Phase 4: 聊天室页面 (1.5天)

- **页面建立**: `src/views/chat/ChatView.vue`
- **拆分组件**:
  - `components/chat/ChatStream.vue`: 负责渲染消息列表流，基于 `v-for` 遍历消息数组。
  - `components/chat/MessageBubble.vue`: 区分 User 和 AI 的消息气泡。包含 Agent 状态指示器（如 Pulse 动画）。
  - `components/chat/ChatInputArea.vue`: 底部固定输入框区域，带毛玻璃投影。
- **响应式处理**: 聊天流在移动端要确保留出底部安全区（Safe Area），输入框在唤起键盘时能正确自适应高度。

### Phase 5: 知识库管理页面 (1.5天)

- **页面建立**:
  - 列表页: `src/views/kb/KbListView.vue`
  - 详情页: `src/views/kb/KbDetailView.vue`
- **拆分组件**:
  - `components/kb/KbCard.vue`: Bento 风格卡片。
  - `components/kb/FilterBar.vue`: 顶部的状态过滤与排序条。
- **构建与部署配置**:
  - 配置 `vite.config.ts` 中的 `base` 路径，执行 `npm run build` 生成 `dist` 静态产物，可直接丢到 Nginx 中运行，配合 `try_files $uri /index.html` 完美支持 History 模式的 SPA 路由。

---

## 6. 待确认细节 (后端联调前)

1. **Command Palette 数据源**: 全局命令面板 (Cmd+K) 需要搜索的具体实体清单（文档内容、知识库名称、聊天历史记录？），以便前端提前 Mock 数据结构。
