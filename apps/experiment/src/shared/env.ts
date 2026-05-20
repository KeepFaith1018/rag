/**
 * 加载环境变量：
 * 1. 实验项目自身的 .env（优先级最高）
 * 2. apps/server/.env（回退）
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 先加载 server 基线的 .env，然后加载实验项目自身的 .env 覆盖
config({ path: resolve(__dirname, '../../../server/.env') });
config({ path: resolve(__dirname, '../../.env'), override: true });

export function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val === undefined || val === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`缺少环境变量: ${key}`);
  }
  return val;
}

export function envNumber(key: string, fallback?: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback ?? 0;
  const n = Number(val);
  return Number.isNaN(n) ? (fallback ?? 0) : n;
}

export function envBool(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
}
