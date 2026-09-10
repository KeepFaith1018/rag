import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Operation = { security?: unknown[] };
type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components?: { securitySchemes?: Record<string, unknown> };
};

describe('OpenAPI contract inventory', () => {
  const document = JSON.parse(
    readFileSync(
      join(__dirname, '../../openapi/server-next.openapi.json'),
      'utf8',
    ),
  ) as OpenApiDocument;
  const expected: Record<string, string[]> = {
    '/health/live': ['get'],
    '/health/ready': ['get'],
    '/auth/send-code': ['post'],
    '/auth/register': ['post'],
    '/auth/login': ['post'],
    '/auth/refresh': ['post'],
    '/auth/logout': ['post'],
    '/auth/me': ['get'],
    '/users/me': ['patch'],
    '/users/me/avatar': ['post'],
    '/users/avatar/{userId}': ['get'],
    '/users/me/password': ['post'],
    '/users/reset-password': ['post'],
    '/knowledge-bases': ['get', 'post'],
    '/public/knowledge-bases': ['get'],
    '/knowledge-bases/{kbId}': ['get', 'patch', 'delete'],
    '/knowledge-bases/{kbId}/members': ['get'],
    '/knowledge-bases/{kbId}/invitations': ['get', 'post'],
    '/knowledge-bases/{kbId}/invitations/{invitationId}': ['delete'],
    '/knowledge-bases/join': ['post'],
    '/knowledge-bases/{kbId}/join': ['post'],
    '/knowledge-bases/{kbId}/leave': ['post'],
    '/knowledge-bases/{kbId}/members/{memberUserId}': ['delete', 'patch'],
  };

  it('declares every current controller route exactly once', () => {
    expect(document.openapi).toBe('3.0.3');
    expect(Object.keys(document.paths).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [path, methods] of Object.entries(expected))
      expect(Object.keys(document.paths[path]).sort()).toEqual(methods.sort());
  });

  it('marks only explicitly public routes as anonymous', () => {
    const publicRoutes = new Set([
      '/health/live',
      '/health/ready',
      '/auth/send-code',
      '/auth/register',
      '/auth/login',
      '/auth/refresh',
      '/users/avatar/{userId}',
      '/users/reset-password',
    ]);
    for (const [path, methods] of Object.entries(document.paths))
      for (const [method, operation] of Object.entries(methods)) {
        if (publicRoutes.has(path)) expect(operation.security).toEqual([]);
        else expect(operation.security).toBeUndefined();
        expect(method).not.toBe('parameters');
      }
  });

  it('defines the bearer authentication scheme', () => {
    expect(document.components?.securitySchemes).toHaveProperty('bearerAuth');
  });
});
