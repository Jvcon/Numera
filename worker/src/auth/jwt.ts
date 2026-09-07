import { JWTPayload } from '../types';
import { JWT_CONFIG } from '../config';

// Base64 URL 编码
function base64UrlEncode(data: string): string {
  return btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Base64 URL 解码
function base64UrlDecode(data: string): string {
  let padded = data.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  return atob(padded);
}

// HMAC-SHA256 签名
async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
}

// 验证 HMAC-SHA256 签名
async function hmacVerify(data: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(data, secret);
  // 时间安全比较
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// 签发 JWT
export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn: number = JWT_CONFIG.accessTokenExpiry
): Promise<string> {
  const header = {
    alg: JWT_CONFIG.algorithm,
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = await hmacSign(data, secret);

  return `${data}.${signature}`;
}

// 验证 JWT
export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerEncoded, payloadEncoded, signature] = parts;
  const data = `${headerEncoded}.${payloadEncoded}`;

  // 验证签名
  const isValid = await hmacVerify(data, signature, secret);
  if (!isValid) return null;

  // 解析 payload
  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded)) as JWTPayload;
    
    // 检查过期时间
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;

    return payload;
  } catch {
    return null;
  }
}

// 签发 Refresh Token
export async function signRefreshToken(
  userId: string,
  secret: string
): Promise<string> {
  return signJWT(
    { sub: userId, email: '', plan: '' },
    secret,
    JWT_CONFIG.refreshTokenExpiry
  );
}
