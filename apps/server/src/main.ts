import { NestFactory } from '@nestjs/core';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { formatValidationErrors } from '@common/utils/formatValidationErrors';
import { bindRequestId } from '@common/utils/requestId';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filter/all-exceptions.filter';
import { NextFunction } from 'express';
import { Request, Response } from 'express';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // 为每个请求绑定 requestId，用于串联拦截器、过滤器和业务日志。
  app.use((request: Request, response: Response, next: NextFunction) => {
    bindRequestId(request, response);
    next();
  });

  // 跨域
  const corsOrigins = configService
    .get<string>('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  // 使用 Winston 作为全局 Logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  // 全局拦截器 (统一响应格式 + 日志)
  app.useGlobalInterceptors(
    app.get(ResponseInterceptor),
    app.get(LoggingInterceptor),
  );
  // 全局异常过滤器
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,

      exceptionFactory: (errors: ValidationError[]) => {
        // 将 class-validator 的原始错误统一转换为业务异常，避免前端收到杂乱结构。
        return new BusinessException(
          ErrorCode.PARAM_ERROR,
          formatValidationErrors(errors),
        );
      },
    }),
  );
  // 全局前缀
  app.setGlobalPrefix('api');

  const port = configService.get<number>('PORT') || 3000;

  await app.listen(port);
}
void bootstrap();
