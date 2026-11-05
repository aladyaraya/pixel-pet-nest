import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPTS = path.join(ROOT, 'scripts')
const reportPath = path.join(ROOT, 'dist/build-report.json')
const lockPath = path.join(ROOT, 'dist/.build-lock')
mkdirSync(path.dirname(reportPath), { recursive: true })
try {
  mkdirSync(lockPath)
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.error('同一工程已有构建运行；多端请使用一次 npm run build 或 --targets，不要并发单端构建。若进程已异常退出，确认无构建后清理 dist/.build-lock 再重试。')
  process.exit(1)
}
process.on('exit', () => rmSync(lockPath, { recursive: true, force: true }))
const report = { protocolVersion: '1', targets: Object.fromEntries(['native', 'pwa', 'admin'].map((target) => [target, { status: 'not_requested' }])) }
const saveReport = () => writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
saveReport()
const args = process.argv.slice(2)
const legacy = args.filter((arg) => ['--client', '--admin', '--pwa'].includes(arg))
const targetArgs = args.filter((arg) => arg === '--targets' || arg.startsWith('--targets='))
let targets
let explicit = false
try {
  if (legacy.length > 1 || targetArgs.length > 1 || (legacy.length && targetArgs.length)) throw new Error('--client/--admin/--pwa/--targets 互斥')
  if (targetArgs.length) {
    const flag = targetArgs[0]
    const value = flag === '--targets' ? args[args.indexOf(flag) + 1] : flag.slice('--targets='.length)
    if (!value) throw new Error('--targets 必须提供 native,pwa[,admin] 目标列表')
    targets = value.split(',')
    const accepted = flag === '--targets' ? [flag, value] : [flag]
    if (args.some((arg) => !accepted.includes(arg))) throw new Error('未知构建参数')
    explicit = true
  } else if (legacy.length) {
    if (args.length !== 1) throw new Error('未知构建参数')
    targets = [legacy[0] === '--client' ? 'native' : legacy[0].slice(2)]
    explicit = true
  } else {
    if (args.length) throw new Error('未知构建参数')
    targets = ['native', 'pwa', 'admin']
  }
  if (targets.some((target) => !['native', 'admin', 'pwa'].includes(target)) || new Set(targets).size !== targets.length) throw new Error('构建目标未知或重复')
} catch (error) {
  for (const target of Object.keys(report.targets)) report.targets[target] = { status: 'failed', stage: 'dependencies', code: 'INVALID_BUILD_ARGUMENTS' }
  saveReport()
  console.error(error.message)
  process.exit(1)
}

const adminFiles = ['admin.html', 'vite.config.admin.ts', 'src/admin']
const presentAdmin = adminFiles.filter((file) => existsSync(path.join(ROOT, file)))
if (!explicit && presentAdmin.length === 0) {
  targets = targets.filter((target) => target !== 'admin')
  rmSync(path.join(ROOT, 'dist/admin'), { recursive: true, force: true })
}
for (const target of targets) report.targets[target] = { status: 'failed', stage: 'dependencies', code: 'BUILD_NOT_COMPLETED' }
saveReport()

const children = new Set()
let abortCode = 0
function forwardSignal(signal) {
  if (abortCode) return
  abortCode = signal === 'SIGINT' ? 130 : 143
  for (const child of children) child.kill(signal)
  setTimeout(() => process.exit(abortCode), 500)
}
process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

function run(name, cmd, argv, deferredOutput) {
  if (abortCode) return Promise.resolve(abortCode)
  return new Promise((resolve) => {
    let buffer = ''
    const child = spawn(cmd, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    children.add(child)
    const print = (line) => {
      if (deferredOutput) deferredOutput.push(`[${name}] ${line}\n`)
      else process.stdout.write(`[${name}] ${line}\n`)
    }
    const emit = (chunk) => {
      const lines = (buffer + chunk.toString()).split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) print(line)
    }
    child.stdout.on('data', emit)
    child.stderr.on('data', emit)
    child.on('error', (error) => { emit(`${error.message}\n`); resolve(1) })
    child.on('close', (code) => {
      children.delete(child)
      if (buffer) print(buffer)
      resolve(code ?? 1)
    })
  })
}

async function buildTarget(target) {
  let stage = 'context'
  const deferredOutput = target === 'pwa' && !explicit ? [] : undefined
  try {
    if (target === 'admin' && presentAdmin.length !== adminFiles.length) throw new Error('Admin 构建需要完整三件套')
    if (target === 'pwa') {
      const { readPwaContext, checkPwaCapabilities } = await import('./pwa-context.mjs')
      checkPwaCapabilities(ROOT, readPwaContext(ROOT))
    }
    const finalizer = target === 'pwa' ? 'finalize-pwa.mjs' : 'finalize-build.mjs'
    if (!existsSync(path.join(SCRIPTS, finalizer))) throw new Error(`缺少 ${finalizer}`)
    stage = 'build'
    const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    const configArgs = target === 'native' ? ['build'] : ['build', '--config', `vite.config.${target}.ts`]
    const buildCode = await run(`vite:${target}`, process.execPath, [vite, ...configArgs], deferredOutput)
    if (buildCode !== 0) throw new Error(`构建失败 (exit ${buildCode})`)
    stage = 'finalize'
    const flags = target === 'pwa' ? [] : [target === 'native' ? '--client' : '--admin']
    const finalizeCode = await run(`finalize:${target}`, process.execPath, [path.join(SCRIPTS, finalizer), ...flags], deferredOutput)
    if (finalizeCode !== 0) throw new Error(`收尾失败 (exit ${finalizeCode})`)
    report.targets[target] = { status: 'success', stage }
    if (deferredOutput?.length) process.stdout.write(deferredOutput.join(''))
  } catch (error) {
    report.targets[target] = { status: 'failed', stage, code: `${target.toUpperCase()}_${stage.toUpperCase()}_FAILED` }
    if (target === 'pwa') rmSync(path.join(ROOT, 'dist/pwa'), { recursive: true, force: true })
    if (target !== 'pwa' || explicit) console.warn(`[${target}] ${error.message}`)
  }
  saveReport()
}

if (targets.includes('pwa')) rmSync(path.join(ROOT, 'dist/pwa'), { recursive: true, force: true })
const depsCode = await run('deps', process.execPath, [path.join(SCRIPTS, 'ensure-deps.mjs')])
if (depsCode !== 0 || abortCode) {
  for (const target of targets) report.targets[target] = { status: 'failed', stage: 'dependencies', code: 'DEPENDENCIES_FAILED' }
  saveReport()
  process.exit(abortCode || depsCode)
}
await Promise.all(targets.map(buildTarget))
const failed = targets.filter((target) => report.targets[target].status === 'failed')
const blocking = failed.filter((target) => target !== 'pwa' || explicit)
if (blocking.length) console.warn(`构建结果：失败目标 ${blocking.join(', ')}；已成功目标的产物保留，详见 dist/build-report.json`)
process.exit(abortCode || (blocking.length ? 1 : 0))
