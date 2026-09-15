import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from './generated/client';

// pnpm --filter 从工作区根目录执行命令，显式定位本应用配置避免遗漏 DATABASE_URL。
config({ path: resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for seed');
const url = new URL(databaseUrl);
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionLimit: 2,
  }),
});

async function main() {
  const existing = await prisma.sys_model_configs.findMany({
    where: { type: 'embedding', is_default: true },
    select: { id: true },
  });
  if (existing.length === 0) {
    await prisma.sys_model_configs.create({
      data: {
        provider: 'bailian',
        model_name: 'text-embedding-v4',
        display_name: 'text-embedding-v4',
        type: 'embedding',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        config_json: {
          revision: 'stable',
          dimension: 1024,
          inputMode: 'document',
          normalization: { normalize: true },
          parameters: {},
        },
        is_default: true,
        is_active: true,
      },
    });
  }
}

main().finally(() => prisma.$disconnect());
