/* 浏览器验收：普通孵化局 + 可控时钟，不代替 APK 真机验证。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = (process.argv[2] || process.env.ACCEPTANCE_BASE || 'http://127.0.0.1:5173/').replace(/\/?$/, '/')
const OUT = process.env.ACCEPTANCE_OUT || '.acceptance-storybook'
const FILTER = process.env.ACCEPTANCE_FILTER ? new RegExp(process.env.ACCEPTANCE_FILTER) : null
const KEY = 'capsule.mock.egg.record.v1'
const EPOCH = Date.UTC(2026, 10, 5, 8)
const results = []
mkdirSync(OUT, { recursive: true })
const labels = { low: '低级', normal: '普通', high: '高级', ornate: '华丽' }
const identities = { low: ['tiny_egg', 'sprout_potato', 'question_face'], normal: ['late_duck', 'box_ghost', 'nap_cloud'],
  high: ['crescent_cat', 'star_fawn', 'cape_penguin'], ornate: ['solar_phoenix', 'ring_whale', 'moon_crown_dragon'] }
const record = (durationMs = 180000) => ({ version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: durationMs, privacyAgreed: true, backScreenPetId: null }, session: null, collection: {} })
const owned = (petIds = ['tiny_egg', 'late_duck'], selected = null) => {
  const value = record()
  value.settings.backScreenPetId = selected
  value.collection = Object.fromEntries(petIds.map((id, index) => [id, { count: index + 1, lastRevealedAt: EPOCH - (index + 1) * 60000 }]))
  return value
}
const browser = await chromium.launch()

// Node 侧轮询仅等待 React/桥接微任务，不推进页面时钟。
async function eventually(check) {
  const deadline = Date.now() + 10000
  let error
  do {
    try { await check(); return } catch (caught) { error = caught }
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  throw error
}
// 背屏帧在上一帧真正完成后至少等待1秒；只用于设备画面断言，不改变业务计时边界测试。
async function eventuallyFrame(page, check) {
  let error
  for (let elapsed = 0; elapsed <= 2000; elapsed += 250) {
    try { await check(); return } catch (caught) { error = caught }
    if (elapsed < 2000) await page.clock.runFor(250)
  }
  throw error
}
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), KEY)
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled' })
async function setDuration(page, seconds) {
  await page.getByLabel('分钟', { exact: true }).fill(String(Math.floor(seconds / 60)))
  await page.getByLabel('秒', { exact: true }).fill(String(seconds % 60))
  await page.getByLabel('秒', { exact: true }).press('Tab')
}
async function start(page, seconds) {
  await setDuration(page, seconds)
  await page.getByRole('button', { name: /^孵一颗 ·/ }).click()
  await page.waitForURL(/#\/hatch$/)
  await eventually(async () => assert.ok((await read(page))?.session))
  return (await read(page)).session
}
async function ready(page, milliseconds) {
  await page.clock.runFor(milliseconds)
  await page.getByRole('button', { name: '看看是谁', exact: true }).waitFor()
  await eventually(async () => assert.equal((await read(page)).session.phase, 'ready'))
}
async function gallery(page) {
  await page.evaluate(() => { location.hash = '#/collection' })
  await page.getByRole('heading', { name: '收藏', exact: true }).waitFor()
}
async function openPet(page, id) {
  await page.getByRole('button', { name: `查看${catalog.find(pet => pet.id === id).name}`, exact: true }).click()
  await page.getByRole('dialog').waitFor()
  return page.getByRole('dialog')
}
async function goHome(page) {
  await page.evaluate(() => { location.hash = '#/' })
  await page.getByLabel('分钟', { exact: true }).waitFor()
}
async function endEgg(page) {
  await page.evaluate(() => { location.hash = '#/hatch' })
  await page.getByRole('button', { name: '结束这颗蛋', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '结束', exact: true }).click()
  await page.getByLabel('分钟', { exact: true }).waitFor()
}
async function noPetLeak(page, pet) {
  const body = await page.locator('body').innerText()
  const aria = await page.locator('body').ariaSnapshot()
  const attributes = await page.locator('[aria-label], [alt], svg title').evaluateAll(elements => elements.map(element =>
    [element.getAttribute('aria-label'), element.getAttribute('alt'), element.matches('title') ? element.textContent : ''].join(' ')).join('\n'))
  for (const value of [body, aria, attributes]) {
    assert.ok(!value.includes(pet.name), `揭晓前泄露名字：${pet.name}`)
    if (pet.quote) assert.ok(!value.includes(pet.quote), '揭晓前泄露角色短句')
  }
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth,
    html: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    pages: [...document.querySelectorAll('.page')].map(element => ({ client: element.clientWidth, scroll: element.scrollWidth })) }))
  assert.ok(sizes.html <= sizes.width + 1 && sizes.body <= sizes.width + 1, JSON.stringify(sizes))
  assert.ok(sizes.pages.every(size => size.scroll <= size.client + 1), JSON.stringify(sizes))
}
async function scenario(name, run, options = {}) {
  // 定向复现时仍先加载并核对角色目录，正式回归不设置过滤器。
  if (FILTER && !name.startsWith('默认3:00') && !FILTER.test(name)) return
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 844 }, reducedMotion: options.reducedMotion || 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await context.addInitScript(({ key, seed, failWrites, mcp }) => {
      // 只在每个隔离 context 首次播种；刷新必须读取应用保存的记录。
      if (!sessionStorage.getItem('egg.acceptance.seeded')) {
        if (seed) localStorage.setItem(key, JSON.stringify(seed))
        sessionStorage.setItem('egg.acceptance.seeded', 'yes')
      }
      window.__eggWrites = []
      window.__failEggWrites = failWrites
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) {
          if (window.__failEggWrites) throw new DOMException('injected failure', 'QuotaExceededError')
          window.__eggWrites.push(JSON.parse(value))
        }
        return original.call(this, name, value)
      }
      if (mcp) {
        window.__mcp = { commands: [], active: 0, maxActive: 0, hold: false, fail: mcp === 'fail', pending: [],
          connectCalls: 0, connecting: 0, maxConnecting: 0, connectMode: mcp, pendingConnect: [], receipts: [] }
        window.mcp = {
          connect: async () => {
            const mock = window.__mcp
            mock.connectCalls += 1
            mock.connecting += 1
            mock.maxConnecting = Math.max(mock.maxConnecting, mock.connecting)
            if (mock.connectMode === 'connect-pending') await new Promise(() => {})
            const result = mock.connectMode === 'connect-held'
              ? await new Promise(resolve => mock.pendingConnect.push(resolve))
              : mock.connectMode === 'connect-false' ? false : {}
            mock.connecting -= 1
            return result
          },
          callTool: async (name, args) => {
            const mock = window.__mcp
            const command = { name, args: structuredClone(args), startedAt: Date.now(), finishedAt: null }
            mock.commands.push(command)
            mock.active += 1
            mock.maxActive = Math.max(mock.maxActive, mock.active)
            if (mock.hold) await new Promise(resolve => mock.pending.push(resolve))
            mock.active -= 1
            command.finishedAt = Date.now()
            const result = mock.fail ? { isError: true } : mcp === 'text' ? '背屏操作已完成' : { isError: false }
            mock.receipts.push(result)
            return result
          },
        }
        window.__releaseMcp = () => window.__mcp.pending.shift()?.()
        window.__releaseConnect = (result = {}) => window.__mcp.pendingConnect.shift()?.(result)
      }
    }, { key: KEY, seed: options.seed ?? null, failWrites: options.failWrites ?? false, mcp: options.mcp ?? false })
    await page.clock.install({ time: new Date(EPOCH) })
    await page.clock.pauseAt(new Date(EPOCH + 1000))
    await page.goto(BASE + (options.route || ''), { waitUntil: 'networkidle' })
    if (options.route === '#/hatch') await page.locator('.hatch-page').waitFor()
    else if (options.route === '#/collection') await page.getByRole('heading', { name: '收藏', exact: true }).waitFor()
    else await page.getByLabel('分钟', { exact: true }).waitFor()
    await run(page)
    assert.deepEqual(errors, [], '页面发生未捕获异常')
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.stack })
    console.error(`FAIL ${name}: ${error.message}`)
    await shot(page, `error-${results.length}`).catch(() => {})
  } finally { await context.close() }
}

let catalog = []
try {
  await scenario('默认3:00，无演示/预设；12角色身份分档与唯一391点帧', async page => {
    assert.equal(await page.getByLabel('分钟', { exact: true }).inputValue(), '3')
    assert.equal(await page.getByLabel('秒', { exact: true }).inputValue(), '0')
    assert.equal(await page.getByRole('button', { name: /体验一局|演示|^(1|3|5|10) 分钟$/ }).count(), 0)
    await page.getByRole('button', { name: '孵一颗 · 3 分钟', exact: true }).waitFor()
    catalog = await page.evaluate(async url => {
      const { PETS, petFrame } = await import(url)
      return PETS.map(pet => ({ ...pet, frame: petFrame(pet.id) }))
    }, new URL('src/shared/egg/pets.ts', BASE).href)
    assert.equal(catalog.length, 12)
    assert.equal(new Set(catalog.map(pet => pet.id)).size, 12)
    for (const tier of Object.keys(labels)) assert.deepEqual(catalog.filter(pet => pet.tier === tier).map(pet => pet.id).sort(), [...identities[tier]].sort())
    assert.equal(new Set(catalog.map(pet => pet.frame.join(','))).size, 12, '每只宠物应有独立背屏图案')
    for (const pet of catalog) {
      assert.equal(pet.frame.length, 391)
      assert.equal(pet.pattern.length, 23)
      assert.ok(pet.pattern.every(row => row.length === 17))
      assert.ok(pet.frame.every(value => value === 0 || value === 255))
      assert.ok(pet.frame.some(value => value > 0), '宠物点阵不能为空')
    }
    await shot(page, '01-start')
  })
  for (const [seconds, tier] of [[1,'low'],[179,'low'],[180,'normal'],[419,'normal'],[420,'high'],[599,'high'],[600,'ornate'],[10800,'ornate']]) {
    await scenario(`${seconds}秒等级${tier}：同池抽取、刷新不重抽`, async page => {
      await setDuration(page, seconds)
      await page.getByText(`${labels[tier]}宠物`, { exact: true }).waitFor()
      const session = await start(page, seconds)
      assert.equal(session.durationMs, seconds * 1000)
      assert.equal(session.tier, tier)
      assert.equal(catalog.find(pet => pet.id === session.petId)?.tier, tier)
      assert.equal('mode' in session, false)
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.hatch-page').waitFor()
      const restored = (await read(page)).session
      for (const field of ['sessionId', 'petId', 'tier', 'durationMs']) assert.equal(restored[field], session[field])
    })
  }
  for (const [minutes, seconds, saved] of [['0','0',180000],['-1','0',180000],['3.5','0',180000],['3','60',180000],['180','1',10800000],['181','0',180000],['','0',180000],['abc','0',180000]]) {
    await scenario(`非法输入${JSON.stringify(minutes)}:${seconds}不开局、不覆盖有效设置`, async page => {
      await page.getByLabel('分钟', { exact: true }).fill(minutes)
      await page.getByLabel('秒', { exact: true }).fill(seconds)
      await page.getByLabel('秒', { exact: true }).press('Tab')
      assert.equal(await page.getByRole('button', { name: '设置时长后开始', exact: true }).isDisabled(), true)
      await page.getByRole('alert').waitFor()
      assert.equal((await read(page)).settings.lastDurationMs, saved)
      assert.equal((await read(page)).session, null)
    }, { seed: record(saved) })
  }
  await scenario('有效分秒重载与连续开始只创建一局', async page => {
    await setDuration(page, 305)
    await eventually(async () => assert.equal((await read(page))?.settings.lastDurationMs, 305000))
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByLabel('分钟', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('分钟', { exact: true }).inputValue(), '5')
    assert.equal(await page.getByLabel('秒', { exact: true }).inputValue(), '5')
    await page.getByRole('button', { name: '孵一颗 · 5 分钟 5 秒', exact: true }).evaluate(button => { button.click(); button.click(); button.click() })
    await page.waitForURL(/#\/hatch$/)
    const ids = await page.evaluate(() => [...new Set(window.__eggWrites.map(value => value.session?.sessionId).filter(Boolean))])
    assert.equal(ids.length, 1)
    assert.equal((await read(page)).session.durationMs, 305000)
  })
  await scenario('60秒局阶段推进、超时不升级、连续揭晓只收藏一次', async page => {
    const session = await start(page, 60)
    await shot(page, '02-hatching')
    assert.equal((await read(page)).session.phase, 'waiting')
    await page.clock.runFor(30000)
    await page.getByText('嘘，里面好像动了一下。', { exact: true }).waitFor()
    await page.clock.runFor(21000)
    await page.getByText('就快见面了，再等一小会儿。', { exact: true }).waitFor()
    await ready(page, 9000)
    assert.equal(await page.locator('.hatch-countdown').innerText(), '00:00')
    await shot(page, '03-ready')
    await page.clock.fastForward(20 * 60000)
    assert.equal((await read(page)).session.tier, 'low')
    assert.equal((await read(page)).session.petId, session.petId)
    await page.getByRole('button', { name: '看看是谁', exact: true }).evaluate(button => { button.click(); button.click(); button.click() })
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    assert.equal((await read(page)).collection[session.petId].count, 1)
    await shot(page, '04-revealed')
    await page.getByRole('button', { name: '去看看收藏', exact: true }).click()
    await page.getByText('已遇见 1 / 12', { exact: true }).waitFor()
    for (const name of Object.values(labels)) await page.getByRole('heading', { name: `${name}宠物`, exact: true }).waitFor()
    assert.equal(await page.getByRole('listitem').count(), 12)
    await shot(page, '06-collection')
  })
  await scenario('收藏写失败无成功文案，收藏页重试仅加一次且重启保留', async page => {
    const session = await start(page, 1)
    await ready(page, 1000)
    await page.evaluate(() => { window.__failEggWrites = true })
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByText('收藏待保存', { exact: true }).waitFor()
    assert.equal(await page.getByText('已收进收藏', { exact: true }).count(), 0)
    assert.equal((await read(page)).collection[session.petId]?.count ?? 0, 0)
    assert.equal(await page.getByRole('button', { name: '再孵一颗', exact: true }).isDisabled(), true)
    await shot(page, '05-save-failed')
    await page.getByRole('button', { name: '去看看收藏', exact: true }).click()
    await page.getByRole('heading', { name: '收藏', exact: true }).waitFor()
    await page.getByText('这次收藏还没保存，请重试', { exact: true }).waitFor()
    await page.evaluate(() => { window.__failEggWrites = false })
    await page.getByRole('button', { name: '重试保存', exact: true }).evaluate(button => { button.click(); button.click() })
    await eventually(async () => assert.equal(await page.getByRole('button', { name: '重试保存', exact: true }).count(), 0))
    const saved = await read(page)
    assert.equal(saved.collection[session.petId].count, 1)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByText('已遇见 1 / 12', { exact: true }).waitFor()
    assert.deepEqual((await read(page)).collection, saved.collection)
    await page.evaluate(() => { location.hash = '#/hatch' })
    await page.getByText('已收进收藏', { exact: true }).waitFor()
  })
  for (const kind of ['normal', 'demo', 'revealed']) {
    const legacy = record(305000)
    legacy.version = 1
    legacy.collection = { tiny_egg: { count: 2, lastRevealedAt: EPOCH - 100000 } }
    legacy.session = { sessionId: `legacy-${kind}`, mode: kind === 'normal' ? 'normal' : 'demo',
      durationMs: kind === 'normal' ? 180000 : 20000, startedAt: EPOCH - 5000,
      deadlineAt: EPOCH - 5000 + (kind === 'normal' ? 180000 : 20000), petId: 'tiny_egg',
      phase: kind === 'revealed' ? 'revealed' : 'waiting', revealedAt: kind === 'revealed' ? EPOCH - 100000 : null,
      hintedPhases: kind === 'revealed' ? ['waiting', 'ready'] : ['waiting'] }
    await scenario(`v1 ${kind}迁移保留旧数据且重孵沿用5:05`, async page => {
      await eventually(async () => assert.equal((await read(page)).version, 2))
      const migrated = await read(page)
      assert.deepEqual(migrated.collection, legacy.collection)
      for (const field of ['sessionId','petId','durationMs','startedAt','deadlineAt','revealedAt']) assert.equal(migrated.session[field], legacy.session[field])
      assert.equal(migrated.session.tier, null)
      assert.equal('mode' in migrated.session, false)
      assert.equal(await page.getByText(/^(低级|普通|高级|华丽)宠物$/).count(), 0)
      if (kind !== 'revealed') {
        const remaining = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).session.deadlineAt - Date.now(), KEY)
        await ready(page, remaining)
        await page.getByRole('button', { name: '看看是谁', exact: true }).click()
      }
      await page.getByText('已收进收藏', { exact: true }).waitFor()
      await page.getByRole('button', { name: '再孵一颗', exact: true }).click()
      await eventually(async () => assert.notEqual((await read(page)).session.sessionId, legacy.session.sessionId))
      const next = (await read(page)).session
      assert.equal(next.durationMs, 305000)
      assert.equal(next.tier, 'normal')
      assert.equal(catalog.find(pet => pet.id === next.petId)?.tier, 'normal')
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.hatch-page').waitFor()
      assert.equal((await read(page)).session.sessionId, next.sessionId)
    }, { seed: legacy, route: '#/hatch' })
  }
  for (const withSession of [true, false]) {
    const legacy = record(305000)
    legacy.version = 1
    legacy.collection = { tiny_egg: { count: 2, lastRevealedAt: EPOCH - 100000 } }
    if (withSession) legacy.session = { sessionId: 'migration-failure', mode: 'demo', durationMs: 20000,
      startedAt: EPOCH - 30000, deadlineAt: EPOCH - 10000, petId: 'tiny_egg', phase: 'revealed', revealedAt: EPOCH - 100000, hintedPhases: ['ready'] }
    await scenario(`迁移写失败可重试（${withSession ? '已揭晓' : '无当前局：首页'}）`, async page => {
      await page.getByText('原有记录还没保存，请重试', { exact: true }).waitFor()
      assert.equal((await read(page)).version, 1)
      assert.equal(await page.getByText('已收进收藏', { exact: true }).count(), 0)
      await page.evaluate(() => { window.__failEggWrites = false })
      await page.getByRole('button', { name: '重试保存', exact: true }).click()
      await eventually(async () => assert.equal((await read(page)).version, 2))
      assert.deepEqual((await read(page)).collection, legacy.collection)
      if (withSession) {
        assert.equal((await read(page)).session.tier, null)
        assert.equal((await read(page)).session.petId, 'tiny_egg')
      } else assert.equal((await read(page)).session, null)
    }, { seed: legacy, route: withSession ? '#/hatch' : '', failWrites: true })
  }
  await scenario('连续墙钟+1h/-2h/+1h校正：剩余连续、不提前ready', async page => {
    const original = await start(page, 60)
    await page.clock.runFor(10000)
    for (const jump of [3600000, -7200000, 3600000]) {
      const before = await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); return { now: Date.now(), remaining: value.session.deadlineAt - Date.now() } }, KEY)
      await page.clock.setSystemTime(before.now + jump)
      await page.clock.runFor(250)
      // 定时器同步修正内存状态；本地桥接的串行写入需等待微任务落盘。
      await eventually(async () => assert.notEqual((await read(page)).session.deadlineAt, before.now + before.remaining))
      const after = await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)); return { session: value.session, remaining: value.session.deadlineAt - Date.now() } }, KEY)
      assert.ok(Math.abs(after.remaining - (before.remaining - 250)) < 2, JSON.stringify({ before, after }))
      assert.equal(after.session.tier, original.tier)
      assert.equal(after.session.petId, original.petId)
      assert.ok(!after.session.hintedPhases.includes('ready'))
      assert.equal(await page.getByRole('button', { name: '看看是谁', exact: true }).count(), 0)
    }
    const remaining = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).session.deadlineAt - Date.now(), KEY)
    await page.clock.runFor(remaining - 1000)
    assert.equal(await page.getByRole('button', { name: '看看是谁', exact: true }).count(), 0)
    await ready(page, 1000)
  })
  await scenario('修改时长不改变当前局；取消/确认重孵和结束流程', async page => {
    const original = await start(page, 60)
    await page.evaluate(() => { location.hash = '#/' })
    await page.getByLabel('分钟', { exact: true }).waitFor()
    await setDuration(page, 600)
    assert.deepEqual((await read(page)).session, original)
    await page.getByRole('button', { name: '孵一颗 · 10 分钟', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '继续孵化', exact: true }).click()
    assert.equal((await read(page)).session.sessionId, original.sessionId)
    await page.getByRole('button', { name: '孵一颗 · 10 分钟', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '结束并重孵', exact: true }).click()
    await page.waitForURL(/#\/hatch$/)
    const next = (await read(page)).session
    assert.notEqual(next.sessionId, original.sessionId)
    assert.equal(next.durationMs, 600000)
    assert.equal(next.tier, 'ornate')
    await page.getByRole('button', { name: '结束这颗蛋', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '结束', exact: true }).click()
    await page.getByLabel('分钟', { exact: true }).waitFor()
    assert.equal((await read(page)).session, null)
  })
  for (const [name, selection] of [['缺失', undefined], ['未知角色', 'not-a-pet'], ['未拥有角色', 'moon_crown_dragon'], ['非法类型', 42]]) {
    const seed = owned()
    if (selection === undefined) delete seed.settings.backScreenPetId
    else seed.settings.backScreenPetId = selection
    await scenario(`v2背屏选择${name}归null，旧收藏保留`, async page => {
      const parsed = await page.evaluate(async ({ url, value }) => (await import(url)).migrateRecord(value),
        { url: new URL('src/shared/egg/storage.ts', BASE).href, value: seed })
      assert.equal(parsed.settings.backScreenPetId, null)
      assert.deepEqual(parsed.collection, seed.collection)
      await setDuration(page, 181)
      await eventually(async () => assert.equal((await read(page)).settings.lastDurationMs, 181000))
      assert.equal((await read(page)).settings.backScreenPetId, null)
      assert.deepEqual((await read(page)).collection, seed.collection)
    }, { seed })
  }
  await scenario('已收藏伙伴可选择并重载保持；停止展示清空选择', async page => {
    const before = (await read(page)).collection
    await gallery(page)
    assert.equal(await page.getByRole('button', { name: '查看月冠龙', exact: true }).isDisabled(), true, '未拥有角色不得进入互动选择')
    await (await openPet(page, 'late_duck')).getByRole('button', { name: '放到背屏', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, 'late_duck'))
    assert.deepEqual((await read(page)).collection, before)
    await page.reload({ waitUntil: 'networkidle' })
    const dialog = await openPet(page, 'late_duck')
    await dialog.getByRole('button', { name: '停止展示', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, null))
    await eventually(async () => {
      const commands = await page.evaluate(() => window.__mcp.commands.map(command => command.name))
      assert.deepEqual(commands.slice(-2), ['clear_back_screen_frame', 'sleep_back_screen'])
    })
    assert.deepEqual((await read(page)).collection, before)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal((await read(page)).settings.backScreenPetId, null)
  }, { seed: owned(), mcp: true })
  for (const isReady of [false, true]) {
    await scenario(`未揭晓${isReady ? 'ready' : 'waiting'}局禁止替换宠物，结束恢复原选择`, async page => {
      const current = await start(page, 1)
      if (isReady) await ready(page, 1000)
      await gallery(page)
      const dialog = await openPet(page, 'late_duck')
      await dialog.getByText('这颗蛋还在孵化，揭晓或结束后可更换', { exact: true }).waitFor()
      assert.equal(await dialog.getByRole('button', { name: '放到背屏', exact: true }).isDisabled(), true)
      assert.equal((await read(page)).settings.backScreenPetId, 'tiny_egg')
      assert.equal((await read(page)).session.sessionId, current.sessionId)
      await page.reload({ waitUntil: 'networkidle' })
      await endEgg(page)
      await eventually(async () => assert.equal((await read(page)).session, null))
      assert.equal((await read(page)).settings.backScreenPetId, 'tiny_egg')
      await eventuallyFrame(page, async () => {
        const commands = await page.evaluate(() => window.__mcp.commands.filter(command => command.name === 'set_back_screen_frame'))
        assert.deepEqual(commands.at(-1)?.args.frame, catalog.find(pet => pet.id === 'tiny_egg').frame)
      })
    }, { seed: owned(undefined, 'tiny_egg'), mcp: true })
  }
  await scenario('新揭晓自动选中；后续手动选择不被旧结果页覆盖', async page => {
    const session = await start(page, 1)
    await ready(page, 1000)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    const revealed = await read(page)
    assert.equal(revealed.settings.backScreenPetId, session.petId)
    assert.equal(revealed.collection[session.petId].count, (owned().collection[session.petId]?.count || 0) + 1)
    await gallery(page)
    await (await openPet(page, 'late_duck')).getByRole('button', { name: '放到背屏', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, 'late_duck'))
    await page.evaluate(() => { location.hash = '#/hatch' })
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    assert.equal((await read(page)).settings.backScreenPetId, 'late_duck')
    assert.deepEqual((await read(page)).collection, revealed.collection)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    assert.equal((await read(page)).settings.backScreenPetId, 'late_duck')
    assert.deepEqual((await read(page)).collection, revealed.collection)
  }, { seed: owned() })
  await scenario('轻碰蛋和逗宠物只产生局部反馈，不改时间、抽签或收藏', async page => {
    const session = await start(page, 60)
    await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).evaluate(button => { button.click(); button.click(); button.click() })
    assert.deepEqual((await read(page)).session, session)
    await gallery(page)
    const dialog = await openPet(page, 'late_duck')
    const before = await read(page)
    await dialog.getByRole('button', { name: '逗逗迟到小鸭', exact: true }).evaluate(button => { button.click(); button.click(); button.click() })
    assert.deepEqual(await read(page), before)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await openPet(page, 'late_duck')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
  }, { seed: owned() })
  await scenario('1秒短局揭晓前及1200ms破壳期间不泄露名字或ARIA', async page => {
    const session = await start(page, 1)
    const pet = catalog.find(item => item.id === session.petId)
    await noPetLeak(page, pet)
    await ready(page, 1000)
    await noPetLeak(page, pet)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '正在破壳…' }).waitFor()
    await noPetLeak(page, pet)
    await page.clock.runFor(600)
    await gallery(page)
    await page.getByRole('status').filter({ hasText: '正在破壳…' }).waitFor()
    await noPetLeak(page, pet)
    await goHome(page)
    await noPetLeak(page, pet)
    await page.evaluate(() => { location.hash = '#/hatch' })
    await page.getByRole('status').filter({ hasText: '正在破壳…' }).waitFor()
    await page.clock.runFor(599)
    await noPetLeak(page, pet)
    assert.equal(await page.getByRole('button', { name: '再孵一颗', exact: true }).count(), 0)
    await page.clock.runFor(1)
    await page.getByText(pet.name, { exact: true }).first().waitFor()
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    assert.equal((await read(page)).collection[pet.id].count, 1)
    await shot(page, 'storybook-revealed-motion')
  }, { reducedMotion: 'no-preference' })
  await scenario('破壳中重载：已揭晓记录不重播且不重复计数', async page => {
    const session = await start(page, 1)
    await ready(page, 1000)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '正在破壳…' }).waitFor()
    await eventually(async () => assert.equal((await read(page)).session.phase, 'revealed'))
    await page.clock.runFor(300)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByText(catalog.find(pet => pet.id === session.petId).name, { exact: true }).first().waitFor()
    assert.equal(await page.getByText('正在破壳…', { exact: true }).count(), 0)
    assert.equal((await read(page)).collection[session.petId].count, 1)
    assert.equal((await read(page)).settings.backScreenPetId, session.petId)
  }, { reducedMotion: 'no-preference' })
  await scenario('减少动态：1秒局直接相遇，不播放破壳过场', async page => {
    const session = await start(page, 1)
    await ready(page, 1000)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    assert.equal(await page.getByText('正在破壳…', { exact: true }).count(), 0)
    await page.getByText(catalog.find(pet => pet.id === session.petId).name, { exact: true }).first().waitFor()
    assert.equal((await read(page)).collection[session.petId].count, 1)
  })
  await scenario('背屏连接失败不等于保存失败；重连不改变收藏或选择', async page => {
    await gallery(page)
    await (await openPet(page, 'late_duck')).getByRole('button', { name: '放到背屏', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, 'late_duck'))
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '重试保存', exact: true }).count(), 0)
    const saved = await read(page)
    await page.evaluate(() => { window.__mcp.fail = false })
    await page.locator('.back-screen-panel summary').click()
    await page.getByRole('button', { name: '重试背屏连接', exact: true }).click()
    await eventuallyFrame(page, async () => assert.equal(await page.getByText('背屏暂时没接上', { exact: true }).count(), 0))
    assert.deepEqual(await read(page), saved)
  }, { seed: owned(), mcp: 'fail' })
  await scenario('选择宠物保存失败单独提示、禁止再次选择，重试后持久化', async page => {
    await gallery(page)
    const dialog = await openPet(page, 'late_duck')
    await page.evaluate(() => { window.__failEggWrites = true })
    await dialog.getByRole('button', { name: '放到背屏', exact: true }).click()
    await page.getByRole('button', { name: '重试保存', exact: true }).waitFor()
    assert.equal((await read(page)).settings.backScreenPetId, null)
    assert.equal(await page.getByText('背屏暂时没接上', { exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: '停止展示', exact: true }).isDisabled(), true)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await page.evaluate(() => { window.__failEggWrites = false })
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, 'late_duck'))
    assert.deepEqual((await read(page)).collection, owned().collection)
    await page.reload({ waitUntil: 'networkidle' })
    await (await openPet(page, 'late_duck')).getByRole('button', { name: '停止展示', exact: true }).waitFor()
  }, { seed: owned(), mcp: true })
  await scenario('停止展示后清屏失败仍可重试，已保存的null不回滚', async page => {
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.commands.at(-1)?.name), 'set_back_screen_frame'))
    await gallery(page)
    const dialog = await openPet(page, 'late_duck')
    await page.evaluate(() => { window.__mcp.fail = true })
    await dialog.getByRole('button', { name: '停止展示', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, null))
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '重试保存', exact: true }).count(), 0)
    await page.locator('.back-screen-panel summary').click()
    await page.evaluate(() => { window.__mcp.fail = false })
    await page.getByRole('button', { name: '重试背屏连接', exact: true }).click()
    await eventually(async () => assert.deepEqual(await page.evaluate(() => window.__mcp.commands.slice(-2).map(command => command.name)), ['clear_back_screen_frame', 'sleep_back_screen']))
    assert.equal((await read(page)).settings.backScreenPetId, null)
    assert.deepEqual((await read(page)).collection, owned(undefined, 'late_duck').collection)
  }, { seed: owned(undefined, 'late_duck'), mcp: true })
  await scenario('首次空记录不主动清空或熄灭系统背屏', async page => {
    await page.clock.runFor(24000)
    assert.deepEqual(await page.evaluate(() => window.__mcp.commands), [])
  }, { mcp: true })
  await scenario('connect永久挂起：首页仍可开局，10秒提示失败且重复重试不并发', async page => {
    const session = await start(page, 60)
    assert.equal((await read(page)).session.sessionId, session.sessionId)
    await page.clock.runFor(9999)
    assert.equal(await page.getByText('背屏暂时没接上', { exact: true }).count(), 0)
    await page.locator('.back-screen-panel summary').click()
    await page.getByRole('button', { name: '重试背屏连接', exact: true }).evaluate(button => { button.click(); button.click(); button.click() })
    assert.deepEqual(await page.evaluate(() => ({ connectCalls: window.__mcp.connectCalls, maxConnecting: window.__mcp.maxConnecting,
      commands: window.__mcp.commands })), { connectCalls: 1, maxConnecting: 1, commands: [] }, '超时前原请求仍挂起，连续重试也不能另起连接')
    await page.clock.runFor(1)
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    await page.getByRole('button', { name: '重试背屏连接', exact: true }).evaluate(button => { button.click(); button.click(); button.click() })
    await page.clock.runFor(15000)
    const state = await page.evaluate(() => ({ connectCalls: window.__mcp.connectCalls, connecting: window.__mcp.connecting,
      maxConnecting: window.__mcp.maxConnecting, commands: window.__mcp.commands }))
    assert.deepEqual(state, { connectCalls: 1, connecting: 1, maxConnecting: 1, commands: [] }, '超时不是取消，原连接未结束不能另起连接或设备命令')
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '重试保存', exact: true }).count(), 0)
    assert.equal((await read(page)).session.sessionId, session.sessionId)
    await goHome(page)
    await setDuration(page, 305)
    await eventually(async () => assert.equal((await read(page)).settings.lastDurationMs, 305000))
    assert.equal((await read(page)).session.sessionId, session.sessionId)
    await shot(page, 'connection-pending-home-usable')
  }, { mcp: 'connect-pending' })
  await scenario('connect明确false及失败后重连挂起：不并发，超时释放后仅恢复最新目标', async page => {
    const session = await start(page, 60)
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    assert.equal(await page.getByText('背屏显示中', { exact: true }).count(), 0)
    assert.equal(await page.getByText('背屏预览模拟中（非真机）', { exact: true }).count(), 0)
    assert.deepEqual(await page.evaluate(() => window.__mcp.commands), [])
    assert.equal(await page.evaluate(() => window.__mcp.connectCalls), 1)
    await page.locator('.back-screen-panel summary').click()
    await page.getByRole('button', { name: '重试背屏连接', exact: true }).click()
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.connectCalls), 2))
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.__mcp.commands), [])
    assert.equal(await page.evaluate(() => window.__mcp.maxConnecting), 1)
    assert.equal((await read(page)).session.sessionId, session.sessionId)
    await shot(page, 'connection-explicit-false')
    // 失败后的重连本身也必须进入受控通道，不能等 connect 返回后才启用占用保护。
    await page.evaluate(() => { window.__mcp.connectMode = 'connect-held' })
    const retry = page.getByRole('button', { name: '重试背屏连接', exact: true })
    await retry.evaluate(button => { button.click(); button.click(); button.click() })
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.connectCalls), 3))
    await page.clock.runFor(9999)
    await retry.evaluate(button => { button.click(); button.click(); button.click() })
    assert.deepEqual(await page.evaluate(() => ({ connectCalls: window.__mcp.connectCalls, connecting: window.__mcp.connecting,
      maxConnecting: window.__mcp.maxConnecting, commands: window.__mcp.commands })),
    { connectCalls: 3, connecting: 1, maxConnecting: 1, commands: [] })
    await page.clock.runFor(1)
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    await retry.evaluate(button => { button.click(); button.click(); button.click() })
    await page.clock.runFor(1000)
    assert.equal(await page.evaluate(() => window.__mcp.connectCalls), 3)
    await goHome(page)
    await setDuration(page, 305)
    await eventually(async () => assert.equal((await read(page)).settings.lastDurationMs, 305000))
    assert.equal((await read(page)).session.sessionId, session.sessionId)
    // 挂起时将目标切为停止展示；迟到连接不得补发旧蛋帧。
    await endEgg(page)
    await gallery(page)
    await page.evaluate(() => { window.__mcp.connectMode = 'success'; window.__releaseConnect({}) })
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.connecting), 0))
    assert.equal(await page.evaluate(() => window.__mcp.commands.filter(command => command.name === 'set_back_screen_frame').length), 0)
    await page.getByText('背屏暂时没接上', { exact: true }).waitFor()
    await page.locator('.back-screen-panel summary').click()
    await page.getByRole('button', { name: '重试背屏连接', exact: true }).click()
    await eventually(async () => assert.deepEqual(await page.evaluate(() => window.__mcp.commands.slice(-2).map(command => command.name)), ['clear_back_screen_frame', 'sleep_back_screen']))
    assert.equal(await page.evaluate(() => window.__mcp.connectCalls), 4)
    assert.equal(await page.evaluate(() => window.__mcp.maxConnecting), 1)
    assert.equal(await page.evaluate(() => window.__mcp.maxActive), 1)
    assert.equal(await page.evaluate(() => window.__mcp.commands.filter(command => command.name === 'set_back_screen_frame').length), 0)
    assert.equal((await read(page)).session, null)
    assert.equal((await read(page)).settings.backScreenPetId, null)
    await shot(page, 'connection-pending-retry-idle-restored')
  }, { mcp: 'connect-false' })
  await scenario('中文文本回执支持完整开局、揭晓自动选择和停止展示', async page => {
    const session = await start(page, 1)
    await page.getByText('背屏显示中', { exact: true }).waitFor()
    await ready(page, 1000)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByText('已收进收藏', { exact: true }).waitFor()
    assert.equal((await read(page)).settings.backScreenPetId, session.petId)
    assert.equal((await read(page)).collection[session.petId].count, 1)
    await eventuallyFrame(page, async () => assert.deepEqual(await page.evaluate(() => window.__mcp.commands.filter(command => command.name === 'set_back_screen_frame').at(-1)?.args.frame), catalog.find(pet => pet.id === session.petId).frame))
    await gallery(page)
    const dialog = await openPet(page, session.petId)
    await dialog.getByRole('button', { name: '停止展示', exact: true }).click()
    await eventually(async () => assert.equal((await read(page)).settings.backScreenPetId, null))
    await eventually(async () => assert.deepEqual(await page.evaluate(() => window.__mcp.commands.slice(-2).map(command => command.name)), ['clear_back_screen_frame', 'sleep_back_screen']))
    const state = await page.evaluate(() => ({ receipts: window.__mcp.receipts, maxActive: window.__mcp.maxActive, active: window.__mcp.active }))
    assert.ok(state.receipts.length >= 6)
    assert.ok(state.receipts.every(value => value === '背屏操作已完成'), '必须实际走中文字符串回执，不能只覆盖结构化mock')
    assert.equal(state.maxActive, 1)
    assert.equal(state.active, 0)
    assert.equal((await read(page)).collection[session.petId].count, 1)
    assert.equal(await page.getByText('背屏暂时没接上', { exact: true }).count(), 0)
    await shot(page, 'chinese-text-receipt-stop')
  }, { mcp: 'text' })
  await scenario('延迟MCP四类命令串行；新场景丢弃旧待发帧及旧sleep', async page => {
    await page.evaluate(async base => {
      const { BackScreenScheduler } = await import(new URL('src/shared/egg/backScreenScheduler.ts', base).href)
      const { wakeBackScreen, pushFrame, clearFrame, sleepBackScreen } = await import(new URL('src/shared/egg/backScreen.ts', base).href)
      window.__testScheduler = new BackScreenScheduler({ commands: { wake: wakeBackScreen, frame: pushFrame, clear: clearFrame, sleep: sleepBackScreen } })
      window.__mcp.hold = true
      window.__testScheduler.setScene({ key: 'old', frame: new Array(391).fill(1) })
      window.__testScheduler.resume()
    }, BASE)
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.pending.length), 1))
    await page.evaluate(() => {
      window.__testScheduler.setScene({ key: 'middle', frame: new Array(391).fill(2) })
      window.__testScheduler.setScene({ key: 'current', frame: new Array(391).fill(3) })
      window.__releaseMcp()
    })
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.commands.length), 2))
    assert.deepEqual(await page.evaluate(() => window.__mcp.commands.map(command => command.name)), ['wake_up_back_screen', 'wake_up_back_screen'])
    await page.evaluate(() => window.__releaseMcp())
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.commands.length), 3))
    assert.deepEqual(await page.evaluate(() => window.__mcp.commands[2].args.frame), new Array(391).fill(3))
    await page.evaluate(() => { window.__mcp.hold = false; window.__releaseMcp() })
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.active), 0))
    await page.evaluate(() => { window.__mcp.hold = true; window.__testScheduler.setScene({ key: 'idle', frame: null }) })
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.commands.at(-1).name), 'clear_back_screen_frame'))
    await page.evaluate(() => {
      window.__testScheduler.setScene({ key: 'latest', frame: new Array(391).fill(4) })
      window.__mcp.hold = false
      window.__releaseMcp()
    })
    await eventuallyFrame(page, async () => assert.equal(await page.evaluate(() => window.__mcp.commands.at(-1)?.args.frame?.[0]), 4))
    assert.equal(await page.evaluate(() => window.__mcp.commands.some(command => command.name === 'sleep_back_screen')), false, '过期清屏任务不可再熄灭新场景')
    await page.evaluate(() => window.__testScheduler.setScene({ key: 'final-idle', frame: null }))
    await eventually(async () => assert.deepEqual(await page.evaluate(() => window.__mcp.commands.slice(-2).map(command => command.name)), ['clear_back_screen_frame', 'sleep_back_screen']))
    assert.equal(await page.evaluate(() => window.__mcp.maxActive), 1)
    await page.evaluate(() => window.__testScheduler.suspend())
  }, { mcp: true })
  await scenario('动画请求超时仍占用通道；释放后手动重试仅发最新帧', async page => {
    await page.evaluate(async base => {
      const { BackScreenScheduler } = await import(new URL('src/shared/egg/backScreenScheduler.ts', base).href)
      const { wakeBackScreen, pushFrame, clearFrame, sleepBackScreen } = await import(new URL('src/shared/egg/backScreen.ts', base).href)
      window.__schedulerResults = []
      window.__testScheduler = new BackScreenScheduler({ commands: { wake: wakeBackScreen, frame: pushFrame, clear: clearFrame, sleep: sleepBackScreen },
        onResult: result => window.__schedulerResults.push(result) })
      window.__testScheduler.setScene({ key: 'animated', frame: new Array(391).fill(10), animationFrames: [new Array(391).fill(11), new Array(391).fill(12)], animate: true })
      window.__testScheduler.resume()
    }, BASE)
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.commands.at(-1)?.args.frame?.[0]), 10))
    await page.evaluate(() => { window.__mcp.hold = true })
    await page.clock.runFor(12000)
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.commands.at(-1)?.args.frame?.[0]), 11))
    await page.clock.runFor(60000)
    assert.equal(await page.evaluate(() => window.__mcp.pending.length), 1)
    assert.equal(await page.evaluate(() => window.__testScheduler.waitingForTimedOutRequest), true)
    assert.equal(await page.evaluate(() => window.__schedulerResults.at(-1)?.reason), 'timeout')
    const cutoff = await page.evaluate(() => window.__mcp.commands.length)
    await page.evaluate(() => {
      window.__testScheduler.setScene({ key: 'new-pet', frame: new Array(391).fill(20), animate: false })
      window.__testScheduler.retry()
      window.__testScheduler.retry()
    })
    await page.clock.runFor(24000)
    assert.equal(await page.evaluate(() => window.__mcp.commands.length), cutoff, '原动画请求未结束，重试也不能并发发送')
    await page.evaluate(() => {
      window.__mcp.hold = false
      window.__releaseMcp()
    })
    await eventually(async () => assert.equal(await page.evaluate(() => window.__testScheduler.waitingForTimedOutRequest), false))
    assert.equal(await page.evaluate(() => window.__mcp.commands.length), cutoff, '迟到ACK不自动恢复或补播动画')
    await page.evaluate(() => window.__testScheduler.retry())
    await eventuallyFrame(page, async () => assert.equal(await page.evaluate(() => window.__mcp.commands.at(-1)?.args.frame?.[0]), 20))
    await page.clock.runFor(24000)
    const newFrames = await page.evaluate(index => window.__mcp.commands.slice(index).filter(command => command.name === 'set_back_screen_frame').map(command => command.args.frame[0]), cutoff)
    assert.deepEqual(newFrames, [20])
    assert.equal(await page.evaluate(() => window.__mcp.maxActive), 1)
    await page.evaluate(() => window.__testScheduler.suspend())
  }, { mcp: true })
  await scenario('Provider隐藏暂停发送；恢复只显示当前ready，不补播过期动画', async page => {
    await start(page, 60)
    await eventually(async () => assert.equal(await page.evaluate(() => window.__mcp.active), 0))
    await page.evaluate(() => {
      window.__pageHidden = true
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__pageHidden ? 'hidden' : 'visible' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__pageHidden })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const count = await page.evaluate(() => window.__mcp.commands.length)
    await page.clock.runFor(65000)
    assert.equal(await page.evaluate(() => window.__mcp.commands.length), count)
    await page.evaluate(() => { window.__pageHidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    await page.getByRole('button', { name: '看看是谁', exact: true }).waitFor()
    const frame = await page.evaluate(async url => (await import(url)).frameForPhase('ready'), new URL('src/shared/egg/patterns.ts', BASE).href)
    await eventually(async () => assert.deepEqual(await page.evaluate(() => window.__mcp.commands.filter(command => command.name === 'set_back_screen_frame').at(-1)?.args.frame), frame))
    assert.equal(await page.evaluate(() => window.__mcp.maxActive), 1)
    const resumedFrames = await page.evaluate(index => window.__mcp.commands.slice(index).filter(command => command.name === 'set_back_screen_frame').map(command => command.args.frame), count)
    assert.ok(resumedFrames.length >= 1)
    assert.ok(resumedFrames.every(value => JSON.stringify(value) === JSON.stringify(frame)), '恢复时不补播等待/裂纹阶段')
  }, { mcp: true, reducedMotion: 'no-preference' })
  for (const width of [375, 320]) {
    await scenario(`${width}px三页面及宠物详情没有水平溢出`, async page => {
      await noOverflow(page)
      await start(page, 60)
      await noOverflow(page)
      await page.evaluate(() => { location.hash = '#/collection' })
      await page.getByRole('heading', { name: '收藏', exact: true }).waitFor()
      await noOverflow(page)
      const detail = await openPet(page, 'late_duck')
      await noOverflow(page)
      const box = await detail.boundingBox()
      assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, JSON.stringify(box))
      await shot(page, `storybook-detail-${width}`)
    }, { width, seed: owned() })
  }
  await scenario('375×480模拟键盘视口：聚焦秒输入保持可见且无横向溢出', async page => {
    const input = page.getByLabel('秒', { exact: true })
    await input.focus()
    await page.setViewportSize({ width: 375, height: 480 })
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await page.clock.runFor(50)
    await eventually(async () => {
      // 视口布局与 ResizeObserver 可能晚于 resize 事件一帧；推进真实应用的校正回调，不代替它滚动。
      await page.clock.runFor(16)
      const bounds = await input.boundingBox()
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 480, JSON.stringify(bounds))
    })
    await noOverflow(page)
    await input.fill('15')
    await input.press('Tab')
    await eventually(async () => assert.equal((await read(page)).settings.lastDurationMs, 195000))
    await shot(page, 'storybook-keyboard-viewport-375x480')
  }, { width: 375 })
} finally {
  await browser.close()
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(results, null, 2)}\n`)
}
const failed = results.filter(result => !result.ok)
console.log(`\n合计 ${results.length} 个场景：通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exitCode = failed.length ? 1 : 0
