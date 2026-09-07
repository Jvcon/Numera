import { Env } from '../../types';
import { WEBDAV_CONFIG } from '../../config';
import { requireAuth, AuthError } from '../auth/middleware';
import { checkQuota, QuotaError } from '../storage/quota';
import { 
  getUserObject, headUserObject, putUserObject, deleteUserObject, listUserObjects 
} from '../storage/r2';
import {
  escapeXml, getResourceHref, fromR2Object, renderDavProperty, renderPropstat,
  getPreservedCustomMetadata, getLockDetails, withLockMetadata, stripLockMetadata
} from './xml/builder';
import {
  parsePropfindRequest, parseProppatchRequest, parseDestinationPath,
  decodeResourcePath, getRequestLockTokens, normalizeLockToken
} from './xml/parser';

// WebDAV 请求分发
export async function handleWebDAV(
  request: Request,
  env: Env
): Promise<Response> {
  // 认证检查
  let auth;
  try {
    auth = await requireAuth(request, env);
  } catch (error) {
    if (error instanceof AuthError) {
      return error.toResponse();
    }
    throw error;
  }

  // 提取资源路径
  const url = new URL(request.url);
  const fullPath = decodeResourcePath(url.pathname);
  
  // 确保路径在用户目录下
  const userPrefix = `${auth.userId}/`;
  let resourcePath: string;
  
  if (fullPath === '' || fullPath === auth.userId) {
    resourcePath = '';
  } else if (fullPath.startsWith(userPrefix)) {
    resourcePath = fullPath.slice(userPrefix.length);
  } else {
    return new Response('Forbidden', { status: 403 });
  }

  // 配额检查（PUT 请求）
  if (request.method === 'PUT') {
    try {
      await checkQuota(auth.userId, auth.plan, request, env);
    } catch (error) {
      if (error instanceof QuotaError) {
        return error.toResponse();
      }
      throw error;
    }
  }

  // 分发到具体的 WebDAV 方法
  switch (request.method) {
    case 'OPTIONS':
      return handleOptions();
    case 'HEAD':
    case 'GET':
      return handleGet(request, env, auth.userId, resourcePath);
    case 'PUT':
      return handlePut(request, env, auth.userId, resourcePath);
    case 'DELETE':
      return handleDelete(request, env, auth.userId, resourcePath);
    case 'MKCOL':
      return handleMkcol(request, env, auth.userId, resourcePath);
    case 'PROPFIND':
      return handlePropfind(request, env, auth.userId, resourcePath);
    case 'PROPPATCH':
      return handleProppatch(request, env, auth.userId, resourcePath);
    case 'COPY':
      return handleCopy(request, env, auth.userId, resourcePath);
    case 'MOVE':
      return handleMove(request, env, auth.userId, resourcePath);
    case 'LOCK':
      return handleLock(request, env, auth.userId, resourcePath);
    case 'UNLOCK':
      return handleUnlock(request, env, auth.userId, resourcePath);
    default:
      return new Response('Method Not Allowed', {
        status: 405,
        headers: {
          Allow: WEBDAV_CONFIG.supportedMethods.join(', '),
          DAV: WEBDAV_CONFIG.davClass,
        },
      });
  }
}

// OPTIONS 方法
function handleOptions(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      Allow: WEBDAV_CONFIG.supportedMethods.join(', '),
      DAV: WEBDAV_CONFIG.davClass,
    },
  });
}

// GET/HEAD 方法
async function handleGet(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  // 如果是目录（以 / 结尾）
  if (request.url.endsWith('/')) {
    if (resourcePath !== '') {
      const resource = await headUserObject(userId, resourcePath, env);
      if (resource === null || resource.customMetadata?.resourcetype !== '<collection />') {
        return new Response('Not Found', { status: 404 });
      }
    }

    // 列出目录内容
    let page = '';
    let prefix = resourcePath;
    if (resourcePath !== '') {
      page += `<a href="../">..</a><br>`;
      prefix = `${resourcePath}/`;
    }

    const listed = await listUserObjects(userId, prefix, env);
    for (const object of listed.objects) {
      if (object.key === `${userId}/${resourcePath}`) {
        continue;
      }
      const relativePath = object.key.slice(`${userId}/${prefix}`.length);
      const isCollection = object.customMetadata?.resourcetype === '<collection />';
      const href = getResourceHref(relativePath, isCollection);
      page += `<a href="${escapeXml(href)}">${escapeXml(
        object.httpMetadata?.contentDisposition ?? relativePath
      )}</a><br>`;
    }

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Numera</title><style>*{box-sizing:border-box;}body{padding:10px;font-family:'Segoe UI','Circular','Roboto','Lato','Helvetica Neue','Arial Rounded MT Bold','sans-serif';}a{display:inline-block;width:100%;color:#000;text-decoration:none;padding:5px 10px;cursor:pointer;border-radius:5px;}a:hover{background-color:#60C590;color:white;}a[href="../"]{background-color:#cbd5e1;}</style></head><body><h1>Numera Storage</h1><div>${page}</div></body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // 获取文件
  const object = await getUserObject(userId, resourcePath, env, {
    onlyIf: request.headers,
    range: request.headers,
  });

  if (object === null) {
    return new Response('Not Found', { status: 404 });
  }

  // 检查是否是 R2ObjectBody
  const isR2ObjectBody = (obj: R2Object | R2ObjectBody): obj is R2ObjectBody => {
    return 'body' in obj;
  };

  if (!isR2ObjectBody(object)) {
    return new Response('Precondition Failed', { status: 412 });
  }

  const rangeOffset = object.range && 'offset' in object.range ? object.range.offset ?? 0 : 0;
  const rangeEnd = object.range && 'length' in object.range 
    ? rangeOffset + object.range.length! - 1 
    : object.size - 1;
  const contentLength = rangeEnd - rangeOffset + 1;
  const rangeRequested = request.headers.has('Range') && object.range !== undefined;

  return new Response(object.body, {
    status: rangeRequested ? 206 : 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': contentLength.toString(),
      ...(rangeRequested ? { 'Content-Range': `bytes ${rangeOffset}-${rangeEnd}/${object.size}` } : {}),
      ...(object.httpMetadata?.contentDisposition
        ? { 'Content-Disposition': object.httpMetadata.contentDisposition }
        : {}),
    },
  });
}

// PUT 方法
async function handlePut(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  if (request.url.endsWith('/')) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const existing = await headUserObject(userId, resourcePath, env);

  const body = await request.arrayBuffer();
  await putUserObject(userId, resourcePath, body, env, {
    httpMetadata: request.headers as unknown as R2HTTPMetadata,
    customMetadata: getPreservedCustomMetadata(existing?.customMetadata),
  });

  return existing === null 
    ? new Response('', { status: 201 })
    : new Response(null, { status: 204 });
}

// DELETE 方法
async function handleDelete(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  const resource = await headUserObject(userId, resourcePath, env);
  if (resource === null) {
    return new Response('Not Found', { status: 404 });
  }

  if (resource.customMetadata?.resourcetype !== '<collection />') {
    await deleteUserObject(userId, resourcePath, env);
    return new Response(null, { status: 204 });
  }

  // 删除目录及其所有内容
  const prefix = resourcePath === '' ? '' : `${resourcePath}/`;
  const listed = await listUserObjects(userId, prefix, env, { limit: 1000 });
  
  if (listed.objects.length > 0) {
    const keys = listed.objects.map(obj => obj.key);
    await env.R2.delete(keys);
  }

  await deleteUserObject(userId, resourcePath, env);
  return new Response(null, { status: 204 });
}

// MKCOL 方法
async function handleMkcol(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  if ((await request.clone().arrayBuffer()).byteLength > 0) {
    return new Response('Unsupported Media Type', { status: 415 });
  }

  const resource = await headUserObject(userId, resourcePath, env);
  if (resource !== null) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  await putUserObject(userId, resourcePath, new Uint8Array(), env, {
    customMetadata: { resourcetype: '<collection />' },
  });

  return new Response('', { status: 201 });
}

// PROPFIND 方法
async function handlePropfind(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  const propfindRequest = parsePropfindRequest(await request.text());
  if (propfindRequest === null) {
    return new Response('Bad Request', { status: 400 });
  }

  let isCollection: boolean;
  let page = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">`;

  if (resourcePath === '') {
    page += generatePropfindResponse(null, propfindRequest);
    isCollection = true;
  } else {
    const object = await headUserObject(userId, resourcePath, env);
    if (object === null) {
      return new Response('Not Found', { status: 404 });
    }
    isCollection = object.customMetadata?.resourcetype === '<collection />';
    page += generatePropfindResponse(object, propfindRequest);
  }

  if (isCollection) {
    const depth = request.headers.get('Depth') ?? 'infinity';
    switch (depth) {
      case '0':
        break;
      case '1': {
        const prefix = resourcePath === '' ? '' : `${resourcePath}/`;
        const listed = await listUserObjects(userId, prefix, env);
        for (const object of listed.objects) {
          page += generatePropfindResponse(object, propfindRequest);
        }
        break;
      }
      case 'infinity': {
        const prefix = resourcePath === '' ? '' : `${resourcePath}/`;
        const listed = await listUserObjects(userId, prefix, env);
        for (const object of listed.objects) {
          page += generatePropfindResponse(object, propfindRequest);
        }
        break;
      }
      default:
        return new Response('Bad Request', { status: 400 });
    }
  }

  page += '\n</multistatus>\n';
  return new Response(page, {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

// 生成 PROPFIND 响应
function generatePropfindResponse(
  object: R2Object | null,
  propfindRequest: ReturnType<typeof parsePropfindRequest>
): string {
  const href = object === null ? '/' : getResourceHref(
    object.key.split('/').slice(1).join('/'),
    object.customMetadata?.resourcetype === '<collection />'
  );
  
  const deadProperties = getDeadProperties(object?.customMetadata);
  const liveProperties = Object.entries(fromR2Object(object)).flatMap(([key, value]) =>
    value === undefined ? [] : [renderDavProperty(key, value)]
  );

  let okProperties: string[] = [];
  let missingProperties: string[] = [];

  switch (propfindRequest!.mode) {
    case 'allprop': {
      okProperties = [...liveProperties, ...deadProperties.map(renderPropertyElement)];
      break;
    }
    case 'propname': {
      okProperties = [
        ...Object.entries(fromR2Object(object)).flatMap(([key, value]) =>
          value === undefined ? [] : [renderDavProperty(key, '')]
        ),
        ...deadProperties.map(property => renderEmptyPropertyElement({ ...property, valueXml: '' })),
      ];
      break;
    }
    case 'prop': {
      for (const property of propfindRequest!.properties) {
        const liveValue = getLivePropertyValue(object, property);
        if (liveValue !== undefined) {
          okProperties.push(renderDavProperty(property.localName, liveValue));
          continue;
        }
        const deadProperty = getDeadProperty(object?.customMetadata, property.namespaceURI, property.localName);
        if (deadProperty !== null) {
          okProperties.push(renderPropertyElement(deadProperty));
        } else {
          missingProperties.push(renderEmptyPropertyElement({ ...property, valueXml: '' }));
        }
      }
      break;
    }
  }

  return `
  <response>
    <href>${escapeXml(href)}</href>${renderPropstat('HTTP/1.1 200 OK', okProperties)}${renderPropstat('HTTP/1.1 404 Not Found', missingProperties)}
  </response>`;
}

// PROPPATCH 方法
async function handleProppatch(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  const object = await headUserObject(userId, resourcePath, env);
  if (object === null) {
    return new Response('Not Found', { status: 404 });
  }

  const body = await request.text();
  const parsedRequest = parseProppatchRequest(body);
  if (parsedRequest === null) {
    return new Response('Bad Request', { status: 400 });
  }

  const { operations } = parsedRequest;
  const customMetadata = getPreservedCustomMetadata(object.customMetadata);
  const successfulSetProperties: DeadProperty[] = [];
  const failedSetProperties: DeadProperty[] = [];
  const successfulRemoveProperties: DeadProperty[] = [];
  const failedRemoveProperties: DeadProperty[] = [];

  for (const operation of operations) {
    if (isProtectedProperty(operation.property)) {
      if (operation.action === 'set') {
        failedSetProperties.push(operation.property);
      } else {
        failedRemoveProperties.push(operation.property);
      }
      continue;
    }

    if (operation.action === 'set') {
      customMetadata[getDeadPropertyKey(operation.property.namespaceURI, operation.property.localName)] =
        JSON.stringify(operation.property);
      successfulSetProperties.push(operation.property);
    } else {
      delete customMetadata[getDeadPropertyKey(operation.property.namespaceURI, operation.property.localName)];
      successfulRemoveProperties.push(operation.property);
    }
  }

  const hasFailures = failedSetProperties.length > 0 || failedRemoveProperties.length > 0;
  if (!hasFailures) {
    const src = await getUserObject(userId, resourcePath, env);
    if (src === null) {
      return new Response('Not Found', { status: 404 });
    }

    await putUserObject(userId, resourcePath, src.body, env, {
      customMetadata,
    });
  }

  const successStatus = hasFailures ? 'HTTP/1.1 424 Failed Dependency' : 'HTTP/1.1 200 OK';
  const propstats = new Map<string, string[]>();

  const appendPropstat = (property: DeadProperty, status: string) => {
    const props = propstats.get(status) ?? [];
    props.push(renderEmptyPropertyElement({ ...property, valueXml: '' }));
    propstats.set(status, props);
  };

  for (const property of successfulSetProperties) {
    appendPropstat(property, successStatus);
  }
  for (const property of successfulRemoveProperties) {
    appendPropstat(property, successStatus);
  }
  for (const property of failedSetProperties) {
    appendPropstat(property, 'HTTP/1.1 403 Forbidden');
  }
  for (const property of failedRemoveProperties) {
    appendPropstat(property, 'HTTP/1.1 403 Forbidden');
  }

  let responseXML = `<?xml version="1.0" encoding="utf-8"?>\n<multistatus xmlns="DAV:">\n\t<response>\n\t\t<href>${escapeXml(getResourceHref(resourcePath, object.customMetadata?.resourcetype === '<collection />'))}</href>`;
  for (const [status, propNames] of propstats) {
    responseXML += `\n\t\t<propstat>\n\t\t\t<prop>\n${propNames.map(propName => `\t\t\t\t${propName}`).join('\n')}\n\t\t\t</prop>\n\t\t\t<status>${status}</status>\n\t\t</propstat>`;
  }
  responseXML += '\n\t</response>\n</multistatus>';

  return new Response(responseXML, {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

// COPY 方法
async function handleCopy(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  const destinationHeader = request.headers.get('Destination');
  if (destinationHeader === null) {
    return new Response('Bad Request', { status: 400 });
  }

  const destination = parseDestinationPath(destinationHeader, request.url);
  if (destination === null) {
    return new Response('Bad Request', { status: 400 });
  }

  // 提取目标路径的相对部分
  const userPrefix = `${userId}/`;
  const destRelative = destination.startsWith(userPrefix) 
    ? destination.slice(userPrefix.length)
    : destination;

  const dontOverwrite = request.headers.get('Overwrite') === 'F';

  const resource = await headUserObject(userId, resourcePath, env);
  if (resource === null) {
    return new Response('Not Found', { status: 404 });
  }

  const destExists = await headUserObject(userId, destRelative, env);
  if (dontOverwrite && destExists) {
    return new Response('Precondition Failed', { status: 412 });
  }

  const isDir = resource.customMetadata?.resourcetype === '<collection />';

  if (isDir) {
    // 复制目录
    const prefix = `${resourcePath}/`;
    const listed = await listUserObjects(userId, prefix, env);
    
    for (const object of listed.objects) {
      const relativePath = object.key.slice(`${userId}/${prefix}`.length);
      const destKey = `${destRelative}/${relativePath}`;
      const src = await getUserObject(userId, `${prefix}${relativePath}`, env);
      if (src !== null) {
        await putUserObject(userId, destKey, src.body, env, {
          httpMetadata: object.httpMetadata,
          customMetadata: stripLockMetadata(object.customMetadata),
        });
      }
    }

    // 创建目标目录
    await putUserObject(userId, destRelative, new Uint8Array(), env, {
      customMetadata: { resourcetype: '<collection />' },
    });
  } else {
    // 复制文件
    const src = await getUserObject(userId, resourcePath, env);
    if (src === null) {
      return new Response('Not Found', { status: 404 });
    }

    await putUserObject(userId, destRelative, src.body, env, {
      httpMetadata: src.httpMetadata,
      customMetadata: stripLockMetadata(src.customMetadata),
    });
  }

  return destExists ? new Response(null, { status: 204 }) : new Response('', { status: 201 });
}

// MOVE 方法
async function handleMove(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  const destinationHeader = request.headers.get('Destination');
  if (destinationHeader === null) {
    return new Response('Bad Request', { status: 400 });
  }

  const destination = parseDestinationPath(destinationHeader, request.url);
  if (destination === null) {
    return new Response('Bad Request', { status: 400 });
  }

  const userPrefix = `${userId}/`;
  const destRelative = destination.startsWith(userPrefix) 
    ? destination.slice(userPrefix.length)
    : destination;

  const overwrite = (request.headers.get('Overwrite') ?? 'T') !== 'F';

  const resource = await headUserObject(userId, resourcePath, env);
  if (resource === null) {
    return new Response('Not Found', { status: 404 });
  }

  if (resourcePath === destRelative) {
    return new Response('Bad Request', { status: 400 });
  }

  const destExists = await headUserObject(userId, destRelative, env);
  if (!overwrite && destExists) {
    return new Response('Precondition Failed', { status: 412 });
  }

  // 如果目标存在，先删除
  if (destExists) {
    await deleteUserObject(userId, destRelative, env);
  }

  const isDir = resource.customMetadata?.resourcetype === '<collection />';

  if (isDir) {
    // 移动目录
    const prefix = `${resourcePath}/`;
    const listed = await listUserObjects(userId, prefix, env);
    
    for (const object of listed.objects) {
      const relativePath = object.key.slice(`${userId}/${prefix}`.length);
      const destKey = `${destRelative}/${relativePath}`;
      const src = await getUserObject(userId, `${prefix}${relativePath}`, env);
      if (src !== null) {
        await putUserObject(userId, destKey, src.body, env, {
          httpMetadata: object.httpMetadata,
          customMetadata: getPreservedCustomMetadata(object.customMetadata),
        });
        await deleteUserObject(userId, `${prefix}${relativePath}`, env);
      }
    }

    // 删除源目录
    await deleteUserObject(userId, resourcePath, env);
  } else {
    // 移动文件
    const src = await getUserObject(userId, resourcePath, env);
    if (src === null) {
      return new Response('Not Found', { status: 404 });
    }

    await putUserObject(userId, destRelative, src.body, env, {
      httpMetadata: src.httpMetadata,
      customMetadata: getPreservedCustomMetadata(src.customMetadata),
    });
    await deleteUserObject(userId, resourcePath, env);
  }

  return destExists ? new Response(null, { status: 204 }) : new Response('', { status: 201 });
}

// LOCK 方法
async function handleLock(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  // 简化实现：返回成功
  const token = crypto.randomUUID();
  const lockDetails = {
    token,
    owner: undefined,
    scope: 'exclusive' as const,
    depth: '0' as const,
    timeout: 'Second-3600',
    expiresAt: Date.now() + 3600 * 1000,
    root: getResourceHref(resourcePath, false),
  };

  const response = `<?xml version="1.0" encoding="utf-8"?>
<prop xmlns="DAV:">
  <lockdiscovery>
    <activelock>
      <locktype><write /></locktype>
      <lockscope><exclusive /></lockscope>
      <depth>0</depth>
      <timeout>Second-3600</timeout>
      <locktoken><href>urn:uuid:${token}</href></locktoken>
      <lockroot><href>${escapeXml(lockDetails.root)}</href></lockroot>
    </activelock>
  </lockdiscovery>
</prop>`;

  return new Response(response, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Lock-Token': `<urn:uuid:${token}>`,
    },
  });
}

// UNLOCK 方法
async function handleUnlock(
  request: Request,
  env: Env,
  userId: string,
  resourcePath: string
): Promise<Response> {
  // 简化实现：返回成功
  return new Response(null, { status: 204 });
}

// 辅助函数
function getDeadProperties(metadata: Record<string, string> | undefined): DeadProperty[] {
  if (metadata === undefined) {
    return [];
  }
  return Object.entries(metadata)
    .filter(([key]) => key.startsWith(DEAD_PROPERTY_PREFIX))
    .map(([, value]) => JSON.parse(value) as DeadProperty);
}

function getLivePropertyValue(object: R2Object | null, property: DeadProperty): string | undefined {
  if (property.namespaceURI !== DAV_NAMESPACE) {
    return undefined;
  }
  return fromR2Object(object)[property.localName as keyof ReturnType<typeof fromR2Object>];
}

function isProtectedProperty(propName: DeadProperty): boolean {
  const lockKeys = ['lock_token', 'lock_owner', 'lock_scope', 'lock_depth', 'lock_timeout', 'lock_expires_at', 'lock_root', 'lock_records'];
  return lockKeys.includes(propName.localName) || propName.localName === 'supportedlock' || propName.localName === 'lockdiscovery';
}

function getDeadPropertyKey(namespaceURI: string, localName: string): string {
  return `dead_property:${encodeURIComponent(namespaceURI)}:${encodeURIComponent(localName)}`;
}

function getDeadProperty(
  metadata: Record<string, string> | undefined,
  namespaceURI: string,
  localName: string
): DeadProperty | null {
  const value = metadata?.[getDeadPropertyKey(namespaceURI, localName)];
  if (value === undefined) {
    return null;
  }
  return JSON.parse(value) as DeadProperty;
}

function renderPropertyElement(property: DeadProperty): string {
  const qualifiedName = property.prefix ? `${property.prefix}:${property.localName}` : property.localName;
  const namespaceDeclaration =
    property.namespaceURI === ''
      ? ' xmlns=""'
      : property.prefix
        ? ` xmlns:${property.prefix}="${escapeXml(property.namespaceURI)}"`
        : ` xmlns="${escapeXml(property.namespaceURI)}"`;
  return `<${qualifiedName}${namespaceDeclaration}>${property.valueXml}</${qualifiedName}>`;
}

function renderEmptyPropertyElement(property: DeadProperty): string {
  const qualifiedName = property.prefix ? `${property.prefix}:${property.localName}` : property.localName;
  const namespaceDeclaration =
    property.namespaceURI === ''
      ? ' xmlns=""'
      : property.prefix
        ? ` xmlns:${property.prefix}="${escapeXml(property.namespaceURI)}"`
        : ` xmlns="${escapeXml(property.namespaceURI)}"`;
  return `<${qualifiedName}${namespaceDeclaration} />`;
}

function renderPropstat(status: string, properties: string[]): string {
  if (properties.length === 0) {
    return '';
  }
  return `
    <propstat>
      <prop>
      ${properties.join('\n        ')}
      </prop>
      <status>${status}</status>
    </propstat>`;
}
