import { Env, User, Subscription } from '../types';

// 获取用户
export async function getUser(
  userId: string,
  env: Env
): Promise<User | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!result) return null;

  return {
    id: result.id as string,
    email: result.email as string,
    created_at: result.created_at as string,
    plan: result.plan as 'free' | 'pro',
  };
}

// 通过邮箱获取用户
export async function getUserByEmail(
  email: string,
  env: Env
): Promise<User | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first();

  if (!result) return null;

  return {
    id: result.id as string,
    email: result.email as string,
    created_at: result.created_at as string,
    plan: result.plan as 'free' | 'pro',
  };
}

// 创建用户
export async function createUser(
  email: string,
  env: Env
): Promise<User> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO users (id, email, created_at, plan) VALUES (?, ?, ?, ?)'
  ).bind(id, email, now, 'free').run();

  return {
    id,
    email,
    created_at: now,
    plan: 'free',
  };
}

// 更新用户计划
export async function updateUserPlan(
  userId: string,
  plan: 'free' | 'pro',
  env: Env
): Promise<void> {
  await env.DB.prepare(
    'UPDATE users SET plan = ? WHERE id = ?'
  ).bind(plan, userId).run();
}

// 获取用户订阅
export async function getUserSubscription(
  userId: string,
  env: Env
): Promise<Subscription | null> {
  const result = await env.DB.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ? AND status = ? ORDER BY expires_at DESC LIMIT 1'
  ).bind(userId, 'active').first();

  if (!result) return null;

  return {
    id: result.id as string,
    user_id: result.user_id as string,
    plan: result.plan as string,
    status: result.status as 'active' | 'expired' | 'cancelled',
    provider: result.provider as string | null,
    provider_id: result.provider_id as string | null,
    started_at: result.started_at as string,
    expires_at: result.expires_at as string | null,
    created_at: result.created_at as string,
  };
}

// 创建订阅
export async function createSubscription(
  subscription: Omit<Subscription, 'id' | 'created_at'>,
  env: Env
): Promise<Subscription> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, plan, status, provider, provider_id, started_at, expires_at, created_at) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    subscription.user_id,
    subscription.plan,
    subscription.status,
    subscription.provider,
    subscription.provider_id,
    subscription.started_at,
    subscription.expires_at,
    now
  ).run();

  return {
    id,
    ...subscription,
    created_at: now,
  };
}

// 检查用户是否有有效的 Pro 订阅
export async function hasActiveProSubscription(
  userId: string,
  env: Env
): Promise<boolean> {
  const subscription = await getUserSubscription(userId, env);
  if (!subscription || subscription.plan !== 'pro') return false;

  // 检查是否过期
  if (subscription.expires_at) {
    return new Date(subscription.expires_at) > new Date();
  }

  return true;
}
