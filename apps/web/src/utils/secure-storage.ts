/**
 * API Key 加密工具（仅加密，不解密）。
 *
 * 前端使用 AES-256-GCM 加密 API Key 后存入 localStorage，
 * 传输时直接发送密文，由后端用相同密钥解密使用。
 *
 * 加密密钥 = SHA-256(TRANSMISSION_SECRET)，前后端一致。
 *
 * 注意：此密钥会被打包到前端产物中，不属于真正的机密。
 * 传输安全应依赖 HTTPS，此密钥仅用于应用层混淆。
 *
 * 流程：
 *   配置保存：用户输入 raw → encryptForStorage(raw) → localStorage
 *   发送消息：从 localStorage 读密文 → HTTP Header → 后端解密
 */

const PASSPHRASE = import.meta.env.VITE_TRANSMISSION_SECRET as string;

async function deriveKey(): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(PASSPHRASE),
  );
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
}

function bufToBase64url(buf: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buf.byteLength; i++) {
    binary += String.fromCharCode(buf[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * 加密 API Key。
 * 格式: iv:authTag:ciphertext（base64url，与后端 CryptoService 一致）
 */
export async function encryptApiKey(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoded = new TextEncoder().encode(plaintext);
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  // Web Crypto AES-GCM 输出 = ciphertext + 16-byte auth tag
  const buf = new Uint8Array(result);
  const ciphertext = buf.slice(0, -16);
  const tag = buf.slice(-16);
  return [
    bufToBase64url(new Uint8Array(iv)),
    bufToBase64url(tag),
    bufToBase64url(ciphertext),
  ].join(':');
}

/** 存入 localStorage */
export function secureSet(key: string, encrypted: string): void {
  localStorage.setItem(key, encrypted);
}

/** 读取（返回密文，不解密） */
export function secureGet(key: string): string | null {
  return localStorage.getItem(key);
}

/** 删除 */
export function secureRemove(key: string): void {
  localStorage.removeItem(key);
}
