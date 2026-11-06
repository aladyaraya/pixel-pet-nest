/* Production bundle diagnostics with simulated native APIs, no HTTP server.
 * Usage: node scripts/diagnose-background-reload.mjs [output-directory] [native-web-directory] [--assert-single-sensor]
 * Clock.runFor executes scheduled callbacks; no fastForward or injected document reload.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const ASSERT_SINGLE_SENSOR = process.argv.includes('--assert-single-sensor')
const args = process.argv.slice(2).filter(arg => arg !== '--assert-single-sensor')
const OUT = resolve(args[0] || '.acceptance-final/reload-investigation')
const BUILD = resolve(args[1] || 'dist/client/web')
const BASE = 'http://egg-background-diagnostic.test/'
const KEY = 'diagnostic.background.egg.record.v1'
const EPOCH = Date.UTC(2026, 10, 6, 12)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
const assets = new Map()
function snapshot(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) snapshot(path)
    else if (entry.isFile()) assets.set('/' + relative(BUILD, path).split(sep).join('/'), readFileSync(path))
  }
}
snapshot(BUILD)
assert.ok(assets.has('/index.html'))
const hash = createHash('sha256')
for (const [path, body] of [...assets].sort(([a], [b]) => a.localeCompare(b))) hash.update(path).update('\0').update(body)
const buildSha256 = hash.digest('hex')
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const results = []
const seed = () => ({
  version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: 180000, privacyAgreed: true, backScreenPetId: null },
  session: null,
  collection: { tiny_egg: { count: 2, lastRevealedAt: EPOCH - 86400000 } },
})
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)
const total = record => Object.values(record.collection).reduce((sum, entry) => sum + entry.count, 0)
const emit = (page, name, payload = {}) => page.evaluate(({ name, payload }) => window.__emitDiagnostic(name, payload), { name, payload })
async function eventually(check) {
  let error
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return await check() } catch (caught) { error = caught }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw error
}
async function statistics(page) {
  return page.evaluate(key => ({
    ...window.__backgroundDiagnostic,
    now: Date.now(), mono: performance.now(), visibility: document.visibilityState,
    record: JSON.parse(localStorage.getItem(key)),
    countdown: document.querySelector('.hatch-countdown')?.textContent,
  }), KEY)
}

async function scenario(name, options, run) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  page.setDefaultTimeout(5000)
  const errors = [], navigation = [], checkpoints = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('crash', () => errors.push('BROWSER_RENDERER_CRASH'))
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigation.push(frame.url()) })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(BASE).origin) return route.abort()
    if (url.pathname === '/sdk/capsule.js') return route.fulfill({ contentType: 'text/javascript', body: '/* isolated diagnostic SDK */' })
    const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
    const body = assets.get(path)
    return body ? route.fulfill({ contentType: MIME[extname(path)] || 'application/octet-stream', body })
      : route.fulfill({ status: 404, body: 'missing diagnostic asset' })
  })
  await context.addInitScript(({ key, record, holdSensor }) => {
    if (!sessionStorage.getItem('background.seeded')) {
      localStorage.setItem(key, JSON.stringify(record))
      sessionStorage.setItem('background.seeded', 'true')
    }
    const loads = Number(sessionStorage.getItem('background.loads') || 0) + 1
    sessionStorage.setItem('background.loads', String(loads))
    const handlers = new Map(), pendingSensors = []
    const state = window.__backgroundDiagnostic = {
      loads, nativeForeground: true, holdSensor, sensorZ: -9.8, reads: 0, writes: 0,
      calls: [], commands: [], events: [], logs: [], byApi: {},
      activeNative: 0, maxNative: 0, activeMcp: 0, maxMcp: 0,
    }
    window.__emitDiagnostic = (name, payload) => {
      if (name === 'appHide') state.nativeForeground = false
      if (name === 'appShow') state.nativeForeground = true
      state.events.push({ name, payload, at: Date.now(), listeners: handlers.get(name)?.size || 0 })
      handlers.get(name)?.forEach(callback => callback(payload))
    }
    window.__releaseDiagnosticSensors = (z = -9.8) => {
      state.holdSensor = false
      pendingSensors.splice(0).forEach(resolve => resolve({ ok: true, values: [0, 0, z] }))
    }
    const dispatch = async (name, args) => {
      if (name === 'canIUse') return { ok: true, data: true }
      if (name === 'privacy.getStatus') return { ok: true, agreed: true }
      if (name === 'getStorage') {
        if (args.key !== 'egg.record.v1') return { ok: true, data: null }
        state.reads += 1
        return { ok: true, data: JSON.parse(localStorage.getItem(key)) }
      }
      if (name === 'setStorage') {
        if (args.key === 'egg.record.v1') {
          state.writes += 1
          localStorage.setItem(key, JSON.stringify(args.data))
        }
        return { ok: true }
      }
      if (name === 'getSafeArea') return { ok: true, top: 0, right: 0, bottom: 0, left: 0 }
      if (name === 'getNetworkType') return { ok: true, networkType: 'wifi', isConnected: true }
      if (name === 'getSystemInfo') return { ok: true, platform: 'android', system: 'isolated diagnostic', screenWidth: 390, screenHeight: 844, pixelRatio: 1 }
      if (name === 'getSensor') return state.holdSensor ? new Promise(resolve => pendingSensors.push(resolve)) : { ok: true, values: [0, 0, state.sensorZ] }
      return { ok: true }
    }
    window.capsule = {
      invoke: async (name, args) => {
        const api = state.byApi[name] ||= { calls: 0, active: 0, maxActive: 0 }
        api.calls += 1; api.active += 1; api.maxActive = Math.max(api.maxActive, api.active)
        state.activeNative += 1; state.maxNative = Math.max(state.maxNative, state.activeNative)
        const call = { name, at: Date.now(), hidden: !state.nativeForeground,
          ...(name === 'setKeepScreenOn' ? { keep: args.keepScreenOn } : {}),
          ...(name === 'vibrateShort' ? { type: args.type } : {}) }
        state.calls.push(call)
        try { return await dispatch(name, args) }
        finally { api.active -= 1; state.activeNative -= 1; call.settledAt = Date.now() }
      },
      on: (name, callback) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(callback) },
      off: (name, callback) => handlers.get(name)?.delete(callback),
      log: (level, tag, message) => state.logs.push({ level, tag, message, at: Date.now() }),
    }
    window.mcp = {
      connect: async () => ({}),
      callTool: async (name, args) => {
        state.activeMcp += 1; state.maxMcp = Math.max(state.maxMcp, state.activeMcp)
        state.commands.push({ name, at: Date.now(), hidden: !state.nativeForeground, size: args?.frame?.length })
        try { await Promise.resolve(); return '背屏操作已完成' }
        finally { state.activeMcp -= 1 }
      },
    }
    navigator.vibrate = () => true
  }, { key: KEY, record: options.record || seed(), holdSensor: !!options.holdSensor })
  const checkpoint = async label => {
    await cdp.send('HeapProfiler.collectGarbage')
    const item = { label, ...await statistics(page), heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') }
    checkpoints.push(item)
    assert.equal(item.loads, 1, 'the document must not recreate itself')
    assert.equal(item.reads, 1, 'lifecycle events must not reread stored records')
    assert.deepEqual(errors, [])
    console.log(`${name} / ${label}: loads=${item.loads}, reads=${item.reads}, nativeMax=${item.maxNative}, sensorMax=${item.byApi.getSensor?.maxActive || 0}, heap=${item.heap.usedSize}, nodes=${item.dom.nodes}`)
    return item
  }
  let result
  try {
    await page.clock.install({ time: new Date(EPOCH) })
    await page.clock.pauseAt(new Date(EPOCH + 1000))
    await page.goto(BASE + (options.route || ''), { waitUntil: 'networkidle' })
    await run(page, checkpoint)
    assert.deepEqual(errors, [])
    result = { name, ok: true, checkpoints, errors, navigation, final: await statistics(page) }
  } catch (error) {
    result = { name, ok: false, error: error.stack, checkpoints, errors, navigation, final: await statistics(page).catch(() => null) }
    console.error(`FAIL ${name}: ${error.message}`)
    await page.screenshot({ path: resolve(OUT, `${name}-failed.png`), fullPage: true }).catch(() => undefined)
  } finally {
    results.push(result)
    writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(result, null, 2))
    await context.close()
  }
}

await scenario('sensor-held-20s', {
  holdSensor: true, route: '#/hatch',
  record: {
    ...seed(), settings: { ...seed().settings, flipReveal: true },
    session: {
      sessionId: 'held-sensor-session', durationMs: 190000, tier: 'normal', petId: 'late_duck',
      startedAt: EPOCH - 189000, deadlineAt: EPOCH + 1000, phase: 'ready', revealedAt: null,
      hintedPhases: ['waiting', 'cracking', 'almost', 'ready'],
    },
  },
}, async (page, checkpoint) => {
  await page.getByRole('button', { name: '看看是谁', exact: true }).waitFor()
  await checkpoint('ready-baseline')
  await page.clock.runFor(20000)
  const held = await checkpoint('20s-sensor-pending')
  assert.ok(held.byApi.getSensor?.calls > 0)
  assert.equal(held.byApi.getSensor.active, held.byApi.getSensor.calls, 'all synthetic sensor calls remain pending until released')
  assert.equal(await page.getByRole('button', { name: '看看是谁', exact: true }).isEnabled(), true, 'manual reveal stays available while a sensor request is pending')
  assert.equal(await page.getByRole('button', { name: '结束这颗蛋', exact: true }).isEnabled(), true, 'manual end stays available while a sensor request is pending')
  if (ASSERT_SINGLE_SENSOR) {
    assert.equal(held.byApi.getSensor.maxActive, 1, 'a held sensor request must prevent overlapping calls for the full 20 seconds')
    assert.equal(held.byApi.getSensor.calls, 1)
  }
  await emit(page, 'appHide')
  await page.clock.runFor(4000)
  const hidden = await checkpoint('hidden-no-new-sensors')
  assert.equal(hidden.byApi.getSensor.calls, held.byApi.getSensor.calls)
  assert.equal(hidden.commands.filter(command => command.hidden).length, 0)
  if (ASSERT_SINGLE_SENSOR) {
    await emit(page, 'appShow')
    await page.clock.runFor(1200)
    const resumed = await checkpoint('resumed-with-original-request-still-pending')
    assert.equal(resumed.byApi.getSensor.calls, 1, 'foreground recovery must not release the unsettled request lock')
    assert.equal(resumed.byApi.getSensor.active, 1)
    // Old face-up data must be discarded even though the document is foreground again.
    await page.evaluate(() => window.__releaseDiagnosticSensors(9.8))
    await eventually(async () => assert.equal((await statistics(page)).byApi.getSensor.active, 0))
    const stale = await checkpoint('old-face-up-reply-discarded-after-resume')
    assert.equal(stale.record.session.revealedAt, null)
    assert.equal(total(stale.record), 2)
    await page.clock.runFor(400)
    const fresh = await checkpoint('fresh-sampling-resumed')
    assert.ok(fresh.byApi.getSensor.calls > 1, 'sampling must resume after the original Promise actually settles')
    assert.equal(fresh.byApi.getSensor.maxActive, 1)
    assert.equal(fresh.record.session.revealedAt, null)
    await page.evaluate(() => { window.__backgroundDiagnostic.sensorZ = 9.8 })
    await page.clock.runFor(400)
    await eventually(async () => assert.equal((await read(page)).session.phase, 'revealed'))
    await page.clock.runFor(2000)
    const revealed = await checkpoint('fresh-face-up-revealed-once')
    assert.equal(total(revealed.record), 3)
    assert.equal(revealed.byApi.getSensor.maxActive, 1)
    await emit(page, 'appHide')
    await emit(page, 'appShow')
    await page.clock.runFor(2000)
    const repeated = await checkpoint('no-repeat-after-reveal')
    assert.equal(total(repeated.record), 3)
    assert.equal(repeated.byApi.getSensor.calls, revealed.byApi.getSensor.calls)
  } else {
    await page.evaluate(() => window.__releaseDiagnosticSensors())
    await eventually(async () => assert.equal((await statistics(page)).byApi.getSensor.active, 0))
    const released = await checkpoint('old-sensor-replies-released-while-hidden')
    assert.equal(released.record.session.revealedAt, null)
    assert.equal(total(released.record), 2)
  }
})

await scenario('three-short-then-long-background', {}, async (page, checkpoint) => {
  await page.getByLabel('分钟', { exact: true }).fill('0')
  await page.getByLabel('秒', { exact: true }).fill('10')
  await checkpoint('before-first-egg')
  await page.getByRole('button', { name: /^孵一颗 ·/ }).click()
  for (let round = 1; round <= 3; round += 1) {
    if (round > 1) await page.getByRole('button', { name: '再孵一颗', exact: true }).click()
    await page.locator('.hatch-countdown').waitFor()
    await page.clock.runFor(10500)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.clock.runFor(1300)
    await page.getByRole('button', { name: '再孵一颗', exact: true }).waitFor()
    await eventually(async () => assert.equal(total(await read(page)), 2 + round))
    await checkpoint(`short-egg-${round}-saved`)
  }
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByLabel('分钟', { exact: true }).fill('3')
  await page.getByLabel('秒', { exact: true }).fill('10')
  await page.getByRole('button', { name: /^孵一颗 ·/ }).click()
  await page.locator('.hatch-countdown').waitFor()
  await eventually(async () => assert.equal((await read(page)).session.durationMs, 190000))
  const longRecord = await read(page)
  await checkpoint('long-egg-started')
  // 50 seconds is a deliberately chosen test point, not timing reported by the user.
  await page.clock.runFor(50000)
  await emit(page, 'appHide')
  const beforeHidden = await checkpoint('appHide-before-halfway')
  assert.equal(beforeHidden.visibility, 'visible', 'native-only hide must work without DOM visibility fallback')
  for (const [advance, phase, label] of [
    [50000, 'cracking', 'hidden-past-50-percent'],
    [65000, 'almost', 'hidden-past-85-percent'],
    [26000, 'ready', 'hidden-past-deadline'],
  ]) {
    await page.clock.runFor(advance)
    for (let level = 1; level <= 3; level += 1) await emit(page, 'memoryWarning', { level })
    await eventually(async () => assert.equal((await read(page)).session.phase, phase))
    const item = await checkpoint(label)
    assert.equal(item.record.session.sessionId, longRecord.session.sessionId)
    assert.equal(item.record.session.deadlineAt, longRecord.session.deadlineAt)
    assert.deepEqual(item.record.collection, longRecord.collection)
    assert.equal(item.commands.filter(command => command.hidden).length, 0, 'no back-screen command starts while hidden')
    assert.equal(item.byApi.getSensor?.calls || 0, 0, 'default disabled flip must not poll sensors')
    assert.ok(item.maxMcp <= 1)
  }
  await page.clock.runFor(10000)
  const hidden = await checkpoint('hidden-ready-wait')
  const warningLogs = hidden.logs.filter(log => log.tag === 'NativeProvider' && /memoryWarning/.test(log.message))
  assert.equal(warningLogs.length, 9, 'all injected memory warnings must be observed without reloading')
  const hiddenFrameCount = hidden.commands.filter(command => command.name === 'set_back_screen_frame').length
  await emit(page, 'appShow')
  await page.clock.runFor(2000)
  const shown = await checkpoint('appShow-current-ready-scene')
  assert.ok(shown.commands.filter(command => command.name === 'set_back_screen_frame').length > hiddenFrameCount)
  assert.equal(shown.record.session.sessionId, longRecord.session.sessionId)
  await page.getByRole('button', { name: '看看是谁', exact: true }).click()
  await page.clock.runFor(1300)
  await page.getByRole('button', { name: '再孵一颗', exact: true }).waitFor()
  await eventually(async () => assert.equal(total(await read(page)), 6))
  const completed = await checkpoint('long-egg-revealed-once')
  assert.equal(completed.record.session.phase, 'revealed')
  assert.equal(completed.byApi.getSensor?.calls || 0, 0)
  await page.screenshot({ path: resolve(OUT, 'long-egg-completed.png'), fullPage: true })
})

await browser.close()
const report = {
  buildRoot: BUILD, buildSha256, assetCount: assets.size,
  simulatedNative: true, timerMethod: 'page.clock.runFor', injectedReload: false, assertSingleSensor: ASSERT_SINGLE_SENSOR,
  limitations: [
    'Native API responses and memoryWarning events are simulated, not physical device evidence.',
    'Memory samples are Chromium JavaScript heap after GC and DOM counts; they exclude the real native host and include diagnostic trace arrays.',
    'Background entry timings are controlled test choices; the user reported no exact elapsed time.',
  ],
  completed: results.filter(result => result.ok).length, total: results.length,
  sensorMaxConcurrency: results.find(result => result.name === 'sensor-held-20s')?.final?.byApi?.getSensor?.maxActive,
  results,
}
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(`${report.completed}/${report.total} diagnostics completed; max pending sensor requests=${report.sensorMaxConcurrency}; ${resolve(OUT, 'report.json')}`)
if (report.completed !== report.total) process.exitCode = 1
