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
} from "@/utils/token";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:3000/api";

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
    });
  } catch (error) {
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
    await ensureFreshAccessToken();
    return apiRequest<T>({
      ...options,
      _retry: true,
    });
  }

  throw createApiError(response.status, result);
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
    await ensureFreshAccessToken();
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
async function ensureFreshAccessToken(): Promise<string> {
  if (isRefreshing && refreshPromise) {
    return enqueuePendingRequest();
  }

  isRefreshing = true;
  refreshPromise = refreshAccessToken();

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

/**
 * 统一构造网络错误对象。
 */
function createNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : "网络请求失败";
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
