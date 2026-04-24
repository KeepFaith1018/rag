# 前端认证模块实现总结

## 1. 本次目标

本次工作围绕 `apps/frontend` 的认证链路落地，目标是完成从“仅有静态登录页”到“具备真实认证能力”的前端实现闭环。

完成范围包括：

- 统一认证请求层接入
- 双 token 存储与自动刷新
- `auth store` 状态管理
- 路由守卫与启动恢复登录态
- 登录 / 注册 / 发送验证码
- 忘记密码与重置密码
- 全局消息提示
- 验证码发送倒计时
- 基础前端表单校验

## 2. 已实现功能

### 2.1 请求层与 Token

已完成统一请求封装，支持：

- 自动拼接 `/api` 基础前缀
- 自动注入 `Authorization: Bearer <accessToken>`
- 统一解析后端 `Result<T>` 响应结构
- `401` / `40101` / `47004` 自动触发刷新
- 并发请求命中过期时单次刷新、其余请求排队等待
- 刷新成功后自动重试原请求
- 刷新失败后统一清理登录态

相关文件：

- `src/api/api.ts`
- `src/api/auth.ts`
- `src/types/api.ts`
- `src/types/auth.ts`
- `src/utils/token.ts`

### 2.2 认证状态管理

已新增 `auth store`，负责统一编排认证态：

- `login`
- `register`
- `sendVerificationCode`
- `resetPassword`
- `fetchCurrentUser`
- `bootstrap`
- `logout`

同时提供以下状态：

- `user`
- `isAuthenticated`
- `isBootstrapping`
- `isLoginSubmitting`
- `isRegisterSubmitting`
- `isSendingCode`
- `isResetPasswordSubmitting`

相关文件：

- `src/stores/auth.ts`
- `src/stores/pinia.ts`

### 2.3 登录态恢复与路由守卫

已在应用启动时完成认证恢复流程：

1. 初始化全局认证失败回调
2. 执行 `authStore.bootstrap()`
3. 检查本地 `refreshToken`
4. 缺少 `accessToken` 时由请求层自动刷新
5. 成功后拉取 `/auth/me`

同时已完成路由级权限控制：

- `/login` 为游客页
- `/forgot-password` 为游客页
- `/chat`、`/kb`、`/kb/:id` 受登录态保护
- 未登录访问业务页时跳回登录页，并保留 `redirect`

相关文件：

- `src/main.ts`
- `src/router/index.ts`

### 2.4 登录 / 注册 / 忘记密码

登录页已从静态页面接为真实表单流程：

- 登录调用 `authStore.login`
- 注册调用 `authStore.register`
- 发送验证码调用 `authStore.sendVerificationCode`
- 注册补齐后端要求的 `username`
- 登录成功后按 `redirect` 回跳

忘记密码流程已完成：

- 新增找回密码页面
- 通过邮箱发送重置验证码
- 输入验证码和新密码进行重置
- 成功后返回登录页

相关文件：

- `src/views/auth/LoginView.vue`
- `src/views/auth/ForgotPasswordView.vue`

### 2.5 全局消息提示

已完成轻量级全局提示能力：

- `success`
- `error`
- `warning`
- `info`

提示以全局浮层方式展示，适用于认证流程中的统一反馈。

相关文件：

- `src/composables/useMessage.ts`
- `src/components/ui/AppMessageContainer.vue`
- `src/App.vue`

### 2.6 认证状态在布局层展示

已在侧边栏接入当前用户信息：

- 用户名
- 邮箱
- 角色
- 头像
- 退出登录

同时顺手清理了若干影响构建的存量类型问题。

相关文件：

- `src/components/layout/AppSidebar.vue`
- `src/components/layout/TopNavBar.vue`
- `src/views/chat/ChatView.vue`
- `src/views/kb/KbListView.vue`
- `src/views/kb/KbDetailView.vue`

### 2.7 倒计时与细化校验

已为注册页和找回密码页补充：

- 验证码按钮 30 秒倒计时
- 倒计时期间禁用按钮
- 邮箱格式校验
- 用户名长度校验
- 验证码 6 位数字校验
- 密码长度校验
- 确认密码一致性校验

相关文件：

- `src/composables/useVerificationCountdown.ts`
- `src/views/auth/LoginView.vue`
- `src/views/auth/ForgotPasswordView.vue`

## 3. 主要新增文件

```txt
apps/frontend/src/api/api.ts
apps/frontend/src/api/auth.ts
apps/frontend/src/components/ui/AppMessageContainer.vue
apps/frontend/src/composables/useMessage.ts
apps/frontend/src/composables/useVerificationCountdown.ts
apps/frontend/src/stores/auth.ts
apps/frontend/src/stores/pinia.ts
apps/frontend/src/types/api.ts
apps/frontend/src/types/auth.ts
apps/frontend/src/utils/token.ts
apps/frontend/src/views/auth/ForgotPasswordView.vue
```

## 4. 主要修改文件

```txt
apps/frontend/src/App.vue
apps/frontend/src/main.ts
apps/frontend/src/router/index.ts
apps/frontend/src/views/auth/LoginView.vue
apps/frontend/src/components/layout/AppSidebar.vue
apps/frontend/src/components/layout/TopNavBar.vue
apps/frontend/src/views/chat/ChatView.vue
apps/frontend/src/views/kb/KbListView.vue
apps/frontend/src/views/kb/KbDetailView.vue
apps/frontend/tsconfig.app.json
```

## 5. 验证结果

本次实现已完成以下验证：

- 新增与修改文件的类型诊断通过
- 前端生产构建通过

验证命令：

```bash
pnpm --filter frontend build
```

## 6. 当前已完成的认证闭环

目前前端已具备完整的基础认证能力：

- 登录
- 注册
- 发送验证码
- 自动刷新 accessToken
- 启动恢复登录态
- 路由守卫
- 退出登录
- 忘记密码
- 重置密码
- 全局消息提示
- 验证码发送倒计时
- 基础字段校验

## 7. 后续建议

建议下一阶段继续完善：

- 字段级错误展示，而不仅是 toast 提示
- 注册页 / 找回密码页的更细表单状态反馈
- 个人资料页与头像/昵称编辑
- 顶部导航用户信息联动
- 业务接口联调（知识库、聊天、个人资料）

## 8. 结论

本次工作已经将前端认证从“页面占位态”推进到“可真实联调态”。

后续业务模块只需要基于当前认证基础设施继续接入 API，即可共享统一的 token、错误处理、刷新队列与登录态恢复能力。
