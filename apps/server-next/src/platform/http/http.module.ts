import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ObservabilityModule } from '../observability/observability.module';
import { AllExceptionsFilter } from './exception.filter';
import { ResponseInterceptor } from './response.interceptor';
import { RequestContextMiddleware } from './request-context.middleware';
import { createValidationPipe } from './validation.pipe';

/**
 * HTTP 边界基础模块。
 *
 * 通过 Nest 全局 Provider 注册异常过滤器、成功响应拦截器和参数校验管道，确保业务
 * Controller 无需重复装配。请求上下文中间件覆盖全部路由，用于建立 requestId 和访问日志。
 */
@Module({
  imports: [ObservabilityModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class HttpModule implements NestModule {
  /**
   * `{*path}` 同时覆盖根路径和任意子路径，使健康检查、业务 API 及不存在的路由都能
   * 获得一致的 requestId 响应头和请求完成日志。
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
