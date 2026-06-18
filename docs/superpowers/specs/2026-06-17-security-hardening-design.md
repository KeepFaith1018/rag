# Security Hardening & Observability Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all identified security vulnerabilities and add production observability to the Linsor AI backend.

**Architecture:** Each fix is scoped to specific files with minimal blast radius. Auth fixes (#1, #2, #4) are interdependent and should be deployed together. Permission fix (#3), CORS (#6), rate limiting (#5), and config (#7) are independent. Observability (#9, #10, #11) are additive.

**Tech Stack:** NestJS 11, ioredis, Prisma, class-validator, @nestjs/schedule, Winston

---

## Fix #1: JWT Secret Key Bug

**Severity:** Critical — all tokens signed with literal `'7d'`

**File:** `apps/server/src/app.module.ts:41`

**Problem:** `configService.get<string>('JWT_EXPIRES_IN')` returns `'7d'` (the expiry duration), used as the JWT signing secret. Every token is signed with the string `'7d'`, making token forgery trivial.

**Fix:** Change to `configService.get<string>('JWT_SECRET')`. Also read `expiresIn` from config:

```typescript
JwtModule.registerAsync({
  global: true,
  imports: [ConfigModule],
  useFactory: (configService: ConfigService) => ({
    secret: configService.get<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d'),
    },
  }),
  inject: [ConfigService],
}),
```

**Joi hardening** (in `env.validation.ts`):
```typescript
JWT_SECRET: Joi.string().min(32).required(),
JWT_EXPIRES_IN: Joi.string().default('7d'),
```

Min 32 chars prevents weak secrets. Startup fails fast if missing.

**Breaking change:** All existing tokens become invalid. Users must re-login.

---

## Fix #2: Hardcoded Encryption Keys

**Severity:** Critical — API key encryption is bypassable

**Files:**
- `apps/server/src/common/utils/crypto.service.ts:12,33`
- `apps/web/src/utils/secure-storage.ts` (transmission passphrase)
- `apps/server/src/common/config/env.validation.ts`

**Problem:**
- Line 12: `TRANSMISSION_PASSPHRASE = 'linsor-model-key-v1'` hardcoded in source
- Line 33: fallback `'linsor-default-encryption-key'` when env vars missing
- Frontend `secure-storage.ts` has matching hardcoded passphrase

**Fix:**

1. Delete `TRANSMISSION_PASSPHRASE` constant from `crypto.service.ts`
2. Make both keys mandatory env vars with no fallback:

```typescript
constructor(private readonly configService: ConfigService) {
  const secret = this.configService.get<string>('ENCRYPTION_KEY');
  // no fallback — Joi validation ensures it exists
  this.dbKey = scryptSync(secret, 'linsor-salt-2026', 32);

  const transmissionSecret = this.configService.get<string>('TRANSMISSION_SECRET');
  this.transmissionKey = createHash('sha256').update(transmissionSecret).digest();
}
```

3. Joi validation:
```typescript
ENCRYPTION_KEY: Joi.string().min(16).required(),
TRANSMISSION_SECRET: Joi.string().min(16).required(),
```

4. Frontend: read `VITE_TRANSMISSION_SECRET` from env. Note: this value is embedded in the client bundle and is NOT a true secret — it's obfuscation only. Real transport security relies on HTTPS. The design document should clearly state this boundary.

**Update `.env.example`:** Add `ENCRYPTION_KEY`, `TRANSMISSION_SECRET` with placeholder values.

---

## Fix #3: Document Delete Permission Error

**Severity:** High — any member with read access can delete documents

**Files:**
- `apps/server/src/modules/document/document.controller.ts:160,173`
- `apps/server/src/modules/knowledge-base/permission/kb-permission.decorator.ts`
- `apps/server/src/modules/knowledge-base/permission/kb-permission.guard.ts`
- `apps/server/src/modules/knowledge-base/permission/kb-permission.service.ts`

**Problem:**
- `remove()` at line 160 uses `@KbPermission({ action: 'read' })` — should require delete permission
- `reparse()` at line 173 uses `@KbPermission({ action: 'read' })` — should require reparse permission

**Fix (Refined Approach):**

Enhance `@KbPermission` decorator to support `fallback` action and document ownership param:

```typescript
// kb-permission.interface.ts — extend existing KbPermissionRequirement
export interface KbPermissionRequirement {
  action: KbPermissionAction;
  kbIdParam?: string;
  fallback?: KbPermissionAction;        // NEW: try this if primary fails
  documentIdParam?: string;             // NEW: param name for ownership check, default 'documentId'
}

// kb-permission.decorator.ts — no change to signature, already accepts KbPermissionRequirement
export const KbPermission = (options: KbPermissionRequirement) =>
  SetMetadata(KB_PERMISSION_KEY, options);
```

Update `KbPermissionGuard` to try primary action, then fallback. Extract `documentId` from `request.params` for ownership check:

```typescript
// kb-permission.guard.ts canActivate() — replace current authorize block
const requirement = this.reflector.get<KbPermissionRequirement>(KB_PERMISSION_KEY, context.getHandler());

// ... existing kbId extraction unchanged ...

try {
  request.kbPermission = await this.kbPermissionService.authorize(Number(userId), kbId, requirement.action);
  return true;
} catch {
  if (!requirement.fallback) throw;

  // Fallback: authorize with fallback action
  request.kbPermission = await this.kbPermissionService.authorize(Number(userId), kbId, requirement.fallback);

  // For own-document actions, verify the document's uploader matches current user
  if (requirement.fallback === 'deleteOwnDocument' || requirement.fallback === 'reparseOwnDocument') {
    const docIdParam = requirement.documentIdParam ?? 'documentId';
    const documentId = request.params?.[docIdParam];
    if (!documentId) {
      throw new BusinessException(ErrorCode.PARAM_ERROR, '缺少文档 ID 参数');
    }

    const document = await this.prisma.b_documents.findUnique({
      where: { id: BigInt(documentId) },
      select: { uploader_id: true },
    });
    if (!document || document.uploader_id.toString() !== userId) {
      throw new BusinessException(ErrorCode.KNOWLEDGE_UNAUTHORIZED);
    }
  }

  return true;
}
```

Update controllers:
```typescript
@Delete('knowledge-bases/:kbId/documents/:documentId')
@KbPermission({ action: 'deleteAnyDocument', fallback: 'deleteOwnDocument' })
remove(...) { ... }

@Post('knowledge-bases/:kbId/documents/:documentId/reparse')
@KbPermission({ action: 'reparseAnyDocument', fallback: 'reparseOwnDocument' })
reparse(...) { ... }
```

Permission matrix after fix:
- owner/manager → `deleteAnyDocument` passes → can delete any doc
- collaborator → `deleteAnyDocument` fails → falls back to `deleteOwnDocument` → only if `uploader_id` matches
- member/publicVisitor → both fail → rejected

---

## Fix #4: Refresh Token Rotation

**Severity:** Medium — leaked refresh tokens cannot be revoked

**Files:**
- `apps/server/src/modules/auth/auth.service.ts:150-210`
- `apps/web/src/api/api.ts` (ensureFreshAccessToken)

**Problem:** `refreshToken()` returns only a new accessToken. Old refreshToken stays valid for 7 days with no rotation.

**Fix:** Full rotation with transaction + replay detection:

```typescript
async refreshToken(dto: RefreshTokenDto) {
  const hash = this.hashToken(dto.refreshToken);
  const now = new Date();

  // 1. Find session by hash (include revoked for replay detection)
  const session = await this.prisma.b_user_sessions.findFirst({
    where: { refresh_token_hash: hash },
  });

  if (!session) {
    throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
  }

  // 2. Replay detection: if session already revoked, suspicious
  if (session.revoked) {
    this.securityAudit.logTokenReplay(
      session.user_id.toString(),
      session.session_id,
      ip,
    );
    // Optionally revoke all sessions for this user
    await this.revokeAllUserSessions(session.user_id);
    throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
  }

  // 3. Expiry check
  if (session.expired_at <= now) {
    throw new BusinessException(ErrorCode.AUTH_INVALID_REFRESH_TOKEN);
  }

  // 4. Verify JWT signature
  const payload = await this.jwtService.verifyAsync(dto.refreshToken);
  const user = await this.userService.findById(session.user_id);
  if (!user || user.id.toString() !== String(payload.sub)) {
    throw new BusinessException(ErrorCode.AUTH_USER_NOT_FOUND);
  }

  // 5. Transaction: revoke old + create new
  const newPayload = this.buildPayload(user);
  const [accessToken, refreshToken] = await Promise.all([
    this.jwtService.signAsync(newPayload),
    this.jwtService.signAsync(newPayload, { expiresIn: '7d' }),
  ]);

  const newRefreshHash = this.hashToken(refreshToken);
  const newSessionId = this.generateSessionId();

  await this.prisma.$transaction([
    this.prisma.b_user_sessions.update({
      where: { session_id: session.session_id },
      data: { revoked: true },
    }),
    this.prisma.b_user_sessions.create({
      data: {
        session_id: newSessionId,
        user_id: user.id,
        refresh_token_hash: newRefreshHash,
        expired_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        revoked: false,
      },
    }),
  ]);

  return { accessToken, refreshToken };
}
```

**Frontend update** (`api/api.ts`):
```typescript
// In ensureFreshAccessToken(), after successful refresh:
const data = await response.json();
setAccessToken(data.data.accessToken);
if (data.data.refreshToken) {
  setRefreshToken(data.data.refreshToken);  // save rotated token
}
```

**Admin auth** (`admin-auth.service.ts`): Apply the same rotation pattern.

---

## Fix #5: Redis-Based Rate Limiting

**Severity:** Medium — in-memory Map, multi-instance broken, unbounded growth

**Files:**
- `apps/server/src/common/cache/redis-cache.service.ts` — add `getClient()` method
- `apps/server/src/common/guards/rate-limit.guard.ts` — rewrite to use Redis

**Problem:** `Map<string, number[]>` in guard class scope. Cannot share state across instances. Never cleaned up.

**Fix:**

1. Add `getClient()` to `RedisCacheService`:
```typescript
getClient(): Redis {
  return this.client;
}
```

2. Rewrite `RateLimitGuard` using Redis sorted sets (MULTI transaction):
```typescript
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(
    private readonly redis: RedisCacheService,
    windowMs = 60_000,
    maxRequests = 30,
  ) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    if (!userId) return true;

    const key = `rate:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const client = this.redis.getClient();
    const multi = client.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zcard(key);
    multi.zadd(key, now, `${now}:${crypto.randomUUID()}`);
    multi.expire(key, Math.ceil(this.windowMs / 1000));

    const results = await multi.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= this.maxRequests) {
      throw new HttpException(
        { success: false, code: 42900, message: '请求过于频繁，请稍后再试' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
```

3. Same pattern for `StreamRateLimitGuard` (key prefix `stream:`, maxRequests=10).

4. Delete the old in-memory `Map` implementations entirely.

---

## Fix #6: CORS Whitelist

**Severity:** Medium — any origin can make authenticated requests

**Files:**
- `apps/server/src/main.ts:25-29`
- `apps/server/src/common/config/env.validation.ts`

**Problem:** `origin: true` reflects any request origin.

**Fix:**

```typescript
// env.validation.ts
CORS_ORIGINS: Joi.string().default('http://localhost:5173,http://localhost:5174'),

// main.ts
const corsOrigins = configService
  .get<string>('CORS_ORIGINS', 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.enableCors({
  origin: corsOrigins,
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
});
```

Production: `CORS_ORIGINS=https://linsor.example.com,https://admin.linsor.example.com`

---

## Fix #7: Joi/Prisma Config Validation Alignment

**Severity:** Low-Medium — Joi validates vars Prisma doesn't use, misses vars Prisma does use

**File:** `apps/server/src/common/config/env.validation.ts`

**Problem:**
- Joi requires `DATABASE_URL` but PrismaService reads `DATABASE_HOST/PORT/USER/PASSWORD/NAME`
- `ENCRYPTION_KEY`, `TRANSMISSION_SECRET`, `EMAIL_*` not validated

**Fix:**

Remove `DATABASE_URL: Joi.string().required()` and add:
```typescript
DATABASE_HOST: Joi.string().required(),
DATABASE_PORT: Joi.number().default(3306),
DATABASE_USER: Joi.string().required(),
DATABASE_PASSWORD: Joi.string().required(),
DATABASE_NAME: Joi.string().required(),
ENCRYPTION_KEY: Joi.string().min(16).required(),
TRANSMISSION_SECRET: Joi.string().min(16).required(),
EMAIL_HOST: Joi.string().required(),
EMAIL_PORT: Joi.number().required(),
EMAIL_USER: Joi.string().required(),
EMAIL_PASS: Joi.string().required(),
EMAIL_FROM: Joi.string().email().required(),
```

Update `.env.example` to match.

---

## Fix #8: Session Cleanup Cron Job

**Severity:** Low — expired sessions accumulate indefinitely

**Files:**
- Create: `apps/server/src/modules/auth/session-cleanup.service.ts`
- Modify: `apps/server/src/modules/auth/auth.module.ts`

**Fix:**

```typescript
@Injectable()
export class SessionCleanupService {
  private readonly BATCH_SIZE = 1000;

  @Cron('0 4 * * *')  // daily at 4:00 AM
  async cleanupExpiredSessions() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    let total = 0;

    // User sessions
    while (true) {
      const result = await this.prisma.b_user_sessions.deleteMany({
        where: {
          OR: [
            { expired_at: { lt: new Date() } },
            { revoked: true, updated_at: { lt: thirtyDaysAgo } },
          ],
        },
        take: this.BATCH_SIZE,
      });
      total += result.count;
      if (result.count < this.BATCH_SIZE) break;
    }

    // Admin sessions
    while (true) {
      const result = await this.prisma.sys_admin_sessions.deleteMany({
        where: {
          OR: [
            { expired_at: { lt: new Date() } },
            { revoked: true, updated_at: { lt: thirtyDaysAgo } },
          ],
        },
        take: this.BATCH_SIZE,
      });
      total += result.count;
      if (result.count < this.BATCH_SIZE) break;
    }

    this.logger.log(`Session cleanup: removed ${total} expired records`);
  }
}
```

Register in `AuthModule` providers.

---

## Fix #9: Health Check Endpoints

**Severity:** Observability — no liveness/readiness probes

**Files:**
- Create: `apps/server/src/modules/health/health.module.ts`
- Create: `apps/server/src/modules/health/health.controller.ts`
- Modify: `apps/server/src/app.module.ts` — import HealthModule

**Endpoints:**

- `GET /api/health/live` — always 200, confirms process is alive
- `GET /api/health/ready` — checks MySQL (`prisma.$queryRaw SELECT 1`), Redis (`PING`), Qdrant (HTTP `/healthz`), ES (HTTP `/`)

Response format:
```json
// 200
{ "status": "ok", "timestamp": "...", "checks": { "mysql": "ok", "redis": "ok", "qdrant": "ok", "elasticsearch": "ok" } }

// 503
{ "status": "degraded", "timestamp": "...", "checks": { "mysql": "ok", "redis": "error: connection refused", ... } }
```

No auth required (add to `@Auth(false)` or exclude from AuthGuard).

---

## Fix #10: Security Audit Logging

**Severity:** Observability — security events not recorded

**Files:**
- Create: `apps/server/src/common/security/security-audit.service.ts`
- Create: `apps/server/src/common/security/security.module.ts`
- Modify integration points: auth.service.ts, kb-permission.guard.ts, rate-limit.guard.ts

**Design:**

```typescript
@Injectable()
export class SecurityAuditService {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {}

  logLoginFailure(email: string, reason: string, context?: Record<string, unknown>) {
    this.logger.warn('[SECURITY] Login failure', { event: 'LOGIN_FAILURE', email, reason, ...context });
  }

  logPermissionDenied(userId: string, resource: string, action: string) {
    this.logger.warn('[SECURITY] Permission denied', { event: 'PERMISSION_DENIED', userId, resource, action });
  }

  logTokenReplay(userId: string, sessionId: string) {
    this.logger.warn('[SECURITY] Token replay detected', { event: 'TOKEN_REPLAY', userId, sessionId });
  }

  logRateLimitExceeded(userId: string, endpoint: string) {
    this.logger.warn('[SECURITY] Rate limit exceeded', { event: 'RATE_LIMIT_EXCEEDED', userId, endpoint });
  }
}
```

No database table. Pure Winston structured logs. Can be shipped to ELK/Grafana Loki later.

Integration points:
- `AuthService.login()` catch block → `logLoginFailure()`
- `KbPermissionGuard` catch block → `logPermissionDenied()`
- `AuthService.refreshToken()` replay detection → `logTokenReplay()`
- `RateLimitGuard` when exceeding limit → `logRateLimitExceeded()`

---

## Fix #11: Validation Pipe `abortEarly: false`

**Severity:** UX — users see only first validation error

**File:** `apps/server/src/main.ts:41`

**Problem:** `abortEarly` defaults to `true`. Only first validation error returned.

**Fix:** Add `abortEarly: false`:
```typescript
new ValidationPipe({
  transform: true,
  whitelist: true,
  abortEarly: false,  // collect all errors
  exceptionFactory: (errors: ValidationError[]) => {
    return new BusinessException(ErrorCode.PARAM_ERROR, formatValidationErrors(errors));
  },
}),
```

`formatValidationErrors` already iterates all errors, so no other changes needed.

---

## Deployment Notes

1. **New required env vars:** `ENCRYPTION_KEY`, `TRANSMISSION_SECRET`, `CORS_ORIGINS`, `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`
2. **Breaking:** All existing JWT tokens and sessions become invalid after deployment
3. **Breaking:** All existing encrypted API keys in `b_user_model_configs` were encrypted with the old fallback key — if `ENCRYPTION_KEY` changes, those keys cannot be decrypted. Users must re-enter API keys.
4. **Migration path:** Deploy with `ENCRYPTION_KEY` set to the old fallback `'linsor-default-encryption-key'` temporarily, then rotate to a real key in a subsequent release with a user prompt to re-enter API keys.
