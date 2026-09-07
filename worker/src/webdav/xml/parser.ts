import { DeadProperty, PropfindRequest, ProppatchOperation } from '../../types';
import { DOMParser } from '@xmldom/xmldom';

// 解析 PROPFIND 请求
export function parsePropfindRequest(body: string): PropfindRequest | null {
  if (body.trim() === '') {
    return { mode: 'allprop' };
  }

  const document = parseXmlDocument(body);
  if (!document || document.documentElement.localName.toLowerCase() !== 'propfind') {
    return null;
  }

  const propfindChildren = getChildElements(document.documentElement);

  if (propfindChildren.some(child => child.localName.toLowerCase() === 'propname')) {
    return { mode: 'propname' };
  }

  const propElement = propfindChildren.find(child => child.localName.toLowerCase() === 'prop');
  if (propElement !== undefined) {
    const properties = getChildElements(propElement).map(getElementProperty);
    if (properties.some(property => property === null)) {
      return null;
    }
    return {
      mode: 'prop',
      properties: properties as DeadProperty[],
    };
  }

  if (propfindChildren.some(child => child.localName.toLowerCase() === 'allprop')) {
    return { mode: 'allprop' };
  }

  return null;
}

// 解析 PROPPATCH 请求
export function parseProppatchRequest(body: string): { operations: ProppatchOperation[] } | null {
  const document = parseXmlDocument(body);
  if (!document || document.documentElement.localName.toLowerCase() !== 'propertyupdate') {
    return null;
  }

  const operations: ProppatchOperation[] = [];
  
  for (const actionElement of getChildElements(document.documentElement)) {
    const action = actionElement.localName.toLowerCase();
    if (action !== 'set' && action !== 'remove') {
      continue;
    }

    const propElement = getChildElements(actionElement).find(
      child => child.localName.toLowerCase() === 'prop'
    );
    if (propElement === undefined) {
      continue;
    }

    for (const propertyElement of getChildElements(propElement)) {
      const property = getElementProperty(propertyElement);
      if (property === null) {
        return null;
      }
      operations.push({ action, property });
    }
  }

  return { operations };
}

// 解析 XML 文档
function parseXmlDocument(body: string): Document | null {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(body, 'application/xml');

  if (errors.length > 0) {
    return null;
  }

  return document;
}

// 获取子元素
function getChildElements(element: Element): Element[] {
  const children: Element[] = [];
  for (let child = element.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === child.ELEMENT_NODE) {
      children.push(child as Element);
    }
  }
  return children;
}

// 获取元素属性
function getElementProperty(element: Element): DeadProperty | null {
  if (element.prefix && (element.namespaceURI === null || element.namespaceURI === '')) {
    return null;
  }

  return {
    namespaceURI: element.namespaceURI ?? '',
    localName: element.localName,
    prefix: element.prefix,
    valueXml: serializeNodeChildren(element),
  };
}

// 序列化节点子节点
function serializeNodeChildren(node: Node): string {
  let xml = '';
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    xml += child.toString();
  }
  return xml;
}

// 解析 LOCK 请求中的 owner
export function extractLockOwner(body: string): string | undefined {
  const owner = body.match(/<owner(?:\s[^>]*)?>([\s\S]*?)<\/owner>/i)?.[1];
  if (owner === undefined) {
    return undefined;
  }

  const trimmed = owner.trim();
  return trimmed === '' ? undefined : trimmed;
}

// 解析 Timeout 头
export function parseTimeout(timeoutHeader: string | null): { timeout: string; expiresAt: number } {
  const DEFAULT_LOCK_TIMEOUT = 3600;
  const MAX_LOCK_TIMEOUT = 365 * 24 * 60 * 60;

  if (timeoutHeader === null) {
    return {
      timeout: `Second-${DEFAULT_LOCK_TIMEOUT}`,
      expiresAt: Date.now() + DEFAULT_LOCK_TIMEOUT * 1000,
    };
  }

  for (const item of timeoutHeader.split(',').map(value => value.trim())) {
    if (item.toLowerCase() === 'infinite') {
      return {
        timeout: 'Infinite',
        expiresAt: Date.now() + MAX_LOCK_TIMEOUT * 1000,
      };
    }

    const seconds = Number(item.match(/^Second-(\d+)$/i)?.[1] ?? NaN);
    if (Number.isFinite(seconds) && seconds > 0) {
      const clamped = Math.min(seconds, MAX_LOCK_TIMEOUT);
      return {
        timeout: `Second-${clamped}`,
        expiresAt: Date.now() + clamped * 1000,
      };
    }
  }

  return {
    timeout: `Second-${DEFAULT_LOCK_TIMEOUT}`,
    expiresAt: Date.now() + DEFAULT_LOCK_TIMEOUT * 1000,
  };
}

// 解析 Destination 头
export function parseDestinationPath(
  destinationHeader: string,
  requestUrl: string
): string | null {
  try {
    const destinationUrl = new URL(destinationHeader, requestUrl);
    if (destinationUrl.origin !== new URL(requestUrl).origin) {
      return null;
    }
    return decodeResourcePath(destinationUrl.pathname);
  } catch {
    return null;
  }
}

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

// 获取请求中的锁令牌
export function getRequestLockTokens(request: Request): string[] {
  const lockTokens: string[] = [];
  
  const directLockToken = request.headers.get('Lock-Token');
  if (directLockToken) {
    lockTokens.push(normalizeLockToken(directLockToken));
  }

  const ifHeader = request.headers.get('If');
  if (ifHeader) {
    for (const match of ifHeader.matchAll(/<([^>]+)>/g)) {
      const token = normalizeLockToken(match[1]);
      if (token !== '') {
        lockTokens.push(token);
      }
    }
  }

  return [...new Set(lockTokens)];
}

// 规范化锁令牌
export function normalizeLockToken(lockToken: string): string {
  return lockToken
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^(?:urn:uuid:|opaquelocktoken:)/, '');
}
