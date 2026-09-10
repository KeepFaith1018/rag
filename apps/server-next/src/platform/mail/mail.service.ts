import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { RuntimeConfig } from '../config/runtime-config.service';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService implements OnModuleDestroy {
  private transport?: Transporter;
  constructor(private readonly config: RuntimeConfig) {}
  async send(message: MailMessage): Promise<void> {
    const settings = this.config.mail;
    if (!settings.enabled)
      throw new BusinessError(
        ErrorCode.MAIL_DISABLED,
        '邮件服务未启用',
        'unavailable',
      );
    this.transport ??= createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      auth: { user: settings.user, pass: settings.password },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await this.transport.sendMail({ ...message, from: settings.from });
    } catch {
      throw new BusinessError(
        ErrorCode.MAIL_SEND_FAILED,
        '邮件发送失败',
        'unavailable',
      );
    }
  }
  onModuleDestroy() {
    this.transport?.close();
  }
}
