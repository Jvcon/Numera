import { QuotaLimits } from './types';

// 配额限制配置
export const QUOTA_LIMITS: Record<string, QuotaLimits> = {
  free: {
    maxBytes: 50 * 1024 * 1024,      // 50 MB
    maxFiles: 100,
    maxDevices: 3,
  },
  pro: {
    maxBytes: 1024 * 1024 * 1024,    // 1 GB
    maxFiles: Infinity,
    maxDevices: Infinity,
  },
};

// JWT 配置
export const JWT_CONFIG = {
  accessTokenExpiry: 15 * 60,        // 15 分钟
  refreshTokenExpiry: 7 * 24 * 60 * 60, // 7 天
  algorithm: 'HS256' as const,
};

// Magic Link 配置
export const MAGIC_LINK_CONFIG = {
  tokenExpiry: 15 * 60,              // 15 分钟
  tokenPrefix: 'magic:',
};

// WebDAV 配置
export const WEBDAV_CONFIG = {
  davClass: '1, 2',
  supportedMethods: [
    'OPTIONS',
    'PROPFIND',
    'PROPPATCH',
    'MKCOL',
    'GET',
    'HEAD',
    'PUT',
    'DELETE',
    'COPY',
    'MOVE',
    'LOCK',
    'UNLOCK',
  ],
  defaultLockTimeout: 3600,           // 1 小时
  maxLockTimeout: 365 * 24 * 60 * 60, // 1 年
};

// DAV 命名空间
export const DAV_NAMESPACE = 'DAV:';
export const DEAD_PROPERTY_PREFIX = 'dead_property:';
export const LOCK_METADATA_KEYS = [
  'lock_token',
  'lock_owner',
  'lock_scope',
  'lock_depth',
  'lock_timeout',
  'lock_expires_at',
  'lock_root',
  'lock_records',
];

// R2 配置
export const R2_CONFIG = {
  userPrefixLength: 36, // UUID 长度
};

// 用量缓存配置
export const USAGE_CACHE_TTL = 300; // 5 分钟
