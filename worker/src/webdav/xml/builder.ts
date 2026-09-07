import { DavProperties, DeadProperty, LockDetails } from '../types';
import { DAV_NAMESPACE, DEAD_PROPERTY_PREFIX } from '../config';

// XML 转义
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// 获取资源 Href
export function getResourceHref(key: string, isCollection: boolean): string {
  const encodeHrefPath = (href: string): string => {
    if (href === '/') {
      return '/';
    }
    return href
      .split('/')
      .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
      .join('/');
  };

  if (key === '') {
    return '/';
  }
  return encodeHrefPath(`/${key + (isCollection ? '/' : '')}`);
}

// 从 R2Object 生成 DavProperties
export function fromR2Object(object: R2Object | null | undefined): DavProperties {
  if (object === null || object === undefined) {
    return {
      creationdate: new Date().toUTCString(),
      displayname: undefined,
      getcontentlanguage: undefined,
      getcontentlength: '0',
      getcontenttype: undefined,
      getetag: undefined,
      getlastmodified: new Date().toUTCString(),
      resourcetype: '<collection />',
      supportedlock: getSupportedLock(),
      lockdiscovery: '',
    };
  }

  const isCollection = object.customMetadata?.resourcetype === '<collection />';
  const lockDetails = getLockDetails(object.customMetadata);
  
  return {
    creationdate: object.uploaded.toUTCString(),
    displayname: object.httpMetadata?.contentDisposition,
    getcontentlanguage: object.httpMetadata?.contentLanguage,
    getcontentlength: object.size.toString(),
    getcontenttype: object.httpMetadata?.contentType,
    getetag: object.etag,
    getlastmodified: object.uploaded.toUTCString(),
    resourcetype: object.customMetadata?.resourcetype ?? '',
    supportedlock: getSupportedLock(),
    lockdiscovery:
      lockDetails.length === 0
        ? ''
        : getLockDiscovery(
            lockDetails.map(lockDetail => ({
              ...lockDetail,
              root: getResourceHref(object.key, isCollection),
            }))
          ),
  };
}

// 获取支持的锁类型
export function getSupportedLock(): string {
  return [
    '<lockentry><lockscope><exclusive /></lockscope><locktype><write /></locktype></lockentry>',
    '<lockentry><lockscope><shared /></lockscope><locktype><write /></locktype></lockentry>',
  ].join('');
}

// 从自定义元数据获取锁详情
export function getLockDetails(
  customMetadata: Record<string, string> | undefined
): LockDetails[] {
  const records = customMetadata?.lock_records;
  if (records !== undefined) {
    try {
      const parsed = JSON.parse(records);
      if (Array.isArray(parsed)) {
        return parsed.flatMap(lockDetails => {
          if (lockDetails && typeof lockDetails === 'object' && typeof lockDetails.token === 'string') {
            const normalized = normalizeLockDetails(lockDetails as Partial<LockDetails> & Pick<LockDetails, 'token'>);
            return normalized === null ? [] : [normalized];
          }
          return [];
        });
      }
    } catch {}
  }

  const token = customMetadata?.lock_token;
  if (token === undefined) {
    return [];
  }

  const normalized = normalizeLockDetails({
    token,
    owner: customMetadata?.lock_owner,
    scope: customMetadata?.lock_scope === 'shared' ? 'shared' : 'exclusive',
    depth: customMetadata?.lock_depth === 'infinity' ? 'infinity' : '0',
    timeout: customMetadata?.lock_timeout ?? `Second-3600`,
    expiresAt: Number(customMetadata?.lock_expires_at ?? 0),
    root: customMetadata?.lock_root ?? '/',
  });
  
  return normalized === null ? [] : [normalized];
}

// 规范化锁详情
function normalizeLockDetails(
  lockDetails: Partial<LockDetails> & Pick<LockDetails, 'token'>
): LockDetails | null {
  let expiresAt = Number(lockDetails.expiresAt ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    expiresAt = Date.now() + 3600 * 1000;
  }
  if (expiresAt <= Date.now()) {
    return null;
  }

  return {
    token: lockDetails.token,
    owner: lockDetails.owner,
    scope: lockDetails.scope === 'shared' ? 'shared' : 'exclusive',
    depth: lockDetails.depth === 'infinity' ? 'infinity' : '0',
    timeout: lockDetails.timeout ?? 'Second-3600',
    expiresAt,
    root: lockDetails.root ?? '/',
  };
}

// 获取锁发现信息
export function getLockDiscovery(lockDetails: LockDetails | LockDetails[]): string {
  const lockDetailList = Array.isArray(lockDetails) ? lockDetails : [lockDetails];
  return lockDetailList
    .map(
      lockDetail =>
        `<activelock><locktype><write /></locktype><lockscope><${lockDetail.scope} /></lockscope><depth>${lockDetail.depth}</depth>${lockDetail.owner ? `<owner>${escapeXml(lockDetail.owner)}</owner>` : ''}<timeout>${escapeXml(lockDetail.timeout)}</timeout><locktoken><href>urn:uuid:${escapeXml(lockDetail.token)}</href></locktoken><lockroot><href>${escapeXml(lockDetail.root)}</href></lockroot></activelock>`
    )
    .join('');
}

// 渲染 DAV 属性
export function renderDavProperty(propName: string, value: string): string {
  const rawXmlProperties = new Set(['resourcetype', 'supportedlock', 'lockdiscovery']);
  const content = rawXmlProperties.has(propName) ? value : escapeXml(value);
  return `<${propName}>${content}</${propName}>`;
}

// 渲染 Dead Property 元素
export function renderPropertyElement(property: DeadProperty): string {
  const qualifiedName = property.prefix ? `${property.prefix}:${property.localName}` : property.localName;
  const namespaceDeclaration =
    property.namespaceURI === ''
      ? ' xmlns=""'
      : property.prefix
        ? ` xmlns:${property.prefix}="${escapeXml(property.namespaceURI)}"`
        : ` xmlns="${escapeXml(property.namespaceURI)}"`;
  return `<${qualifiedName}${namespaceDeclaration}>${property.valueXml}</${qualifiedName}>`;
}

// 渲染空 Dead Property 元素
export function renderEmptyPropertyElement(property: DeadProperty): string {
  const qualifiedName = property.prefix ? `${property.prefix}:${property.localName}` : property.localName;
  const namespaceDeclaration =
    property.namespaceURI === ''
      ? ' xmlns=""'
      : property.prefix
        ? ` xmlns:${property.prefix}="${escapeXml(property.namespaceURI)}"`
        : ` xmlns="${escapeXml(property.namespaceURI)}"`;
  return `<${qualifiedName}${namespaceDeclaration} />`;
}

// 渲染 propstat
export function renderPropstat(status: string, properties: string[]): string {
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

// 获取 Dead Property key
export function getDeadPropertyKey(namespaceURI: string, localName: string): string {
  return `${DEAD_PROPERTY_PREFIX}${encodeURIComponent(namespaceURI)}:${encodeURIComponent(localName)}`;
}

// 从元数据获取 Dead Property
export function getDeadProperty(
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

// 获取所有 Dead Properties
export function getDeadProperties(
  metadata: Record<string, string> | undefined
): DeadProperty[] {
  if (metadata === undefined) {
    return [];
  }
  return Object.entries(metadata)
    .filter(([key]) => key.startsWith(DEAD_PROPERTY_PREFIX))
    .map(([, value]) => JSON.parse(value) as DeadProperty);
}

// 保留的自定义元数据
export function getPreservedCustomMetadata(
  customMetadata: Record<string, string> | undefined
): Record<string, string> {
  const lockDetails = getLockDetails(customMetadata);
  if (lockDetails.length === 0) {
    return stripLockMetadata(customMetadata);
  }
  return withLockMetadata(customMetadata, lockDetails);
}

// 去除锁元数据
export function stripLockMetadata(
  customMetadata: Record<string, string> | undefined
): Record<string, string> {
  const metadata = customMetadata ? { ...customMetadata } : {};
  const lockKeys = ['lock_token', 'lock_owner', 'lock_scope', 'lock_depth', 'lock_timeout', 'lock_expires_at', 'lock_root', 'lock_records'];
  for (const key of lockKeys) {
    delete metadata[key];
  }
  return metadata;
}

// 添加锁元数据
export function withLockMetadata(
  customMetadata: Record<string, string> | undefined,
  lockDetails: LockDetails | LockDetails[]
): Record<string, string> {
  const lockDetailList = Array.isArray(lockDetails) ? lockDetails : [lockDetails];
  if (lockDetailList.length === 0) {
    return stripLockMetadata(customMetadata);
  }
  return {
    ...stripLockMetadata(customMetadata),
    lock_records: JSON.stringify(lockDetailList),
  };
}
