/* 读取恢复与翻面生命周期回归；所有设备能力仅在独立浏览器 context 中模拟。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = (process.argv[2] || 'http://127.0.0.1:5179/').replace(/\/?$/, '/')
const OUT = '.acceptance-final/recovery'
const KEY = 'capsule.mock.egg.record.v1'
const EPOCH = Date.UTC(2026, 10, 5, 10)
const NOW = EPOCH + 1000
const saved = () => ({
  version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: 180000, privacyAgreed: true, backScreenPetId: null },
  session: null,
  collection: { tiny_egg: { count: 4, lastRevealedAt: EPOCH - 1000 } },
})
const egg = (ready = false) => ({
  ...saved(),
  settings: { ...saved().settings, flipReveal: true },
  session: {
    sessionId: 'recovery-flip', tier: 'low', durationMs: 5000,
    startedAt: ready ? NOW - 5000 : NOW, deadlineAt: ready ? NOW : NOW + 5000,
    petId: 'tiny_egg', phase: ready ? 'ready' : 'waiting', revealedAt: null,
    hintedPhases: ready ? ['waiting', 'ready'] : ['waiting'],
  },
})
const browser = await chromium.launch()
const results = []
mkdirSync(OUT, { recursive: true })
const readRaw = page => page.evaluate(key => localStorage.getItem(key), KEY)
const read = async page => JSON.parse(await readRaw(page))
const stats = page => page.evaluate(() => ({ reads: window.__recovery.reads, writes: window.__recovery.writes, sensors: window.__recovery.sensors }))
const pageEvent = (page, name) => page.evaluate(name => window.dispatchEvent(new PageTransitionEvent(name, { persisted: true })), name)

async function eventually(check) {
  let error
  for (let index = 0; index < 160; index += 1) {
    try { await check(); return } catch (caught) { error = caught }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw error
}

async function scenario(name, run, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const raw = options.raw === undefined ? JSON.stringify(saved()) : options.raw
  try {
    await context.addInitScript(({ raw, key, base, readMode, failWrites, holdSensor }) => {
      if (!sessionStorage.getItem('recovery.seeded')) {
        if (raw !== null) localStorage.setItem(key, raw)
        sessionStorage.setItem('recovery.seeded', 'true')
      }
      window.__recovery = { reads: 0, writes: 0, sensors: 0, readMode, failWrites, holdSensor, pendingSensors: [] }
      const handlers = new Map()
      let sdkPromise
      const sdk = () => sdkPromise ||= import(new URL('src/shared/bridge/mock.ts', base).href).then(module => module.createMockSdk())
      window.__recoveryReleaseSensors = () => window.__recovery.pendingSensors.splice(0).forEach(resolve => resolve({ ok: true, values: [0, 0, 9.8] }))
      window.capsule = {
        invoke: async (name, args) => {
          const state = window.__recovery
          if (name === 'getStorage' && args?.key === 'egg.record.v1') {
            state.reads += 1
            if (state.readMode === 'timeout') throw new Error('getStorage:fail bridge timeout')
            if (state.readMode === 'missing-data') return { ok: true }
          }
          if (name === 'setStorage' && args?.key === 'egg.record.v1') {
            state.writes += 1
            if (state.failWrites) throw new Error('setStorage:fail quota exceeded')
          }
          if (name === 'getSensor') {
            state.sensors += 1
            if (state.holdSensor) return new Promise(resolve => state.pendingSensors.push(resolve))
            return { ok: true, values: [0, 0, 9.8] }
          }
          return (await sdk()).invoke(name, args)
        },
        on: (name, handler) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler) },
        off: (name, handler) => handlers.get(name)?.delete(handler),
      }
      window.mcp = { connect: async () => ({}), callTool: async () => '背屏操作已完成' }
      navigator.vibrate = () => true
    }, { raw, key: KEY, base: BASE, readMode: options.readMode || 'normal', failWrites: !!options.failWrites, holdSensor: !!options.holdSensor })
    await page.clock.install({ time: new Date(EPOCH) })
    await page.clock.pauseAt(new Date(NOW))
    await page.goto(BASE + (options.route || '#/'), { waitUntil: 'networkidle' })
    await run(page, raw)
    assert.deepEqual(errors, [], '页面不应产生未捕获异常')
    const evidence = { name, ok: true, ...(await stats(page)), raw: await readRaw(page) }
    writeFileSync(`${OUT}/case-${results.length + 1}.json`, JSON.stringify(evidence, null, 2))
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.stack })
    console.error(`FAIL ${name}: ${error.message}`)
    await page.screenshot({ path: `${OUT}/failed-${results.length}.png`, fullPage: true }).catch(() => undefined)
  } finally { await context.close() }
}

const waitLoadError = async page => {
  await page.getByRole('button', { name: '重新读取', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^孵一颗 ·/ }).count(), 0)
  assert.equal(await page.getByLabel('分钟', { exact: true }).count(), 0)
}

await scenario('读取超时保留原值，三页均不可写，重试恢复收藏', async (page, raw) => {
  await waitLoadError(page)
  for (const hash of ['#/hatch', '#/collection', '#/']) {
    await page.evaluate(hash => { location.hash = hash }, hash)
    await waitLoadError(page)
    await page.clock.runFor(1000)
    assert.equal(await readRaw(page), raw)
    assert.equal((await stats(page)).writes, 0)
  }
  await page.evaluate(() => { window.__recovery.readMode = 'normal' })
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.getByLabel('分钟', { exact: true }).waitFor()
  assert.equal(await readRaw(page), raw)
  assert.equal((await stats(page)).writes, 0)
  assert.equal((await read(page)).collection.tiny_egg.count, 4)
  await page.getByRole('button', { name: '孵一颗 · 3 分钟', exact: true }).click()
  await eventually(async () => assert.ok((await read(page)).session))
  assert.equal((await read(page)).collection.tiny_egg.count, 4)
}, { readMode: 'timeout' })

for (const [name, raw] of [
  ['损坏 JSON', '{"version":2,broken'],
  ['损坏记录结构', JSON.stringify({ ...saved(), collection: { tiny_egg: { count: -1, lastRevealedAt: null } } })],
  ['未知记录版本', JSON.stringify({ ...saved(), version: 99 })],
]) {
  await scenario(`${name}保留原值，重复读取不覆盖`, async (page, raw) => {
    await waitLoadError(page)
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await eventually(async () => assert.ok((await stats(page)).reads >= 2))
    await waitLoadError(page)
    await page.clock.runFor(1000)
    assert.equal(await readRaw(page), raw)
    assert.equal((await stats(page)).writes, 0)
  }, { raw })
}

await scenario('缺少 data 的回执不可当作新用户', async (page, raw) => {
  await waitLoadError(page)
  assert.equal(await readRaw(page), raw)
  assert.equal((await stats(page)).writes, 0)
}, { readMode: 'missing-data' })

await scenario('明确 data:null 的新用户可以正常开局', async page => {
  await page.getByLabel('分钟', { exact: true }).waitFor()
  assert.equal(await readRaw(page), null)
  await page.getByRole('button', { name: '孵一颗 · 3 分钟', exact: true }).click()
  await eventually(async () => assert.ok((await read(page))?.session))
  const value = await read(page)
  assert.equal(value.version, 2)
  assert.deepEqual(value.collection, {})
}, { raw: null })

await scenario('旧版迁移写失败仍可恢复内存并重试保存', async (page, raw) => {
  await page.getByLabel('分钟', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新读取', exact: true }).count(), 0)
  assert.equal(await readRaw(page), raw)
  await page.evaluate(() => { window.__recovery.failWrites = false })
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await eventually(async () => assert.equal((await read(page)).version, 2))
  assert.equal((await read(page)).collection.tiny_egg.count, 4)
  assert.equal((await read(page)).collection.tiny_egg.lastRevealedAt, EPOCH - 1000)
}, { raw: JSON.stringify({ ...saved(), version: 1 }), failWrites: true })

await scenario('pagehide 后到期不采样不揭晓，pageshow 后正常翻面', async page => {
  await page.locator('.hatch-page').waitFor()
  await pageEvent(page, 'pagehide')
  await page.clock.runFor(6000)
  await eventually(async () => assert.equal((await read(page)).session.phase, 'ready'))
  await page.clock.runFor(1000)
  assert.equal((await stats(page)).sensors, 0)
  assert.equal((await read(page)).session.revealedAt, null)
  assert.equal((await read(page)).collection.tiny_egg.count, 4)
  await pageEvent(page, 'pageshow')
  await page.clock.runFor(500)
  await eventually(async () => assert.equal((await read(page)).session.phase, 'revealed'))
  assert.equal((await read(page)).collection.tiny_egg.count, 5)
}, { raw: JSON.stringify(egg()), route: '#/hatch' })

for (const restoreBeforeSettlement of [false, true]) {
  await scenario(`翻面慢回执在${restoreBeforeSettlement ? '隐藏后恢复' : '隐藏中'}返回仍丢弃`, async page => {
    await page.locator('.hatch-page').waitFor()
    await page.clock.runFor(400)
    await eventually(async () => assert.equal((await stats(page)).sensors, 1))
    await pageEvent(page, 'pagehide')
    if (restoreBeforeSettlement) await pageEvent(page, 'pageshow')
    await page.evaluate(() => window.__recoveryReleaseSensors())
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal((await read(page)).session.phase, 'ready')
    assert.equal((await read(page)).collection.tiny_egg.count, 4)
    if (!restoreBeforeSettlement) {
      await page.clock.runFor(800)
      assert.equal((await stats(page)).sensors, 1)
      await pageEvent(page, 'pageshow')
    }
    await page.evaluate(() => { window.__recovery.holdSensor = false })
    await page.clock.runFor(400)
    await eventually(async () => assert.equal((await read(page)).session.phase, 'revealed'))
    assert.equal((await read(page)).collection.tiny_egg.count, 5)
  }, { raw: JSON.stringify(egg(true)), route: '#/hatch', holdSensor: true })
}

await browser.close()
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
console.log(`${results.filter(result => result.ok).length}/${results.length} recovery scenarios passed`)
if (results.some(result => !result.ok)) process.exitCode = 1
