import { Env, MagicTokenData } from '../types';
import { MAGIC_LINK_CONFIG } from '../config';

// 生成 Magic Token
export async function createMagicToken(
  email: string,
  kv: KVNamespace
): Promise<string> {
  const token = crypto.randomUUID();
  const data: MagicTokenData = {
    email,
    expires_at: Date.now() + MAGIC_LINK_CONFIG.tokenExpiry * 1000,
  };

  await kv.put(
    `${MAGIC_LINK_CONFIG.tokenPrefix}${token}`,
    JSON.stringify(data),
    { expirationTtl: MAGIC_LINK_CONFIG.tokenExpiry }
  );

  return token;
}

// 验证 Magic Token
export async function verifyMagicToken(
  token: string,
  kv: KVNamespace
): Promise<{ email: string } | null> {
  const key = `${MAGIC_LINK_CONFIG.tokenPrefix}${token}`;
  const data = await kv.get(key);

  if (!data) return null;

  try {
    const parsed = JSON.parse(data) as MagicTokenData;
    
    // 检查过期时间
    if (parsed.expires_at < Date.now()) {
      await kv.delete(key);
      return null;
    }

    // 删除已使用的 token
    await kv.delete(key);
    
    return { email: parsed.email };
  } catch {
    return null;
  }
}

// 生成 Magic Link URL
export function generateMagicLink(
  baseUrl: string,
  token: string
): string {
  return `${baseUrl}/auth/verify?token=${token}`;
}
