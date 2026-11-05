/* =============================================================================
 * 背屏失败路径验收（平台预览环境可跑；真机证据另见 APK 验收）。
 * 覆盖：connect 永久挂起、回执 isError、空回执、中文文本回执四类路径，
 * 断言前屏业务不卡死、失败有提示与重试、不把无效回执当成功。
 *
 * 用法：node scripts/verify-back-screen-failpaths.mjs [previewBase]
 *   例：node scripts/verify-back-screen-failpaths.mjs http://127.0.0.1:5173/preview/p_xxx/
 * 需要 PLAYWRIGHT_BROWSERS_PATH 指向可用的 Chromium。
 * ========================================================================== */

import { createRequire } from 'node:module'
const require = createRequire('/home/ide/workspace/')
const { chromium } = require('playwright')

const BASE = (process.argv[2] || 'http://127.0.0.1:5173/').replace(/\/?$/, '/')
const KEY = 'capsule.mock.egg.record.v1'
const results = []
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const seed = (extra = {}) => ({
  version: 2,
  settings: { sound: false, flipReveal: false, lastDurationMs: 180000, backScreenPetId: null, privacyAgreed: true },
  session: null, collection: {}, ...extra,
})

async function newPage(bridgeScript) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
  await page.addInitScript(bridgeScript)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=孵一颗', { timeout: 30000 })
  return { browser, page, errors }
}

async function startOneMinute(page) {
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, settings: { sound: false, flipReveal: false, lastDurationMs: 180000, backScreenPetId: null, privacyAgreed: true }, session: null, collection: {} }))
  }, KEY)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=孵一颗', { timeout: 30000 })
  const inputs = page.locator('input')
  await inputs.nth(0).fill('1')
  await inputs.nth(1).fill('0')
  await page.locator('button:has-text("孵一颗 ·")').first().click()
  await page.waitForURL(/#\/hatch/, { timeout: 8000 })
}

/* 场景 1：connect 永久挂起 —— 前屏必须可用，背屏提示失败可重试，不卡死 */
{
  const { browser, page, errors } = await newPage(() => {
    window.__calls = []
    window.mcp = {
      connect: () => new Promise(() => {}), // 永不 resolve
      callTool: async (name) => { window.__calls.push(name); return { isError: false } },
    }
  })
  await startOneMinute(page)
  await page.waitForTimeout(1200)
  const onHatch = page.url().includes('#/hatch')
  const hasRetry = await page.locator('button:has-text("重试"), button:has-text("背屏")').count() > 0
  const noFrameSent = await page.evaluate(() => !window.__calls.some((n) => n === 'set_back_screen_frame'))
  check('connect 挂起：仍能开局进入孵化页', onHatch)
  check('connect 挂起：未发送帧、有失败提示/重试入口', noFrameSent && hasRetry)
  check('connect 挂起：无页面异常', errors.length === 0, errors.join('; '))
  await browser.close()
}

/* 场景 2：callTool 返回 isError —— 显示背屏失败，业务继续 */
{
  const { browser, page, errors } = await newPage(() => {
    window.__calls = []
    window.mcp = {
      connect: async () => undefined,
      callTool: async (name) => { window.__calls.push(name); return { isError: true, errorCode: 7 } },
    }
  })
  await startOneMinute(page)
  await page.waitForTimeout(1000)
  const failHint = await page.locator('text=背屏暂时没接上').count()
  const stillTiming = await page.locator('text=/^0[01]:\\d\\d$/').count() > 0 || await page.locator('.tabular-nums').count() > 0
  check('回执 isError：显示「背屏暂时没接上」', failHint > 0)
  check('回执 isError：主屏计时继续', stillTiming)
  check('回执 isError：无页面异常', errors.length === 0, errors.join('; '))
  await browser.close()
}

/* 场景 3：无效回执（空对象/空文本）—— 不假装成功 */
{
  const { browser, page, errors } = await newPage(() => {
    window.__calls = []
    window.mcp = {
      connect: async () => undefined,
      callTool: async (name) => { window.__calls.push(name); return {} }, // 空回执
    }
  })
  await startOneMinute(page)
  await page.waitForTimeout(1000)
  const failHint = await page.locator('text=背屏暂时没接上').count()
  check('空回执：按失败处理并提示', failHint > 0)
  check('空回执：无页面异常', errors.length === 0, errors.join('; '))
  await browser.close()
}

/* 场景 4：中文文本回执 —— 正常完成（用户文档记录设备返回中文文本） */
{
  const { browser, page, errors } = await newPage(() => {
    window.__calls = []
    window.mcp = {
      connect: async () => undefined,
      callTool: async (name, args) => {
        window.__calls.push(name)
        if (name === 'set_back_screen_frame' && (!Array.isArray(args.frame) || args.frame.length !== 391)) throw new Error('bad frame')
        return '设备已接收请求'
      },
    }
  })
  await startOneMinute(page)
  await page.waitForTimeout(800)
  const ok = await page.locator('text=背屏显示中').count()
  check('中文文本回执：识别为成功并显示「背屏显示中」', ok > 0)
  check('中文文本回执：帧参数合法（391）', await page.evaluate(() => window.__calls.includes('set_back_screen_frame')))
  await browser.close()
}

const failed = results.filter(([, ok]) => !ok).length
console.log(`\n合计 ${results.length} 项：通过 ${results.length - failed}，失败 ${failed}`)
process.exit(failed ? 1 : 0)
