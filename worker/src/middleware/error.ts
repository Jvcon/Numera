// 错误处理中间件
export function errorHandler(error: unknown, env?: { ENVIRONMENT: string }): Response {
  console.error('Worker error:', error);

  if (error instanceof Response) {
    return error;
  }

  if (error instanceof Error) {
    const status = (error as any).status || 500;
    return new Response(
      JSON.stringify({
        error: error.message,
        ...(env?.ENVIRONMENT === 'development' ? { stack: error.stack } : {}),
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({ error: 'Internal Server Error' }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// 自定义错误类
export class AppError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number = 500, code?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: this.message,
        code: this.code,
      }),
      {
        status: this.status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// 常用错误
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
    this.name = 'BadRequestError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}
