import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { VerificationPurpose } from '../auth/dto/send-verification-code.dto';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.configService.get<string>('EMAIL_HOST');
    const port = this.configService.get<number>('EMAIL_PORT');
    const user = this.configService.get<string>('EMAIL_USER');
    const pass = this.configService.get<string>('EMAIL_PASS');

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: {
          user,
          pass,
        },
      });
    }
  }

  async sendVerificationCode(email: string, purpose: VerificationPurpose) {
    const now = new Date();
    const recentUnused = await this.prisma.email_verification_codes.findFirst({
      where: {
        email,
        purpose,
        used: false,
        expired_at: { gt: now },
        created_at: { gt: new Date(now.getTime() - 30 * 1000) },
      },
      orderBy: { created_at: 'desc' },
    });
    if (recentUnused) {
      throw new BusinessException(ErrorCode.EMAIL_RATE_LIMIT);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    try {
      await this.prisma.email_verification_codes.create({
        data: {
          email,
          code,
          purpose,
          expired_at: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    } catch (error) {
      throw new BusinessException(ErrorCode.EMAIL_CODE_PROCESS_FAILED);
    }

    try {
      await this.transporter.sendMail({
        from:
          this.configService.get<string>('EMAIL_FROM') ||
          'RAG 私有知识库 <no-reply@rag-kb.com>',
        to: email,
        subject: 'RAG 私有知识库验证码',
        text: `您的验证码为：${code}，有效期 5 分钟，请勿泄露给他人。`,
        html: `
          <div style="
            margin: 0;
            padding: 32px 24px;
            background: #050816;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            color: #e5e7eb;
          ">
            <div style="
              max-width: 520px;
              margin: 0 auto;
              background: radial-gradient(circle at top left, #1d4ed8 0, transparent 55%), radial-gradient(circle at bottom right, #22c55e 0, transparent 60%), #020617;
              border-radius: 20px;
              border: 1px solid rgba(148, 163, 184, 0.35);
              box-shadow:
                0 20px 40px rgba(15, 23, 42, 0.8),
                0 0 0 1px rgba(148, 163, 184, 0.2);
              overflow: hidden;
            ">
              <div style="padding: 24px 24px 16px 24px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                  <div style="
                    width: 32px;
                    height: 32px;
                    border-radius: 999px;
                    background: radial-gradient(circle at 30% 30%, #4ade80, transparent 55%), #1f2937;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #e5e7eb;
                    font-weight: 700;
                    font-size: 18px;
                    box-shadow: 0 0 16px rgba(34, 197, 94, 0.6);
                  ">
                    R
                  </div>
                  <div>
                    <div style="font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: #9ca3af;">
                      RAG Knowledge Base
                    </div>
                    <div style="font-size: 12px; color: #6b7280;">
                      私有知识库 · 安全访问校验
                    </div>
                  </div>
                </div>

                <h1 style="
                  margin: 8px 0 4px 0;
                  font-size: 20px;
                  line-height: 1.5;
                  font-weight: 600;
                  color: #f9fafb;
                ">
                  您的验证码已生成
                </h1>
                <p style="
                  margin: 0 0 18px 0;
                  font-size: 13px;
                  line-height: 1.7;
                  color: #d1d5db;
                ">
                  您正在使用邮箱 <span style="color: #60a5fa;">${email}</span> 进行登录 / 注册 / 安全操作，为保障账号安全，请在页面中输入以下验证码完成验证。
                </p>

                <div style="
                  margin: 0 0 20px 0;
                  padding: 16px 18px;
                  border-radius: 16px;
                  background:
                    radial-gradient(circle at top, rgba(59, 130, 246, 0.18), transparent 55%),
                    linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.9));
                  border: 1px solid rgba(96, 165, 250, 0.45);
                  text-align: center;
                ">
                  <div style="font-size: 12px; color: #9ca3af; margin-bottom: 4px; letter-spacing: 0.18em; text-transform: uppercase;">
                    Verification Code
                  </div>
                  <div style="
                    font-size: 32px;
                    letter-spacing: 0.42em;
                    font-weight: 700;
                    color: #e5e7eb;
                    text-shadow:
                      0 0 16px rgba(59, 130, 246, 0.9),
                      0 0 4px rgba(15, 23, 42, 0.9);
                  ">
                    ${code}
                  </div>
                  <div style="font-size: 12px; color: #9ca3af; margin-top: 8px;">
                    有效期 <span style="color: #facc15;">5 分钟</span>，过期请重新获取
                  </div>
                </div>

                <div style="font-size: 12px; color: #9ca3af; line-height: 1.7;">
                  <p style="margin: 0 0 6px 0;">
                    · 请勿将验证码转发或泄露给他人，<span style="color: #f97316;">RAG 私有知识库团队不会向您索取验证码</span>。
                  </p>
                  <p style="margin: 0 0 6px 0;">
                    · 如果这不是您本人的操作，建议及时修改密码并检查账号安全。
                  </p>
                </div>
              </div>

              <div style="
                padding: 10px 24px 14px 24px;
                border-top: 1px solid rgba(148, 163, 184, 0.2);
                background: linear-gradient(to right, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.96));
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
              ">
                <div style="font-size: 11px; color: #6b7280;">
                  此邮件由系统自动发出，请勿直接回复。
                </div>
              </div>
            </div>
          </div>
        `,
      });
    } catch (error) {
      throw new BusinessException(ErrorCode.EMAIL_SEND_FAILED);
    }

    return true;
  }

  async verifyCode(email: string, code: string, purpose: VerificationPurpose) {
    const validCode = await this.prisma.email_verification_codes.findFirst({
      where: {
        email,
        code,
        purpose,
        used: false,
        expired_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!validCode) {
      throw new BusinessException(ErrorCode.EMAIL_CODE_INVALID);
    }

    await this.prisma.email_verification_codes.update({
      where: { id: validCode.id },
      data: { used: true },
    });

    return true;
  }
}
   
