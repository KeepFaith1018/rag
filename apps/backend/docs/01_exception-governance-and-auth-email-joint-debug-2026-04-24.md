# 后端异常治理与认证邮件联调总结

## 背景

本次修改围绕认证链路、邮件验证码链路以及异常治理展开，目标是解决以下几个实际问题：

1. 前端请求后端认证接口时未命中 `/api` 前缀，导致登录接口返回 `404`
2. 后端业务代码统一抛出 `BusinessException` 后，底层系统异常根因被吞掉，日志无法直接定位真实问题
3. 认证和邮件发送联调过程中，先后暴露出数据库连接池超时、SMTP 连接超时、SMTP 发件人地址校验失败等问题

## 本次完成的工作

### 1. 前后端认证接口联调修复

- 将前端 API 基础地址统一修正为 `http://localhost:3000/api`
- 修复前端调用 `/auth/login`、`/auth/refresh` 时缺少 `/api` 前缀的问题
- 避免认证请求误打到 `/auth/login`，从而触发 Nest 全局前缀下的 `404`

### 2. 统一异常模型增强

对 `apps/backend/src/common/exception/businessException.ts` 做了增强，保留原有统一错误码模型的同时，引入以下能力：

- `cause`：保留底层原始异常对象
- `context`：记录模块、动作、关键业务参数
- `logLevel`：支持区分 `warn` / `error`
- 兼容旧调用方式：保留 `new BusinessException(code)` 和 `new BusinessException(code, message)` 的使用方式
- 新增 `wrapBusinessException()`，用于把未知异常统一包装成业务异常，并自动带上 `cause`

这样处理后，系统既能保持统一的对外错误响应结构，也不会丢失内部排障所需的根因信息。

### 3. 全局异常过滤器增强

对 `apps/backend/src/common/filter/all-exceptions.filter.ts` 做了增强：

- 对 `BusinessException` 统一输出结构化日志
- 日志中补充：
  - `status`
  - `code`
  - `message`
  - `context`
  - `stack`
  - `causeMessage`
  - `causeStack`
- 对日志附加字段做安全序列化，避免 `BigInt` 等值导致序列化失败
- 修复了 `#problems_and_diagnostics` 中与 `HttpException.cause` 继承、`JSON.parse` 返回 `any`、对象字符串化相关的类型与 ESLint 问题

经过改造后，业务异常、系统异常和未知异常都能在统一出口完成日志收口。

### 4. 认证模块异常改造

对 `apps/backend/src/modules/auth/auth.service.ts` 做了异常包装治理：

- `sendVerificationCode`
- `register`
- `login`
- `refreshToken`
- `me`

这些方法现在在出现数据库、JWT、邮件、下游服务等系统异常时，会统一走 `wrapBusinessException()`，并保留上下文信息，例如：

- `module: 'AuthService'`
- `action: 'login'`
- `action: 'refreshToken.verify'`
- `email`
- `userId`

这样即使前端只收到统一错误码，后端日志仍然能直接定位是认证的哪一步出错。

### 5. 邮件模块异常改造

对 `apps/backend/src/modules/email/email.service.ts` 做了重点改造：

- 验证码入库失败时，包装为 `EMAIL_CODE_PROCESS_FAILED`
- 邮件发送失败时，包装为 `EMAIL_SEND_FAILED`
- 整个验证码发送流程增加上下文记录：
  - `module: 'EmailService'`
  - `action: 'saveVerificationCode'`
  - `action: 'sendVerificationCode'`
  - `action: 'sendVerificationCodeFlow'`
  - `email`
  - `purpose`

这解决了原本 `catch (error) { throw new BusinessException(...) }` 直接丢失原始异常的问题。

### 6. 用户模块异常改造

对 `apps/backend/src/modules/user/user.service.ts` 做了同样的异常包装治理，覆盖以下能力：

- 创建用户
- 更新资料
- 修改密码
- 重置密码

系统内部错误会自动附带用户维度上下文，方便日志追踪与后续审计。

## 联调过程中定位出的真实问题

本次改造后，日志能力已经能够完整暴露认证和邮件链路的真实根因。联调中实际识别出了以下问题：

### 1. 认证接口 404

根因：

- 后端启用了 `app.setGlobalPrefix('api')`
- 前端请求地址最初未带 `/api`

修复结果：

- 前端 API 地址已统一改为 `http://localhost:3000/api`

### 2. 数据库连接池超时

典型报错：

- `pool timeout: failed to retrieve a connection from pool after 10010ms`

说明：

- 后端在登录链路访问数据库时，未能在连接池中获取有效连接
- 该问题通常与数据库配置不一致、数据库不可达、连接资源不足有关

### 3. SMTP 连接超时

典型报错：

- `connect ETIMEDOUT 58.254.165.67:456`

说明：

- 邮件服务在网络连接阶段就失败
- 这通常与 SMTP 端口错误、网络不可达或防火墙拦截有关

### 4. SMTP 发件人地址与认证账号不一致

典型报错：

- `501 Mail from address must be same as authorization user.`

说明：

- SMTP 认证已通过
- 但邮件 `from` 地址与 `EMAIL_USER` 对应的授权账号不一致
- 服务商拒绝发信

修复方向：

- 将 `EMAIL_FROM` 与实际授权邮箱保持一致
- 同时保留代码中的合理兜底值，避免默认发件人地址与授权邮箱不一致

## 当前实现效果

完成本次改造后，系统具备以下能力：

- 前端认证接口可正确命中后端 `/api` 前缀
- 后端统一异常响应结构不变
- 业务异常不再吞掉原始系统异常
- 日志能够看到原始根因、错误堆栈和业务上下文
- 邮件发送失败时，能够快速分辨是：
  - 配置问题
  - 网络问题
  - SMTP 协议问题
  - 发件人账号问题

## 后续建议

建议继续将同样的异常治理策略扩展到以下模块：

1. Prisma / 数据访问层
2. Redis / 向量库 / 外部模型调用
3. 文件上传与文档解析链路
4. Guard / Interceptor / 定时任务等基础设施层

统一规则建议如下：

1. 纯业务校验错误可直接抛 `BusinessException`
2. 系统依赖调用失败必须通过 `wrapBusinessException()` 保留 `cause`
3. 所有包装异常都应附带 `context`
4. `4xx` 业务异常默认记 `warn`，`5xx` 系统异常默认记 `error`

## 涉及文件

- `apps/backend/src/common/exception/businessException.ts`
- `apps/backend/src/common/filter/all-exceptions.filter.ts`
- `apps/backend/src/modules/auth/auth.service.ts`
- `apps/backend/src/modules/email/email.service.ts`
- `apps/backend/src/modules/user/user.service.ts`
- `apps/frontend/src/api/api.ts`
- `apps/frontend/.env`
