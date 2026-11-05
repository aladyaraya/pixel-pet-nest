import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the actual adapter in isolated browser-like contexts, including production mode.
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText
const typeCode = compile(await readFile(new URL('./types.ts', import.meta.url), 'utf8'))
const adapterCode = compile((await readFile(new URL('./backScreen.ts', import.meta.url), 'utf8'))
  .replaceAll('import.meta.env.DEV', '__DEV__'))
const wire = value => JSON.parse(JSON.stringify(value))
const frame = () => Array.from({ length: 391 }, (_, i) => i % 256)

function harness({ dev = false, absent = false, connect = async () => undefined, reply = async () => ({ text: '已设置自定义点阵' }) } = {}) {
  const calls = []
  const logs = []
  let connects = 0
  const typeExports = {}
  vm.runInNewContext(typeCode, { exports: typeExports })
  const exports = {}
  const context = {
    __DEV__: dev, exports,
    require: id => {
      assert.equal(id, './types')
      return typeExports
    },
    console: { warn: (...parts) => logs.push(parts.join(' ')) },
    window: {},
  }
  if (!absent) context.window.mcp = {
    connect: () => { connects += 1; return connect() },
    callTool: async (name, args) => {
      calls.push({ name, args: wire(args) })
      return reply(name, args)
    },
  }
  vm.runInNewContext(adapterCode, context)
  return { api: exports, calls, logs, context, connects: () => connects }
}

test('production without a bridge is unavailable and never simulates a device', async () => {
  const h = harness({ absent: true })
  assert.equal(await h.api.resolveBackScreenMode(), 'unavailable')
  assert.deepEqual(wire(await h.api.pushFrame(frame())), { ok: false, reason: 'unavailable', simulated: false })
  assert.equal(h.calls.length, 0)
})

test('development-only preview is explicitly simulated and sends no device request', async () => {
  const h = harness({ dev: true, absent: true })
  assert.equal(await h.api.resolveBackScreenMode(), 'simulated')
  assert.deepEqual(wire(await h.api.pushFrame(frame())), { ok: true, reason: 'ok', simulated: true })
  assert.equal(h.calls.length, 0)
})

test('an incomplete bridge cannot silently fall back to simulated success', async () => {
  const h = harness({ dev: true })
  delete h.context.window.mcp.connect
  assert.equal((await h.api.pushFrame(frame())).ok, false)
  assert.equal(h.calls.length, 0)
})

for (const [name, value] of [['false', false], ['isError', { isError: true, errorCode: 401, text: 'private text' }]]) {
  test('explicit connect failure ' + name + ' prevents tool dispatch', async () => {
    const h = harness({ connect: async () => value })
    assert.equal(await h.api.resolveBackScreenMode(), 'unavailable')
    assert.equal((await h.api.wakeBackScreen()).reason, 'connect-failed')
    assert.equal(h.calls.length, 0)
    assert.ok(h.logs.every(line => !line.includes('private text')))
  })
}

test('connect rejection is sanitized and prevents dispatch', async () => {
  const h = harness({ connect: async () => { throw new Error('private-token-123') } })
  assert.equal((await h.api.wakeBackScreen()).reason, 'connect-failed')
  assert.equal(h.calls.length, 0)
  assert.ok(h.logs.some(line => line.includes('connector=ic_atomic_990001') && line.includes('connect-rejected')))
  assert.ok(h.logs.every(line => !line.includes('private-token-123')))
})

test('void connect success remains compatible with the undocumented success payload', async () => {
  const h = harness()
  assert.equal((await h.api.wakeBackScreen()).ok, true)
  assert.equal(h.connects(), 1)
})

test('concurrent availability checks share a single connection', async () => {
  let complete
  const h = harness({ connect: () => new Promise(resolve => { complete = resolve }) })
  const checks = [h.api.resolveBackScreenMode(), h.api.resolveBackScreenMode()]
  assert.equal(h.connects(), 1)
  complete(undefined)
  assert.deepEqual(await Promise.all(checks), ['device', 'device'])
})

test('late old connection cannot overwrite the result of a manual reconnect', async () => {
  let complete
  const h = harness({ connect: () => new Promise(resolve => { complete = resolve }) })
  const old = h.api.resolveBackScreenMode()
  h.api.resetBackScreenMode()
  h.context.window.mcp.connect = async () => undefined
  assert.equal(await h.api.resolveBackScreenMode(), 'device')
  complete(false)
  assert.equal(await old, 'unavailable')
  assert.equal(await h.api.resolveBackScreenMode(), 'device')
})

test('a command awaiting an obsolete connection does not dispatch after reset', async () => {
  let complete
  const h = harness({ connect: () => new Promise(resolve => { complete = resolve }) })
  const old = h.api.wakeBackScreen()
  h.api.resetBackScreenMode()
  complete(undefined)
  assert.equal((await old).ok, false)
  assert.equal(h.calls.length, 0)
})

test('four command names and JSON wire payloads match the supplied device contract', async () => {
  const h = harness()
  const expected = frame()
  await h.api.wakeBackScreen()
  await h.api.pushFrame(expected)
  await h.api.clearFrame()
  await h.api.sleepBackScreen()
  assert.deepEqual(h.calls, [
    { name: 'wake_up_back_screen', args: {} },
    { name: 'set_back_screen_frame', args: { frame: expected } },
    { name: 'clear_back_screen_frame', args: {} },
    { name: 'sleep_back_screen', args: {} },
  ])
  assert.equal(h.calls[1].args.frame[2 * 17 + 3], expected[37])
  assert.equal(h.connects(), 1)
})

test('text-only and MCP-wrapped acknowledgments do not require structuredContent', async () => {
  for (const raw of [
    '已设置点阵帧', { text: '自定义帧已清除' },
    { content: [{ type: 'text', text: '背屏已点亮' }] },
    { isError: false, text: '' }, { content: [] }, { structuredContent: { accepted: true } },
  ]) {
    const h = harness({ reply: async () => raw })
    assert.deepEqual(wire(await h.api.wakeBackScreen()), { ok: true, reason: 'ok', simulated: false })
  }
})

test('missing, empty or primitive acknowledgments are never reported as success', async () => {
  for (const raw of [undefined, null, false, 0, '', '  ', {}, { text: '' }, { content: null }]) {
    const h = harness({ reply: async () => raw })
    assert.equal((await h.api.wakeBackScreen()).reason, 'invalid-response')
    assert.equal(h.calls.length, 1)
  }
})

test('isError overrides success-looking text and logs only safe numeric error codes', async () => {
  const h = harness({ reply: async () => ({ isError: true, errorCode: 403, text: 'private-text', errorMsg: 'private-token' }) })
  assert.equal((await h.api.pushFrame(frame())).reason, 'call-failed')
  assert.ok(h.logs.some(line => line.includes('set_back_screen_frame') && line.includes('errorCode=403')))
  assert.ok(h.logs.every(line => !/private|frame:|\[0,/.test(line)))
})

test('arbitrary string error codes and rejected exception text are not exposed', async () => {
  const h = harness({ reply: async () => ({ isError: true, errorCode: 'private-key' }) })
  assert.equal((await h.api.clearFrame()).ok, false)
  const rejected = harness({ reply: async () => { throw new Error('private-token-123') } })
  assert.equal((await rejected.api.sleepBackScreen()).reason, 'call-failed')
  assert.ok([...h.logs, ...rejected.logs].every(line => !line.includes('private')))
})

test('invalid length, values and sparse frames fail before connecting or transmitting', async () => {
  const invalid = [[], new Array(390).fill(0), new Array(392).fill(0), new Array(391), null, 'not an array']
  for (const value of [-1, 256, 300.5, 0.5, NaN, Infinity, '1', null, undefined]) {
    const bad = frame()
    bad[190] = value
    invalid.push(bad)
  }
  for (const value of invalid) {
    const h = harness()
    assert.equal((await h.api.pushFrame(value)).reason, 'invalid-frame')
    assert.equal(h.calls.length, 0)
    assert.equal(h.connects(), 0)
  }
})

test('outgoing frame is snapshotted before an asynchronous connection', async () => {
  let complete
  const h = harness({ connect: () => new Promise(resolve => { complete = resolve }) })
  const input = frame()
  const expected = [...input]
  const pending = h.api.pushFrame(input)
  input.fill(999)
  complete(undefined)
  assert.equal((await pending).ok, true)
  assert.deepEqual(h.calls[0].args, { frame: expected })
})
