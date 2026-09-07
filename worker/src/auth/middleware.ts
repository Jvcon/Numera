import { Env, User } from '../types';
import { verifyJWT } from './jwt';

// 认证结果
export interface AuthResult {
  userId: string;
  email: string;
  plan: string;
}

// 从请求中提取并验证认证信息
export async function requireAuth(
  request: Request,
  env: Env
): Promise<AuthResult> {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid authorization header', 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);

  if (!payload) {
    throw new AuthError('Invalid or expired token', 401);
  }

  return {
    userId: payload.sub,
    email: payload.email,
    plan: payload.plan,
  };
}

// 可选认证（不强制要求）
export async function optionalAuth(
  request: Request,
  env: Env
): Promise<AuthResult | null> {
  try {
    return await requireAuth(request, env);
  } catch {
    return null;
  }
}

// 认证错误类
export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }

  toResponse(): Response {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.status === 401) {
      headers['WWW-Authenticate'] = 'Bearer';
    }
    return new Response(
      JSON.stringify({ error: this.message }),
      {
        status: this.status,
        headers,
      }
    );
  }
}
