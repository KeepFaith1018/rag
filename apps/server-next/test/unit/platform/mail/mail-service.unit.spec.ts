import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '@platform/config/environment';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { MailService } from '@platform/mail/mail.service';

describe('optional mail adapter', () => {
  it('does not pretend to send when SMTP is disabled', async () => {
    const config = new RuntimeConfig(
      new ConfigService(
        validateEnvironment({
          DATABASE_URL: 'mysql://test:test@localhost/rag_kb_next',
          REDIS_URL: 'redis://localhost:6379',
          JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
          VERIFICATION_CODE_SECRET:
            'test-verification-secret-with-at-least-32-chars',
        }),
      ),
    );
    const mail = new MailService(config);
    await expect(
      mail.send({ to: 'test@example.com', subject: 'test', text: 'test' }),
    ).rejects.toMatchObject({ code: 46004, kind: 'unavailable' });
    mail.onModuleDestroy();
  });
});
