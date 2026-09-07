// 路径处理工具

// 解码资源路径
export function decodeResourcePath(pathname: string): string {
  let resourcePath = pathname.slice(1);
  resourcePath = resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath;
  
  if (resourcePath === '') {
    return '';
  }

  return resourcePath
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

// 编码资源路径
export function encodeResourcePath(path: string): string {
  if (path === '') {
    return '';
  }

  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

// 获取父路径
export function getParentPath(resourcePath: string): string {
  const normalizedPath = resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath;
  return normalizedPath.split('/').slice(0, -1).join('/');
}

// 获取文件名
export function getFileName(resourcePath: string): string {
  const parts = resourcePath.split('/');
  return parts[parts.length - 1] || '';
}

// 检查路径是否是子路径
export function isSubPath(parentPath: string, childPath: string): boolean {
  if (parentPath === '') {
    return childPath !== '';
  }
  return childPath.startsWith(`${parentPath}/`);
}

// 规范化路径
export function normalizePath(path: string): string {
  if (path === '') {
    return '';
  }

  // 移除开头和结尾的斜杠
  let normalized = path.replace(/^\/+|\/+$/g, '');
  
  // 处理 . 和 ..
  const parts = normalized.split('/');
  const result: string[] = [];
  
  for (const part of parts) {
    if (part === '.') {
      continue;
    }
    if (part === '..') {
      result.pop();
    } else {
      result.push(part);
    }
  }
  
  return result.join('/');
}

// 连接路径
export function joinPaths(...paths: string[]): string {
  return paths
    .map(path => path.replace(/^\/+|\/+$/g, ''))
    .filter(path => path !== '')
    .join('/');
}
