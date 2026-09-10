import { API_BASE_URL, ensureFreshAccessToken } from "@/api/api";
import { getAccessToken } from "@/utils/token";
import { isTokenExpiredOrSoon } from "@/utils/jwt";

export interface AuthenticatedEventSourceOptions {
  path: string;
  tokenParam?: string;
  expireSoonThresholdSeconds?: number;
  maxReconnect?: number;
  heartbeatTimeoutMs?: number;
  onMessage: (event: MessageEvent<string>) => void;
  onOpen?: (event: Event) => void;
  onError?: (event: Event) => void;
  onFallback?: (reason: string) => void;
}

export interface AuthenticatedEventSourceController {
  close: () => void;
  reconnect: () => Promise<void>;
  getReadyState: () => number | null;
}

const DEFAULT_TOKEN_PARAM = "token";
const DEFAULT_EXPIRE_SOON_THRESHOLD_SECONDS = 120;
const DEFAULT_MAX_RECONNECT = 2;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * 创建带认证、token 预刷新、有限重连和心跳兜底的 EventSource。
 */
export async function createAuthenticatedEventSource(
  options: AuthenticatedEventSourceOptions,
): Promise<AuthenticatedEventSourceController | null> {
  let source: EventSource | null = null;
  let closed = false;
  let reconnectCount = 0;
  let lastMessageAt = Date.now();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const maxReconnect = options.maxReconnect ?? DEFAULT_MAX_RECONNECT;
  const heartbeatTimeoutMs =
    options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

  const controller: AuthenticatedEventSourceController = {
    close() {
      closed = true;
      if (source) {
        source.close();
        source = null;
      }
      stopHeartbeat();
    },
    async reconnect() {
      await connect();
    },
    getReadyState() {
      return source?.readyState ?? null;
    },
  };

  async function resolveToken(): Promise<string | null> {
    let token = getAccessToken();
    if (
      !token ||
      isTokenExpiredOrSoon(
        token,
        options.expireSoonThresholdSeconds ??
          DEFAULT_EXPIRE_SOON_THRESHOLD_SECONDS,
      )
    ) {
      try {
        token = await ensureFreshAccessToken(token);
      } catch {
        return null;
      }
    }
    return token;
  }

  function buildUrl(token: string) {
    const rawUrl = isAbsoluteUrl(options.path)
      ? options.path
      : joinUrl(API_BASE_URL, options.path);
    const url = new URL(
      rawUrl,
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost",
    );
    url.searchParams.set(options.tokenParam ?? DEFAULT_TOKEN_PARAM, token);
    return url.toString();
  }

  async function connect(): Promise<boolean> {
    if (closed) return false;

    source?.close();
    source = null;

    const token = await resolveToken();
    if (!token) {
      fallback("auth_refresh_failed");
      return false;
    }

    lastMessageAt = Date.now();
    source = new EventSource(buildUrl(token));
    source.onopen = (event) => {
      lastMessageAt = Date.now();
      options.onOpen?.(event);
    };
    source.onmessage = (event) => {
      lastMessageAt = Date.now();
      options.onMessage(event as MessageEvent<string>);
    };
    source.onerror = (event) => {
      options.onError?.(event);
      if (!closed && source?.readyState === EventSource.CLOSED) {
        void reconnectOrFallback("connection_closed");
      }
    };

    startHeartbeat();
    return true;
  }

  async function reconnectOrFallback(reason: string) {
    if (closed) return;
    if (reconnectCount >= maxReconnect) {
      fallback(reason);
      return;
    }

    reconnectCount += 1;
    const connected = await connect();
    if (!connected) {
      fallback(reason);
    }
  }

  function fallback(reason: string) {
    controller.close();
    options.onFallback?.(reason);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (closed || !source) return;
      if (Date.now() - lastMessageAt > heartbeatTimeoutMs) {
        void reconnectOrFallback("heartbeat_timeout");
      }
    }, heartbeatTimeoutMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  const connected = await connect();
  return connected ? controller : null;
}

function isAbsoluteUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}
