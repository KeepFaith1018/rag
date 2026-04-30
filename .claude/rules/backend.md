---
paths: ["apps/server/**/*"]
---

# Linsor AI 后端专项开发规则

你必须严格遵循项目已建立的基础设施（Winston, Prisma, BusinessException, Result<T>）进行代码编写。

## 1. 响应与异常处理 (核心规范)
- **禁止手动包装成功响应**: Controller 必须直接返回原始数据或 Promise，由 `ResponseInterceptor` 自动处理为 `Result.success(data)`。
- **业务错误抛出**: 必须使用 `throw new BusinessException(ErrorCode.XXX)`。
- **系统错误包装**: 数据库(Prisma)、外部调用(Redis, AI API)、邮件(SMTP)等系统级失败，**必须**使用 `wrapBusinessException(error, ErrorCode.XXX, { context: { module, action, ... } })` 进行包装，以保留原始 `cause` 和链路追踪。
- **参数校验**: DTO 必须配合 `class-validator`。校验失败逻辑已由 `main.ts` 中的 `ValidationPipe` 统一接管，禁止在 Controller 手动校验。

## 2. 日志与链路追踪 (Winston & RequestId)
- **上下文注入**: 记录日志或抛出包装异常时，必须包含 `context` 对象，至少声明 `module` 和 `action`。
- **RequestId**: 在 Service 间传递或记录重要业务日志时，确保 `requestId` 的存在（可从 Request 对象获取），以便链路追踪。
- **敏感数据**: 日志和异常上下文中严禁包含 `password`, `salt`, `token` 等敏感字段。

## 3. 鉴权与用户注入 (Auth & Guards)
- **登录保护**: 需要登录的接口必须同时使用 `@UseGuards(AuthGuard)` (类或方法级) 和 `@Auth()` (方法级)。
- **用户获取**: 统一使用 `@CurrentUser('sub') userId: string` 获取当前登录用户的 ID。
- **公开接口**: 不标记 `@Auth()` 的接口即视为公开。

## 4. 数据库访问 (Prisma)
- **注入方式**: 始终通过构造函数注入 `PrismaService`。
- **分层原则**: 数据库操作必须留在 Service 层。严禁在 Controller 中直接调用 `this.prisma`。
- **异常捕获**: Prisma 操作建议使用 `wrapBusinessException` 包装，防止底层数据库错误码直接泄露给前端，并保留 `cause` 堆栈。

## 5. 配置管理 (Config)
- **校验先行**: 关键环境变量必须在 `src/common/config/env.validation.ts` 中注册 Joi 校验。
- **读取规范**: 始终通过 `ConfigService` 读取配置，禁止直接使用 `process.env`。

## 6. 邮件与异步逻辑
- **延迟失败**: 邮件模块 (`EmailService`) 配置不全不应阻塞启动，但调用时需处理 `EMAIL_CONFIG_INVALID` 异常。
- **验证码逻辑**: 严格区分“写库失败” (`EMAIL_CODE_PROCESS_FAILED`) 与“发信失败” (`EMAIL_SEND_FAILED`)。

## 7. 代码生成检查清单 (Self-Check)
1. **Controller**: 是否去掉了多余的 `try-catch`？是否标记了 `@Auth()`？
2. **Service**: 系统调用是否使用了 `wrapBusinessException`？`context` 是否完整？
3. **DTO**: 是否使用了正确的 `class-validator` 装饰器？
4. **命名**: 接口路径是否符合 `/api/xxx` 规范（代码中不写 /api，由全局前缀注入）？