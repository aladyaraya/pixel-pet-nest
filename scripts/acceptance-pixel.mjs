/* 像素伙伴浏览器验收：真实指针事件 + 可控时钟 + 隔离本地记录；不代替真机。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = (process.argv[2] || process.env.ACCEPTANCE_BASE || 'http://127.0.0.1:5173/').replace(/\/?$/, '/')
const OUT = process.env.PIXEL_ACCEPTANCE_OUT || '.acceptance-pixel'
const FILTER = process.env.PIXEL_ACCEPTANCE_FILTER ? new RegExp(process.env.PIXEL_ACCEPTANCE_FILTER) : null
const KEY = 'capsule.mock.egg.record.v1'
const EPOCH = Date.UTC(2026, 10, 5, 8)
const PETS = [
  ['tiny_egg', '小小蛋', 'low'], ['sprout_potato', '发芽土豆', 'low'], ['question_face', '一脸问号', 'low'],
  ['late_duck', '迟到小鸭', 'normal'], ['box_ghost', '纸箱幽灵', 'normal'], ['nap_cloud', '打盹云', 'normal'],
  ['crescent_cat', '月牙小猫', 'high'], ['star_fawn', '星角小鹿', 'high'], ['cape_penguin', '披风企鹅', 'high'],
  ['solar_phoenix', '日冕凤凰', 'ornate'], ['ring_whale', '星环鲸', 'ornate'], ['moon_crown_dragon', '月冠龙', 'ornate'],
]
const results = []
mkdirSync(OUT, { recursive: true })
mkdirSync(`${OUT}/action-samples`, { recursive: true })
const seed = (selected = null) => ({ version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: 180000, privacyAgreed: true, backScreenPetId: selected },
  session: null,
  collection: Object.fromEntries(PETS.map(([id], index) => [id, { count: index + 1, lastRevealedAt: EPOCH - (index + 1) * 60000 }])),
})
const eggSeed = (durationMs = 60000, selected = 'late_duck') => ({ ...seed(selected), session: {
  sessionId: 'pixel-egg', tier: 'low', durationMs, startedAt: EPOCH + 1000, deadlineAt: EPOCH + 1000 + durationMs,
  petId: 'tiny_egg', phase: 'waiting', revealedAt: null, hintedPhases: ['waiting'],
} })
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)
const frames = page => page.evaluate(() => window.__pixelMcp.commands.filter(command => command.name === 'set_back_screen_frame'))
const reactionCount = async art => Number(await art.getAttribute('data-reaction-count'))
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled' })

async function eventually(check) {
  let error
  const deadline = Date.now() + 10000
  do {
    try { await check(); return } catch (caught) { error = caught }
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  throw error
}
async function tickUntil(page, check, maximum = 5000) {
  let error
  for (let elapsed = 0; elapsed <= maximum; elapsed += 250) {
    try { await check(); return } catch (caught) { error = caught }
    if (elapsed < maximum) await page.clock.runFor(250)
  }
  throw error
}
async function gallery(page) {
  await page.evaluate(() => { location.hash = '#/collection' })
  await page.getByRole('heading', { name: '收藏', exact: true }).waitFor()
}
async function detail(page, id = 'late_duck') {
  const name = PETS.find(pet => pet[0] === id)[1]
  await page.getByRole('button', { name: `查看${name}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const art = dialog.getByRole('button', { name: `逗逗${name}`, exact: true })
  await art.waitFor()
  return { dialog, art }
}
async function center(art) {
  await art.scrollIntoViewIfNeeded()
  const box = await art.boundingBox()
  assert.ok(box)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), id: 1 }
}
async function touch(client, type, points = []) {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: points })
}
async function tap(client, art) {
  const point = await center(art)
  await touch(client, 'touchStart', [point])
  await touch(client, 'touchEnd')
}
async function hidden(page, value) {
  await page.evaluate(value => {
    window.__pixelHidden = value
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__pixelHidden ? 'hidden' : 'visible' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__pixelHidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}
async function noOverflow(page) {
  const value = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => {
      const box = element.getBoundingClientRect(); return { x: box.x, right: box.right, scroll: element.scrollWidth, client: element.clientWidth }
    }) }))
  assert.ok(value.html <= value.width + 1 && value.body <= value.width + 1, JSON.stringify(value))
  assert.ok(value.dialogs.every(dialog => dialog.x >= -1 && dialog.right <= value.width + 1 && dialog.scroll <= dialog.client + 1), JSON.stringify(value))
}
async function noPetLeak(page) {
  const visible = await page.locator('body').innerText()
  const aria = await page.locator('body').ariaSnapshot()
  for (const value of [visible, aria]) assert.ok(!value.includes('小小蛋'), '未揭晓结果泄漏到可见文本或无障碍树')
}
function frameGaps(commands) {
  const sent = commands.filter(command => command.name === 'set_back_screen_frame')
  for (let index = 1; index < sent.length; index += 1) {
    assert.ok(sent[index - 1].finishedAt !== null)
    assert.ok(sent[index].startedAt - sent[index - 1].finishedAt >= 999.9,
      `背屏帧间隔不足 1 秒：${JSON.stringify(sent.slice(index - 1, index + 1).map(({ startedAt, finishedAt }) => ({ startedAt, finishedAt })))}`)
  }
}

const browser = await chromium.launch()
async function scenario(name, run, options = {}) {
  if (FILTER && !FILTER.test(name)) return
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: options.height || 844 }, hasTouch: true,
    reducedMotion: options.reducedMotion || 'no-preference', ...(options.video ? { recordVideo: { dir: `${OUT}/videos` } } : {}) })
  const page = await context.newPage()
  const video = options.video ? page.video() : null
  const client = await context.newCDPSession(page)
  page.setDefaultTimeout(10000)
  const errors = [], fontRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.resourceType() === 'font') fontRequests.push(request.url()) })
  try {
    await context.addInitScript(({ key, record }) => {
      if (!sessionStorage.getItem('pixel.seeded')) {
        localStorage.setItem(key, JSON.stringify(record))
        sessionStorage.setItem('pixel.seeded', 'true')
      }
      window.__pixelMcp = { commands: [], active: 0, maxActive: 0, fail: false, hold: false, pending: [] }
      window.mcp = { connect: async () => ({}), callTool: async (name, args) => {
        const mock = window.__pixelMcp
        const entry = { name, args: structuredClone(args), startedAt: performance.now(), finishedAt: null }
        mock.commands.push(entry)
        mock.active += 1
        mock.maxActive = Math.max(mock.maxActive, mock.active)
        if (mock.hold) await new Promise(resolve => mock.pending.push(resolve))
        mock.active -= 1
        entry.finishedAt = performance.now()
        return mock.fail ? { isError: true } : '背屏操作已完成'
      } }
      window.__pixelRelease = () => window.__pixelMcp.pending.shift()?.()
    }, { key: KEY, record: options.seed || seed() })
    await page.clock.install({ time: new Date(EPOCH) })
    await page.clock.pauseAt(new Date(EPOCH + 1000))
    await page.goto(BASE + (options.route || '#/collection'), { waitUntil: 'networkidle' })
    if (options.route === '#/hatch') await page.locator('.hatch-page').waitFor()
    else if (options.route === '#/') await page.getByLabel('分钟', { exact: true }).waitFor()
    else await page.getByRole('heading', { name: '收藏', exact: true }).waitFor()
    await run({ page, client, fontRequests })
    assert.deepEqual(errors, [], '页面发生未捕获异常')
    const mock = await page.evaluate(() => ({ commands: window.__pixelMcp.commands, maxActive: window.__pixelMcp.maxActive }))
    assert.ok(mock.maxActive <= 1, '背屏命令发生并发')
    frameGaps(mock.commands)
    writeFileSync(`${OUT}/commands-${results.length + 1}.json`, `${JSON.stringify(mock, null, 2)}\n`)
    results.push({ name, ok: true })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error.stack })
    console.error(`FAIL ${name}: ${error.message}`)
    await shot(page, `error-pixel-${results.length}`).catch(() => {})
  } finally {
    await context.close()
    if (video) await video.saveAs(`${OUT}/pixel-interactions.webm`)
  }
}

try {
  await scenario('触摸阈值：599ms为轻点，600ms为亲昵，抬手不重复触发', async ({ page, client }) => {
    const { art } = await detail(page)
    const before = await read(page)
    let point = await center(art)
    await touch(client, 'touchStart', [point])
    await page.clock.runFor(599)
    assert.equal(await reactionCount(art), 0)
    await touch(client, 'touchEnd')
    await eventually(async () => assert.equal(await art.getAttribute('data-motion'), 'tap'))
    assert.equal(await reactionCount(art), 1)
    await page.clock.runFor(999)
    assert.equal(await art.getAttribute('data-reacting'), 'true')
    await page.clock.runFor(1)
    await eventually(async () => assert.equal(await art.getAttribute('data-reacting'), 'false'))
    point = await center(art)
    await touch(client, 'touchStart', [point])
    await page.clock.runFor(600)
    assert.equal(await art.getAttribute('data-motion'), 'hold')
    assert.equal(await reactionCount(art), 2)
    await touch(client, 'touchEnd')
    await page.clock.runFor(1799)
    assert.equal(await art.getAttribute('data-reacting'), 'true')
    await page.clock.runFor(1)
    await eventually(async () => assert.equal(await art.getAttribute('data-reacting'), 'false'))
    assert.equal(await reactionCount(art), 2)
    assert.deepEqual(await read(page), before)
  })
  await scenario('移动边界与pointer取消：10px仍可轻点，超过10px或touchCancel取消', async ({ page, client }) => {
    const { art } = await detail(page)
    let point = await center(art)
    await touch(client, 'touchStart', [point])
    await touch(client, 'touchMove', [{ ...point, x: point.x + 10 }])
    await touch(client, 'touchEnd')
    await eventually(async () => assert.equal(await reactionCount(art), 1))
    await page.clock.runFor(1000)
    point = await center(art)
    await touch(client, 'touchStart', [point])
    await touch(client, 'touchMove', [{ ...point, x: point.x + 11 }])
    await page.clock.runFor(700)
    await touch(client, 'touchEnd')
    assert.equal(await reactionCount(art), 1)
    await touch(client, 'touchStart', [point])
    await touch(client, 'touchCancel')
    await page.clock.runFor(700)
    assert.equal(await reactionCount(art), 1)
  })
  await scenario('多指取消：第二触点出现后不触发亲昵或轻点', async ({ page, client }) => {
    const { art } = await detail(page)
    const point = await center(art)
    await touch(client, 'touchStart', [point])
    await page.clock.runFor(300)
    await touch(client, 'touchStart', [point, { ...point, x: point.x + 30, id: 2 }])
    await page.clock.runFor(700)
    await touch(client, 'touchEnd')
    assert.equal(await reactionCount(art), 0)
    assert.equal(await art.getAttribute('data-reacting'), 'false')
  })
  await scenario('详情实际滚动取消未完成手势', async ({ page, client }) => {
    const { dialog, art } = await detail(page)
    const point = await center(art)
    await touch(client, 'touchStart', [point])
    await page.clock.runFor(300)
    const scrolled = await dialog.evaluate(element => new Promise(resolve => {
      const before = element.scrollTop
      element.addEventListener('scroll', () => resolve(element.scrollTop !== before), { once: true })
      element.scrollTop += 32
      if (element.scrollTop === before) resolve(false)
    }))
    assert.equal(scrolled, true, '测试必须实际滚动详情，不能只伪造事件')
    await page.clock.runFor(700)
    await touch(client, 'touchEnd')
    assert.equal(await reactionCount(art), 0)
  }, { height: 430 })
  for (const cancellation of ['visibility', 'pagehide', 'route']) {
    await scenario(`${cancellation}取消长按且不留下迟到回应`, async ({ page, client }) => {
      const { art } = await detail(page)
      const before = await read(page)
      const point = await center(art)
      await touch(client, 'touchStart', [point])
      await page.clock.runFor(300)
      if (cancellation === 'visibility') await hidden(page, true)
      else if (cancellation === 'pagehide') await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
      else await page.evaluate(() => { location.hash = '#/' })
      await page.clock.runFor(2000)
      await touch(client, 'touchEnd')
      if (cancellation === 'visibility') await hidden(page, false)
      if (cancellation !== 'route') {
        assert.equal(await reactionCount(art), 0)
        assert.equal(await art.getAttribute('data-motion'), 'still')
      } else await page.getByLabel('分钟', { exact: true }).waitFor()
      assert.deepEqual(await read(page), before)
    })
  }
  await scenario('键盘替代与无动作按钮：Enter／Space轻点，Shift+Enter亲昵', async ({ page }) => {
    const { art } = await detail(page)
    assert.equal(await page.getByRole('button', { name: /重听.*的文案|听它说一句/ }).count(), 0)
    await art.focus()
    await page.keyboard.press('Enter')
    assert.equal(await art.getAttribute('data-motion'), 'tap')
    await page.clock.runFor(1000)
    await page.keyboard.press('Space')
    assert.equal(await art.getAttribute('data-motion'), 'tap')
    await page.clock.runFor(1000)
    await page.keyboard.press('Shift+Enter')
    assert.equal(await art.getAttribute('data-motion'), 'hold')
    assert.equal(await reactionCount(art), 3)
    assert.match(await art.getAttribute('aria-keyshortcuts'), /Shift\+Enter/)
    await page.clock.runFor(1800)
    assert.equal(await reactionCount(art), 3)
  })
  await scenario('12只角色专属动作采样与互动后记录完全不变', async ({ page, client }) => {
    const before = await read(page)
    const samples = []
    for (const [id] of PETS) {
      const { dialog, art } = await detail(page, id)
      await tap(client, art)
      await page.clock.runFor(400)
      samples.push({ id, kind: 'tap', motion: await art.getAttribute('data-motion'), frame: await art.getAttribute('data-frame') })
      await art.screenshot({ path: `${OUT}/action-samples/${id}-tap.png`, animations: 'allow' })
      assert.equal(await art.getAttribute('data-motion'), 'tap')
      await page.clock.runFor(600)
      const point = await center(art)
      await touch(client, 'touchStart', [point])
      await page.clock.runFor(1000)
      samples.push({ id, kind: 'hold', motion: await art.getAttribute('data-motion'), frame: await art.getAttribute('data-frame') })
      await art.screenshot({ path: `${OUT}/action-samples/${id}-hold.png`, animations: 'allow' })
      assert.equal(await art.getAttribute('data-motion'), 'hold')
      await touch(client, 'touchEnd')
      await page.clock.runFor(1400)
      assert.equal(await reactionCount(art), 2)
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    }
    assert.deepEqual(await read(page), before)
    assert.equal((await frames(page)).length, 0, '未选择伙伴时，浏览互动不能接管背屏')
    writeFileSync(`${OUT}/action-samples.json`, `${JSON.stringify(samples, null, 2)}\n`)
  }, { video: true })
  await scenario('收藏卡片与缩略图静止，且未收集卡片不可进入互动', async ({ page }) => {
    const cards = page.locator('.pet-card .pet-art')
    assert.equal(await cards.count(), 12)
    const first = await cards.evaluateAll(elements => elements.map(element => ({ motion: element.getAttribute('data-motion'), frame: element.getAttribute('data-frame'), html: element.querySelector('svg')?.innerHTML })))
    await page.clock.runFor(30000)
    const later = await cards.evaluateAll(elements => elements.map(element => ({ motion: element.getAttribute('data-motion'), frame: element.getAttribute('data-frame'), html: element.querySelector('svg')?.innerHTML })))
    assert.deepEqual(later, first)
    assert.ok(first.every(value => value.motion === 'still'))
    assert.equal(await page.getByRole('button', { name: '查看月冠龙', exact: true }).isDisabled(), true)
    await shot(page, 'pixel-collection-static')
  }, { seed: { ...seed(), collection: { late_duck: { count: 1, lastRevealedAt: EPOCH } } } })
  await scenario('只有当前背屏伙伴联动，浏览其他宠物仅前屏回应', async ({ page, client }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    const before = await read(page)
    let opened = await detail(page, 'tiny_egg')
    await tap(client, opened.art)
    await page.clock.runFor(1000)
    assert.equal(await reactionCount(opened.art), 1)
    assert.equal((await frames(page)).length, 1)
    await opened.dialog.getByRole('button', { name: '关闭', exact: true }).click()
    opened = await detail(page, 'late_duck')
    await tap(client, opened.art)
    await page.clock.runFor(4000)
    const sent = await frames(page)
    assert.ok(sent.length >= 3, '当前伙伴应有短动作帧与回到静帧')
    assert.ok(sent.slice(1).some(command => JSON.stringify(command.args.frame) !== JSON.stringify(sent[0].args.frame)), '当前伙伴应出现自身动作变化')
    assert.deepEqual(sent.at(-1).args.frame, sent[0].args.frame)
    assert.deepEqual(await read(page), before)
    await shot(page, 'pixel-current-companion')
  }, { seed: seed('late_duck') })
  await scenario('孵化期间伙伴不抢背屏；触摸蛋不改变截止时间、抽签或阶段', async ({ page, client }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    const before = await read(page)
    const { dialog, art } = await detail(page, 'late_duck')
    await tap(client, art)
    await page.clock.runFor(1000)
    assert.equal((await frames(page)).length, 1)
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await page.evaluate(() => { location.hash = '#/hatch' })
    const egg = page.getByRole('button', { name: '轻碰这颗蛋', exact: true })
    await egg.waitFor()
    await tap(client, egg)
    await page.clock.runFor(4000)
    const after = await read(page)
    for (const key of ['sessionId', 'durationMs', 'startedAt', 'deadlineAt', 'petId', 'tier', 'phase']) assert.deepEqual(after.session[key], before.session[key])
    assert.deepEqual(after.collection, before.collection)
    assert.equal(await egg.getAttribute('data-phase'), 'waiting')
    await noPetLeak(page)
    await shot(page, 'pixel-egg-interaction')
  }, { seed: eggSeed() })
  await scenario('短局自然到期取消旧手势，ready不因触摸自动揭晓，破壳仍隐藏身份', async ({ page, client }) => {
    const before = await read(page)
    const egg = page.getByRole('button', { name: '轻碰这颗蛋', exact: true })
    await page.clock.runFor(500)
    await touch(client, 'touchStart', [await center(egg)])
    await page.clock.runFor(600)
    await touch(client, 'touchEnd')
    await page.getByRole('button', { name: '看看是谁', exact: true }).waitFor()
    assert.equal((await read(page)).session.phase, 'ready')
    assert.equal((await read(page)).session.revealedAt, null)
    assert.deepEqual((await read(page)).collection, before.collection)
    await noPetLeak(page)
    await page.getByRole('button', { name: '看看是谁', exact: true }).click()
    await page.getByText('正在破壳…', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '轻碰这颗蛋', exact: true }).count(), 0)
    await page.clock.runFor(1199)
    await noPetLeak(page)
    await shot(page, 'pixel-breaking-hidden')
    await page.clock.runFor(1)
    await page.getByRole('button', { name: '逗逗小小蛋', exact: true }).waitFor()
    assert.equal((await read(page)).collection.tiny_egg.count, before.collection.tiny_egg.count + 1)
  }, { seed: eggSeed(1000), route: '#/hatch' })
  await scenario('减少动态保留轻点和亲昵文本，动作帧固定且背屏不播放短动画', async ({ page, client }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    const before = await read(page)
    const { art } = await detail(page)
    await tap(client, art)
    assert.equal(await art.getAttribute('data-motion'), 'tap')
    assert.equal(await art.getAttribute('data-frame'), '1')
    await page.clock.runFor(400)
    assert.equal(await art.getAttribute('data-frame'), '1')
    await page.clock.runFor(600)
    await touch(client, 'touchStart', [await center(art)])
    await page.clock.runFor(600)
    assert.equal(await art.getAttribute('data-motion'), 'hold')
    assert.equal(await art.getAttribute('data-frame'), '1')
    await touch(client, 'touchEnd')
    await page.clock.runFor(900)
    assert.equal(await art.getAttribute('data-frame'), '1')
    await page.clock.runFor(900)
    assert.equal(await art.getAttribute('data-reacting'), 'false')
    await page.clock.runFor(30000)
    assert.equal((await frames(page)).length, 1)
    assert.deepEqual(await read(page), before)
    await shot(page, 'pixel-reduced-motion')
  }, { seed: seed('late_duck'), reducedMotion: 'reduce' })
  await scenario('隐藏立即停止动作，恢复不补播旧手势或旧背屏序列', async ({ page, client }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    await page.clock.runFor(1000)
    const { art } = await detail(page)
    await tap(client, art)
    await page.clock.runFor(250)
    await hidden(page, true)
    assert.equal(await art.getAttribute('data-motion'), 'still')
    const sent = (await frames(page)).length
    await page.clock.runFor(20000)
    assert.equal((await frames(page)).length, sent)
    await hidden(page, false)
    await page.clock.runFor(1000)
    assert.equal(await art.getAttribute('data-reacting'), 'false')
    assert.equal(await reactionCount(art), 1)
    const restored = await frames(page)
    assert.deepEqual(restored.at(-1).args.frame, restored[0].args.frame)
  }, { seed: seed('late_duck') })
  await scenario('背屏自主短动作按8／10／12秒开始间隔轮替，每帧完成后至少等1秒', async ({ page }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    const initial = (await frames(page))[0]
    await page.clock.runFor(7999)
    assert.equal((await frames(page)).length, 1)
    await page.clock.runFor(1)
    await eventually(async () => assert.equal((await frames(page)).length, 2))
    await page.clock.runFor(24000)
    const sent = await frames(page)
    assert.equal(sent.length, 10, '静帧加三个三帧动作，不跳帧或积压补播')
    const starts = [sent[1], sent[4], sent[7]].map(command => command.startedAt)
    assert.equal(starts[0] - initial.finishedAt, 8000)
    assert.deepEqual([starts[1] - starts[0], starts[2] - starts[1]], [10000, 12000])
    for (const index of [3, 6, 9]) assert.deepEqual(sent[index].args.frame, initial.args.frame)
    writeFileSync(`${OUT}/idle-timing.json`, `${JSON.stringify(sent.map(({ startedAt, finishedAt }) => ({ startedAt, finishedAt })), null, 2)}\n`)
  }, { seed: seed('late_duck') })
  await scenario('人工回应等待旧帧完成，开始新蛋后旧伙伴回应不得接管背屏', async ({ page, client }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    await page.evaluate(() => { window.__pixelMcp.hold = true })
    await page.clock.runFor(8000)
    await eventually(async () => assert.equal(await page.evaluate(() => window.__pixelMcp.pending.length), 1))
    const { dialog, art } = await detail(page)
    await tap(client, art)
    await page.clock.runFor(250)
    assert.equal(await reactionCount(art), 1)
    assert.equal((await frames(page)).length, 2, '设备旧帧未完成时不能并发发送人工回应')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await page.evaluate(() => { location.hash = '#/' })
    await page.getByRole('button', { name: '孵一颗 · 3 分钟', exact: true }).click()
    await page.locator('.hatch-page').waitFor()
    const cutoff = (await frames(page)).length
    await page.evaluate(() => { window.__pixelMcp.hold = false; window.__pixelRelease() })
    await page.clock.runFor(4000)
    const expected = await page.evaluate(async url => (await import(url)).frameForPhase('waiting'), new URL('src/shared/egg/patterns.ts', BASE).href)
    const following = (await frames(page)).slice(cutoff)
    assert.ok(following.length >= 1)
    assert.ok(following.every(command => JSON.stringify(command.args.frame) === JSON.stringify(expected)), '阶段切换后不得补播旧伙伴的idle或manual帧')
    assert.equal((await read(page)).session.phase, 'waiting')
  }, { seed: seed('late_duck') })
  await scenario('同伙伴idle失败必须清除待播人工动作，前屏可回应但背屏须手动重试', async ({ page, client }) => {
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 1))
    const before = await read(page)
    const baseFrame = (await frames(page))[0].args.frame
    await page.evaluate(() => { window.__pixelMcp.hold = true })
    await page.clock.runFor(8000)
    await eventually(async () => assert.equal(await page.evaluate(() => window.__pixelMcp.pending.length), 1))
    const { dialog, art } = await detail(page)
    await tap(client, art)
    await page.evaluate(() => { window.__pixelMcp.fail = true; window.__pixelMcp.hold = false; window.__pixelRelease() })
    await dialog.getByText('背屏暂时没接上', { exact: true }).waitFor()
    await page.clock.runFor(10000)
    assert.equal((await frames(page)).length, 2, '同目标失败后不得继续已排队manual或自主动画')
    await tap(client, art)
    await eventually(async () => assert.equal(await reactionCount(art), 2))
    await page.clock.runFor(1000)
    assert.equal((await frames(page)).length, 2)
    assert.deepEqual(await read(page), before)
    await page.evaluate(() => { window.__pixelMcp.fail = false })
    await dialog.locator('.back-screen-panel summary').click()
    await dialog.getByRole('button', { name: '重试背屏连接', exact: true }).click()
    await tickUntil(page, async () => assert.equal((await frames(page)).length, 3))
    assert.deepEqual((await frames(page)).at(-1).args.frame, baseFrame)
    await shot(page, 'pixel-idle-failure-recovered')
  }, { seed: seed('late_duck') })
  for (const width of [320, 375, 390]) {
    await scenario(`${width}px像素三页面与详情：字体就绪、业务入口保留、无横向溢出`, async ({ page, fontRequests }) => {
      await page.evaluate(() => document.fonts.ready)
      const font = await page.evaluate(() => ({ loaded: [...document.fonts].some(face => face.family.includes('Fusion Pixel') && face.status === 'loaded'),
        family: getComputedStyle(document.querySelector('.start-intro h1')).fontFamily,
        size: getComputedStyle(document.querySelector('.start-intro h1')).fontSize }))
      assert.equal(font.loaded, true, '必须实际加载本地像素字体')
      assert.match(font.family, /Fusion Pixel/)
      assert.equal(font.size, '24px')
      assert.ok(fontRequests.length > 0)
      assert.ok(fontRequests.every(url => new URL(url).origin === new URL(BASE).origin), '字体必须从本地服务加载')
      await noOverflow(page)
      await shot(page, `pixel-start-${width}`)
      await page.getByRole('button', { name: '孵一颗 · 3 分钟', exact: true }).click()
      await page.locator('.hatch-countdown').waitFor()
      assert.equal(await page.locator('.hatch-countdown').evaluate(element => getComputedStyle(element).fontSize), '24px')
      const toast = page.locator('[role="status"] .bg-toast').first()
      await toast.waitFor({ state: 'visible' })
      assert.equal(await toast.evaluate(element => getComputedStyle(element).borderRadius), '0px', '提示也应使用直角像素外观')
      await noOverflow(page)
      await shot(page, `pixel-hatch-${width}`)
      await gallery(page)
      await noOverflow(page)
      await shot(page, `pixel-gallery-${width}`)
      const { dialog, art } = await detail(page)
      await noOverflow(page)
      assert.equal(await dialog.getByRole('button', { name: '放到背屏', exact: true }).isDisabled(), true)
      const target = await art.boundingBox()
      assert.ok(target.width >= 44 && target.height >= 44)
      await shot(page, `pixel-detail-${width}`)
    }, { width, route: '#/' })
  }
} finally {
  await browser.close()
  writeFileSync(`${OUT}/pixel-report.json`, `${JSON.stringify(results, null, 2)}\n`)
}
const failed = results.filter(result => !result.ok)
console.log(`\n像素验收 ${results.length} 个场景：通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exitCode = failed.length ? 1 : 0
