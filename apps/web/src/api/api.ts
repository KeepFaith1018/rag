import {
  ApiError,
  type ApiQueryParams,
  type ApiRequestBody,
  type ApiRequestOptions,
  type ApiResult,
} from "@/types/api";
import type { RefreshResponse } from "@/types/auth";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from "@/utils/token";

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:3001/api";

type AuthFailureHandler = () => void | Promise<void>;

type PendingRequest = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

export type ApiBlobResponse = {
  blob: Blob;
  fileName: string | null;
  mimeType: string | null;
};

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;
let authFailureHandler: AuthFailureHandler | null = null;

const pendingQueue: PendingRequest[] = [];

/** 默认请求超时 (毫秒) */
const DEFAULT_TIMEOUT_MS = 30000;

/** GET 请求去重缓存：相同 url+params 复用 pending Promise */
const pendingRequests = new Map<string, Promise<unknown>>();

function pendingKey(url: string, params?: ApiQueryParams): string {
  const sorted = params
    ? Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("&")
    : "";
  return `${getAccessToken()}::${url}?${sorted}`;
}

/**
 * 注册认证失败后的统一回调，便于后续接 store 或路由跳转。
 */
export function setApiAuthFailureHandler(handler: AuthFailureHandler | null) {
  authFailureHandler = handler;
}

/**
 * 统一发起 API 请求，并处理 token、刷新与错误转换。
 */
export async function apiRequest<T>(options: ApiRequestOptions): Promise<T> {
  const {
    url,
    params,
    skipAuth,
    skipRefreshRetry,
    _retry,
    body,
    method,
    ...rest
  } = options;
  const requestBody = normalizeRequestBody(body);
  const requestHeaders = createHeaders(options, requestBody);

  // GET 请求去重（仅对非重试的首次请求生效）
  const isGet = !method || method === "GET";
  const key = isGet && !_retry ? pendingKey(url, params) : null;
  if (key) {
    const pending = pendingRequests.get(key);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const fetchPromise = doFetch();

  if (key) {
    pendingRequests.set(key, fetchPromise);
    fetchPromise.finally(() => pendingRequests.delete(key));
  }

  return fetchPromise;

  async function doFetch(): Promise<T> {
    const signal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(buildRequestUrl(url, params), {
        ...rest,
        method,
        body: requestBody,
        headers: requestHeaders,
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw createNetworkError(new Error("请求超时"));
      }
      throw createNetworkError(error);
    }

    const result = await parseApiResult<T>(response);

    if (response.ok && result?.success) {
      return result.data as T;
    }

    if (response.ok && !result) {
      return undefined as T;
    }

    if (
      !skipAuth &&
      !skipRefreshRetry &&
      !_retry &&
      shouldRefresh(response.status, result)
    ) {
      await ensureFreshAccessToken(extractAccessToken(requestHeaders));
      return apiRequest<T>({
        ...options,
        _retry: true,
      });
    }

    throw createApiError(response.status, result);
  }
}

/**
 * 拉取二进制响应，并复用统一鉴权与刷新逻辑。
 */
export async function apiRequestBlob(
  options: ApiRequestOptions,
): Promise<ApiBlobResponse> {
  const { url, params, skipAuth, skipRefreshRetry, _retry, body, ...rest } =
    options;
  const requestBody = normalizeRequestBody(body);
  const requestHeaders = createHeaders(options, requestBody);

  let response: Response;

  try {
    response = await fetch(buildRequestUrl(url, params), {
      ...rest,
      body: requestBody,
      headers: requestHeaders,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw createNetworkError(error);
  }

  if (response.ok) {
    return {
      blob: await response.blob(),
      fileName: resolveFileName(response.headers.get("Content-Disposition")),
      mimeType: response.headers.get("Content-Type"),
    };
  }

  const result = await parseApiResult<unknown>(response);

  if (
    !skipAuth &&
    !skipRefreshRetry &&
    !_retry &&
    shouldRefresh(response.status, result)
  ) {
    await ensureFreshAccessToken(extractAccessToken(requestHeaders));
    return apiRequestBlob({
      ...options,
      _retry: true,
    });
  }

  throw createApiError(response.status, result);
}

/**
 * 请求 URL 构建。
 */
function buildRequestUrl(url: string, params?: ApiQueryParams) {
  const rawUrl = isAbsoluteUrl(url) ? url : joinUrl(API_BASE_URL, url);
  const fallbackOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const parsedUrl = isAbsoluteUrl(rawUrl)
    ? new URL(rawUrl)
    : new URL(rawUrl, fallbackOrigin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        parsedUrl.searchParams.set(key, String(value));
      }
    });
  }

  return isAbsoluteUrl(rawUrl)
    ? parsedUrl.toString()
    : `${parsedUrl.pathname}${parsedUrl.search}`;
}

/**
 * 流式请求（返回原始 Response 对象供调用方自行处理流式解析）。
 * 复用统一鉴权与刷新逻辑，但不做响应体解析。
 */
export async function apiRequestStream(
  options: Omit<ApiRequestOptions, "skipRefreshRetry">,
): Promise<Response> {
  const { url, params, skipAuth, _retry, body, ...rest } = options;
  const requestBody = normalizeRequestBody(body);
  const requestHeaders = createHeaders(options, requestBody);

  let fetchResponse: Response;
  try {
    fetchResponse = await fetch(buildRequestUrl(url, params), {
      ...rest,
      body: requestBody,
      headers: requestHeaders,
    });
  } catch (error) {
    throw createNetworkError(error);
  }

  // 401 且未禁用刷新重试 → 刷新 token 后重试
  if (!skipAuth && !_retry && fetchResponse.status === 401) {
    await ensureFreshAccessToken(extractAccessToken(requestHeaders));
    return apiRequestStream({
      ...options,
      _retry: true,
    });
  }

  return fetchResponse;
}

/**
 * 统一创建请求头，并自动注入最新 accessToken。
 */
function createHeaders(
  options: ApiRequestOptions,
  requestBody: BodyInit | null | undefined,
) {
  const headers = new Headers(options.headers || {});

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  if (!options.skipAuth) {
    const accessToken = getAccessToken();

    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  // 仅对普通 JSON 请求自动补 content-type，避免影响 FormData 上传。
  if (
    shouldSetJsonContentType(options.body, requestBody) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

/**
 * 将普通对象请求体序列化为 JSON。
 */
function normalizeRequestBody(
  body: ApiRequestBody,
): BodyInit | null | undefined {
  if (body === undefined || body === null) {
    return body;
  }

  if (shouldSerializeJsonBody(body)) {
    return JSON.stringify(body);
  }

  if (isNativeBodyInit(body)) {
    return body;
  }

  return JSON.stringify(body);
}

/**
 * 判断当前请求体是否应自动序列化。
 */
function shouldSerializeJsonBody(
  body: ApiRequestBody,
): body is Record<string, unknown> | unknown[] {
  if (!body || typeof body !== "object") {
    return false;
  }

  if (
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob
  ) {
    return false;
  }

  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return false;
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return false;
  }

  return true;
}

/**
 * 判断请求体是否已是浏览器原生支持的 BodyInit 类型。
 */
function isNativeBodyInit(body: ApiRequestBody): body is BodyInit {
  if (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return true;
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return true;
  }

  return false;
}

/**
 * 判断当前请求是否需要自动补 JSON content-type。
 */
function shouldSetJsonContentType(
  body: ApiRequestBody,
  requestBody: BodyInit | null | undefined,
) {
  return typeof requestBody === "string" && shouldSerializeJsonBody(body);
}

/**
 * 解析后端统一响应结构。
 */
async function parseApiResult<T>(
  response: Response,
): Promise<ApiResult<T> | null> {
  const rawText = await response.text();

  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText) as ApiResult<T>;
  } catch {
    return {
      success: response.ok,
      code: response.status,
      message: rawText,
    };
  }
}

/**
 * 判断当前错误是否需要进入刷新流程。
 */
function shouldRefresh(status: number, result: ApiResult<unknown> | null) {
  return status === 401 || result?.code === 40101 || result?.code === 47004;
}

/**
 * 确保全局只存在一个刷新动作，其余请求进入队列等待。
 */
export async function ensureFreshAccessToken(
  staleAccessToken?: string,
): Promise<string> {
  if (isRefreshing && refreshPromise) {
    return enqueuePendingRequest();
  }

  isRefreshing = true;
  refreshPromise = refreshWithCrossTabLock(staleAccessToken);

  try {
    const nextAccessToken = await refreshPromise;

    resolvePendingRequests(nextAccessToken);

    return nextAccessToken;
  } catch (error) {
    rejectPendingRequests(error);
    await handleAuthFailure();
    throw error;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}

/**
 * 记住登录时通过 Web Locks 串行化多标签页刷新；后进入者直接复用先行标签页写入的新凭证。
 */
async function refreshWithCrossTabLock(staleAccessToken?: string) {
  const refresh = () => {
    const current = getAccessToken();
    if (staleAccessToken && current && current !== staleAccessToken)
      return Promise.resolve(current);
    return refreshAccessToken();
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("linsor-server-next-token-refresh", refresh);
  }
  return refresh();
}

/**
 * 调用刷新接口，获取新的 accessToken。
 */
async function refreshAccessToken(): Promise<string> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    throw new ApiError("缺少刷新令牌", 40100, 401);
  }

  let response: Response;

  try {
    response = await fetch(buildRequestUrl("/auth/refresh"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    throw createNetworkError(error);
  }

  const result = await parseApiResult<RefreshResponse>(response);

  if (!response.ok || !result?.success || !result.data?.accessToken) {
    throw createApiError(response.status, result);
  }

  setAccessToken(result.data.accessToken);

  // 保存轮换后的新 refreshToken
  if (result.data.refreshToken) {
    setRefreshToken(result.data.refreshToken);
  }

  return result.data.accessToken;
}

/**
 * 认证失败后的统一收口。
 */
async function handleAuthFailure() {
  clearTokens();

  if (authFailureHandler) {
    await authFailureHandler();
  }
}

/**
 * 将等待中的请求加入队列。
 */
function enqueuePendingRequest() {
  return new Promise<string>((resolve, reject) => {
    pendingQueue.push({ resolve, reject });
  });
}

/**
 * 刷新成功后批量唤醒排队请求。
 */
function resolvePendingRequests(token: string) {
  pendingQueue.forEach((item) => item.resolve(token));
  pendingQueue.length = 0;
}

/**
 * 刷新失败后批量拒绝排队请求。
 */
function rejectPendingRequests(error: unknown) {
  pendingQueue.forEach((item) => item.reject(error));
  pendingQueue.length = 0;
}

function extractAccessToken(headers: Headers) {
  const authorization = headers.get("Authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
}

/**
 * 统一构造业务错误对象。
 */
function createApiError(status: number, result: ApiResult<unknown> | null) {
  return new ApiError(
    result?.message || "请求失败",
    result?.code ?? status,
    status,
    result?.data,
  );
}

/** 浏览器原生 fetch 英文错误 → 中文翻译 */
const NETWORK_ERROR_ZH: Record<string, string> = {
  "Failed to fetch": "无法连接到服务器，请检查网络或后端服务是否启动",
  "NetworkError when attempting to fetch resource.": "网络错误，无法获取资源",
  "Load failed": "加载失败",
  "The Internet connection appears to be offline.": "网络连接已断开",
  "Request timed out.": "请求超时",
  cancelled: "请求已取消",
};

/**
 * 统一构造网络错误对象，将浏览器原生英文错误翻译为中文。
 */
function createNetworkError(error: unknown) {
  let message = "网络请求失败";

  if (error instanceof Error) {
    const raw = error.message || "";
    // 精确匹配
    if (NETWORK_ERROR_ZH[raw]) {
      message = NETWORK_ERROR_ZH[raw];
    } else {
      // 模糊匹配（如 "cancelled" 可能是 "The operation was cancelled." 的一部分）
      for (const [key, zh] of Object.entries(NETWORK_ERROR_ZH)) {
        if (raw.toLowerCase().includes(key.toLowerCase())) {
          message = zh;
          break;
        }
      }
    }
  }

  return new ApiError(message, -1, 0, error);
}

/**
 * 判断是否为绝对 URL。
 */
function isAbsoluteUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

/**
 * 拼接 baseURL 与接口路径。
 */
function joinUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}

/**
 * 从响应头中提取下载文件名。
 */
function resolveFileName(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    return safeDecodeFileName(utf8Match[1]);
  }

  const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);

  if (plainMatch?.[1]) {
    return safeDecodeFileName(plainMatch[1]);
  }

  return null;
}

/**
 * 安全解码文件名，避免非法编码导致下载流程中断。
 */
function safeDecodeFileName(fileName: string) {
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}
