import { TestHttpClient } from './test-http';

export interface TestTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; username: string };
}

export async function loginAsOwner(
  client: TestHttpClient,
  email: string,
  password: string,
) {
  return login(client, email, password);
}

export async function loginAsMember(
  client: TestHttpClient,
  email: string,
  password: string,
) {
  return login(client, email, password);
}

async function login(client: TestHttpClient, email: string, password: string) {
  const response = await client.request<{ data: TestTokens }>('auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (response.status !== 200 || !response.body.data?.accessToken)
    throw new Error(`Login failed for test account ${email}`);
  return response.body.data;
}

export async function refreshToken(client: TestHttpClient, token: string) {
  const response = await client.request<{ data: Omit<TestTokens, 'user'> }>(
    'auth/refresh',
    { method: 'POST', body: { refreshToken: token } },
  );
  if (response.status !== 200 || !response.body.data?.accessToken)
    throw new Error('Refresh token failed in test');
  return response.body.data;
}

export async function logout(client: TestHttpClient, token: string) {
  return client.request('auth/logout', {
    method: 'POST',
    token,
  });
}
