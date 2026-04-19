## 一、整体设计概览

后端公共层主要分为几部分：

- 日志与配置：
  - config/winston.config.ts
  - config/env.validation.ts
- 统一响应： interceptors/response.interceptor.ts + utils/result.ts
- 统一日志拦截： interceptors/logging.interceptor.ts
- 请求链路追踪： utils/requestId.ts
- 统一异常与错误码：
  - exception/businessException.ts
  - filter/all-exceptions.filter.ts
  - utils/errorCodeMap.ts / errorMessageMap.ts / errorCodeHttpMap.ts
  - utils/formatValidationErrors.ts
- 鉴权与用户注入：
  - decorators/auth.decorator.ts
  - decorators/currentUser.decorator.ts
  - guards/auth.guard.ts
- 数据库访问： prisma/prisma.module.ts + prisma.service.ts （通过 @common/prisma/prisma.service 注入各模块）

## 二、日志体系

### 2.1 Winston 日志配置

文件： winston.config.ts

- 使用 nest-winston 集成 winston ，提供统一日志格式和输出目标。
- 配置要点：
  - level: 'info' ：默认日志级别，从 info 起记录。
  - 格式（ format ）：
    - 时间戳： YYYY-MM-DD HH:mm:ss
    - 错误堆栈
    - JSON 输出（结构化日志，便于检索）
  - 输出目标（ transports ）：
    - Console：带 Nest 风格的 pretty print
    - DailyRotateFile： `logs/%DATE%/app-info.log` （info 级别）
    - DailyRotateFile： `logs/%DATE%/app-error.log` （error 级别）
- 日志切分策略：
  - 按天切分：`datePattern: 'YYYY-MM-DD'`
  - 单文件最大：`20m`
  - 最多保留：`14d`
  - 不压缩归档：`zippedArchive: false`
    在 AppModule 中通过 WinstonModule.forRoot(winstonConfig) 注册后，可以在任意地方使用 WINSTON_MODULE_PROVIDER 注入 Logger 。

### 2.2 requestId 请求链路追踪

文件： `utils/requestId.ts` 、 `main.ts` 、 `logging.interceptor.ts` 、 `all-exceptions.filter.ts`

- 目标：为每个 HTTP 请求分配一个唯一标识，串联入口日志、异常日志以及后续业务日志。
- 实现方式：
  - 优先复用上游透传的 `x-request-id`
  - 若上游未提供，则由服务端通过 `randomUUID()` 生成
  - 将 `requestId` 挂到 `request` 对象上
  - 同时写回响应头 `x-request-id`
- `main.ts` 中通过全局中间件在请求入口执行绑定：

```
app.use((request, response, next) => {
  bindRequestId(request, response);
  next();
});
```

- 日志拦截器与异常过滤器均通过 `getRequestId(request)` 读取并输出该值。

## 三、配置管理

### 3.1 ConfigModule + 环境变量校验

文件： `app.module.ts` 、 `config/env.validation.ts`

- 使用 `@nestjs/config` 作为全局配置模块，统一读取 `.env`
- 使用 `Joi` 对关键环境变量进行启动期校验，避免服务启动后才暴露配置问题
- 当前已纳入校验的配置项包括：
  - `PORT`
  - `NODE_ENV`
  - `DATABASE_URL`
  - `QDRANT_URL`
  - `JWT_SECRET`
  - `JWT_EXPIRES_IN`
  - `REDIS_URL`
  - `REDIS_PASSWORD`

配置模块的价值：

- 统一管理端口、数据库、向量库、Redis、JWT 等配置
- 配置缺失时在启动阶段直接失败，降低运行期隐患
- 为后续拆分多环境（development / test / production）提供基础

## 四、统一响应结构

### 3.1 Result 包装类

文件： result.ts

```
export class Result<T = any> {
  readonly success: boolean;
  readonly code: number;
  readonly message: string;
  readonly data?: T;

  // 成功
  static success<T>(data: T): Result<T> {
    return new Result(true, 0, 'success', data);
  }

  // 失败
  static error(code: ErrorCode, message?: string): 
  Result<never> {
    return new Result(
      false,
      code,
      message ?? ErrorMessageMap[code] ?? 'error',
    );
  }
}
```

- 返回结构统一为：
  - 成功： { success: true, code: 0, message: 'success', data: ... }
  - 失败： { success: false, code: ErrorCode, message: string }

### 3.2 ResponseInterceptor：自动包装成功结果

文件： response.interceptor.ts

- 类型： NestInterceptor
- 作用：拦截所有控制器返回值，自动用 Result.success 包装。
  核心逻辑：

```
return next.handle().pipe(
  map((data) => Result.success(data)),
);
```

使用规范：

- Controller 里直接 return { ... } 或 return someServiceCall() 即可，不要手动包 Result.success 。
- 任何正常返回都会被包装为统一结构。

## 五、统一异常与错误码体系

### 4.1 错误码枚举

文件： errorCodeMap.ts

- ErrorCode 使用数值型枚举，按模块分段：
  - 公共：40000+ / 50000+
    - PARAM_ERROR , UNAUTHORIZED , INTERNAL_ERROR 等
  - 知识库：41xxx
  - 文件：42xxx
  - 会话：43xxx
  - 消息：44xxx
  - 向量/RAG：45xxx
  - 邮件：46xxx（如 EMAIL_CODE_INVALID , EMAIL_RATE_LIMIT ）
  - 认证：47xxx（如 AUTH_INVALID_CREDENTIALS , AUTH_INVALID_REFRESH_TOKEN ）
    新增业务错误时，应在这里添加对应枚举项。

### 4.2 默认错误文案

文件： errorMessageMap.ts

- ErrorMessageMap: Record<ErrorCode, string> 为每个错误码给出默认消息，统一使用中文文案。
- BusinessException 不传 message 时，会从这里取默认文案。

### 4.3 错误码到 HTTP 状态码映射

文件： errorCodeHttpMap.ts

- ErrorCodeHttpStatusMap: Record<ErrorCode, HttpStatus> 定义每个业务错误对应的 HTTP 状态码。
  - 例：
    - UNAUTHORIZED → 401
    - FORBIDDEN → 403
    - FILE_NOT_FOUND → 404
    - EMAIL_RATE_LIMIT → 429
    - INTERNAL_ERROR / 邮件发送失败等 → 500

### 4.4 BusinessException：业务异常类型

文件： businessException.ts

```
export class BusinessException extends 
HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string, 
  httpStatus?: HttpStatus) {
    super(
      {
        code,
        message: message ?? ErrorMessageMap[code],
      },
      httpStatus ?? ErrorCodeHttpStatusMap
      [code] ?? HttpStatus.BAD_REQUEST,
    );
    this.code = code;
  }
}
```

使用方式：

- 在业务代码中统一用 throw new BusinessException(ErrorCode.XXX) 抛业务错误。
- 如需覆盖默认文案或 HTTP 状态码，可传入可选的 message 、 httpStatus 。

### 4.5 AllExceptionsFilter：统一异常出口

文件： all-exceptions.filter.ts

- 类型： @Catch() ，捕获所有异常，实现统一返回和日志记录。
  处理流程：

1. BusinessException
   - 通过 instanceof BusinessException 判断。
   - 从 exception.getResponse() 中拿 { code, message } 。
   - 记录结构化 warn 日志，包含：
     - `requestId`
     - `method`
     - `url`
     - `ip`
     - `code`
     - `message`
   - 返回：
     ```
     response
       .status(exception.getStatus())
       .json(Result.error(res.code, res.message));
     ```

2. HttpException （如参数校验错误、框架内置异常）
   - 提取 status、message（兼容 string / object / message[] 三种情况）。
   - 使用 `mapHttpStatusToErrorCode()` 将 HTTP 状态码映射为统一业务错误码：
     - 400 → `PARAM_ERROR`
     - 401 → `UNAUTHORIZED`
     - 403 → `FORBIDDEN`
     - 404 → `NOT_FOUND`
     - 503 → `SERVICE_UNAVAILABLE`
     - 5xx → `INTERNAL_ERROR`
   - 4xx 记录为 `warn`，5xx 记录为 `error`
   - 日志中同样附带 `requestId`
   - 返回：
     ```
     response
       .status(status)
       .json(Result.error(errorCode, message));
     ```

3. 未知异常
   - 提取安全错误消息，兼容 `Error`、字符串、普通对象等异常输入
   - 记录结构化 error 日志和堆栈
   - 返回 500，错误码 INTERNAL_ERROR + 文案“服务器内部错误”。

### 4.6 参数校验错误统一处理

文件： `main.ts` 、 `utils/formatValidationErrors.ts`

- 应用启动时在 `ValidationPipe` 中配置了自定义 `exceptionFactory`
- 当 DTO / class-validator 校验失败时：
  - 递归提取所有约束错误消息
  - 使用中文分号 `；` 拼接为单条可读提示
  - 最终统一转换为 `BusinessException(ErrorCode.PARAM_ERROR, message)`

示例：

```
new ValidationPipe({
  transform: true,
  whitelist: true,
  exceptionFactory: (errors: ValidationError[]) => {
    return new BusinessException(
      ErrorCode.PARAM_ERROR,
      formatValidationErrors(errors),
    );
  },
})
```

这样前端拿到的参数错误响应将保持统一结构，例如：

```
{
  "success": false,
  "code": 40000,
  "message": "用户名不能为空；密码长度不能小于 6 位"
}
```

开发规范：

- 自己抛业务错误时：使用 BusinessException + ErrorCode 。
- 不要在 Controller 手动 catch 后自己返回 Response；交给全局异常过滤器统一处理。

## 六、鉴权体系（登录拦截 + 注解）

### 5.1 Auth 装饰器：标记需要鉴权的接口

文件： auth.decorator.ts

```
export const AUTH_KEY = 'needAuth';
export const Auth = () => SetMetadata(AUTH_KEY, 
true);
```

- 通过 @Auth() 为路由 handler 打上 needAuth = true 的 metadata。
- AuthGuard 会读取这个 metadata 决定是否执行鉴权逻辑。
  使用示例（Controller）：

```
@UseGuards(AuthGuard)
@Controller('xxx')
export class XxxController {
  @Get()
  @Auth()
  list() { ... }
}
```

### 5.2 CurrentUser 装饰器：注入当前登录用户

文件： currentUser.decorator.ts

```
export const CurrentUser = createParamDecorator(
  <K extends keyof JwtUser>(
    key: K,
    ctx: ExecutionContext,
  ): JwtUser[K] | JwtUser => {
    const request = ctx.switchToHttp().
    getRequest<Request>();
    const user = request.user as JwtUser;
    return key ? user[key] : user;
  },
);
```

- JwtUser 定义在 modules/auth/interface/jwtUser.ts （目前包含 sub / username / isAdmin 等）。
- 使用方式（推荐统一使用 sub 字段作为用户 id）：

  ```
  import { CurrentUser } from '@common/decorators/
  currentUser.decorator';

  @Get('me')
  getProfile(@CurrentUser('sub') userId: string) {
    // userId 即 JWT 中的 sub
  }
  ```

### 5.3 AuthGuard：JWT 校验 + 登录拦截

文件： auth.guard.ts

核心流程：

1. 使用 Reflector 读取当前 handler 上是否有 AUTH_KEY ：

   ```
   const needAuth = this.reflector.get<boolean>
   (AUTH_KEY, context.getHandler());
   if (!needAuth) return true; // 未标记 Auth() 的接
   口直接放行
   ```

2. 读取请求头 Authorization ：

   ```
   const authHeader = request.headers
   ['authorization'];
   if (!authHeader) {
     throw new BusinessException(ErrorCode.
     UNAUTHORIZED);
   }
   ```

3. 去掉 Bearer 前缀，使用 JwtService.verify 校验 token：

   ```
   const token = authHeader.replace('Bearer ', '');
   try {
     const user = this.jwtService.verify<JwtUser>
     (token);
     request.user = user;
     return true;
   } catch (e) {
     throw new BusinessException(ErrorCode.
     UNAUTHORIZED_EXPIRED);
   }
   ```

- 成功：将解出来的 JwtUser 挂到 request.user 上，供 CurrentUser 使用。
- 失败：抛出 UNAUTHORIZED 或 UNAUTHORIZED_EXPIRED ，交由异常过滤器统一返回。
  使用建议：

- 在需要保护的模块 Controller 上统一加 @UseGuards(AuthGuard) ，然后用 @Auth() 标记具体需要登录的接口。
- 对于完全公开接口，可以不加 @Auth() ，守卫会自动跳过。

## 七、Prisma & 数据库访问

### 6.1 PrismaModule 与 PrismaService

文件：

- prisma.module.ts
- prisma.service.ts
  要点：

- @Global() 模块，整个应用中只需引入一次 PrismaModule 即可（在 AppModule 中）。
- PrismaService 继承自 PrismaClient ，配置了 PrismaMariaDb 适配器，从环境变量读取数据库配置。
- 各业务模块可通过：

  ```
  import { PrismaService } from '@common/prisma/
  prisma.service';

  constructor(private readonly prisma: 
  PrismaService) {}
  ```

  即可访问数据库表，如 prisma.sys_users 、 prisma.user_sessions 、 prisma.email_verification_codes 等。

## 八、日志拦截器

### 7.1 LoggingInterceptor：记录每个请求耗时

文件： logging.interceptor.ts

- 使用 Winston 记录每一个 HTTP 请求的：
  - 请求标识：`requestId`
  - 方法：method
  - 路径：url
  - 请求体：body
  - 耗时：durationMs
    核心逻辑：

```
const start = Date.now();
return next.handle().pipe(
  tap(() => {
    const time = Date.now() - start;
    this.logger.info('[RequestCompleted]', {
      requestId,
      method,
      url,
      durationMs: time,
      body,
    });
  }),
);
```

该拦截器一般在全局注册，开发者不需要在每个 Controller 手动使用。

## 九、开发实践建议

在实现新接口时，建议遵循以下模式：

1. 鉴权与用户信息
   - 需要登录的接口：
     - 在 Controller 上添加 @UseGuards(AuthGuard)
     - 在方法上添加 @Auth()
     - 使用 @CurrentUser('sub') 获取当前用户 ID
   - 完全公开接口：不加 @Auth() 即可。

2. 返回值
   - 服务层返回业务结构即可，Controller 直接 return 。
   - 无需手动构造 Result ，统一交给 ResponseInterceptor 。

3. 错误处理
   - 遇到业务错误，统一使用：
     ```
     throw new BusinessException(ErrorCode.XXX);
     ```
   - 如需自定义提示文案：
     ```
     throw new BusinessException(ErrorCode.XXX, '自
     定义错误提示');
     ```

4. 新增业务错误
   - 在 errorCodeMap.ts 中新增 ErrorCode ；
   - 在 errorMessageMap.ts 中添加默认文案；
   - 在 errorCodeHttpMap.ts 中配置 HTTP 状态码；
   - 业务代码中通过 BusinessException 抛出。

5. 数据库访问
   - 服务层通过注入 PrismaService 操作表，命名上优先对齐 schema.prisma 模型名。

6. 日志追踪
   - 需要串联同一次请求的日志时，统一使用 `requestId`
   - 网关或前端可主动透传 `x-request-id`
   - 若未透传，服务端会自动生成并回写到响应头
