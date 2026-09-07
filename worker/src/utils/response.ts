// 响应工具函数

// JSON 响应
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 错误响应
export function errorResponse(message: string, status: number = 500): Response {
  return jsonResponse({ error: message }, status);
}

// 重定向响应
export function redirectResponse(url: string, status: number = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: url },
  });
}

// 无内容响应
export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

// 创建响应
export function createdResponse(location?: string): Response {
  return new Response(null, {
    status: 201,
    headers: location ? { Location: location } : undefined,
  });
}

// 带 CORS 的响应
export function corsResponse(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  
  const origin = request.headers.get('Origin');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, COPY, MOVE, LOCK, UNLOCK, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth, Overwrite, Destination, Range, If, Lock-Token, Timeout');
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, DAV, ETag, Last-Modified, Location, Date, Content-Range, Lock-Token');
  headers.set('Access-Control-Allow-Credentials', 'true');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
