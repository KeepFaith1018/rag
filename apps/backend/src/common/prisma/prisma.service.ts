import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma-client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const port = process.env.DATABASE_PORT
      ? Number(process.env.DATABASE_PORT)
      : 3306;

    super({
      log:
        process.env.NODE_ENV === 'development' &&
        !process.env.DATABASE_URL_ACCELERATE
          ? [{ emit: 'event', level: 'query' }]
          : [],
      adapter: new PrismaMariaDb({
        host: process.env.DATABASE_HOST,
        port,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME,
        connectionLimit: 5,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
