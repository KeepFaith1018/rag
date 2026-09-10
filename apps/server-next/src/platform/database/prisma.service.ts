import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../../prisma/generated/client';
import { RuntimeConfig } from '../config/runtime-config.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: RuntimeConfig) {
    const url = new URL(config.databaseUrl);
    super({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.slice(1),
        connectionLimit: 5,
        connectTimeout: 3000,
        acquireTimeout: 3000,
      }),
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  /**
   * 数据库健康检测
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1 FROM b_users LIMIT 1`;
  }
}
