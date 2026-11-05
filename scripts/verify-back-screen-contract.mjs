import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

// Uses the supplied capability definition as an independent schema oracle.
// Only an isolated browser bridge is exercised; this never operates real hardware.
const referencePath = process.argv[2]
if (!referencePath) throw new Error('Usage: node scripts/verify-back-screen-contract.mjs <back-screen-abilities.json> [preview URL]')
const base = (process.argv[3] || 'http://127.0.0.1:5179/').replace(/\/?$/, '/')
const raw = readFileSync(resolve(referencePath), 'utf8')
const reference = JSON.parse(raw)
assert.equal(reference.connector_id, 'ic_atomic_990001')
assert.equal(reference.ability_count, reference.abilities.length)
assert.equal(reference.abilities.length, 17)
const names = ['wake_up_back_screen', 'set_back_screen_frame', 'clear_back_screen_frame', 'sleep_back_screen']
const abilities = reference.abilities.filter(item => names.includes(item.name))
assert.equal(abilities.length, 4)
const out = process.env.BACK_SCREEN_OUT || '.acceptance-back-screen'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const stages = []
const key = 'capsule.mock.egg.record.v1'
const epoch = Date.UTC(2026, 10, 5, 10)
const seed = {
  version: 2, settings: { sound: false, flipReveal: false, lastDurationMs: 60000, privacyAgreed: true, backScreenPetId: null },
  session: null, collection: { late_duck: { count: 1, lastRevealedAt: epoch - 60000 } },
}
async function eventually(check, advanceClock = false) {
  const deadline = Date.now() + 8000
  let error
  do {
    try { await check(); return } catch (caught) { error = caught }
    if (advanceClock) await page.clock.runFor(100)
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  throw error
}
async function checkTarget(label, phase) {
  let snapshot
  await eventually(async () => {
    snapshot = await page.evaluate(async key => {
      const record = JSON.parse(localStorage.getItem(key))
      const { frameForPhase } = await import('/src/shared/egg/patterns.ts')
      const { petFrame } = await import('/src/shared/egg/pets.ts')
      const expected = record.session && record.session.phase !== 'revealed'
        ? frameForPhase(record.session.phase) : petFrame(record.settings.backScreenPetId)
      return { record, expected, commands: window.__contract.commands }
    }, key)
    assert.equal(snapshot.record.session.phase, phase)
    assert.equal(snapshot.commands.at(-1)?.name, 'set_back_screen_frame')
    assert.deepEqual(snapshot.commands.at(-1).args.frame, snapshot.expected)
  }, true)
  stages.push({ label, phase, tier: snapshot.record.session.tier, sessionPetId: snapshot.record.session.petId,
    selectedPetId: snapshot.record.settings.backScreenPetId, commandsSoFar: snapshot.commands.length })
}

try {
  await context.addInitScript(({ abilities, key, seed }) => {
    localStorage.setItem(key, JSON.stringify(seed))
    window.__contract = { connects: 0, active: 0, maxActive: 0, commands: [] }
    window.mcp = {
      connect: async () => { window.__contract.connects += 1 },
      callTool: async (name, args) => {
        const state = window.__contract
        state.active += 1
        state.maxActive = Math.max(state.maxActive, state.active)
        try {
          const ability = abilities.find(item => item.name === name)
          if (!ability) throw new Error('Unexpected tool: ' + name)
          const schema = ability.input_schema
          for (const field of schema.required || []) if (!(field in args)) throw new Error('Missing required argument')
          for (const field of Object.keys(args)) if (!(field in (schema.properties || {}))) throw new Error('Unexpected argument')
          if (name === 'set_back_screen_frame') {
            // The supplied schema documents these constraints in description, not JSON keywords.
            if (!Array.isArray(args.frame) || args.frame.length !== 391) throw new Error('Invalid frame size')
            for (let index = 0; index < 391; index += 1) {
              const value = args.frame[index]
              if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid brightness')
            }
          }
          state.commands.push({ name, args: JSON.parse(JSON.stringify(args)), at: Date.now() })
          return '设备已接收请求' // Exercise the text-only acknowledgment described by the reference.
        } finally { state.active -= 1 }
      },
    }
  }, { abilities, key, seed })
  await page.clock.install({ time: new Date(epoch) })
  await page.clock.pauseAt(new Date(epoch + 1000))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByLabel('分钟', { exact: true }).waitFor()
  await page.getByRole('button', { name: /^孵一颗 ·/ }).click()
  await checkTarget('开始：唤醒并推蛋帧', 'waiting')
  await page.clock.runFor(30000)
  await checkTarget('50%：裂纹', 'cracking')
  await page.clock.runFor(21000)
  await checkTarget('85%：接近完成', 'almost')
  await page.clock.runFor(9000)
  await checkTarget('到期：等待揭晓', 'ready')
  const lockedPet = stages[0].sessionPetId
  await page.getByRole('button', { name: '看看是谁', exact: true }).click()
  await page.clock.runFor(1200)
  await checkTarget('破壳完成：宠物', 'revealed')
  assert.equal(stages.at(-1).sessionPetId, lockedPet)
  await page.getByRole('button', { name: '去看看收藏', exact: true }).click()
  await page.getByRole('button', { name: '查看迟到小鸭', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '放到背屏', exact: true }).click()
  await checkTarget('手动选择收藏宠物', 'revealed')
  assert.equal(stages.at(-1).selectedPetId, 'late_duck')
  await page.getByRole('dialog').getByRole('button', { name: '停止展示', exact: true }).click()
  await eventually(async () => {
    const commands = await page.evaluate(() => window.__contract.commands.map(item => item.name))
    assert.deepEqual(commands.slice(-2), ['clear_back_screen_frame', 'sleep_back_screen'])
  })
  const trace = await page.evaluate(() => window.__contract)
  assert.equal(trace.maxActive, 1)
  assert.deepEqual(errors, [])
  stages.push({ label: '停止：清帧后熄灭', selectedPetId: null, commandsSoFar: trace.commands.length })
  const report = {
    verifiedAt: new Date().toISOString(), evidence: 'isolated-browser-contract-test-not-device',
    reference: { path: resolve(referencePath), sha256: createHash('sha256').update(raw).digest('hex'),
      connector_id: reference.connector_id, version: reference.version, ability_count: reference.ability_count },
    stages, ...trace, errors,
  }
  writeFileSync(out + '/contract-trace.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ stages: stages.length, commands: trace.commands.length, maxActive: trace.maxActive,
    schemaViolations: 0, pageErrors: errors.length, report: out + '/contract-trace.json', hardwareVerified: false }))
} finally {
  await context.close()
  await browser.close()
}
