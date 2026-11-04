import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readPwaContext, checkPwaCapabilities, canonicalJson, sha256, htmlTags, pwaHead, pwaRuntime, pwaContextSha256 } from './pwa-context.mjs'
import { PWA_REPORT_FIELDS, PWA_FILE_FIELDS, PWA_PROTOCOL_VERSION, PWA_MIME_TYPES } from './gen/pwa-contract.mjs'
import { PWA_ICONS } from './make-pwa-icons.mjs'

export async function checkPwa(root, outDir = path.join(root, 'dist/pwa')) {
  const errors = []
  const assert = (condition, message) => { if (!condition) errors.push(message) }
  try {
    root = path.resolve(root)
    outDir = path.resolve(outDir)
    const context = readPwaContext(root)
    const capabilityCheck = checkPwaCapabilities(root, context)
    const read = (file) => readFileSync(path.join(outDir, file), 'utf8')
    function walk(dir, prefix = '') {
      return readdirSync(dir).sort().flatMap((name) => {
        const file = path.join(dir, name)
        const stat = lstatSync(file)
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`非法产物文件：${prefix}${name}`)
        return stat.isDirectory() ? walk(file, `${prefix}${name}/`) : [`${prefix}${name}`]
      })
    }
    const files = walk(outDir)
    const fileSet = new Set(files)
    for (const required of ['index.html', 'offline.html', 'manifest.webmanifest', 'sw.js', 'pwa-build-report.json']) assert(fileSet.has(required), `缺少 ${required}`)
    for (const file of files) {
      assert(!/(?:^|\/)(?:\.[^/]*|capsule|signing|functions|src|node_modules|admin)(?:\/|$)|\.(?:p12|pem|key|properties|ts|tsx|map)$/i.test(file)
        && !['admin.html', 'manifest.json', 'package.json', 'package-lock.json'].includes(file), `产物混入内部/原生材料：${file}`)
      assert(!/[\\%?#\x00-\x20]/.test(file) && file.split('/').every((part) => part !== '..'), `产物路径不安全：${file}`)
    }
    const report = JSON.parse(read('pwa-build-report.json'))
    assert(Object.keys(report).length === PWA_REPORT_FIELDS.length && Object.keys(report).every((key) => PWA_REPORT_FIELDS.includes(key)), 'report 含未知字段/缺字段')
    assert(report.protocolVersion === PWA_PROTOCOL_VERSION && report.buildId === context.buildId, 'report 协议/buildId 错误')
    assert(report.contextSha256 === pwaContextSha256(context), 'context 指纹不一致')
    assert(canonicalJson(report.supportedCapabilities) === canonicalJson(capabilityCheck.supported), 'report 能力检查不一致')
    assert(!read('pwa-build-report.json').includes('publicBackend') && !read('pwa-build-report.json').includes('ANON_KEY')
      && (!context.publicBackend?.anonKey || !read('pwa-build-report.json').includes(context.publicBackend.anonKey)), 'report 泄漏后端配置/key')
    assert(Array.isArray(report.files), 'report 缺少文件清单')
    const reported = new Set()
    for (const item of report.files ?? []) {
      assert(item && Object.keys(item).length === PWA_FILE_FIELDS.length && Object.keys(item).every((key) => PWA_FILE_FIELDS.includes(key)), 'report 文件含未知字段/缺字段')
      assert(typeof item.path === 'string' && fileSet.has(item.path) && item.path !== 'pwa-build-report.json' && !reported.has(item.path), 'report 文件路径无效/重复')
      if (!fileSet.has(item.path)) continue
      reported.add(item.path)
      const data = readFileSync(path.join(outDir, item.path))
      assert(typeof item.size === 'string' && /^(0|[1-9]\d*)$/.test(item.size) && item.size === String(data.length)
        && item.sha256 === sha256(data), `文件摘要不一致：${item.path}`)
      assert(item.contentType === PWA_MIME_TYPES[path.extname(item.path).toLowerCase()], `文件 contentType 不一致：${item.path}`)
    }
    assert(files.filter((file) => file !== 'pwa-build-report.json').every((file) => reported.has(file)), 'report 漏报文件')
    const manifest = JSON.parse(read('manifest.webmanifest'))
    for (const field of ['id', 'scope', 'start_url']) assert(manifest[field] === context.appBasePath, `manifest ${field} 必须是稳定应用根`)
    for (const [field, value] of Object.entries({ display: 'standalone', name: context.name, short_name: context.shortName, theme_color: context.themeColor, background_color: context.backgroundColor })) {
      assert(manifest[field] === value, `manifest ${field} 不一致`)
    }
    const resolveRef = (url, from, stable = false) => {
      let resolved
      try { resolved = new URL(url, `${context.origin}${context.assetBasePath}${from}`) } catch { assert(false, `无效引用：${url}`); return }
      assert(resolved.origin === context.origin && !resolved.search && !resolved.hash && !/%|\\/.test(url), `引用不是本应用纯本地路径：${url}`)
      let relative
      if (resolved.pathname.startsWith(context.assetBasePath)) relative = resolved.pathname.slice(context.assetBasePath.length)
      else if (stable && resolved.pathname.startsWith(context.appBasePath)) relative = resolved.pathname.slice(context.appBasePath.length)
      else { assert(false, `引用越出当前应用版本：${url}`); return }
      assert(fileSet.has(relative), `引用文件不存在：${url}`)
    }
    assert(Array.isArray(manifest.icons) && manifest.icons.length === PWA_ICONS.length, 'manifest 图标清单错误')
    for (const icon of PWA_ICONS) {
      const matches = (manifest.icons ?? []).filter((entry) => entry.src === `${context.appBasePath}icons/${icon.file}`)
      assert(matches.length === 1 && matches[0].sizes === `${icon.size}x${icon.size}` && matches[0].type === 'image/png' && matches[0].purpose === icon.purpose, `manifest 图标字段错误：${icon.file}`)
      const file = path.join(outDir, 'icons', icon.file)
      const meta = await sharp(file).metadata()
      assert(meta.format === 'png' && meta.width === icon.size && meta.height === icon.size && (meta.pages ?? 1) === 1, `PNG 尺寸/格式错误：${icon.file}`)
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let opaque = true
      let safe = true
      const bg = context.backgroundColor.slice(1).match(/../g).map((n) => parseInt(n, 16))
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const offset = (y * info.width + x) * info.channels
        if (data[offset + 3] !== 255) opaque = false
        if (icon.purpose === 'maskable' && Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) > info.width * 0.4
          && bg.some((value, channel) => Math.abs(data[offset + channel] - value) > 1)) safe = false
      }
      assert(opaque, `PNG 必须不透明：${icon.file}`)
      assert(safe, 'maskable 主体越出直径 80% 的圆形安全区')
    }
    const html = read('index.html')
    const tags = htmlTags(html)
    for (const expected of pwaHead(context)) {
      const matches = tags.filter((tag) => tag.tag === expected.tag && (expected.attrs.name ? tag.attrs.name?.toLowerCase() === expected.attrs.name
        : tag.attrs.rel?.toLowerCase().split(/\s+/).includes(expected.attrs.rel)))
      assert(matches.length === 1 && Object.entries(expected.attrs).every(([key, value]) => matches[0]?.attrs[key] === value), `PWA head 缺失/重复/错误：${expected.attrs.name ?? expected.attrs.rel}`)
    }
    const viewport = tags.filter((tag) => tag.tag === 'meta' && tag.attrs.name?.toLowerCase() === 'viewport')
    assert(viewport.length === 1 && /viewport-fit\s*=\s*cover/.test(viewport[0].attrs.content ?? '') && !/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\D|$)/i.test(viewport[0].attrs.content ?? ''), 'viewport 不合格')
    for (const file of files.filter((file) => /\.(?:html|css|js|mjs|json|webmanifest|svg)$/.test(file))) {
      const text = read(file)
      assert(!/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|\b(?:AbilityAPIKey|PAY_TOKEN|SUPABASE_SERVICE_ROLE_KEY|TOS_SECRET_KEY)\b|sb_secret_[A-Za-z0-9_]+/.test(text), `产物出现秘密材料标志：${file}`)
      for (const jwt of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
        try { assert(JSON.parse(Buffer.from(jwt[0].split('.')[1], 'base64url').toString()).role !== 'service_role', `产物出现 service_role JWT：${file}`) } catch { /* 非 JWT 字符串不作权限断言 */ }
      }
      if (/\.html$/.test(file)) {
        for (const element of text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) resolveRef(element[1], file)
      }
      if (/\.html$/.test(file)) for (const tag of htmlTags(text)) {
        if (tag.tag === 'script' && tag.attrs.src) resolveRef(tag.attrs.src, file)
        if (tag.tag === 'link' && tag.attrs.href) resolveRef(tag.attrs.href, file, ['manifest', 'apple-touch-icon'].includes(tag.attrs.rel))
        assert(!(tag.tag === 'script' && /capsule(?:\.min)?\.js/i.test(tag.attrs.src ?? '')), `PWA 引入 capsule SDK：${file}`)
      }
      if (/\.(?:js|mjs)$/.test(file)) {
        assert(!/\/sdk\/capsule\.js|__ai-builder\/native-report|\bcreateMockCapsule\b|\bmockCapsule\b|\bcreateMockSdk\b|mock_app|example\.com\/mock-scan|data-step-source|SIMULATED_APIS|ai-builder\.local/.test(text), `PWA 存在原生 SDK/开发 mock：${file}`)
        for (const match of text.matchAll(/(?:\b(?:from|import)\s*|import\s*\(\s*|new URL\s*\(\s*)["']([^"']+\.(?:js|mjs|css|png|svg|woff2?))["']/g)) resolveRef(match[1], file)
      }
      if (/\.css$/.test(file)) for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
        if (!match[1].startsWith('data:') && !match[1].startsWith('#')) resolveRef(match[1], file)
      }
      for (const match of text.matchAll(/\/apps\/[A-Za-z0-9_-]+\/releases\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+/g)) {
        if (match[0] !== context.assetBasePath) resolveRef(match[0], file)
      }
    }
    const offline = read('offline.html')
    assert(!htmlTags(offline).some((tag) => tag.tag === 'script') && !/supabase|https?:\/\/|fetch\s*\(/i.test(offline), '离线页依赖后端/脚本')
    const sw = read('sw.js')
    const template = readFileSync(path.join(root, 'src/shared/pwa/sw-template.js'), 'utf8')
    assert(template.split('__PWA_CONFIG__').length === 2, 'SW 模板占位必须唯一')
    const [before, after] = template.split('__PWA_CONFIG__')
    assert(sw.startsWith(before) && sw.endsWith(after) && !sw.includes('__PWA_CONFIG__'), 'SW 不匹配已审核模板')
    const swConfig = JSON.parse(sw.slice(before.length, after.length ? -after.length : undefined))
    const expectedRuntime = pwaRuntime(context)
    delete expectedRuntime.origin
    for (const [key, value] of Object.entries({ ...expectedRuntime, navigationUrl: `${context.assetBasePath}index.html`, offlineUrl: `${context.assetBasePath}offline.html` })) assert(swConfig[key] === value, `SW ${key} 不一致`)
    const staticFiles = files.filter((file) => !['sw.js', 'pwa-build-report.json', 'manifest.webmanifest'].includes(file))
    assert(Array.isArray(swConfig.precache) && swConfig.precache.length === staticFiles.length, 'SW 预缓存清单不完整')
    const cached = new Set()
    for (const item of swConfig.precache ?? []) {
      resolveRef(item.url, 'sw.js')
      const rel = item.url.slice(context.assetBasePath.length)
      assert(staticFiles.includes(rel) && !cached.has(rel) && item.type === PWA_MIME_TYPES[path.extname(rel).toLowerCase()], `SW 预缓存条目/MIME 错误：${item.url}`)
      cached.add(rel)
    }
    assert(staticFiles.every((file) => cached.has(file)), 'SW 漏缓存静态文件')
  } catch (error) { errors.push(error.message) }
  return { ok: errors.length === 0, errors }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
  const result = await checkPwa(root, process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'dist/pwa'))
  if (!result.ok) { console.error(result.errors.join('\n')); process.exitCode = 1 }
  else console.log('PWA 产物校验通过')
}
