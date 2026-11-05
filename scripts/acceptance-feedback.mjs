/* 音效与到期触觉浏览器验收；合成波形和接口调用不代表扬声器／马达真机效果。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = (process.argv[2] || 'http://127.0.0.1:5179/').replace(/\/?$/, '/')
const OUT = process.env.FEEDBACK_ACCEPTANCE_OUT || '.acceptance-feedback'
const FILTER = process.env.FEEDBACK_ACCEPTANCE_FILTER ? new RegExp(process.env.FEEDBACK_ACCEPTANCE_FILTER) : null
const KEY = 'capsule.mock.egg.record.v1'
const EPOCH = Date.UTC(2026, 10, 5, 10)
const PETS = [
  ['tiny_egg', '小小蛋'], ['sprout_potato', '发芽土豆'], ['question_face', '一脸问号'],
  ['late_duck', '迟到小鸭'], ['box_ghost', '纸箱幽灵'], ['nap_cloud', '打盹云'],
  ['crescent_cat', '月牙小猫'], ['star_fawn', '星角小鹿'], ['cape_penguin', '披风企鹅'],
  ['solar_phoenix', '日冕凤凰'], ['ring_whale', '星环鲸'], ['moon_crown_dragon', '月冠龙'],
]
const record = (sound = false) => ({ version: 2,
  settings: { sound, flipReveal: false, lastDurationMs: 180000, privacyAgreed: true, backScreenPetId: null }, session: null,
  collection: Object.fromEntries(PETS.map(([id]) => [id, { count: 1, lastRevealedAt: EPOCH - 1000 }])),
})
const egg = (sound = false, durationMs = 1000, ready = false) => ({ ...record(sound), session: {
  sessionId: 'feedback-session', tier: 'low', durationMs, startedAt: EPOCH + 1000 - (ready ? durationMs : 0),
  deadlineAt: EPOCH + 1000 + (ready ? 0 : durationMs), petId: 'tiny_egg',
  phase: ready ? 'ready' : 'waiting', revealedAt: null, hintedPhases: ready ? ['waiting', 'ready'] : ['waiting'],
} })
const results = []
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)
const notes = page => page.evaluate(() => window.__feedback.sources.filter(source => source.startedAt !== null))
const buzzes = page => page.evaluate(() => window.__feedback.native.filter(call => call.name === 'vibrateShort'))
const signature = values => JSON.stringify(values.map(({ kind, type, frequency, buffer }) => ({ kind, type, frequency: frequency.map(([method, value]) => [method, value]), buffer })))

async function eventually(check) {
  let error
  for (let index = 0; index < 160; index += 1) {
    try { await check(); return } catch (caught) { error = caught }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw error
}
async function hidden(page, value) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value ? 'hidden' : 'visible' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}
async function clearFeedback(page) {
  await page.evaluate(() => { window.__feedback.sources = []; window.__feedback.native = [] })
}
async function detail(page, name = '迟到小鸭') {
  await page.evaluate(() => { location.hash = '#/collection' })
  await page.getByRole('button', { name: `查看${name}`, exact: true }).click()
  return page.getByRole('dialog').getByRole('button', { name: `逗逗${name}`, exact: true })
}

async function scenario(name, run, options = {}) {
  if (FILTER && !FILTER.test(name)) return
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await context.addInitScript(({ key, seed, base, audioMode }) => {
      if (!sessionStorage.getItem('feedback.seeded')) {
        localStorage.setItem(key, JSON.stringify(seed))
        sessionStorage.setItem('feedback.seeded', 'true')
      }
      window.__feedback = { created: 0, resumes: 0, sources: [], native: [], failWrites: false, holdResume: false, pendingResume: [] }
      const originalSet = Storage.prototype.setItem
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key && window.__feedback.failWrites) throw new DOMException('injected failure', 'QuotaExceededError')
        return originalSet.call(this, name, value)
      }
      let sdkPromise
      const sdk = () => sdkPromise ||= import(new URL('src/shared/bridge/mock.ts', base).href).then(module => module.createMockSdk())
      const nativeHandlers = new Map()
      window.__feedbackEmitNative = (name, payload = {}) => nativeHandlers.get(name)?.forEach(callback => callback(payload))
      window.capsule = {
        invoke: async (name, args) => {
          window.__feedback.native.push({ name, args, at: performance.now() })
          if (name === 'vibrateShort' && window.__feedback.rejectVibration) throw new Error('vibrateShort:fail unsupported')
          return (await sdk()).invoke(name, args)
        },
        on: (name, callback) => {
          if (!nativeHandlers.has(name)) nativeHandlers.set(name, new Set())
          nativeHandlers.get(name).add(callback)
          void sdk().then(value => value.on(name, callback))
        },
        off: (name, callback) => { nativeHandlers.get(name)?.delete(callback); void sdk().then(value => value.off?.(name, callback)) },
      }
      navigator.vibrate = () => true
      window.mcp = { connect: async () => ({}), callTool: async () => '背屏操作已完成' }
      if (audioMode === 'real') {
        const NativeAudioContext = window.AudioContext
        window.AudioContext = class extends NativeAudioContext {
          constructor(...args) {
            super(...args)
            window.__feedback.created += 1
            window.__realContext = this
            const analyser = this.createAnalyser()
            analyser.fftSize = 2048
            analyser.connect(this.destination)
            window.__realAnalyser = analyser
            const originalGain = this.createGain.bind(this)
            this.createGain = () => {
              const gain = originalGain()
              const connect = gain.connect.bind(gain)
              gain.connect = (destination, ...ports) => connect(destination === this.destination ? analyser : destination, ...ports)
              return gain
            }
          }
          resume() { window.__feedback.resumes += 1; return super.resume() }
        }
      } else if (audioMode === 'offline') {
        const NativeOffline = window.OfflineAudioContext
        window.AudioContext = class {
          constructor() {
            const offline = new NativeOffline(1, 96000, 48000)
            Object.defineProperty(offline, 'state', { configurable: true, get: () => 'running' })
            offline.resume = () => Promise.resolve()
            window.__offline = offline
            return offline
          }
        }
      } else if (audioMode === 'missing') {
        window.AudioContext = undefined
        window.webkitAudioContext = undefined
      } else {
        class Param {
          value = 0
          constructor(log = []) { this.log = log }
          setValueAtTime(value, at) { this.value = value; this.log.push(['set', value, at]); return this }
          exponentialRampToValueAtTime(value, at) { this.value = value; this.log.push(['exp', value, at]); return this }
          linearRampToValueAtTime(value, at) { this.value = value; this.log.push(['linear', value, at]); return this }
          setTargetAtTime(value, at) { this.value = value; this.log.push(['target', value, at]); return this }
          cancelScheduledValues() { return this }
        }
        class Node {
          gain = new Param()
          frequency = new Param()
          Q = new Param()
          connect(node) { return node }
          disconnect() { this.disconnected = true }
        }
        class Source extends Node {
          type = 'sine'
          constructor(kind, context) {
            super(); this.context = context
            this.entry = { kind, type: '', frequency: [], buffer: null, startedAt: null, stoppedAt: [], disconnected: false }
            this.frequency = new Param(this.entry.frequency)
            window.__feedback.sources.push(this.entry)
          }
          start(at = this.context.currentTime) {
            this.entry.type = this.type
            this.entry.startedAt = at
            if (this.buffer) this.entry.buffer = { length: this.buffer.length, energy: this.buffer.getChannelData(0).reduce((sum, value) => sum + value * value, 0) }
          }
          stop(at = this.context.currentTime) {
            this.entry.stoppedAt.push(at)
            if (this.endedTimer) clearTimeout(this.endedTimer)
            this.endedTimer = setTimeout(() => { this.onended?.(); this.endListener?.() }, Math.max(0, (at - this.context.currentTime) * 1000))
          }
          addEventListener(name, fn) { if (name === 'ended') this.endListener = fn }
          disconnect() { this.entry.disconnected = true }
        }
        window.AudioContext = class {
          state = 'suspended'
          sampleRate = 48000
          destination = new Node()
          constructor() { window.__feedback.created += 1; window.__feedbackContext = this }
          get currentTime() { return performance.now() / 1000 }
          async resume() {
            window.__feedback.resumes += 1
            if (window.__feedback.holdResume) await new Promise(resolve => window.__feedback.pendingResume.push(resolve))
            this.state = 'running'
          }
          createOscillator() { return new Source('oscillator', this) }
          createBufferSource() { return new Source('buffer', this) }
          createGain() { return new Node() }
          createBiquadFilter() { return new Node() }
          createBuffer(channels, length, sampleRate) {
            const data = new Float32Array(length)
            return { length, sampleRate, getChannelData: () => data }
          }
        }
      }
    }, { key: KEY, seed: options.seed || record(), base: BASE, audioMode: options.audioMode || 'fake' })
    if (options.audioMode !== 'real') {
      await page.clock.install({ time: new Date(EPOCH) })
      await page.clock.pauseAt(new Date(EPOCH + 1000))
    }
    await page.goto(BASE + (options.route || '#/'), { waitUntil: 'networkidle' })
    if (options.route === '#/hatch') await page.locator('.hatch-page').waitFor()
    else await page.getByLabel('分钟', { exact: true }).waitFor()
    await run(page)
    assert.deepEqual(errors, [])
    const evidence = await page.evaluate(() => ({ created: window.__feedback.created, resumes: window.__feedback.resumes,
      sources: window.__feedback.sources, haptics: window.__feedback.native.filter(call => call.name === 'vibrateShort') }))
    writeFileSync(`${OUT}/case-${results.length + 1}.json`, JSON.stringify({ name, ...evidence }, null, 2))
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.stack })
    console.error(`FAIL ${name}: ${error.message}`)
    await page.screenshot({ path: `${OUT}/error-${results.length}.png`, fullPage: true }).catch(() => {})
  } finally { await context.close() }
}

try {
  await scenario('音效默认关闭；开启保存，刷新不自动创建音频，首次手势解锁', async page => {
    assert.equal(await page.getByRole('button', { name: '音效 关', exact: true }).getAttribute('aria-pressed'), 'false')
    assert.equal(await page.evaluate(() => window.__feedback.created), 0)
    const homeEgg = page.getByRole('button', { name: '轻碰这颗蛋', exact: true })
    await homeEgg.press('Enter')
    assert.equal((await notes(page)).length, 0)
    await page.getByRole('button', { name: '音效 关', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.sound, true))
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '音效 开', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__feedback.created), 0)
    const art = await detail(page)
    await art.press('Enter')
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    assert.equal(await page.evaluate(() => window.__feedback.created), 1)
    await page.screenshot({ path: `${OUT}/sound-enabled-pet.png`, fullPage: true, animations: 'disabled' })
  })

  await scenario('12宠物tap／hold声音分别可辨识且互动不改收藏', async page => {
    const before = await read(page)
    const signatures = []
    for (const [id, name] of PETS) {
      const art = await detail(page, name)
      await clearFeedback(page)
      await art.press('Enter')
      await eventually(async () => assert.ok((await notes(page)).length > 0))
      const tap = signature(await notes(page))
      await page.clock.runFor(1100)
      await clearFeedback(page)
      await art.press('Shift+Enter')
      await eventually(async () => assert.ok((await notes(page)).length > 0))
      const hold = signature(await notes(page))
      assert.notEqual(tap, hold, `${id} 的轻点与亲昵不能完全同声`)
      signatures.push({ id, tap, hold })
      await page.clock.runFor(1900)
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    }
    assert.equal(new Set(signatures.map(value => value.tap)).size, 12)
    assert.deepEqual(await read(page), before)
    writeFileSync(`${OUT}/pet-signatures.json`, JSON.stringify(signatures, null, 2))
  }, { seed: record(true) })

  await scenario('蛋轻点与亲昵声音不同，互动不改变孵化记录', async page => {
    const before = await read(page)
    const art = page.getByRole('button', { name: '轻碰这颗蛋', exact: true })
    await art.press('Enter')
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    const tap = signature(await notes(page))
    await page.clock.runFor(1100)
    await clearFeedback(page)
    await art.press('Shift+Enter')
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    assert.notEqual(signature(await notes(page)), tap)
    assert.deepEqual(await read(page), before)
  }, { seed: egg(true, 60000), route: '#/hatch' })

  await scenario('开始、50%阶段、到期和破壳各有音效，揭晓仍只收藏一次', async page => {
    await page.getByLabel('分钟', { exact: true }).fill('0')
    await page.getByLabel('秒', { exact: true }).fill('10')
    await page.getByRole('button', { name: '孵一颗 · 10 秒', exact: true }).click()
    await page.locator('.hatch-page').waitFor()
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    const start = signature(await notes(page))
    await clearFeedback(page)
    await page.clock.runFor(5000)
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    const stage = signature(await notes(page))
    assert.notEqual(stage, start)
    await page.clock.runFor(4000)
    await clearFeedback(page)
    await page.clock.runFor(1000)
    await page.getByRole('button', { name: '看看是谁', exact: true }).waitFor()
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    const due = signature(await notes(page))
    assert.notEqual(due, stage)
    await page.clock.runFor(300)
    assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 2)
    await clearFeedback(page)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await eventually(async () => assert.ok((await notes(page)).some(source => source.kind === 'buffer')))
    assert.notEqual(signature(await notes(page)), due)
    await page.clock.runFor(1200)
    const saved = await read(page)
    assert.equal(saved.session.phase, 'revealed')
    assert.equal(saved.collection[saved.session.petId].count, 2)
    assert.equal((await buzzes(page)).filter(call => call.args.type === 'light').length, 1)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal((await notes(page)).length, 0)
    assert.equal((await buzzes(page)).length, 0)
  }, { seed: record(true) })

  await scenario('静音仍到期双短振250ms；等待、保存后刷新不重复', async page => {
    await page.clock.runFor(1000)
    await eventually(async () => assert.equal((await buzzes(page)).length, 1))
    await page.clock.runFor(249)
    assert.equal((await buzzes(page)).length, 1)
    await page.clock.runFor(1)
    await eventually(async () => assert.equal((await buzzes(page)).length, 2))
    const calls = await buzzes(page)
    assert.deepEqual(calls.map(call => call.args), [{ type: 'medium' }, { type: 'medium' }])
    assert.equal(calls[1].at - calls[0].at, 250)
    assert.equal((await notes(page)).length, 0)
    await page.clock.runFor(3000)
    assert.equal((await buzzes(page)).length, 2)
    assert.ok((await read(page)).session.hintedPhases.includes('ready'))
    await page.reload({ waitUntil: 'networkidle' })
    await page.clock.runFor(1500)
    assert.equal((await buzzes(page)).length, 0)
    assert.equal((await notes(page)).length, 0)
  }, { seed: egg(false), route: '#/hatch' })

  await scenario('到期标记保存失败后原页重试不重复音效或振动', async page => {
    await page.evaluate(() => { window.__feedback.failWrites = true })
    await page.clock.runFor(1300)
    await eventually(async () => assert.equal((await buzzes(page)).length, 2))
    await page.getByRole('button', { name: '重试保存', exact: true }).waitFor()
    await page.evaluate(() => { window.__feedback.failWrites = false })
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await eventually(async () => assert.ok((await read(page)).session.hintedPhases.includes('ready')))
    await page.clock.runFor(1000)
    assert.equal((await buzzes(page)).length, 2)
    await page.reload({ waitUntil: 'networkidle' })
    await page.clock.runFor(1000)
    assert.equal((await buzzes(page)).length, 0)
  }, { seed: egg(false), route: '#/hatch' })

  for (const cancel of ['隐藏', '揭晓']) {
    await scenario(`到期首振后${cancel}取消250ms尾振`, async page => {
      await page.clock.runFor(1000)
      await eventually(async () => assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1))
      if (cancel === '隐藏') await hidden(page, true)
      else await page.getByRole('button', { name: '看看是谁', exact: true }).click()
      await page.clock.runFor(1000)
      assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1)
    }, { seed: egg(false), route: '#/hatch' })
  }

  await scenario('后台阶段不积压音效；后台到期仅首振，返回不补声或尾振', async page => {
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Enter')
    await clearFeedback(page)
    await hidden(page, true)
    await page.clock.runFor(10500)
    assert.equal((await notes(page)).length, 0)
    assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1)
    await hidden(page, false)
    await page.clock.runFor(2000)
    assert.equal((await notes(page)).length, 0)
    assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1)
  }, { seed: egg(true, 10000), route: '#/hatch' })

  await scenario('关闭音效立即停止已排定声音且刷新记住静音', async page => {
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Shift+Enter')
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    await page.getByRole('button', { name: '音效 开', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.sound, false))
    const values = await notes(page)
    assert.ok(values.every(source => source.disconnected), '关闭应断开所有活动音源')
    const count = values.length
    await page.clock.runFor(2000)
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Enter')
    assert.equal((await notes(page)).length, count)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '音效 关', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.__feedback.created), 0)
  }, { seed: record(true) })

  await scenario('无AudioContext及振动拒绝时孵化揭晓仍可完成', async page => {
    await page.evaluate(() => { window.__feedback.rejectVibration = true })
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Enter')
    await page.clock.runFor(1300)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.clock.runFor(1200)
    assert.equal((await read(page)).session.phase, 'revealed')
  }, { seed: egg(true), route: '#/hatch', audioMode: 'missing' })

  await scenario('慢解锁仅保留150ms内最新声音，过期或隐藏均不补播', async page => {
    await page.evaluate(async url => {
      window.__audioTest = await import(url)
      window.__audioTest.setSoundEnabled(true)
      window.__feedback.holdResume = true
      window.__audioTest.unlockAudio()
      window.__audioTest.sfx.start()
      window.__audioTest.sfx.stage()
      window.__audioTest.sfx.meet()
    }, new URL('src/shared/egg/audio.ts', BASE).href)
    assert.equal((await notes(page)).length, 0)
    await page.clock.runFor(100)
    await page.evaluate(() => window.__feedback.pendingResume.splice(0).forEach(resolve => resolve()))
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    const queued = signature(await notes(page))
    await clearFeedback(page)
    await page.evaluate(() => window.__audioTest.sfx.meet())
    assert.equal(signature(await notes(page)), queued, '恢复只播放最后一条，不串播start与stage')
    await clearFeedback(page)
    await page.evaluate(() => {
      window.__feedbackContext.state = 'suspended'
      window.__audioTest.unlockAudio()
      window.__audioTest.sfx.start()
    })
    await page.clock.runFor(151)
    await page.evaluate(() => window.__feedback.pendingResume.splice(0).forEach(resolve => resolve()))
    assert.equal((await notes(page)).length, 0)
    await page.evaluate(() => {
      window.__feedbackContext.state = 'suspended'
      window.__audioTest.unlockAudio()
      window.__audioTest.sfx.start()
    })
    await hidden(page, true)
    await page.evaluate(() => window.__feedback.pendingResume.splice(0).forEach(resolve => resolve()))
    await hidden(page, false)
    await page.clock.runFor(200)
    assert.equal((await notes(page)).length, 0)
  })

  await scenario('隐藏立即停止已排定音源，恢复不继续旧亲昵声音', async page => {
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Shift+Enter')
    await eventually(async () => assert.ok((await notes(page)).length > 0))
    await hidden(page, true)
    assert.ok((await notes(page)).every(source => source.disconnected))
    const count = (await notes(page)).length
    await page.clock.runFor(2000)
    await hidden(page, false)
    await page.clock.runFor(1000)
    assert.equal((await notes(page)).length, count)
  }, { seed: record(true) })

  await scenario('pagehide停止到期声音和尾振，pageshow不覆盖原生appHide且不补播', async page => {
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Enter')
    await clearFeedback(page)
    await page.clock.runFor(1000)
    // 到截止点与250ms阶段采样不是同一事件；先观察首振，再测试隐藏取消尾振。
    // 只给一个采样周期，10ms步进不会越过首振后的250ms尾振窗口。
    for (let elapsed = 0; elapsed < 250; elapsed += 10) {
      if ((await buzzes(page)).some(call => call.args.type === 'medium')) break
      await page.clock.runFor(10)
    }
    await eventually(async () => assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1))
    assert.ok((await notes(page)).length > 0)
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    assert.ok((await notes(page)).every(source => source.disconnected))
    const count = (await notes(page)).length
    await page.clock.runFor(1000)
    assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1)
    await page.evaluate(() => {
      window.__feedbackEmitNative('appHide')
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await page.clock.runFor(1000)
    assert.equal((await notes(page)).length, count)
    assert.equal((await buzzes(page)).filter(call => call.args.type === 'medium').length, 1)
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Enter')
    assert.equal((await notes(page)).length, count, 'pageshow不能绕过尚未恢复的原生appHide')
    await page.evaluate(() => window.__feedbackEmitNative('appShow'))
    await page.clock.runFor(500)
    assert.equal((await notes(page)).length, count, '原生恢复也不能补播过期音效')
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).press('Enter')
    await eventually(async () => assert.ok((await notes(page)).length > count))
  }, { seed: egg(true), route: '#/hatch' })

  await scenario('真实AudioContext首次按钮手势解锁running且Analyser捕获非零声音', async page => {
    assert.equal(await page.evaluate(() => window.__feedback.created), 0)
    await page.getByRole('button', { name: '音效 关', exact: true }).click()
    const captured = await page.evaluate(async () => {
      const context = window.__realContext
      const analyser = window.__realAnalyser
      const values = new Float32Array(analyser.fftSize)
      let peak = 0, energy = 0, nonzero = 0, samples = 0
      for (let index = 0; index < 65; index += 1) {
        analyser.getFloatTimeDomainData(values)
        for (const value of values) {
          peak = Math.max(peak, Math.abs(value)); energy += value * value; samples += 1
          if (value !== 0) nonzero += 1
        }
        await new Promise(resolve => setTimeout(resolve, 8))
      }
      return { state: context.state, sampleRate: context.sampleRate, peak, rms: Math.sqrt(energy / samples), nonzero,
        created: window.__feedback.created, resumes: window.__feedback.resumes, userActivated: navigator.userActivation.hasBeenActive }
    })
    assert.equal(captured.state, 'running')
    assert.equal(captured.created, 1)
    assert.equal(captured.userActivated, true)
    assert.ok(captured.peak > 0.001 && captured.rms > 0.0001 && captured.nonzero > 1000, JSON.stringify(captured))
    assert.equal((await read(page)).settings.sound, true)
    writeFileSync(`${OUT}/real-audio-context.json`, JSON.stringify(captured, null, 2))
  }, { audioMode: 'real' })

  await scenario('真实WebAudio离线渲染非零PCM，无外链音频', async page => {
    const reports = []
    for (const cue of ['start', 'due', 'crack', 'egg-hold', 'whale-tap', 'whale-hold']) {
      const rendered = await page.evaluate(async ({ url, cue }) => {
        const audio = await import(`${url}?feedback=${cue}`)
        audio.setSoundEnabled(true)
        audio.unlockAudio()
        await Promise.resolve()
        if (cue === 'egg-hold') audio.sfx.eggReaction('hold')
        else if (cue.startsWith('whale-')) audio.sfx.petReaction('ring_whale', cue.slice(6))
        else audio.sfx[cue]()
        const buffer = await window.__offline.startRendering()
        const values = buffer.getChannelData(0)
        let energy = 0, peak = 0, nonzero = 0
        for (const value of values) { energy += value * value; peak = Math.max(peak, Math.abs(value)); if (value !== 0) nonzero += 1 }
        return { cue, sampleRate: buffer.sampleRate, length: values.length, rms: Math.sqrt(energy / values.length), peak, nonzero, pcm: Array.from(values) }
      }, { url: new URL('src/shared/egg/audio.ts', BASE).href, cue })
      const { pcm, ...stats } = rendered
      assert.ok(stats.rms > 0.0001 && stats.peak > 0.001 && stats.nonzero > 1000, JSON.stringify(stats))
      assert.ok(Number.isFinite(stats.rms) && Number.isFinite(stats.peak) && stats.peak < 1)
      const wav = Buffer.alloc(44 + pcm.length * 2)
      wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(stats.sampleRate, 24); wav.writeUInt32LE(stats.sampleRate * 2, 28)
      wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40)
      pcm.forEach((value, index) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2))
      writeFileSync(`${OUT}/sound-${cue}.wav`, wav)
      reports.push(stats)
    }
    writeFileSync(`${OUT}/real-audio-render.json`, JSON.stringify(reports, null, 2))
  }, { audioMode: 'offline' })
} finally {
  await browser.close()
  writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2))
}
const failed = results.filter(result => !result.ok)
console.log(`\n反馈验收 ${results.length} 个场景：通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exitCode = failed.length ? 1 : 0
