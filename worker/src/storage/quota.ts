import { Env, QuotaLimits, UsageStats } from '../types';
import { QUOTA_LIMITS, USAGE_CACHE_TTL } from '../config';
import { getUserUsage, clearUserUsageCache } from './r2';

// 获取用户的配额限制
export function getQuotaLimits(plan: string): QuotaLimits {
  return QUOTA_LIMITS[plan] || QUOTA_LIMITS.free;
}

// 检查配额
export async function checkQuota(
  userId: string,
  plan: string,
  request: Request,
  env: Env
): Promise<void> {
  const limits = getQuotaLimits(plan);
  const usage = await getUserUsage(userId, env);

  // 检查文件数量
  if (usage.fileCount >= limits.maxFiles) {
    throw new QuotaError('File limit exceeded', 'files', usage.fileCount, limits.maxFiles);
  }

  // 检查存储大小（PUT 请求）
  const contentLength = parseInt(request.headers.get('Content-Length') || '0');
  if (contentLength > 0 && usage.totalBytes + contentLength > limits.maxBytes) {
    throw new QuotaError('Storage limit exceeded', 'bytes', usage.totalBytes + contentLength, limits.maxBytes);
  }
}

// 检查是否超出配额（不抛异常）
export async function isWithinQuota(
  userId: string,
  plan: string,
  env: Env,
  additionalBytes: number = 0
): Promise<{ within: boolean; reason?: string; usage: UsageStats; limits: QuotaLimits }> {
  const limits = getQuotaLimits(plan);
  const usage = await getUserUsage(userId, env);

  if (usage.fileCount >= limits.maxFiles) {
    return {
      within: false,
      reason: 'File limit exceeded',
      usage,
      limits,
    };
  }

  if (usage.totalBytes + additionalBytes > limits.maxBytes) {
    return {
      within: false,
      reason: 'Storage limit exceeded',
      usage,
      limits,
    };
  }

  return { within: true, usage, limits };
}

// 配额错误类
export class QuotaError extends Error {
  resource: 'files' | 'bytes';
  current: number;
  limit: number;

  constructor(message: string, resource: 'files' | 'bytes', current: number, limit: number) {
    super(message);
    this.name = 'QuotaError';
    this.resource = resource;
    this.current = current;
    this.limit = limit;
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: this.message,
        resource: this.resource,
        current: this.current,
        limit: this.limit,
      }),
      {
        status: 507, // Insufficient Storage
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
