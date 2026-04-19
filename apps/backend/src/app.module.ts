import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '@common/prisma/prisma.module';
import { winstonConfig } from '@common/config/winston.config';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from '@common/filter/all-exceptions.filter';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { KbMemberModule } from './modules/kb-member/kb-member.module';
import { DocumentModule } from './modules/document/document.module';
import { ChatModule } from './modules/chat/chat.module';
import { AiModelModule } from './modules/ai-model/ai-model.module';
import { DictModule } from './modules/dict/dict.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory(configService: ConfigService) {
        return {
          secret: configService.get<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: '30m', // 默认 30 分钟
          },
        };
      },
      inject: [ConfigService],
    }),
    PrismaModule,
    WinstonModule.forRoot(winstonConfig),
    AuthModule,
    UserModule,
    KnowledgeBaseModule,
    KbMemberModule,
    DocumentModule,
    ChatModule,
    AiModelModule,
    DictModule,
  ],
  controllers: [AppController],
  providers: [AppService, ResponseInterceptor, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
