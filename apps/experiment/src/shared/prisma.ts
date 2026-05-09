/**
 * Prisma 客户端（查用户、知识库等）。
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env, envNumber } from './env.js';

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      adapter: new PrismaMariaDb({
        host: env('DATABASE_HOST'),
        port: envNumber('DATABASE_PORT', 3306),
        user: env('DATABASE_USER'),
        password: env('DATABASE_PASSWORD'),
        database: env('DATABASE_NAME'),
        connectionLimit: 5,
      }),
    });
  }
  return _prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}
