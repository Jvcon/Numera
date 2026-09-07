import { Env, AuthResponse } from '../types';
import { createMagicToken, verifyMagicToken, generateMagicLink } from './magic-link';
import { signJWT, signRefreshToken } from './jwt';
import { sendMagicLinkEmail } from './email';
import { AuthError } from './middleware';
import { JWT_CONFIG } from '../config';

// 认证路由处理
export async function handleAuth(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // POST /auth/login - 发送 Magic Link
  if (path === '/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }

  // GET /auth/verify - 验证 Magic Link
  if (path === '/auth/verify' && request.method === 'GET') {
    return handleVerify(request, env);
  }

  // POST /auth/refresh - 刷新 Token
  if (path === '/auth/refresh' && request.method === 'POST') {
    return handleRefresh(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

// 处理登录请求
async function handleLogin(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const email = body.email?.toLowerCase().trim();
  if (!email || !isValidEmail(email)) {
    return new Response(
      JSON.stringify({ error: 'Invalid email address' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 生成 Magic Token
  const token = await createMagicToken(email, env.KV);
  
  // 生成 Magic Link
  const baseUrl = new URL(request.url).origin;
  const magicLink = generateMagicLink(baseUrl, token);

  // 发送邮件
  const sent = await sendMagicLinkEmail(email, magicLink, env);
  if (!sent) {
    return new Response(
      JSON.stringify({ error: 'Failed to send email' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ message: 'Magic link sent to your email' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// 处理验证请求
async function handleVerify(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Missing token' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 验证 Magic Token
  const result = await verifyMagicToken(token, env.KV);
  if (!result) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 查询或创建用户
  let user = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(result.email).first();

  if (!user) {
    // 创建新用户
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id, email) VALUES (?, ?)'
    ).bind(userId, result.email).run();

    user = {
      id: userId,
      email: result.email,
      created_at: new Date().toISOString(),
      plan: 'free',
    };
  }

  // 签发 JWT
  const accessToken = await signJWT(
    {
      sub: user.id as string,
      email: user.email as string,
      plan: user.plan as string,
    },
    env.JWT_SECRET,
    JWT_CONFIG.accessTokenExpiry
  );

  const refreshToken = await signRefreshToken(user.id as string, env.JWT_SECRET);

  // 存储 refresh token
  await env.KV.put(
    `refresh:${user.id}:${refreshToken}`,
    JSON.stringify({ user_id: user.id, expires_at: Date.now() + JWT_CONFIG.refreshTokenExpiry * 1000 }),
    { expirationTtl: JWT_CONFIG.refreshTokenExpiry }
  );

  const response: AuthResponse = {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id as string,
      email: user.email as string,
      created_at: user.created_at as string,
      plan: user.plan as 'free' | 'pro',
    },
  };

  // 如果是重定向模式（浏览器点击链接）
  const redirectUri = url.searchParams.get('redirect_uri');
  if (redirectUri) {
    // 将 tokens 存储在 cookie 或重定向到带有 tokens 的 URL
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${redirectUri}?access_token=${accessToken}&refresh_token=${refreshToken}`,
      },
    });
  }

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// 处理刷新请求
async function handleRefresh(
  request: Request,
  env: Env
): Promise<Response> {
  let body: { refresh_token?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const refreshToken = body.refresh_token;
  if (!refreshToken) {
    return new Response(
      JSON.stringify({ error: 'Missing refresh token' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 验证 refresh token
  const payload = await (await import('./jwt')).verifyJWT(refreshToken, env.JWT_SECRET);
  if (!payload) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired refresh token' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 检查 refresh token 是否在 KV 中
  const kvKey = `refresh:${payload.sub}:${refreshToken}`;
  const stored = await env.KV.get(kvKey);
  if (!stored) {
    return new Response(
      JSON.stringify({ error: 'Refresh token revoked' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 删除旧的 refresh token
  await env.KV.delete(kvKey);

  // 获取用户信息
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(payload.sub).first();

  if (!user) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 签发新的 access token
  const accessToken = await signJWT(
    {
      sub: user.id as string,
      email: user.email as string,
      plan: user.plan as string,
    },
    env.JWT_SECRET,
    JWT_CONFIG.accessTokenExpiry
  );

  // 签发新的 refresh token
  const newRefreshToken = await signRefreshToken(user.id as string, env.JWT_SECRET);

  // 存储新的 refresh token
  await env.KV.put(
    `refresh:${user.id}:${newRefreshToken}`,
    JSON.stringify({ user_id: user.id, expires_at: Date.now() + JWT_CONFIG.refreshTokenExpiry * 1000 }),
    { expirationTtl: JWT_CONFIG.refreshTokenExpiry }
  );

  return new Response(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: newRefreshToken,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// 验证邮箱格式
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
