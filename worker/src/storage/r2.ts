import { Env, UsageStats } from '../types';
import { USAGE_CACHE_TTL } from '../config';

// 获取用户用量统计
export async function getUserUsage(
  userId: string,
  env: Env
): Promise<UsageStats> {
  // 尝试从 KV 获取缓存
  const cacheKey = `usage:${userId}`;
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached) {
    return cached as UsageStats;
  }

  // 从 R2 列表计算
  let totalBytes = 0;
  let fileCount = 0;
  const prefix = `${userId}/`;

  let cursor: string | undefined;
  do {
    const listed = await env.R2.list({
      prefix,
      cursor,
    });

    for (const obj of listed.objects) {
      totalBytes += obj.size;
      fileCount++;
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const usage: UsageStats = { totalBytes, fileCount };

  // 缓存到 KV
  await env.KV.put(cacheKey, JSON.stringify(usage), {
    expirationTtl: USAGE_CACHE_TTL,
  });

  return usage;
}

// 清除用户用量缓存
export async function clearUserUsageCache(
  userId: string,
  env: Env
): Promise<void> {
  await env.KV.delete(`usage:${userId}`);
}

// 列出用户目录下的对象
export async function listUserObjects(
  userId: string,
  prefix: string,
  env: Env,
  options?: {
    delimiter?: string;
    limit?: number;
    cursor?: string;
  }
) {
  const fullPrefix = `${userId}/${prefix}`;
  return env.R2.list({
    prefix: fullPrefix,
    delimiter: options?.delimiter,
    limit: options?.limit,
    cursor: options?.cursor,
  });
}

// 获取用户对象
export async function getUserObject(
  userId: string,
  path: string,
  env: Env,
  options?: {
    onlyIf?: Headers;
    range?: Headers;
  }
) {
  const key = `${userId}/${path}`;
  return env.R2.get(key, options);
}

// 获取用户对象元数据
export async function headUserObject(
  userId: string,
  path: string,
  env: Env
) {
  const key = `${userId}/${path}`;
  return env.R2.head(key);
}

// 上传用户对象
export async function putUserObject(
  userId: string,
  path: string,
  body: ReadableStream | ArrayBuffer | string,
  env: Env,
  options?: {
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
    onlyIf?: Headers;
  }
) {
  const key = `${userId}/${path}`;
  return env.R2.put(key, body, options);
}

// 删除用户对象
export async function deleteUserObject(
  userId: string,
  path: string,
  env: Env
) {
  const key = `${userId}/${path}`;
  await env.R2.delete(key);
  await clearUserUsageCache(userId, env);
}

// 删除用户目录下的多个对象
export async function deleteUserObjects(
  userId: string,
  keys: string[],
  env: Env
) {
  await env.R2.delete(keys);
  await clearUserUsageCache(userId, env);
}

// 检查路径是否在用户目录下
export function isPathInUserScope(
  userId: string,
  path: string
): boolean {
  const prefix = `${userId}/`;
  return path.startsWith(prefix) || path === userId;
}

// 从完整路径中提取用户相对路径
export function extractRelativePath(
  userId: string,
  fullPath: string
): string {
  const prefix = `${userId}/`;
  if (fullPath.startsWith(prefix)) {
    return fullPath.slice(prefix.length);
  }
  return fullPath;
}

// 构建完整的 R2 key
export function buildR2Key(
  userId: string,
  relativePath: string
): string {
  return `${userId}/${relativePath}`;
}
