import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText
const typeCode = compile(await readFile(new URL('./types.ts', import.meta.url), 'utf8'))
const loaderCode = compile((await readFile(new URL('./loader.ts', import.meta.url), 'utf8'))
  .replaceAll('import.meta.env.DEV', 'false')
  .replaceAll('import.meta.env.VITE_APP_TARGET', "'native'"))

function harness() {
  const timers = new Map()
  let nextTimer = 0
  const window = {
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
  }
  const types = {}
  vm.runInNewContext(typeCode, { exports: types })
  const api = {}
  vm.runInNewContext(loaderCode, { exports: api, window, require: id => {
    assert.equal(id, './types')
    return types
  } })
  return { api, window, timeout: () => { for (const callback of [...timers.values()]) callback() } }
}
const readySdk = () => ({ invoke: async () => ({ ok: true, data: true }), on() {}, off() {} })

test('a missing native SDK can be retried after the SDK becomes available', async () => {
  const h = harness()
  await assert.rejects(h.api.loadBridge(), { code: 'unsupported' })
  h.window.capsule = readySdk()
  const recovered = await h.api.loadBridge()
  assert.equal(recovered.mode, 'native')
  assert.equal(recovered.sdk, h.window.capsule)
})

test('a timed-out native probe does not permanently poison later explicit retries', async () => {
  const h = harness()
  h.window.capsule = { ...readySdk(), invoke: () => new Promise(() => {}) }
  const first = h.api.loadBridge()
  h.timeout()
  await assert.rejects(first, { code: 'unsupported' })
  h.window.capsule = readySdk()
  assert.equal((await h.api.loadBridge()).mode, 'native')
})

test('a rejected probe can recover without reloading the document', async () => {
  const h = harness()
  h.window.capsule = { ...readySdk(), invoke: async () => { throw new Error('temporary host startup failure') } }
  await assert.rejects(h.api.loadBridge(), { code: 'unsupported' })
  h.window.capsule = readySdk()
  assert.equal((await h.api.loadBridge()).mode, 'native')
})

test('concurrent successful callers share one probe and retain its successful handle', async () => {
  const h = harness()
  let calls = 0
  h.window.capsule = { ...readySdk(), invoke: async () => { calls += 1; return { ok: true, data: true } } }
  const first = h.api.loadBridge()
  const second = h.api.loadBridge()
  assert.equal(first, second)
  const result = await first
  assert.equal(await second, result)
  assert.equal(await h.api.loadBridge(), result)
  assert.equal(calls, 1)
})

test('retries with no real SDK still fail closed in production', async () => {
  const h = harness()
  for (let i = 0; i < 3; i++) await assert.rejects(h.api.loadBridge(), { code: 'unsupported' })
})
