import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * AES-256-GCM 加密/解密服务。
 *
 * 两套密钥：
 * - DB 存储密钥：scrypt(ENCRYPTION_KEY) → 用于 b_user_model_configs.api_key_encrypted 加密
 * - 传输密钥：SHA-256(TRANSMISSION_SECRET) → 用于前端加密传输、后端解密使用
 *   注意：TRANSMISSION_SECRET 会被打包到前端产物中，不属于真正的机密。
 *   传输安全应依赖 HTTPS，此密钥仅用于应用层混淆。
 */
@Injectable()
export class CryptoService {
  private readonly dbKey: Buffer;
  private readonly transmissionKey: Buffer;
  private readonly ALGORITHM = 'aes-256-gcm';

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('ENCRYPTION_KEY')!;
    this.dbKey = scryptSync(secret, 'linsor-salt-2026', 32);

    const transmissionSecret = this.configService.get<string>('TRANSMISSION_SECRET')!;
    this.transmissionKey = createHash('sha256')
      .update(transmissionSecret)
      .digest();
  }

  /** DB 存储加密：明文 → "iv:authTag:ciphertext"（base64url） */
  encrypt(plaintext: string): string {
    return this.encryptWithKey(plaintext, this.dbKey);
  }

  /** DB 存储解密 */
  decrypt(ciphertext: string): string {
    return this.decryptWithKey(ciphertext, this.dbKey);
  }

  /**
   * 解密前端传来的加密 API Key。
   * 使用与前端 secure-storage.ts 相同的共享口令派生密钥。
   */
  decryptTransmission(ciphertext: string): string {
    return this.decryptWithKey(ciphertext, this.transmissionKey);
  }

  private encryptWithKey(plaintext: string, key: Buffer): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  private decryptWithKey(ciphertext: string, key: Buffer): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('无效的密文格式');
    }
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const encrypted = Buffer.from(dataB64, 'base64url');
    const decipher = createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
