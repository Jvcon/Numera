import { Env } from '../types';

// KV 操作封装
export class KVStore {
  private kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  // 获取值
  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key, 'json');
    return value as T | null;
  }

  // 获取字符串值
  async getString(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  // 设置值
  async put<T>(key: string, value: T, options?: { expirationTtl?: number }): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), options);
  }

  // 设置字符串值
  async putString(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    await this.kv.put(key, value, options);
  }

  // 删除值
  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  // 列出键
  async list(prefix: string, options?: { limit?: number; cursor?: string }) {
    return this.kv.list({ prefix, ...options });
  }
}

// 会话管理
export class SessionStore {
  private kv: KVNamespace;
  private prefix = 'session:';

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  // 创建会话
  async create(userId: string, data: Record<string, unknown>, ttl: number): Promise<string> {
    const sessionId = crypto.randomUUID();
    const key = `${this.prefix}${userId}:${sessionId}`;
    
    await this.kv.put(key, JSON.stringify({
      ...data,
      user_id: userId,
      created_at: Date.now(),
      expires_at: Date.now() + ttl * 1000,
    }), { expirationTtl: ttl });

    return sessionId;
  }

  // 获取会话
  async get(userId: string, sessionId: string): Promise<Record<string, unknown> | null> {
    const key = `${this.prefix}${userId}:${sessionId}`;
    const data = await this.kv.get(key, 'json');
    
    if (!data) return null;

    const session = data as Record<string, unknown>;
    
    // 检查过期
    if ((session.expires_at as number) < Date.now()) {
      await this.delete(userId, sessionId);
      return null;
    }

    return session;
  }

  // 删除会话
  async delete(userId: string, sessionId: string): Promise<void> {
    const key = `${this.prefix}${userId}:${sessionId}`;
    await this.kv.delete(key);
  }

  // 删除用户的所有会话
  async deleteAllForUser(userId: string): Promise<void> {
    const prefix = `${this.prefix}${userId}:`;
    let cursor: string | undefined;

    do {
      const listed = await this.kv.list({ prefix, cursor });
      
      for (const key of listed.keys) {
        await this.kv.delete(key.name);
      }

      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);
  }
}

// Refresh Token 管理
export class RefreshTokenStore {
  private kv: KVNamespace;
  private prefix = 'refresh:';

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  // 存储 refresh token
  async store(userId: string, token: string, ttl: number): Promise<void> {
    const key = `${this.prefix}${userId}:${token}`;
    
    await this.kv.put(key, JSON.stringify({
      user_id: userId,
      created_at: Date.now(),
      expires_at: Date.now() + ttl * 1000,
    }), { expirationTtl: ttl });
  }

  // 验证 refresh token
  async verify(userId: string, token: string): Promise<boolean> {
    const key = `${this.prefix}${userId}:${token}`;
    const data = await this.kv.get(key, 'json');
    
    if (!data) return false;

    const record = data as { expires_at: number };
    
    // 检查过期
    if (record.expires_at < Date.now()) {
      await this.delete(userId, token);
      return false;
    }

    return true;
  }

  // 删除 refresh token
  async delete(userId: string, token: string): Promise<void> {
    const key = `${this.prefix}${userId}:${token}`;
    await this.kv.delete(key);
  }

  // 删除用户的所有 refresh tokens
  async deleteAllForUser(userId: string): Promise<void> {
    const prefix = `${this.prefix}${userId}:`;
    let cursor: string | undefined;

    do {
      const listed = await this.kv.list({ prefix, cursor });
      
      for (const key of listed.keys) {
        await this.kv.delete(key.name);
      }

      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);
  }
}
