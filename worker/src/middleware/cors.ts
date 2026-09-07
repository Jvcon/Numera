// CORS 中间件
export function corsMiddleware(response: Response): Response {
  const headers = new Headers(response.headers);
  
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, MKCOL, PROPFIND, PROPPATCH, COPY, MOVE, LOCK, UNLOCK, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth, Overwrite, Destination, Range, If, Lock-Token, Timeout');
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, DAV, ETag, Last-Modified, Location, Date, Content-Range, Lock-Token');
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// 处理 OPTIONS 预检请求
export function handleOptionsRequest(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return corsMiddleware(new Response(null, { status: 204 }));
  }
  return null;
}
