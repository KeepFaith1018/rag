# 后端基础设施与开发参考

本文档用于说明当前后端项目已经具备的基础建设、公共能力以及编写业务代码时的统一约定。目标不是只描述“有哪些文件”，而是帮助开发者在新增模块、接口、异常处理、认证逻辑、邮件能力时，能够按同一套规则实现，保证响应结构、日志结构和排障方式一致。

## 一、文档适用范围

当前后端采用 `Nest.js + Prisma + Winston + JWT` 架构，项目位于 `apps/backend`。

本文档主要覆盖：

- 启动期基础设施
- 配置与日志体系
- 请求链路追踪
- 统一响应与异常治理
- 鉴权与用户注入
- 数据访问、认证、邮件相关基础能力
- 后端日常开发规范与联调排障经验

## 二、后端基础建设总览

当前后端公共层的核心能力包括：

- 配置管理：
  - `src/common/config/env.validation.ts`
- 日志配置：
  - `src/common/config/winston.config.ts`
- 统一成功响应：
  - `src/common/interceptors/response.interceptor.ts`
  - `src/common/utils/result.ts`
- 请求日志与链路追踪：
  - `src/common/interceptors/logging.interceptor.ts`
  - `src/common/utils/requestId.ts`
- 统一异常治理：
  - `src/common/exception/businessException.ts`
  - `src/common/filter/all-exceptions.filter.ts`
  - `src/common/utils/errorCodeMap.ts`
  - `src/common/utils/errorMessageMap.ts`
  - `src/common/utils/errorCodeHttpMap.ts`
  - `src/common/utils/formatValidationErrors.ts`
- 鉴权与当前用户注入：
  - `src/common/decorators/auth.decorator.ts`
  - `src/common/decorators/currentUser.decorator.ts`
  - `src/common/guards/auth.guard.ts`
- 数据库访问：
  - `src/common/prisma/prisma.module.ts`
  - `src/common/prisma/prisma.service.ts`
- 启动入口与全局注册：
  - `src/main.ts`

## 三、启动期基础设施

文件：`src/main.ts`

应用启动时已经统一完成以下注册：

- 为每个请求绑定 `requestId`
- 启用 CORS
- 注册 Winston 作为全局日志实现
- 注册全局响应拦截器 `ResponseInterceptor`
- 注册全局请求日志拦截器 `LoggingInterceptor`
- 注册全局异常过滤器 `AllExceptionsFilter`
- 注册全局参数校验管道 `ValidationPipe`
- 设置全局接口前缀 `app.setGlobalPrefix('api')`

启动主流程示意：

```ts
app.use((request, response, next) => {
  bindRequestId(request, response);
  next();
});

app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
app.useGlobalInterceptors(
  app.get(ResponseInterceptor),
  app.get(LoggingInterceptor),
);
app.useGlobalFilters(app.get(AllExceptionsFilter));
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    exceptionFactory: (errors: ValidationError[]) => {
      return new BusinessException(
        ErrorCode.PARAM_ERROR,
        formatValidationErrors(errors),
      );
    },
  }),
);
app.setGlobalPrefix("api");
```

开发注意事项：

- 所有 HTTP 接口最终访问路径都带 `/api` 前缀
- 前端或网关联调时，基础地址必须与全局前缀保持一致
- Controller 不要自行拼装通用响应结构，也不要自行吞掉异常

## 四、配置管理

### 4.1 ConfigModule 与环境变量校验

文件：`src/common/config/env.validation.ts`

项目通过 `Joi` 对关键环境变量进行启动期校验，避免服务启动后才暴露配置问题。当前已纳入校验的字段包括：

- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `QDRANT_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `REDIS_URL`
- `REDIS_PASSWORD`

价值：

- 配置缺失时在启动阶段快速失败
- 降低运行期隐患
- 为不同环境配置提供统一入口

说明：

- 邮件配置当前由 `EmailService` 在运行时读取和校验，未纳入此处的启动期必填校验
- 这意味着邮件能力配置不完整时，服务可以启动，但调用邮件功能时会抛出 `EMAIL_CONFIG_INVALID`

### 4.2 配置开发建议

- 新增公共配置时，优先补充到环境变量校验中
- 只有确实允许“能力延迟失败”的场景，才放在业务模块运行时校验
- 不要在业务代码里散落硬编码配置值

## 五、日志体系

### 5.1 Winston 日志配置

文件：`src/common/config/winston.config.ts`

项目使用 `nest-winston` 集成 `winston`，统一日志格式与输出目标。

当前配置要点：

- 默认日志级别：`info`
- 统一包含：
  - 时间戳
  - 错误堆栈
  - JSON 结构化内容
- 输出目标：
  - Console
  - `logs/%DATE%/app-info.log`
  - `logs/%DATE%/app-error.log`
- 切分策略：
  - 按天切分
  - 单文件最大 `20m`
  - 最多保留 `14d`

### 5.2 requestId 请求链路追踪

文件：`src/common/utils/requestId.ts`

每个 HTTP 请求都会带上唯一 `requestId`，用于串联：

- 请求入口日志
- 异常日志
- 业务过程日志
- 网关与前端联调排障

实现规则：

- 优先复用上游透传的 `x-request-id`
- 若没有透传，则服务端自动生成 UUID
- 将值挂到 `request.requestId`
- 同时写回响应头 `x-request-id`

示例：

```ts
export function bindRequestId(request: Request, response: Response): string {
  const incomingRequestId = request.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incomingRequestId === "string" && incomingRequestId.trim()
      ? incomingRequestId.trim()
      : randomUUID();

  (request as RequestWithRequestId).requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  return requestId;
}
```

开发建议：

- 业务日志中如需排查单次请求，优先输出 `requestId`
- 网关、前端、测试工具建议透传 `x-request-id`

### 5.3 请求日志拦截

文件：`src/common/interceptors/logging.interceptor.ts`

`LoggingInterceptor` 会统一记录每个请求的基础信息：

- `requestId`
- `method`
- `url`
- `body`
- `durationMs`

核心逻辑：

```ts
return next.handle().pipe(
  tap(() => {
    const time = Date.now() - start;
    this.logger.info("[RequestCompleted]", {
      requestId,
      method,
      url,
      durationMs: time,
      body,
    });
  }),
);
```

开发建议：

- 不需要在每个 Controller 手动记录通用请求日志
- 只在关键业务步骤补充额外业务日志

## 六、统一响应结构

### 6.1 Result 返回模型

文件：`src/common/utils/result.ts`

后端对外统一响应结构如下：

- 成功：

```json
{
  "success": true,
  "code": 0,
  "message": "success",
  "data": {}
}
```

- 失败：

```json
{
  "success": false,
  "code": 40000,
  "message": "错误信息"
}
```

### 6.2 ResponseInterceptor 自动包装成功结果

文件：`src/common/interceptors/response.interceptor.ts`

所有正常返回值都会被自动包装为 `Result.success(data)`，因此：

- Controller 中直接返回业务数据即可
- 不要手动 `return Result.success(...)`
- 不要手动构造 `{ success: true }` 之类的结构

示例：

```ts
return next.handle().pipe(map((data) => Result.success(data)));
```

## 七、统一异常治理

### 7.1 设计目标

异常治理需要同时满足两件事：

- 对前端保持稳定、统一的错误码与响应结构
- 对后端保留真实根因、堆栈与上下文，便于排障

本次异常治理的核心结论是：

- 不能只保留统一业务错误码，而吞掉底层系统异常
- 所有系统调用失败都应该在统一模型下保留 `cause`

### 7.2 错误码体系

文件：

- `src/common/utils/errorCodeMap.ts`
- `src/common/utils/errorMessageMap.ts`
- `src/common/utils/errorCodeHttpMap.ts`

规则：

- `ErrorCode` 负责统一错误码枚举
- `ErrorMessageMap` 负责默认错误文案
- `ErrorCodeHttpStatusMap` 负责错误码到 HTTP 状态码映射

新增业务错误时，必须同步补齐这三处映射关系。

### 7.3 BusinessException 统一业务异常模型

文件：`src/common/exception/businessException.ts`

当前 `BusinessException` 在原有“错误码 + 文案 + HTTP 状态码”的基础上，新增了以下能力：

- `cause`：保留底层原始异常对象
- `context`：记录业务上下文
- `logLevel`：区分 `warn` 与 `error`
- 兼容旧调用方式：
  - `new BusinessException(code)`
  - `new BusinessException(code, message)`
- 提供 `wrapBusinessException()` 用于统一包装未知异常

示例：

```ts
throw new BusinessException(ErrorCode.AUTH_USER_EXISTS);

throw new BusinessException(ErrorCode.EMAIL_SEND_FAILED, {
  context: {
    module: "EmailService",
    action: "sendVerificationCode",
    email,
    purpose,
  },
});
```

包装未知异常示例：

```ts
throw wrapBusinessException(error, ErrorCode.INTERNAL_ERROR, {
  context: {
    module: "AuthService",
    action: "login",
    email: loginDto.email,
  },
});
```

### 7.4 什么时候直接抛，什么时候包装

建议遵循以下规则：

1. 纯业务校验错误，直接抛 `BusinessException`
2. 数据库、JWT、Redis、外部接口、邮件发送等系统依赖失败，必须通过 `wrapBusinessException()` 包装
3. 包装异常时必须附带 `context`
4. `4xx` 类业务问题默认记为 `warn`
5. `5xx` 类系统问题默认记为 `error`

典型例子：

- 用户不存在
  - 这是业务判定，直接抛 `AUTH_USER_NOT_FOUND`
- 数据库连接超时
  - 这是系统问题，应该包装成统一业务异常，并保留真实 `cause`
- SMTP 发送失败
  - 这是系统问题，应该包装成 `EMAIL_SEND_FAILED`，并保留 `cause`

### 7.5 AllExceptionsFilter 统一异常出口

文件：`src/common/filter/all-exceptions.filter.ts`

全局异常过滤器统一处理三类异常：

1. `BusinessException`
2. `HttpException`
3. 未知异常

其中针对 `BusinessException`，当前日志会额外输出：

- `status`
- `code`
- `message`
- `context`
- `stack`
- `causeMessage`
- `causeStack`
- `cause`

并且会对日志字段做安全序列化，避免 `BigInt` 等值导致日志序列化失败。

返回给前端时，仍然保持统一错误结构，不直接暴露内部堆栈。

### 7.6 参数校验错误统一处理

文件：

- `src/main.ts`
- `src/common/utils/formatValidationErrors.ts`

DTO 校验失败时，系统会：

- 收集所有 `class-validator` 错误
- 拼接为可读中文提示
- 统一转换成 `BusinessException(ErrorCode.PARAM_ERROR, message)`

因此开发中：

- DTO 只负责声明规则
- Controller 不要手动捕获参数错误再改写响应

## 八、鉴权体系

### 8.1 Auth 装饰器

文件：`src/common/decorators/auth.decorator.ts`

`@Auth()` 用于标记当前接口需要登录鉴权，本质是写入 `needAuth` 元数据。

### 8.2 CurrentUser 装饰器

文件：`src/common/decorators/currentUser.decorator.ts`

`@CurrentUser()` 用于从 `request.user` 中读取当前登录用户信息。

推荐优先使用：

```ts
@CurrentUser('sub') userId: string
```

这样可以稳定拿到 JWT 中的用户主键。

### 8.3 AuthGuard

文件：`src/common/guards/auth.guard.ts`

核心流程：

1. 读取当前接口是否标记了 `@Auth()`
2. 若未标记，则直接放行
3. 读取 `Authorization` 请求头
4. 去掉 `Bearer ` 前缀
5. 使用 `JwtService.verify()` 校验 token
6. 成功后将用户信息挂到 `request.user`
7. 失败时抛出统一业务异常

开发约定：

- 需要登录的接口：
  - 在 Controller 上使用 `@UseGuards(AuthGuard)`
  - 在具体方法上使用 `@Auth()`
- 完全公开接口：
  - 不加 `@Auth()`

## 九、认证链路参考

文件：`src/modules/auth/auth.service.ts`

认证模块目前已完成系统异常包装治理，以下方法在出现下游异常时都会保留上下文与根因：

- `sendVerificationCode`
- `register`
- `login`
- `refreshToken`
- `me`

推荐上下文字段示例：

- `module: 'AuthService'`
- `action: 'login'`
- `action: 'refreshToken.verify'`
- `email`
- `userId`

开发时应遵循：

- 业务判定错误直接抛业务异常
- JWT 校验、会话表写入、邮件发送、数据库查询失败等系统问题统一包装
- 上下文要足够定位到具体动作，不要只写模块名

## 十、邮件与验证码链路参考

文件：`src/modules/email/email.service.ts`

邮件模块当前具备以下行为特征：

- 初始化时读取邮件配置
- 配置不完整时，不阻塞应用启动
- 真正调用邮件能力时，如发送器不可用，抛 `EMAIL_CONFIG_INVALID`
- 验证码写库失败时，包装为 `EMAIL_CODE_PROCESS_FAILED`
- 邮件发送失败时，包装为 `EMAIL_SEND_FAILED`

推荐上下文字段：

- `module: 'EmailService'`
- `action: 'saveVerificationCode'`
- `action: 'sendVerificationCode'`
- `action: 'sendVerificationCodeFlow'`
- `action: 'verifyCode'`
- `email`
- `purpose`

开发建议：

- 验证码链路至少分清“写库失败”和“发信失败”
- 不要在 `catch` 里直接 `throw new BusinessException(...)` 而丢失原始错误
- 邮件相关配置问题、网络问题、SMTP 协议问题应能在日志里区分

## 十一、用户模块开发参考

文件：`src/modules/user/user.service.ts`

用户模块已经按相同模式治理异常，覆盖：

- 创建用户
- 更新资料
- 修改密码
- 重置密码

开发建议：

- 返回给前端的用户信息统一通过 `buildUserProfile()` 组装
- 对外结构应稳定，不要在不同接口里返回不同命名的用户字段
- 涉及用户关键操作时，在日志上下文中补充 `userId` 或 `email`

## 十二、数据库访问约定

文件：

- `src/common/prisma/prisma.module.ts`
- `src/common/prisma/prisma.service.ts`

当前数据库访问约定如下：

- 统一通过注入 `PrismaService` 访问数据库
- 数据访问放在 Service 层，不放在 Controller 层
- 表模型命名优先对齐 Prisma schema
- 数据库异常属于系统异常，不能简单吞掉

示例：

```ts
constructor(private readonly prisma: PrismaService) {}
```

开发建议：

- Prisma 查询失败、连接超时、事务失败等都需要统一包装
- 如果后续扩展仓储层，也要延续相同异常治理规则

## 十三、新增后端接口的推荐写法

新增接口时，建议按以下顺序实现：

### 13.1 Controller 层

- 负责路由、DTO、鉴权标记和参数接收
- 正常情况直接 `return service.xxx()`
- 不手动包装 `Result`
- 不手动 `try/catch` 后返回自定义错误响应

### 13.2 Service 层

- 写核心业务逻辑
- 业务校验错误直接抛 `BusinessException`
- 系统调用错误统一通过 `wrapBusinessException()` 包装
- `context` 中至少写明：
  - `module`
  - `action`
  - 关键业务参数

### 13.3 DTO 层

- 使用 `class-validator` 声明参数规则
- 不在 DTO 中写业务逻辑
- 参数错误统一交给全局 `ValidationPipe`

### 13.4 返回值

- 返回纯业务数据
- 成功包装交给 `ResponseInterceptor`
- 失败包装交给 `AllExceptionsFilter`

## 十五、后续建设建议

建议继续将相同的异常治理与日志规范扩展到以下场景：

1. Prisma 更底层的数据访问封装
2. Redis、向量库、外部模型调用
3. 文件上传与文档解析链路
4. Guard、Interceptor、定时任务等基础设施层

统一原则不变：

1. 业务错误直接抛 `BusinessException`
2. 系统错误必须保留 `cause`
3. 所有包装异常都应附带 `context`
4. 对前端保持统一响应结构
5. 对后端日志保留足够的根因信息

## 十六、相关文件索引

- `apps/backend/src/main.ts`
- `apps/backend/src/common/config/env.validation.ts`
- `apps/backend/src/common/config/winston.config.ts`
- `apps/backend/src/common/utils/requestId.ts`
- `apps/backend/src/common/interceptors/logging.interceptor.ts`
- `apps/backend/src/common/interceptors/response.interceptor.ts`
- `apps/backend/src/common/utils/result.ts`
- `apps/backend/src/common/exception/businessException.ts`
- `apps/backend/src/common/filter/all-exceptions.filter.ts`
- `apps/backend/src/common/decorators/auth.decorator.ts`
- `apps/backend/src/common/decorators/currentUser.decorator.ts`
- `apps/backend/src/common/guards/auth.guard.ts`
- `apps/backend/src/modules/auth/auth.service.ts`
- `apps/backend/src/modules/email/email.service.ts`
- `apps/backend/src/modules/user/user.service.ts`
