// Worker 环境变量和绑定类型
export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  JWT_SECRET: string;
  MAIL_FROM: string;
  ENVIRONMENT: string;
}

// 用户类型
export interface User {
  id: string;
  email: string;
  created_at: string;
  plan: 'free' | 'pro';
}

// 订阅类型
export interface Subscription {
  id: string;
  user_id: string;
  plan: string;
  status: 'active' | 'expired' | 'cancelled';
  provider: string | null;
  provider_id: string | null;
  started_at: string;
  expires_at: string | null;
  created_at: string;
}

// JWT Payload
export interface JWTPayload {
  sub: string;      // user_id
  email: string;
  plan: string;
  iat: number;
  exp: number;
}

// Magic Token 数据
export interface MagicTokenData {
  email: string;
  expires_at: number;
}

// 认证响应
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

// 配额限制
export interface QuotaLimits {
  maxBytes: number;
  maxFiles: number;
  maxDevices: number;
}

// 用量统计
export interface UsageStats {
  totalBytes: number;
  fileCount: number;
}

// WebDAV 属性
export interface DavProperties {
  creationdate: string | undefined;
  displayname: string | undefined;
  getcontentlanguage: string | undefined;
  getcontentlength: string | undefined;
  getcontenttype: string | undefined;
  getetag: string | undefined;
  getlastmodified: string | undefined;
  resourcetype: string;
  supportedlock: string;
  lockdiscovery: string;
}

// WebDAV 锁详情
export interface LockDetails {
  token: string;
  owner: string | undefined;
  scope: 'exclusive' | 'shared';
  depth: '0' | 'infinity';
  timeout: string;
  expiresAt: number;
  root: string;
}

// Dead Property
export interface DeadProperty {
  namespaceURI: string;
  localName: string;
  prefix: string | null;
  valueXml: string;
}

// PROPFIND 请求类型
export type PropfindRequest =
  | { mode: 'allprop' }
  | { mode: 'propname' }
  | { mode: 'prop'; properties: DeadProperty[] };

// PROPPATCH 操作
export interface ProppatchOperation {
  action: 'set' | 'remove';
  property: DeadProperty;
}
