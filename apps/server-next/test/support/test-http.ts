export interface TestHttpResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

export interface TestHttpOptions {
  method?: string;
  token?: string;
  body?: unknown;
  expectedStatus?: number | number[];
}

/** 面向真实 HTTP 测试的轻量客户端，统一请求头、解析和失败摘要。 */
export class TestHttpClient {
  constructor(private readonly baseUrl: string) {}

  async request<T = unknown>(
    path: string,
    options: TestHttpOptions = {},
  ): Promise<TestHttpResponse<T>> {
    const body = options.body;
    const isFormData =
      typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, '')}/api/${path.replace(/^\//, '')}`,
      {
        method: options.method ?? 'GET',
        headers: {
          ...(options.token
            ? { authorization: `Bearer ${options.token}` }
            : {}),
          ...(body && !isFormData
            ? { 'content-type': 'application/json' }
            : {}),
        },
        body:
          body === undefined
            ? undefined
            : isFormData
              ? body
              : JSON.stringify(body),
      },
    );
    const contentType = response.headers.get('content-type') ?? '';
    const parsed = (
      contentType.includes('json')
        ? await response.json()
        : await response.text()
    ) as T;
    const result = {
      status: response.status,
      headers: response.headers,
      body: parsed,
    };
    const expected = options.expectedStatus ?? [200, 201, 204];
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (!expectedStatuses.includes(response.status)) {
      console.error(
        `[server-next test] ${options.method ?? 'GET'} /api/${path} ` +
          `unexpected status=${response.status} ${this.safeSummary(parsed)}`,
      );
    }
    return result;
  }

  private safeSummary(body: unknown) {
    if (!body || typeof body !== 'object') return '';
    const value = body as Record<string, unknown>;
    const summary = {
      success: value.success,
      code: value.code,
      message: value.message,
    };
    return JSON.stringify(summary);
  }
}
