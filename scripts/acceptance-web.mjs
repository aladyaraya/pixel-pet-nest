/* =============================================================================
 * 网页预览验收（PRD 07 章「网页预览和真机证据」的网页部分）：
 * 计时、状态、角色选择、收藏、文案、点阵预览、错误注入（存储重试）。
 * 背屏在浏览器里是模拟桥，页面须显著标识；真机证据另见 APK 验收记录。
 *
 * 用法：node scripts/acceptance-web.mjs [baseUrl]
 * ========================================================================== */

import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('/usr/local/lib/')
const { chromium } = require('playwright')

const BASE = (process.argv[2] || process.env.ACCEPTANCE_BASE || 'http://127.0.0.1:5173/preview/p_0b48bb06f8c0d4dd/').replace(/\/?$/, '/')
const OUT = '.acceptance'
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function readRecord(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('capsule.mock.egg.record.v1')
    return raw ? JSON.parse(raw) : null
  })
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.setDefaultTimeout(30_000)

try {
  /* 0. 预热：dev server 首轮可能仍在编译，先打开一次等应用挂载 */
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=孵一颗 · 3 分钟', { timeout: 60_000 })
  await page.waitForTimeout(500)

  /* 1. 开始页 */
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=孵一颗 · 3 分钟')
  check('开始页可打开且有主按钮', true)
  check('开始页有演示入口', await page.locator('text=体验一局 · 20 秒').count() === 1)
  check('开始页有音效 / 辅助朗读开关', await page.getByRole('button', { pressed: false }).count() >= 2)
  await page.screenshot({ path: `${OUT}/01-start.png` })

  /* 2. 开始演示局 */
  await page.click('text=体验一局 · 20 秒')
  await page.waitForURL(/#\/hatch/)
  await page.waitForSelector('text=已经开始了，放下手机等一会儿')
  const recordAfterStart = await readRecord(page)
  check('开始后写入本地记录', recordAfterStart?.session?.mode === 'demo', `mode=${recordAfterStart?.session?.mode}`)
  check('演示模式常驻标识', await page.locator('text=演示模式 · 20 秒').count() === 1)
  check('背屏预览模拟标识（非真机）', await page.locator('text=背屏预览模拟中（非真机）').count() === 1)
  const sessionId = recordAfterStart.session.sessionId
  const petId = recordAfterStart.session.petId
  check('petId 已确定并保存', typeof petId === 'string' && petId.length > 0, petId)
  await page.screenshot({ path: `${OUT}/02-hatch-waiting.png` })

  /* 3. 提前翻回（离开再回同一局） */
  await sleep(4000)
  await page.goto(`${BASE}#/collection`, { waitUntil: 'networkidle' })
  await page.goto(`${BASE}#/hatch`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=已经开始了，放下手机等一会儿')
  const recordEarly = await readRecord(page)
  const earlyRemaining = recordEarly.session.deadlineAt - Date.now()
  check('提前翻回仍是同一局', recordEarly.session.sessionId === sessionId)
  check('剩余时间连续（约 14–17s）', earlyRemaining > 13_000 && earlyRemaining < 17_500, `${Math.round(earlyRemaining / 1000)}s`)
  check('提前翻回角色保持隐藏', !(await page.locator('text=孵出来了').count()))
  await page.screenshot({ path: `${OUT}/03-early-return.png` })

  /* 4. 阶段推进：cracking（50%） */
  await page.waitForFunction(
    () => document.body.innerText.includes('蛋壳上出现了一道裂纹'),
    { timeout: 15_000 },
  )
  check('50% 进入「快了」阶段', true)
  await page.screenshot({ path: `${OUT}/04-cracking.png` })

  /* 5. 阶段推进：almost（85%） */
  await page.waitForFunction(
    () => document.body.innerText.includes('裂纹越来越多了'),
    { timeout: 10_000 },
  )
  check('85% 进入「快出来了」阶段', true)
  await page.screenshot({ path: `${OUT}/05-almost.png` })

  /* 6. 到期 */
  await page.waitForSelector('text=看看是谁', { timeout: 10_000 })
  check('到期出现「看看是谁」按钮', true)
  check('到期文案「孵好了，翻过来看看。」', await page.locator('text=孵好了，翻过来看看。').count() >= 1)
  check('到期倒计时归零', (await page.locator('span.tabular-nums').first().innerText()) === '00:00')
  const recordReady = await readRecord(page)
  check('到期阶段已存为 ready', recordReady.session.phase === 'ready')
  await page.screenshot({ path: `${OUT}/06-ready.png` })

  /* 7. 存储失败注入：揭晓时写入失败 → 提示可重试，且不重复计数 */
  await page.evaluate(() => {
    window.__setItemBackup = window.Storage.prototype.setItem
    window.Storage.prototype.setItem = function () {
      throw new DOMException('QuotaExceededError')
    }
  })
  await page.click('text=看看是谁')
  await page.waitForSelector('text=孵出来了')
  await sleep(1200)
  check('存储失败时提示「这次收藏还没保存」', (await page.locator('text=这次收藏还没保存，请重试').count()) === 1)
  const recordSaveFailed = await readRecord(page)
  check('写入失败时本地未落库（可重试）', (recordSaveFailed.collection[petId]?.count ?? 0) === 0)
  await page.screenshot({ path: `${OUT}/07-revealed-save-failed.png` })
  await page.evaluate(() => {
    window.Storage.prototype.setItem = window.__setItemBackup
  })
  await page.click('text=重试保存')
  await page.waitForSelector('text=收藏已保存')
  const recordRetried = await readRecord(page)
  check('重试后收藏写入且只加一次', recordRetried.collection[petId]?.count === 1, `count=${recordRetried.collection[petId]?.count}`)
  check('重试使用同一 sessionId', recordRetried.session.sessionId === sessionId)
  const petName = await page.locator('.text-display.font-semibold').first().innerText()
  check('主屏显示角色名与短句', petName.length > 0, petName)
  await page.screenshot({ path: `${OUT}/08-revealed.png` })

  /* 8. 收藏页 */
  await page.click('text=去看看收藏')
  await page.waitForURL(/#\/collection/)
  await page.waitForSelector('text=已遇见 1 / 6')
  check('收藏页显示已遇见 1 / 6', true)
  await page.screenshot({ path: `${OUT}/09-collection.png` })

  /* 9. 重复点击防护：已揭晓局直接开新局；未揭晓局开始新局需确认 */
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=孵一颗 · 3 分钟')
  await page.click('text=孵一颗 · 3 分钟')
  await page.waitForURL(/#\/hatch/)
  await page.waitForSelector('text=已经开始了，放下手机等一会儿')
  const normalSessionId = (await readRecord(page)).session.sessionId
  check('已揭晓后点孵一颗直接开新局', normalSessionId !== sessionId)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=孵一颗 · 3 分钟')
  await page.click('text=孵一颗 · 3 分钟')
  await page.waitForSelector('text=结束这颗蛋？')
  check('有未揭晓的局时开始新局需确认', true)
  await page.screenshot({ path: `${OUT}/10-confirm-restart.png` })
  await page.getByRole('dialog').getByRole('button', { name: '继续孵化' }).click()
  const recordStillSame = await readRecord(page)
  check('取消后不新建局', recordStillSame.session.sessionId === normalSessionId)

  /* 10. 结束本局释放（确认后回开始页，收藏保留） */
  await page.goto(`${BASE}#/hatch`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=已经开始了，放下手机等一会儿')
  await page.getByRole('button', { name: '结束这颗蛋' }).click()
  await page.waitForSelector('text=结束这颗蛋？')
  await page.screenshot({ path: `${OUT}/11-confirm-abort.png` })
  await page.getByRole('dialog').getByRole('button', { name: '结束', exact: true }).click()
  await page.waitForURL(BASE + '#/')
  const recordAborted = await readRecord(page)
  check('结束本局后 session 清空', recordAborted.session === null)
  check('结束本局后收藏保留', (recordAborted.collection[petId]?.count ?? 0) === 1)
  await page.screenshot({ path: `${OUT}/12-aborted.png` })

  /* 12. 重启恢复：重新加载后收藏与设置仍在 */
  await page.reload({ waitUntil: 'networkidle' })
  const recordReload = await readRecord(page)
  check('重启后收藏记录仍在', (recordReload.collection[petId]?.count ?? 0) === 1)
} catch (error) {
  check('验收流程未中断', false, String(error).slice(0, 200))
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => undefined)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n合计 ${results.length} 项：通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length ? 1 : 0)
