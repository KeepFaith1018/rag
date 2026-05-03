# 前端认证请求层设计文档

## 1. 目标

在 `apps/frontend` 内优先落地一套统一的前端请求层，作为后续 `auth` 模块、知识库模块、聊天模块的公共基础设施。

本方案重点解决以下问题：

- 统一封装 `api.ts` 请求工具
- 自动携带 `Authorization: Bearer <accessToken>`
- 使用双 token 机制
- `accessToken` 过期后自动刷新
- 多个并发请求命中过期场景时，刷新动作只执行一次
- 刷新期间其余请求进入队列等待
- 刷新成功后自动重新发起原请求
- 刷新失败后统一清理登录态并跳转登录页

当前前端依赖中没有 `axios`，因此本方案推荐基于原生 `fetch` 实现，避免新增不必要依赖。

## 2. 后端契约

后端接口前缀为：

```txt
/api
```

认证相关接口：

```txt
POST /api/auth/login
POST /api/auth/refresh
GET  /api/auth/me
POST /api/auth/register
POST /api/auth/send-code
```

受保护接口通过请求头携带 token：

```http
Authorization: Bearer <accessToken>
```

后端成功响应统一结构：

```json
{
  "success": true,
  "code": 0,
  "message": "success",
  "data": {}
}
```

后端失败响应统一结构：

```json
{
  "success": false,
  "code": 40101,
  "message": "登录已过期"
}
```

认证相关核心错误码建议前端重点处理：

- `40100`: 未登录
- `40101`: 登录已过期
- `47004`: 刷新令牌无效
- `47001`: 账号或密码错误
- `47002`: 用户已存在
- `46003`: 验证码错误或已失效
- `46005`: 请求过于频繁

## 3. 推荐目录结构

建议先新增以下文件：

```txt
src/
  api/
    api.ts
    auth.ts
  types/
    api.ts
    auth.ts
  utils/
    token.ts
  stores/
    auth.ts
```

职责划分如下：

- `src/api/api.ts`
  - 基础请求工具
  - 自动拼接 baseURL
  - 自动加 token
  - 统一解包响应
  - 统一处理错误
  - 刷新 token
  - 请求排队与重放

- `src/api/auth.ts`
  - 认证相关业务接口
  - 仅负责组合具体 URL 和请求体
  - 不处理底层 token 逻辑

- `src/utils/token.ts`
  - 负责 token 的读写、清理、持久化策略

- `src/stores/auth.ts`
  - 管理用户信息、登录状态、登录初始化、登出

## 4. 双 Token 机制

### 4.1 定义

- `accessToken`
  - 用于访问业务接口
  - 生命周期短
  - 每次请求自动放入 `Authorization`

- `refreshToken`
  - 用于换取新的 `accessToken`
  - 生命周期长
  - 仅在调用 `/auth/refresh` 时使用

### 4.2 推荐存储策略

在当前后端实现下，建议采用以下策略：

- `accessToken`
  - 存内存为主
  - 可同步保存到 `sessionStorage` 作为刷新页面兜底

- `refreshToken`
  - 存 `localStorage`
  - 用于页面刷新后恢复登录态

说明：

- 纯前端存储方案无法像 HttpOnly Cookie 一样抵御 XSS，这是当前后端接口设计下的现实选择
- 后续若后端改造为 Cookie 刷新方案，前端请求层仍可复用，仅需调整 token 存储和刷新方式

## 5. 核心设计原则

### 5.1 请求工具只暴露统一入口

不建议页面直接使用 `fetch`。

统一通过：

```ts
apiRequest<T>(options);
```

进行调用，确保所有接口都经过同一套 token 与错误处理流程。

### 5.2 刷新动作全局唯一

当多个请求同时发现 `accessToken` 已过期时：

- 只有第一个请求真正触发刷新
- 其余请求进入等待队列
- 刷新成功后统一唤醒并重试
- 刷新失败后统一拒绝并清理登录态

### 5.3 原请求只允许重试一次

防止出现：

- 刷新失败死循环
- 某些异常请求无限重试

因此每个请求配置都应带上：

```ts
_retry?: boolean
```

## 6. 类型设计

建议新增 `src/types/api.ts`：

```ts
export interface ApiResult<T> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
}

export interface ApiRequestOptions extends RequestInit {
  url: string;
  params?: Record<string, string | number | boolean | undefined | null>;
  skipAuth?: boolean;
  skipRefreshRetry?: boolean;
  _retry?: boolean;
}
```

建议新增 `src/types/auth.ts`：

```ts
export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  roles: string[];
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

export interface RefreshPayload {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}
```

## 7. Token 工具设计

建议新增 `src/utils/token.ts`：

```ts
const ACCESS_TOKEN_KEY = "rag_kb_access_token";
const REFRESH_TOKEN_KEY = "rag_kb_refresh_token";

let accessTokenMemory = "";

export function getAccessToken(): string {
  return accessTokenMemory || sessionStorage.getItem(ACCESS_TOKEN_KEY) || "";
}

export function setAccessToken(token: string) {
  accessTokenMemory = token;
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) || "";
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearTokens() {
  accessTokenMemory = "";
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
```

如果后续要支持“记住我”，可以扩展为：

- 勾选记住我：`refreshToken` 存 `localStorage`
- 不勾选记住我：`refreshToken` 存 `sessionStorage`

## 8. `api.ts` 核心能力

`src/api/api.ts` 需要实现以下功能：

- 统一处理 baseURL
- 自动拼接 query 参数
- 自动序列化 JSON body
- 自动添加 `Content-Type: application/json`
- 自动添加 `Authorization`
- 自动解析统一返回结构
- 遇到 token 过期自动刷新
- 刷新期间进入等待队列
- 刷新成功后自动重放原请求
- 刷新失败后统一登出

## 9. 刷新与队列机制

### 9.1 全局状态

建议在 `api.ts` 文件内部维护：

```ts
let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;
```

同时维护等待队列：

```ts
type PendingRequest = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

const pendingQueue: PendingRequest[] = [];
```

### 9.2 队列处理函数

```ts
function enqueuePendingRequest() {
  return new Promise<string>((resolve, reject) => {
    pendingQueue.push({ resolve, reject });
  });
}

function resolvePendingRequests(token: string) {
  pendingQueue.forEach((item) => item.resolve(token));
  pendingQueue.length = 0;
}

function rejectPendingRequests(error: unknown) {
  pendingQueue.forEach((item) => item.reject(error));
  pendingQueue.length = 0;
}
```

### 9.3 刷新逻辑

```ts
async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    throw new Error("No refresh token");
  }

  const response = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken }),
  });

  const result = (await response.json()) as ApiResult<RefreshResponse>;

  if (!response.ok || !result.success || !result.data?.accessToken) {
    throw new Error(result.message || "Refresh token failed");
  }

  setAccessToken(result.data.accessToken);
  return result.data.accessToken;
}
```

### 9.4 过期处理流程

当普通请求发现返回以下错误时：

- HTTP `401`
- 业务码 `40101`
- 业务码 `47004`

执行以下流程：

1. 当前请求检查自己是否已经重试过
2. 若已重试过，直接失败
3. 若当前没有刷新任务，则发起刷新
4. 若已有刷新任务，则等待刷新结果
5. 刷新成功后重新请求原接口
6. 刷新失败后清空 token，并让所有排队请求一起失败

## 10. `api.ts` 参考实现骨架

以下代码是推荐实现骨架，后续可直接按此落地：

```ts
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  clearTokens,
} from "@/utils/token";
import type { ApiRequestOptions, ApiResult } from "@/types/api";
import type { RefreshResponse } from "@/types/auth";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

type PendingRequest = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;
const pendingQueue: PendingRequest[] = [];

function buildUrl(url: string, params?: ApiRequestOptions["params"]) {
  const target = new URL(
    url.startsWith("http") ? url : `${BASE_URL}${url}`,
    window.location.origin,
  );

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        target.searchParams.set(key, String(value));
      }
    });
  }

  if (url.startsWith("http")) {
    return target.toString();
  }

  return `${target.pathname}${target.search}`;
}

function enqueuePendingRequest() {
  return new Promise<string>((resolve, reject) => {
    pendingQueue.push({ resolve, reject });
  });
}

function resolvePendingRequests(token: string) {
  pendingQueue.forEach((item) => item.resolve(token));
  pendingQueue.length = 0;
}

function rejectPendingRequests(error: unknown) {
  pendingQueue.forEach((item) => item.reject(error));
  pendingQueue.length = 0;
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    throw new Error("No refresh token");
  }

  const response = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken }),
  });

  const result = (await response.json()) as ApiResult<RefreshResponse>;

  if (!response.ok || !result.success || !result.data?.accessToken) {
    throw new Error(result.message || "Refresh token failed");
  }

  setAccessToken(result.data.accessToken);
  return result.data.accessToken;
}

function shouldRefresh(response: Response, result?: ApiResult<unknown>) {
  return (
    response.status === 401 || result?.code === 40101 || result?.code === 47004
  );
}

function createHeaders(options: ApiRequestOptions) {
  const headers = new Headers(options.headers || {});

  if (
    !headers.has("Content-Type") &&
    options.body &&
    !(options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  if (!options.skipAuth) {
    const accessToken = getAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  return headers;
}

export async function apiRequest<T>(options: ApiRequestOptions): Promise<T> {
  const { url, params, skipAuth, skipRefreshRetry, _retry, ...rest } = options;

  const requestInit: RequestInit = {
    ...rest,
    headers: createHeaders(options),
  };

  const response = await fetch(buildUrl(url, params), requestInit);
  const result = (await response.json()) as ApiResult<T>;

  if (response.ok && result.success) {
    return result.data as T;
  }

  if (
    !skipAuth &&
    !skipRefreshRetry &&
    !_retry &&
    shouldRefresh(response, result)
  ) {
    try {
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = refreshAccessToken();

        refreshPromise
          .then((newToken) => {
            resolvePendingRequests(newToken);
          })
          .catch((error) => {
            rejectPendingRequests(error);
          })
          .finally(() => {
            isRefreshing = false;
            refreshPromise = null;
          });
      }

      const newToken = refreshPromise
        ? await refreshPromise
        : await enqueuePendingRequest();

      return apiRequest<T>({
        ...options,
        _retry: true,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${newToken}`,
        },
      });
    } catch (error) {
      clearTokens();
      throw error;
    }
  }

  throw new Error(result.message || "Request failed");
}
```

## 11. 刷新队列时序说明

### 场景：3 个请求同时发现 token 过期

请求顺序如下：

1. 请求 A 返回 `40101`
2. 请求 A 发现当前未刷新，于是发起 `/auth/refresh`
3. 请求 B 返回 `40101`
4. 请求 B 发现正在刷新，进入等待
5. 请求 C 返回 `40101`
6. 请求 C 发现正在刷新，进入等待
7. 刷新成功，拿到新 `accessToken`
8. 唤醒 B、C
9. A、B、C 使用新 token 重新请求
10. 三个请求得到正常响应

这样可以避免：

- 连发多个刷新请求
- 刷新接口被打爆
- token 状态竞争覆盖

## 12. `auth.ts` 业务接口封装

建议 `src/api/auth.ts` 只做业务接口封装：

```ts
import { apiRequest } from "./api";
import type {
  LoginPayload,
  LoginResponse,
  RefreshResponse,
  UserProfile,
} from "@/types/auth";

export function login(data: LoginPayload) {
  return apiRequest<LoginResponse>({
    url: "/auth/login",
    method: "POST",
    body: JSON.stringify(data),
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

export function refresh(refreshToken: string) {
  return apiRequest<RefreshResponse>({
    url: "/auth/refresh",
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

export function getMe() {
  return apiRequest<UserProfile>({
    url: "/auth/me",
    method: "GET",
  });
}
```

说明：

- `login` 不需要带 accessToken
- `refresh` 也不应该进入再次刷新的递归逻辑
- `me` 由基础请求层自动带 token

## 13. Store 层对接方式

建议 `authStore` 只负责状态编排，不处理底层重试细节：

```ts
state: -user - isAuthenticated - isBootstrapping;

actions: -login() - logout() - fetchCurrentUser() - bootstrap();
```

推荐启动流程：

1. 应用启动
2. 检查本地是否存在 `refreshToken`
3. 若存在，则请求刷新接口获取新的 `accessToken`
4. 刷新成功后调用 `/auth/me`
5. 恢复用户态
6. 刷新失败则清空 token

## 14. 页面层调用规范

页面层不要自己拼接请求头，也不要自己处理 token 过期。

页面只调用业务 API：

```ts
await login({
  email,
  password,
});
```

或者：

```ts
await getMe();
```

页面层只关心：

- loading
- 表单校验
- 成功提示
- 失败提示
- 页面跳转

## 15. 错误处理建议

建议在 `api.ts` 中自定义统一错误对象，例如：

```ts
export class ApiError extends Error {
  code: number;
  status: number;

  constructor(message: string, code: number, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
```

这样页面层就可以按错误码精确处理：

```ts
if (error.code === 47001) {
  // 账号或密码错误
}
```

## 16. 实施顺序

建议按以下顺序开发：

1. 新增 `src/types/api.ts`
2. 新增 `src/types/auth.ts`
3. 新增 `src/utils/token.ts`
4. 实现 `src/api/api.ts`
5. 实现 `src/api/auth.ts`
6. 实现 `src/stores/auth.ts`
7. 改造登录页与注册页
8. 增加路由守卫
9. 接入应用启动时的登录态恢复

## 17. 当前阶段结论

当前阶段应先完成的是：

- 统一请求层 `api.ts`
- token 存储工具 `token.ts`
- auth 业务 API 封装 `auth.ts`

在这 3 个基础设施完成之前，不建议直接在页面里零散接入登录、注册、`me`、刷新逻辑，否则后续一定会出现重复代码和状态不一致问题。

## 18. 下一步

文档确认后，可直接进入以下落地阶段：

1. 在 `src/api/api.ts` 中实现基础请求工具
2. 在 `src/utils/token.ts` 中实现 token 管理
3. 在 `src/api/auth.ts` 中对接 `/auth/login`、`/auth/refresh`、`/auth/me`
4. 在 `LoginView.vue` 中替换当前 `TODO` 登录逻辑

如果继续执行，下一步建议直接开始编码实现 `api.ts + token.ts + auth.ts`。
