import { createHmac } from 'node:crypto';
import type { VerificationPurpose } from '@app/modules/identity/dto/identity.dto';
import { PrismaService } from '@platform/database/prisma.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { TestRun } from './test-run';

export interface TestVerificationOptions {
  email: string;
  purpose: VerificationPurpose | number;
  code?: string;
  expiresInMs?: number;
}

/** 使用生产环境相同的 HMAC 规则写入验证码，不触碰 SMTP。 */
export async function createTestVerificationCode(
  db: PrismaService,
  config: RuntimeConfig,
  run: TestRun,
  options: TestVerificationOptions,
) {
  const email = options.email.trim().toLowerCase();
  const code = options.code ?? '123456';
  const purpose = Number(options.purpose);
  const codeHash = createHmac('sha256', config.identity.verificationSecret)
    .update(`${purpose}:${email}:${code}`)
    .digest('hex');
  await db.sys_email_codes.create({
    data: {
      email,
      purpose,
      code_hash: codeHash,
      expired_at: new Date(Date.now() + (options.expiresInMs ?? 60_000)),
    },
  });
  run.resources.emailAddresses.add(email);
  return { email, code, purpose };
}
