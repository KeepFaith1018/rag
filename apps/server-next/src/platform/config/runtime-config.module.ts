import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './environment';
import { RuntimeConfig } from './runtime-config.service';

/**
 * 全局运行时配置模块。
 *
 * 进程环境在模块初始化阶段完成一次性校验，业务模块只依赖 RuntimeConfig 暴露的结构化配置。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      validate: validateEnvironment,
      envFilePath: '.env',
    }),
  ],
  providers: [RuntimeConfig],
  exports: [RuntimeConfig],
})
export class RuntimeConfigModule {}
