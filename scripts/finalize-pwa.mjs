import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPwaContext, checkPwaCapabilities, sha256, pwaContextSha256, pwaRuntime, PWA_MIME_TYPES } from './pwa-context.mjs'
import { PWA_PROTOCOL_VERSION } from './gen/pwa-contract.mjs'
import { makePwaIcons } from './make-pwa-icons.mjs'
import { checkPwa } from './check-pwa.mjs'

export function pwaFiles(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const file = path.join(dir, name)
    const rel = `${prefix}${name}`
    const stat = lstatSync(file)
    if (stat.isSymbolicLink()) throw new Error(`PWA 产物禁止符号链接：${rel}`)
    if (stat.isDirectory()) return pwaFiles(file, `${rel}/`)
    if (!stat.isFile()) throw new Error(`PWA 产物不是普通文件：${rel}`)
    return [rel]
  })
}

export async function finalizePwa(root, outDir = path.join(root, 'dist/pwa')) {
  root = path.resolve(root)
  outDir = path.resolve(outDir)
  const context = readPwaContext(root)
  const capabilityCheck = checkPwaCapabilities(root, context)
  const icons = await makePwaIcons(root, outDir, context)
  const manifest = { id: context.appBasePath, start_url: context.appBasePath, scope: context.appBasePath,
    name: context.name, short_name: context.shortName, display: 'standalone',
    theme_color: context.themeColor, background_color: context.backgroundColor, icons }
  writeFileSync(path.join(outDir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`)
  const rgb = context.backgroundColor.slice(1).match(/../g).map((channel) => parseInt(channel, 16))
  const foreground = rgb.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0) > 128 ? 'black' : 'white'
  writeFileSync(path.join(outDir, 'offline.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="${context.themeColor}"><title>暂时离线</title><style>body{margin:0;background:${context.backgroundColor};color:${foreground};font-family:system-ui,sans-serif;padding:calc(env(safe-area-inset-top,0px) + 24px) 24px calc(env(safe-area-inset-bottom,0px) + 24px)}a{color:inherit}</style></head><body><main><h1>暂时离线</h1><p>连接网络后，请重新打开应用。</p><a href="${context.appBasePath}">重试</a></main></body></html>\n`)
  const precache = pwaFiles(outDir).filter((file) => !['sw.js', 'manifest.webmanifest', 'pwa-build-report.json'].includes(file)).map((file) => {
    const type = PWA_MIME_TYPES[path.extname(file).toLowerCase()]
    if (!type) throw new Error(`PWA 静态文件 MIME 未登记：${file}`)
    return { url: `${context.assetBasePath}${file}`, type }
  })
  const config = { ...pwaRuntime(context), precache,
    navigationUrl: `${context.assetBasePath}index.html`, offlineUrl: `${context.assetBasePath}offline.html` }
  delete config.origin
  const template = readFileSync(path.join(root, 'src/shared/pwa/sw-template.js'), 'utf8')
  if (template.split('__PWA_CONFIG__').length !== 2) throw new Error('sw-template.js 必须恰有一个 __PWA_CONFIG__ 字符串占位')
  writeFileSync(path.join(outDir, 'sw.js'), template.replace('__PWA_CONFIG__', JSON.stringify(config)))
  const files = pwaFiles(outDir).filter((file) => file !== 'pwa-build-report.json').map((file) => {
    const data = readFileSync(path.join(outDir, file))
    const contentType = PWA_MIME_TYPES[path.extname(file).toLowerCase()]
    if (!contentType) throw new Error(`PWA 文件 MIME 未登记：${file}`)
    return { path: file, sha256: sha256(data), size: String(data.length), contentType }
  })
  const report = { protocolVersion: PWA_PROTOCOL_VERSION, buildId: context.buildId, contextSha256: pwaContextSha256(context),
    files, supportedCapabilities: capabilityCheck.supported }
  writeFileSync(path.join(outDir, 'pwa-build-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  const result = await checkPwa(root, outDir)
  if (!result.ok) throw new Error(`PWA 校验失败：\n${result.errors.join('\n')}`)
  return report
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
  try { await finalizePwa(root); console.log('PWA 构建收尾与产物校验通过：dist/pwa/') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
