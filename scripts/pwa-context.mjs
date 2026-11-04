import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PWA_CONTEXT_FIELDS, PWA_BACKEND_FIELDS, PWA_PROJECT_FIELDS, PWA_ENVIRONMENTS,
  PWA_CONTEXT_FILENAME, PWA_CONTEXT_ENV, PWA_PROTOCOL_VERSION, PWA_CONTEXT_DEFAULTS, PWA_BACKEND_DEFAULTS } from './gen/pwa-contract.mjs'

export const PUBLIC_BACKEND_KEYS = PWA_BACKEND_FIELDS
export { PWA_MIME_TYPES } from './gen/pwa-contract.mjs'
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  // Go encoding/json sorts map keys by UTF-8 and escapes HTML plus U+2028/U+2029.
  if (object(value)) return `{${Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((key) => `${canonicalJson(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export function pwaContextSha256(context) {
  // Mirror Go protojson EmitUnpopulated for hashing only; never mutate the frozen input.
  const wire = { ...PWA_CONTEXT_DEFAULTS, ...context }
  if (wire.publicBackend !== null) wire.publicBackend = { ...PWA_BACKEND_DEFAULTS, ...wire.publicBackend }
  return sha256(canonicalJson(wire))
}

export function localIconPath(root, source, materialized = process.env.VIBE_PWA_ICON_PATH) {
  requireValue(typeof source === 'string' && source.length > 0, 'iconSource 缺失')
  if (materialized !== undefined) {
    requireValue(typeof materialized === 'string' && path.isAbsolute(materialized), 'VIBE_PWA_ICON_PATH 必须是工程内已物化文件的绝对路径')
  } else {
    requireValue(!path.isAbsolute(source) && !/[\\:%?#\x00-\x1f]/.test(source)
    && source.split('/').every((part) => part && part !== '.' && part !== '..') && /\.(png|svg)$/i.test(source),
    'iconSource URL/data URI 必须由平台物化并提供 VIBE_PWA_ICON_PATH；否则仅允许工程内相对 PNG/SVG，不允许远程抓取')
  }
  const base = realpathSync(root)
  const file = realpathSync(path.resolve(base, materialized ?? source))
  requireValue(file.startsWith(`${base}${path.sep}`) && statSync(file).isFile(), 'iconSource 越出工程或不是文件')
  requireValue(statSync(file).size <= 10 * 1024 * 1024, 'iconSource 超过 10MB')
  const data = readFileSync(file)
  requireValue(/\.(png|svg)$/i.test(file), 'iconSource 物化文件必须为 PNG/SVG')
  if (/\.png$/i.test(file)) {
    requireValue(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'iconSource PNG 签名无效')
  } else {
    const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
    const svg = data.toString('utf8').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) =>
      entity.startsWith('#') ? String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))) : entities[entity.toLowerCase()])
    const fragment = (value) => /^#[^\s"'<>\\&()]+$/.test(value)
    const references = [...svg.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    const urls = [...svg.matchAll(/url\s*\(([^)]*)\)/gi)]
    requireValue(/<svg\b/i.test(svg) && !/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\bon\w+\s*=|@import|\\/i.test(svg)
      && references.every((match) => match[3] === undefined && fragment(match[1] ?? match[2]))
      && [...svg.matchAll(/url\s*\(/gi)].length === urls.length
      && urls.every((match) => fragment(match[1].trim().replace(/^("|')(.*)\1$/, '$2'))),
    'iconSource SVG 必须自包含，不允许外部引用、脚本或实体')
  }
  return file
}

function backgroundToken(root) {
  const css = readFileSync(path.join(root, 'src/shared/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens = new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map((match) => [match[1], match[2].trim()]))
  const seen = new Set()
  function resolve(key) {
    requireValue(!seen.has(key) && tokens.has(key), '--background token 缺失或循环引用')
    seen.add(key)
    const value = tokens.get(key)
    const ref = /^var\((--[\w-]+)\)$/.exec(value)
    if (ref) return resolve(ref[1])
    if (/^#[a-f\d]{6}$/i.test(value)) return value.toLowerCase()
    const rgb = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(value)
    requireValue(rgb && rgb.slice(1).every((n) => Number(n) <= 255), '--background 必须可解析为不透明 RGB 或 #RRGGBB')
    return `#${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  }
  return resolve('--background')
}

function freeze(value) {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

function capabilities(value) {
  return Array.isArray(value) && value.length <= 128 && value.every((item) => typeof item === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(item))
    && new Set(value).size === value.length
}

export function readPwaProjectConfig(root) {
  const config = JSON.parse(readFileSync(path.join(root, 'pwa.config.json'), 'utf8'))
  requireValue(object(config) && Object.keys(config).length === PWA_PROJECT_FIELDS.length
    && Object.keys(config).every((key) => PWA_PROJECT_FIELDS.includes(key)) && capabilities(config.requiredCapabilities),
    'pwa.config.json 必须仅包含无重复字符串列表 requiredCapabilities（PwaProjectConfig）')
  return freeze(config)
}

export function readPwaContext(root, contextPath = process.env[PWA_CONTEXT_ENV] || PWA_CONTEXT_FILENAME) {
  root = path.resolve(root)
  const raw = JSON.parse(readFileSync(path.resolve(root, contextPath), 'utf8'))
  requireValue(object(raw), 'PWA context 必须是对象')
  requireValue(Object.keys(raw).every((key) => PWA_CONTEXT_FIELDS.includes(key)), 'PWA context 含未知字段')
  requireValue(raw.protocolVersion === PWA_PROTOCOL_VERSION, '不支持的 PWA protocolVersion')
  for (const key of ['projectId', 'publicAppId', 'buildId', 'releaseId']) {
    requireValue(typeof raw[key] === 'string' && SLUG.test(raw[key]), `${key} 必须是 ASCII 安全 slug`)
  }
  requireValue(typeof raw.sourceCommit === 'string' && /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(raw.sourceCommit), 'sourceCommit 必须是 40 或 64 位 hex')
  requireValue(typeof raw.configRevision === 'string' && raw.configRevision.length > 0 && Buffer.byteLength(raw.configRevision) <= 256, 'configRevision 无效')
  requireValue(typeof raw.expectedLiveRevision === 'string' && /^(0|[1-9]\d*)$/.test(raw.expectedLiveRevision)
    && BigInt(raw.expectedLiveRevision) < 9223372036854775807n, 'expectedLiveRevision 必须是小于 MaxInt64 的规范非负十进制字符串')
  requireValue(typeof raw.releaseVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(raw.releaseVersion), 'releaseVersion 无效')
  requireValue(PWA_ENVIRONMENTS.includes(raw.environment), `environment 必须明确为 ${PWA_ENVIRONMENTS.join('/')}`)
  let origin
  try { origin = new URL(raw.origin) } catch { throw new Error('origin 无效') }
  requireValue(typeof raw.origin === 'string' && origin.protocol === 'https:' && origin.origin === raw.origin
    && !origin.username && !origin.password && !origin.search && !origin.hash, 'origin 必须是 HTTPS 纯 origin，不含路径、用户信息、query 或 hash')
  requireValue(raw.appBasePath === `/apps/${raw.publicAppId}/`, 'appBasePath 必须精确匹配稳定应用路径')
  requireValue(raw.assetBasePath === `${raw.appBasePath}releases/${raw.buildId}/`, 'assetBasePath 必须精确匹配当前不可变版本路径')
  for (const key of ['name', 'shortName']) {
    requireValue(typeof raw[key] === 'string' && raw[key].trim() === raw[key] && raw[key].length > 0
      && [...raw[key]].length <= (key === 'shortName' ? 12 : 128) && !/[\x00-\x1f\x7f]/.test(raw[key]), `${key} 无效`)
  }
  requireValue(['none', 'supabase', 'zhiyue'].includes(raw.authMode), 'authMode 未知')
  requireValue(raw.authMode !== 'zhiyue', 'zhiyue PWA Web 登录契约未就绪，禁止构建')
  const loginFile = path.join(root, '.app-login')
  requireValue(!existsSync(loginFile) || readFileSync(loginFile, 'utf8').trim() !== 'zhiyue', 'zhiyue 工程的 PWA Web 登录契约未就绪，禁止更换身份绕过')
  const capabilityFile = path.join(root, 'capability.json')
  if (existsSync(capabilityFile)) {
    const capability = JSON.parse(readFileSync(capabilityFile, 'utf8'))
    requireValue(capability.payment !== true, '支付 PWA Web 契约尚未准入，禁止构建支付应用')
    requireValue(capability.appAuth !== true || raw.authMode === 'supabase', '已实现 App 登录不能用 authMode=none 绕过身份准入')
  }
  requireValue(capabilities(raw.requiredCapabilities), 'requiredCapabilities 必须是无重复字符串列表')
  const config = readPwaProjectConfig(root)
  requireValue(canonicalJson(config.requiredCapabilities) === canonicalJson(raw.requiredCapabilities), 'requiredCapabilities 与冻结工程 pwa.config.json 不一致')
  const publicBackend = raw.publicBackend ?? PWA_BACKEND_DEFAULTS
  requireValue(object(publicBackend) && Object.keys(publicBackend).every((key) => PUBLIC_BACKEND_KEYS.includes(key)), 'publicBackend 含非公开白名单字段')
  for (const [key, value] of Object.entries(publicBackend)) {
    requireValue(typeof value === 'string' && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value), `${key} 无效`)
  }
  requireValue(!publicBackend.appEnvironment || ['dev', 'prod'].includes(publicBackend.appEnvironment), 'publicBackend.appEnvironment 必须是 dev/prod')
  for (const field of ['url']) {
    if (!publicBackend[field]) continue
    let url
    try { url = new URL(publicBackend[field]) } catch { throw new Error(`${field} 无效`) }
    requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'PWA 后端 URL 必须是 HTTPS 无凭据地址')
  }
  requireValue(!publicBackend.anonKey || publicBackend.url, 'anon key 必须有显式 HTTPS 后端 URL')
  requireValue(raw.authMode !== 'supabase' || (publicBackend.url && publicBackend.anonKey), 'supabase 模式缺少 HTTPS 后端配置/anon key')
  const key = publicBackend.anonKey
  if (key?.split('.').length === 3) {
    let claims
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()) } catch { throw new Error('anon key JWT 无效') }
    requireValue(claims.role === 'anon', '仅允许 anon JWT，禁止特权后端 key')
  }
  requireValue(!key?.startsWith('sb_secret_'), '禁止 Supabase secret key')
  localIconPath(root, raw.iconSource)
  const tokenColor = backgroundToken(root)
  for (const field of ['themeColor', 'backgroundColor']) {
    requireValue(typeof raw[field] === 'string' && /^#[a-f\d]{6}$/i.test(raw[field]), `${field} 必须由平台冻结为 #RRGGBB`)
    if (field === 'backgroundColor') requireValue(raw[field].toLowerCase() === tokenColor, 'backgroundColor 必须与首屏 --background token 一致')
  }
  // Preserve exactly the frozen wire object. Local hashes/derived values never enter its digest.
  return freeze(raw)
}

export function pwaViteEnv(context) {
  const backend = { ...PWA_BACKEND_DEFAULTS, ...context.publicBackend }
  return { VITE_PROJECT_ID: context.projectId, VITE_PROJECT_CODE: backend.projectCode,
    VITE_SUPABASE_URL: backend.url, VITE_SUPABASE_ANON_KEY: backend.anonKey,
    VITE_APP_ENVIRONMENT: backend.appEnvironment, VITE_SUPABASE_SCHEMA: '', VITE_API_BASE: '' }
}

export function checkPwaCapabilities(root, context) {
  const registry = JSON.parse(readFileSync(path.join(root, 'src/shared/bridge/browser-capabilities.json'), 'utf8'))
  requireValue(object(registry) && Array.isArray(registry.supported) && registry.supported.every((item) => typeof item === 'string'), 'browser-capabilities.json 必须包含 supported 字符串列表')
  const unsupported = context.requiredCapabilities.filter((item) => !registry.supported.includes(item))
  requireValue(unsupported.length === 0, `PWA 主流程能力不支持：${unsupported.join(', ')}`)
  return { required: context.requiredCapabilities, supported: context.requiredCapabilities,
    runtimeAuthorization: context.requiredCapabilities.map((capability) => ({ capability, status: 'pending-runtime-authorization' })) }
}

export function pwaRuntime(context) {
  return Object.fromEntries(['environment', 'publicAppId', 'buildId', 'appBasePath', 'assetBasePath', 'origin'].map((key) => [key, context[key]]))
}

export function htmlTags(html) {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(meta|link|script)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)].map((match) => {
    const attrs = {}
    for (const attr of match[2].matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = (attr[2] ?? attr[3] ?? attr[4] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    }
    return { tag: match[1].toLowerCase(), attrs, source: match[0] }
  })
}

export function pwaHead(context) {
  return [
    { tag: 'link', attrs: { rel: 'manifest', href: `${context.appBasePath}manifest.webmanifest` } },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: `${context.appBasePath}icons/apple-touch-icon.png` } },
    ...Object.entries({ 'apple-mobile-web-app-capable': 'yes', 'mobile-web-app-capable': 'yes', 'apple-mobile-web-app-title': context.shortName,
      'apple-mobile-web-app-status-bar-style': 'default', 'theme-color': context.themeColor,
      'app-target': 'pwa', 'pwa-build-id': context.buildId }).map(([name, content]) => ({ tag: 'meta', attrs: { name, content } })),
  ]
}

export function transformPwaHtml(html, context) {
  // 工程注释仅供开发阅读，不把壳 SDK/预览接线说明分发到公开 PWA。
  html = html.replace(/<!--[\s\S]*?-->/g, '')
  const tags = htmlTags(html)
  requireValue(!tags.some(({ tag, attrs }) => tag === 'script' && /(?:^|\/)capsule(?:\.min)?\.js(?:[?#]|$)/i.test(attrs.src ?? '')), 'PWA 入口禁止静态 capsule SDK 标签')
  const expected = pwaHead(context)
  if (expected.every((item) => {
    const matches = tags.filter((tag) => item.tag === tag.tag && (item.attrs.name ? item.attrs.name === tag.attrs.name?.toLowerCase()
      : tag.attrs.rel?.toLowerCase().split(/\s+/).includes(item.attrs.rel)))
    return matches.length === 1 && Object.entries(item.attrs).every(([key, value]) => matches[0].attrs[key] === value)
  })) return html
  for (const tag of tags) {
    if (expected.some((item) => item.tag === tag.tag && (item.attrs.name ? item.attrs.name === tag.attrs.name?.toLowerCase()
      : tag.attrs.rel?.toLowerCase().split(/\s+/).includes(item.attrs.rel)))) html = html.replace(tag.source, '')
  }
  const escape = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const head = expected.map(({ tag, attrs }) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}>`).join('\n')
  requireValue(/<\/head\s*>/i.test(html), 'index.html 缺少 head')
  return html.replace(/<\/head\s*>/i, `${head}\n</head>`)
}
