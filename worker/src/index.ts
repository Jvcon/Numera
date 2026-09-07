import { Env } from './types';
import { handleAuth } from './auth/routes';
import { handleWebDAV } from './webdav/handler';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return corsMiddleware(new Response(null, { status: 204 }));
    }

    try {
      const url = new URL(request.url);
      
      // 健康检查
      if (url.pathname === '/health') {
        return new Response('OK', { status: 200 });
      }

      // 认证路由: /auth/*
      if (url.pathname.startsWith('/auth/')) {
        const response = await handleAuth(request, env);
        return corsMiddleware(response);
      }

      // WebDAV 路由: /*
      const response = await handleWebDAV(request, env);
      return corsMiddleware(response);
    } catch (error) {
      const response = errorHandler(error, env);
      return corsMiddleware(response);
    }
  },
};
