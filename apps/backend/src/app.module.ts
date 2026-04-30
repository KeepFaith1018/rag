import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { winstonConfig } from '@common/config/winston.config';
import { configValidationSchema } from '@common/config/env.validation';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from '@common/filter/all-exceptions.filter';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { DocumentModule } from './modules/document/document.module';
import { ChatModule } from './modules/chat/chat.module';
import { RagModule } from './modules/rag/rag.module';
import { EmailModule } from './modules/email/email.module';
import { ScheduleModule } from '@nestjs/schedule';

import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema: configValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_EXPIRES_IN'),
        signOptions: {
          expiresIn: '7d',
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    WinstonModule.forRoot(winstonConfig),
    AuthModule,
    UserModule,
    EmailModule,
    KnowledgeBaseModule,
    DocumentModule,
    ChatModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ResponseInterceptor,
    LoggingInterceptor,
    AllExceptionsFilter,
  ],
})
export class AppModule {}
