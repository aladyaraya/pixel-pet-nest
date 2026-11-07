/* Production-bundle recovery regression. Native capabilities are simulated;
 * this does not prove why a particular device recreated its WebView. No server is started.
 * Usage: node scripts/acceptance-native-reload.mjs [output-directory] [native-web-directory]
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const OUT = resolve(process.argv[2] || process.env.NATIVE_RELOAD_OUTPUT || '.acceptance-final/native-reload')
const BUILD = resolve(process.argv[3] || process.env.NATIVE_RELOAD_BUILD || 'dist/client/web')
const BASE = 'http://egg-native-reload.test/'
const KEY = 'diagnostic.native-reload.egg.record.v1'
const EPOCH = Date.UTC(2026, 10, 6, 8)
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
assert.ok(assets.has('/index.html'), 'a previously built native dist/client/web is required')
const digest = createHash('sha256')
for (const [path, body] of [...assets].sort(([a], [b]) => a.localeCompare(b))) digest.update(path).update('\0').update(body)
const buildHash = digest.digest('hex')
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const results = []
const seedRecord = () => ({
  version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: 180000, privacyAgreed: true, backScreenPetId: null },
  session: null,
  collection: { tiny_egg: { count: 2, lastRevealedAt: EPOCH - 86400000 } },
})
const readRaw = page => page.evaluate(key => localStorage.getItem(key), KEY)
const readRecord = async page => JSON.parse(await readRaw(page))
const total = record => Object.values(record.collection).reduce((sum, item) => sum + item.count, 0)
const frameCount = page => page.evaluate(() => window.__nativeReload.commands.filter(item => item.name === 'set_back_screen_frame').length)
const emit = (page, name) => page.evaluate(name => window.__emitNative(name), name)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function eventually(check) {
  let error
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { return await check() } catch (caught) { error = caught }
    await sleep(25)
  }
  throw error
}
async function evidence(page) {
  return page.evaluate(key => ({
    ...window.__nativeReload,
    handlers: window.__nativeListenerCounts(),
    raw: localStorage.getItem(key),
    now: Date.now(),
    countdown: document.querySelector('.hatch-countdown')?.textContent,
    text: document.querySelector('main')?.innerText,
  }), KEY)
}
async function errorPage(page) {
  await page.getByRole('button', { name: '重新读取', exact: true }).waitFor()
  assert.equal(await page.locator('.hatch-countdown').count(), 0)
  assert.equal(await page.getByRole('button', { name: /^孵一颗 ·/ }).count(), 0)
}

async function scenario(name, run, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  const navigation = []
  const checkpoints = {}
  let result
  page.on('pageerror', error => errors.push(error.stack || error.message))
  page.on('crash', () => errors.push('BROWSER_RENDERER_CRASH'))
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigation.push(frame.url()) })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(BASE).origin) return route.abort()
    if (url.pathname === '/sdk/capsule.js') return route.fulfill({ contentType: 'text/javascript', body: '/* SDK provided only by isolated test fixture */' })
    const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
    const body = assets.get(path)
    return body ? route.fulfill({ contentType: MIME[extname(path)] || 'application/octet-stream', body })
      : route.fulfill({ status: 404, body: 'missing fixture asset' })
  })
  await context.addInitScript(({ key, raw, readMode, storageShape, initialSdk }) => {
    if (!sessionStorage.getItem('native-reload.seeded')) {
      localStorage.setItem(key, raw)
      sessionStorage.setItem('native-reload.seeded', 'true')
    }
    const loads = Number(sessionStorage.getItem('native-reload.loads') || 0) + 1
    sessionStorage.setItem('native-reload.loads', String(loads))
    const startupMode = sessionStorage.getItem('native-reload.next-sdk') || initialSdk
    const handlers = new Map()
    const pendingReads = []
    const state = window.__nativeReload = {
      loads, startupMode, probeMode: startupMode, readMode, storageShape, reads: 0, writes: 0, returnedDataTypes: [],
      calls: [], commands: [], subscriptions: [], logs: [],
    }
    const storageData = () => {
      const value = localStorage.getItem(key)
      const data = storageShape === 'json-string' ? value : JSON.parse(value)
      state.returnedDataTypes.push(data === null ? 'null' : typeof data)
      return data
    }
    window.__nativeListenerCounts = () => Object.fromEntries([...handlers].map(([name, listeners]) => [name, listeners.size]))
    window.__emitNative = name => {
      state.calls.push({ name: 'emit:' + name, at: Date.now() })
      handlers.get(name)?.forEach(callback => callback({}))
    }
    window.__releaseNativeReads = () => {
      state.readMode = 'normal'
      pendingReads.splice(0).forEach(resolve => resolve({ ok: true, data: storageData() }))
    }
    window.__sdk = {
      invoke: async (name, args) => {
        state.calls.push({ name, at: Date.now(), ...(name === 'setKeepScreenOn' ? { value: args.keepScreenOn } : {}) })
        if (name === 'canIUse') {
          if (state.probeMode === 'reject') throw new Error('canIUse:fail native bridge unavailable')
          if (state.probeMode === 'hang') return new Promise(() => {})
          return { ok: true, data: true }
        }
        if (name === 'privacy.getStatus') return { ok: true, agreed: true }
        if (name === 'getStorage') {
          if (args.key !== 'egg.record.v1') return { ok: true, data: null }
          state.reads += 1
          if (state.readMode === 'missing-data') return { ok: true }
          if (state.readMode === 'held') return new Promise(resolve => pendingReads.push(resolve))
          return { ok: true, data: storageData() }
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
        if (name === 'getSystemInfo') return { ok: true, platform: 'android', system: 'isolated test', screenWidth: 390, screenHeight: 844, pixelRatio: 1 }
        if (name === 'getSensor') return { ok: true, values: [0, 0, -9.8] }
        return { ok: true }
      },
      on: (name, callback) => {
        if (!handlers.has(name)) handlers.set(name, new Set())
        handlers.get(name).add(callback)
        state.subscriptions.push({ operation: 'on', name, at: Date.now() })
      },
      off: (name, callback) => {
        handlers.get(name)?.delete(callback)
        state.subscriptions.push({ operation: 'off', name, at: Date.now() })
      },
      log: (level, tag, message) => state.logs.push({ level, tag, message }),
    }
    if (startupMode !== 'missing') window.capsule = window.__sdk
    window.__restoreNative = () => {
      state.probeMode = 'ready'
      window.capsule = window.__sdk
      sessionStorage.setItem('native-reload.next-sdk', 'ready')
    }
    window.mcp = {
      connect: async () => ({}),
      callTool: async (name, args) => {
        state.commands.push({ name, at: Date.now(), size: args?.frame?.length })
        return '背屏操作已完成'
      },
    }
    navigator.vibrate = () => true
  }, {
    key: KEY, raw: options.raw ?? JSON.stringify(seedRecord()), readMode: options.readMode || 'normal',
    storageShape: options.storageShape || 'object', initialSdk: options.initialSdk || 'ready',
  })
  try {
    await page.clock.install({ time: new Date(EPOCH) })
    await page.clock.pauseAt(new Date(EPOCH + 1000))
    await page.goto(BASE + (options.route || ''), { waitUntil: 'networkidle' })
    await run(page, checkpoints)
    assert.deepEqual(errors, [], 'no unhandled page errors or renderer crash')
    result = { name, ok: true, checkpoints, errors, navigation, final: await evidence(page) }
    console.log(`PASS ${name}`)
  } catch (error) {
    result = { name, ok: false, error: error.stack, checkpoints, errors, navigation, final: await evidence(page).catch(() => null) }
    console.error(`FAIL ${name}: ${error.message}`)
    await page.screenshot({ path: resolve(OUT, `${name}-failed.png`), fullPage: true }).catch(() => undefined)
  } finally {
    results.push(result)
    writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(result, null, 2))
    await context.close()
  }
}

for (const startupMode of ['missing', 'reject', 'hang']) {
  await scenario(`long-session-reload-${startupMode}`, async (page, checkpoints) => {
    await page.getByLabel('分钟', { exact: true }).fill('0')
    await page.getByLabel('秒', { exact: true }).fill('10')
    await page.getByRole('button', { name: /^孵一颗 ·/ }).click()
    const shortIds = new Set()
    for (let round = 1; round <= 3; round += 1) {
      if (round > 1) await page.getByRole('button', { name: '再孵一颗', exact: true }).click()
      await page.locator('.hatch-countdown').waitFor()
      await eventually(async () => {
        const record = await readRecord(page)
        assert.equal(record.session.durationMs, 10000)
        assert.equal(record.session.revealedAt, null)
        assert.ok(!shortIds.has(record.session.sessionId))
      })
      shortIds.add((await readRecord(page)).session.sessionId)
      await page.clock.runFor(10500)
      await page.getByRole('button', { name: '看看是谁', exact: true }).click()
      await page.clock.runFor(1300)
      await page.getByRole('button', { name: '再孵一颗', exact: true }).waitFor()
      await eventually(async () => assert.equal(total(await readRecord(page)), 2 + round))
    }
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByLabel('分钟', { exact: true }).fill('3')
    await page.getByLabel('秒', { exact: true }).fill('10')
    await page.getByRole('button', { name: /^孵一颗 ·/ }).click()
    await page.locator('.hatch-countdown').waitFor()
    await eventually(async () => assert.equal((await readRecord(page)).session.durationMs, 190000))
    const longRecord = await readRecord(page)
    assert.ok(!shortIds.has(longRecord.session.sessionId))
    await page.clock.runFor(65000)
    await emit(page, 'appHide')
    checkpoints.beforeReload = await evidence(page)
    const elapsed = checkpoints.beforeReload.now - longRecord.session.startedAt
    assert.ok(elapsed >= 65000 && elapsed < 66000, `long-session elapsed ${elapsed}`)
    assert.equal(checkpoints.beforeReload.loads, 1, 'no unexpected reload before injected restart')
    assert.equal(total(await readRecord(page)), 5)
    await page.evaluate(mode => sessionStorage.setItem('native-reload.next-sdk', mode), startupMode)
    await page.reload({ waitUntil: 'networkidle' })
    // The failed privacy query can be followed by a fresh storage probe after cache invalidation.
    if (startupMode === 'hang') await page.clock.runFor(4000)
    await errorPage(page)
    checkpoints.readFailure = await evidence(page)
    assert.equal(checkpoints.readFailure.loads, 2)
    assert.equal(checkpoints.readFailure.raw, checkpoints.beforeReload.raw, 'failed read must preserve the exact persisted bytes')
    assert.equal(checkpoints.readFailure.writes, 0)
    await page.screenshot({ path: resolve(OUT, `${startupMode}-read-error.png`), fullPage: true })
    await page.evaluate(() => window.__restoreNative())
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await page.locator('.hatch-countdown').waitFor()
    await eventually(async () => {
      const listeners = await page.evaluate(() => window.__nativeListenerCounts())
      assert.ok(listeners.appHide >= 1, 'native appHide must be subscribed after read recovery')
      assert.ok(listeners.appShow >= 1, 'native appShow must be subscribed after read recovery')
    })
    const recovered = await readRecord(page)
    assert.equal(recovered.session.sessionId, longRecord.session.sessionId)
    assert.equal(recovered.session.petId, longRecord.session.petId)
    assert.equal(recovered.session.startedAt, longRecord.session.startedAt)
    assert.equal(recovered.session.deadlineAt, longRecord.session.deadlineAt)
    assert.equal(recovered.session.durationMs, 190000)
    assert.equal(recovered.session.tier, 'normal')
    assert.equal(recovered.session.revealedAt, null)
    assert.deepEqual(recovered.collection, longRecord.collection)
    checkpoints.recovered = await evidence(page)
    const remaining = recovered.session.deadlineAt - checkpoints.recovered.now
    const [minutes, seconds] = checkpoints.recovered.countdown.split(':').map(Number)
    assert.ok(Math.abs((minutes * 60 + seconds) * 1000 - remaining) <= 1000, 'recovered countdown must match the original deadline')
    assert.ok(remaining > 115000 && remaining <= 125000, `remaining should reflect approximately 65 seconds used: ${remaining}`)
    await page.clock.runFor(1100)
    await eventually(async () => assert.ok(await frameCount(page) > 0))
    await emit(page, 'appHide')
    const hiddenFrames = await frameCount(page)
    await page.clock.runFor(9000)
    assert.equal(await frameCount(page), hiddenFrames, 'recovered native appHide must stop automatic back-screen frames')
    await emit(page, 'appShow')
    await page.clock.runFor(1100)
    await eventually(async () => assert.ok(await frameCount(page) > hiddenFrames, 'native appShow must restore the current static back-screen frame'))
    assert.deepEqual((await readRecord(page)).collection, longRecord.collection, 'hide/show and read retry must not add encounters')
    assert.equal(await page.getByRole('button', { name: '看看是谁', exact: true }).count(), 0, 'restored session must not finish early')
    await page.screenshot({ path: resolve(OUT, `${startupMode}-recovered.png`), fullPage: true })
  })
}

for (const [name, options] of [
  ['invalid-json', { raw: '{"version":2,broken' }],
  ['unknown-version', { raw: JSON.stringify({ ...seedRecord(), version: 99 }) }],
  ['missing-data', { readMode: 'missing-data' }],
]) {
  await scenario(`preserve-${name}`, async (page, checkpoints) => {
    await errorPage(page)
    checkpoints.initialFailure = await evidence(page)
    for (const hash of ['#/hatch', '#/collection', '#/']) {
      await page.evaluate(hash => { location.hash = hash }, hash)
      await errorPage(page)
      const beforeReads = (await evidence(page)).reads
      await page.getByRole('button', { name: '重新读取', exact: true }).click()
      await eventually(async () => assert.ok((await evidence(page)).reads > beforeReads))
      await errorPage(page)
      await page.clock.runFor(250)
      const current = await evidence(page)
      assert.equal(current.raw, checkpoints.initialFailure.raw)
      assert.equal(current.writes, 0, 'unreadable or absent data must never be replaced with a default record')
    }
  }, options)
}

await scenario('native-hide-during-pending-read', async (page, checkpoints) => {
  await eventually(async () => assert.equal((await evidence(page)).reads, 1))
  await page.evaluate(() => { location.hash = '#/hatch' })
  // Intentionally send only the native event. A visibility/pagehide fallback would mask the regression.
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible')
  await emit(page, 'appHide')
  checkpoints.beforeReadResolved = await evidence(page)
  const original = await readRecord(page)
  const hiddenFrames = await frameCount(page)
  await page.evaluate(() => window.__releaseNativeReads())
  await page.locator('.hatch-countdown').waitFor()
  await page.clock.runFor(9000)
  checkpoints.loadedWhileHidden = await evidence(page)
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible')
  assert.equal(await frameCount(page), hiddenFrames, 'appHide received during a pending storage read must keep the back-screen paused after loading')
  assert.equal((await readRecord(page)).session.sessionId, original.session.sessionId)
  assert.equal((await readRecord(page)).session.revealedAt, null)
  assert.deepEqual((await readRecord(page)).collection, original.collection)
  await emit(page, 'appShow')
  await page.clock.runFor(1100)
  await eventually(async () => assert.ok(await frameCount(page) > hiddenFrames, 'only appShow should restore the current back-screen scene'))
  assert.deepEqual((await readRecord(page)).collection, original.collection)
  checkpoints.foregroundRestored = await evidence(page)
}, {
  readMode: 'held',
  raw: JSON.stringify({
    ...seedRecord(),
    session: {
      sessionId: 'pending-read-background-session', durationMs: 190000, tier: 'normal', petId: 'late_duck',
      startedAt: EPOCH + 1000, deadlineAt: EPOCH + 191000, phase: 'waiting', revealedAt: null,
      hintedPhases: ['waiting'],
    },
  }),
})

const stringSessionRecord = () => ({
  ...seedRecord(),
  settings: { ...seedRecord().settings, lastDurationMs: 190000 },
  session: {
    sessionId: 'synthetic-string-190-second-session', durationMs: 190000, tier: 'normal', petId: 'late_duck',
    startedAt: EPOCH + 1000, deadlineAt: EPOCH + 191000, phase: 'waiting', revealedAt: null,
    hintedPhases: ['waiting'],
  },
})
const stringRevealedRecord = {
  ...seedRecord(),
  settings: { ...seedRecord().settings, lastDurationMs: 10000, backScreenPetId: 'tiny_egg' },
  session: {
    sessionId: 'synthetic-string-revealed-session', durationMs: 10000, tier: 'low', petId: 'tiny_egg',
    startedAt: EPOCH - 19000, deadlineAt: EPOCH - 9000, phase: 'revealed', revealedAt: EPOCH - 8500,
    hintedPhases: ['waiting', 'cracking', 'almost', 'ready'],
  },
  collection: { tiny_egg: { count: 2, lastRevealedAt: EPOCH - 8500 } },
}

await scenario('native-json-string-revealed-reload', async (page, checkpoints) => {
  checkpoints.initialRead = await evidence(page)
  await page.getByRole('button', { name: '再孵一颗', exact: true }).waitFor()
  await page.getByText('已收进收藏', { exact: true }).waitFor()
  assert.deepEqual(await readRecord(page), stringRevealedRecord)
  assert.deepEqual((await evidence(page)).returnedDataTypes, ['string'], 'fixture must exercise actual string data, not an already parsed object')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '再孵一颗', exact: true }).waitFor()
  await page.clock.runFor(2500)
  checkpoints.afterReload = await evidence(page)
  assert.equal(checkpoints.afterReload.loads, 2)
  assert.equal(checkpoints.afterReload.reads, 1)
  assert.deepEqual(checkpoints.afterReload.returnedDataTypes, ['string'])
  assert.equal(checkpoints.afterReload.writes, 0, 'reading an existing v2 reveal must not increment or rewrite the collection')
  assert.deepEqual(await readRecord(page), stringRevealedRecord)
  assert.equal(await page.getByText('正在破壳…', { exact: true }).count(), 0)
  assert.equal(checkpoints.afterReload.calls.filter(call => call.name === 'vibrateShort').length, 0, 'old revealed records must not replay due/reveal haptics')
}, { raw: JSON.stringify(stringRevealedRecord), storageShape: 'json-string', route: '#/hatch' })

await scenario('native-json-string-active-reload', async (page, checkpoints) => {
  checkpoints.initialRead = await evidence(page)
  await page.locator('.hatch-countdown').waitFor()
  const original = await readRecord(page)
  // This elapsed time is a chosen regression checkpoint, not timing reported by the user.
  await page.clock.runFor(65000)
  checkpoints.beforeReload = await evidence(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.hatch-countdown').waitFor()
  checkpoints.afterReload = await evidence(page)
  assert.deepEqual(checkpoints.afterReload.returnedDataTypes, ['string'])
  assert.equal(checkpoints.afterReload.loads, 2)
  assert.equal(checkpoints.afterReload.raw, checkpoints.beforeReload.raw)
  assert.equal(checkpoints.afterReload.writes, 0)
  const recovered = await readRecord(page)
  assert.deepEqual(recovered, original, 'string decoding must retain the same ID, pet, duration, timestamps and collection')
  const remaining = recovered.session.deadlineAt - checkpoints.afterReload.now
  const [minutes, seconds] = checkpoints.afterReload.countdown.split(':').map(Number)
  assert.ok(remaining > 124000 && remaining <= 125000, `expected 125 seconds left after the chosen 65-second checkpoint: ${remaining}`)
  assert.ok(Math.abs((minutes * 60 + seconds) * 1000 - remaining) <= 1000)
  assert.equal(await page.getByRole('button', { name: '看看是谁', exact: true }).count(), 0)
}, { raw: JSON.stringify(stringSessionRecord()), storageShape: 'json-string', route: '#/hatch' })

await scenario('native-json-string-late-sdk-recovery', async (page, checkpoints) => {
  await errorPage(page)
  checkpoints.initialFailure = await evidence(page)
  assert.equal(checkpoints.initialFailure.reads, 0, 'initial failure is the bridge startup, before storage is read')
  assert.equal(checkpoints.initialFailure.writes, 0)
  const original = await readRecord(page)
  await page.evaluate(() => window.__restoreNative())
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.locator('.hatch-countdown').waitFor()
  await eventually(async () => {
    const listeners = await page.evaluate(() => window.__nativeListenerCounts())
    assert.ok(listeners.appHide >= 1 && listeners.appShow >= 1)
  })
  checkpoints.recovered = await evidence(page)
  assert.deepEqual(checkpoints.recovered.returnedDataTypes, ['string'])
  assert.equal(checkpoints.recovered.loads, 1, 'explicit retry must recover without reloading the document')
  assert.deepEqual(await readRecord(page), original)
  await page.clock.runFor(1100)
  await eventually(async () => assert.ok(await frameCount(page) > 0))
  await emit(page, 'appHide')
  const hiddenFrames = await frameCount(page)
  await page.clock.runFor(9000)
  assert.equal(await frameCount(page), hiddenFrames)
  await emit(page, 'appShow')
  await page.clock.runFor(1100)
  await eventually(async () => assert.ok(await frameCount(page) > hiddenFrames))
  assert.deepEqual(await readRecord(page), original)
  checkpoints.lifecycleRecovered = await evidence(page)
  assert.equal(checkpoints.lifecycleRecovered.writes, 0)
}, { raw: JSON.stringify(stringSessionRecord()), storageShape: 'json-string', initialSdk: 'missing', route: '#/hatch' })

await browser.close()
const report = {
  buildRoot: BUILD, buildSha256: buildHash, assetCount: assets.size,
  simulatedNative: true, startedServer: false,
  limitation: 'Document reload is deliberately injected; these cases do not establish why any physical device recreated its WebView or its native storage response shape.',
  passed: results.filter(result => result.ok).length, total: results.length, results,
}
writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(`${report.passed}/${report.total} native reload scenarios passed; report: ${resolve(OUT, 'report.json')}`)
if (report.passed !== report.total) process.exitCode = 1
