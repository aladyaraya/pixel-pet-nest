import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// 使用工程已有编译器，兼容项目支持的 Node 20，不依赖 Node 的实验性 TS 加载器。
const source = await readFile(new URL('./backScreenScheduler.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
})
const { BackScreenScheduler } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

const ok = { ok: true, reason: 'ok', simulated: false }
const failed = { ok: false, reason: 'call-failed', simulated: false }
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }

function fakeClock() {
  let time = 0
  let nextId = 0
  const timers = new Map()
  return {
    now: () => time,
    setTimeout(callback, delay) {
      const id = ++nextId
      timers.set(id, { callback, at: time + delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
    async advance(ms) {
      await flush()
      const end = time + ms
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        time = next[1].at
        timers.delete(next[0])
        next[1].callback()
        await flush()
      }
      time = end
      await flush()
    },
  }
}

function harness({ manual = false } = {}) {
  const clock = fakeClock()
  const calls = []
  const pending = []
  const results = []
  const statuses = []
  let active = 0
  let maxActive = 0
  const call = (name, frame) => {
    calls.push({ name, frame, at: clock.now() })
    active += 1
    maxActive = Math.max(maxActive, active)
    return (manual ? new Promise((resolve) => pending.push(resolve)) : Promise.resolve(ok))
      .finally(() => { active -= 1 })
  }
  const scheduler = new BackScreenScheduler({
    clock,
    commands: {
      wake: () => call('wake'), frame: (frame) => call('frame', frame),
      clear: () => call('clear'), sleep: () => call('sleep'),
    },
    onResult: (result) => { results.push(result); statuses.push(result.ok ? 'ok' : 'failed') },
    onPending: () => statuses.push('pending'),
  })
  return {
    scheduler, clock, calls, results, statuses,
    maxActive: () => maxActive,
    async complete(result = ok) {
      assert.ok(pending.length, 'a bridge command must be in flight')
      pending.shift()(result)
      await flush()
    },
  }
}

test('one serial channel drops intermediate scenes and obsolete command continuations', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'a', frame: [1] })
  h.scheduler.setScene({ key: 'b', frame: [2] })
  h.scheduler.setScene({ key: 'c', frame: [3] })
  assert.deepEqual(h.calls.map((c) => c.name), ['wake'])
  await h.complete()
  assert.deepEqual(h.calls.map((c) => c.name), ['wake', 'wake'])
  await h.complete()
  assert.deepEqual(h.calls.at(-1).frame, [3])
  await h.complete()
  assert.equal(h.maxActive(), 1)
  assert.deepEqual(h.calls.filter((c) => c.name === 'frame').map((c) => c.frame), [[3]])
})

test('a superseded clear cannot sleep after the latest pet is selected', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'idle', frame: null })
  h.scheduler.setScene({ key: 'pet', frame: [7] })
  await h.complete()
  await h.complete()
  await h.complete()
  assert.deepEqual(h.calls.map((c) => c.name), ['clear', 'wake', 'frame'])
  assert.equal(h.maxActive(), 1)
})

test('wake acknowledgment does not report display success before frame acknowledgment', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [7] })
  await h.complete()
  assert.equal(h.calls.at(-1).name, 'frame')
  assert.deepEqual(h.results, [])
  await h.complete()
  assert.deepEqual(h.results, [ok])
  h.scheduler.setScene({ key: 'another-pet', frame: [8] })
  assert.equal(h.statuses.at(-1), 'pending')
  await h.complete()
  assert.equal(h.statuses.at(-1), 'pending')
  await h.clock.advance(1000)
  await h.complete()
  assert.equal(h.statuses.at(-1), 'ok')
})

test('idle releases in clear then sleep order', async () => {
  const h = harness()
  h.scheduler.setScene({ key: 'idle', frame: null })
  h.scheduler.resume()
  await flush()
  assert.deepEqual(h.calls.map((c) => c.name), ['clear', 'sleep'])
})

test('hide discards pending work, resume recomputes one latest static scene', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'waiting', frame: [1], animationFrames: [[2]], animate: true })
  h.scheduler.suspend()
  h.scheduler.setScene({ key: 'ready', frame: [9] })
  await h.complete()
  await h.clock.advance(60_000)
  assert.equal(h.calls.length, 1)
  h.scheduler.resume()
  await h.complete()
  await h.complete()
  assert.deepEqual(h.calls.filter((c) => c.name === 'frame').map((c) => c.frame), [[9]])
  assert.equal(h.maxActive(), 1)
})

test('failure stops automatic work across scenes and foreground changes until retry', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'a', frame: [1], animate: true, animationFrames: [[2]] })
  await h.complete(failed)
  h.scheduler.setScene({ key: 'b', frame: [3] })
  h.scheduler.suspend()
  h.scheduler.resume()
  await h.clock.advance(60_000)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.results, [failed])
  h.scheduler.retry()
  await h.complete()
  await h.complete()
  assert.deepEqual(h.calls.at(-1).frame, [3])
})

test('an obsolete failure cannot disable the latest scene', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'a', frame: [1] })
  h.scheduler.setScene({ key: 'b', frame: [2] })
  await h.complete(failed)
  await h.complete()
  await h.complete()
  assert.equal(h.results.some((r) => !r.ok), false)
  assert.deepEqual(h.calls.at(-1).frame, [2])
})

test('idle starts follow 8/10/12 seconds, alternate variants, and hold frames for one second', async () => {
  const h = harness()
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], idleVariants: [[[2], [3], [1]], [[4], [5], [1]]], animate: true })
  await h.clock.advance(7_999)
  assert.equal(h.calls.filter((c) => c.name === 'frame').length, 1)
  await h.clock.advance(30_001)
  const frames = h.calls.filter((c) => c.name === 'frame')
  assert.deepEqual(frames.map((c) => [c.at, c.frame]), [
    [0, [1]], [8000, [2]], [9000, [3]], [10000, [1]],
    [18000, [4]], [19000, [5]], [20000, [1]],
    [30000, [2]], [31000, [3]], [32000, [1]], [38000, [4]],
  ])
  h.scheduler.suspend()
  await h.clock.advance(60_000)
  assert.equal(h.calls.filter((c) => c.name === 'frame').length, 11)
})

test('slow frames wait for acknowledgment before the next minimum frame hold', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], animationFrames: [[2]], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(8000)
  await h.clock.advance(5000)
  assert.equal(h.calls.length, 3)
  await h.complete()
  await h.clock.advance(999)
  assert.equal(h.calls.length, 3)
  await h.clock.advance(1)
  assert.equal(h.calls.at(-1).at, 14000)
  assert.equal(h.maxActive(), 1)
})

test('reduced motion stays static and repeated identical scenes do not restart animation', async () => {
  const h = harness()
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'static', frame: [1], animationFrames: [[2]], animate: false })
  await h.clock.advance(60_000)
  h.scheduler.setScene({ key: 'static', frame: [1], animationFrames: [[2]], animate: false })
  await flush()
  assert.deepEqual(h.calls.map((c) => c.name), ['wake', 'frame'])
})

test('animation does not flicker pending status and failed animation requires manual retry', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], animationFrames: [[2]], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(12000)
  assert.deepEqual(h.statuses, ['pending', 'ok'])
  await h.complete(failed)
  await h.clock.advance(60000)
  assert.equal(h.calls.length, 3)
  h.scheduler.suspend()
  h.scheduler.retry()
  assert.equal(h.calls.length, 3, 'retry while hidden must not send commands')
  h.scheduler.resume()
  await h.complete()
  await h.complete()
  assert.deepEqual(h.calls.at(-1).frame, [1], 'resume starts with static frame, not a missed animation')
})

test('a never-settling request times out after ten seconds and retry cannot overlap it', async () => {
  const h = harness({ manual: true })
  assert.equal(h.scheduler.hasInFlightRequest, false)
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], animationFrames: [[2]], animate: true })
  assert.equal(h.scheduler.hasInFlightRequest, true)
  await h.clock.advance(9999)
  assert.deepEqual(h.results, [])
  assert.equal(h.scheduler.waitingForTimedOutRequest, false)
  assert.equal(h.scheduler.hasInFlightRequest, true)
  await h.clock.advance(1)
  assert.deepEqual(h.results.at(-1), { ok: false, reason: 'timeout', simulated: false })
  assert.equal(h.scheduler.waitingForTimedOutRequest, true)
  assert.equal(h.scheduler.hasInFlightRequest, true)
  h.scheduler.retry()
  h.scheduler.setScene({ key: 'new-pet', frame: [3] })
  h.scheduler.retry()
  h.scheduler.suspend()
  h.scheduler.resume()
  await h.clock.advance(60_000)
  assert.equal(h.calls.length, 1, 'timeout must retain the original in-flight slot')
  assert.equal(h.maxActive(), 1)
  assert.equal(h.statuses.at(-1), 'failed', 'retry must not advertise a new pending request')
})

test('late timeout settlement never sends obsolete frame or sleep and permits manual latest-scene retry', async () => {
  for (const frame of [[1], null]) {
    const h = harness({ manual: true })
    h.scheduler.resume()
    h.scheduler.setScene({ key: 'old', frame })
    // 超时的是旧目标，但它占住整个通道；新目标也必须停下来等待处理。
    h.scheduler.setScene({ key: 'latest', frame: [9] })
    await h.clock.advance(10000)
    assert.equal(h.results.at(-1).reason, 'timeout')
    h.scheduler.retry()
    assert.equal(h.calls.length, 1)
    await h.complete()
    assert.equal(h.scheduler.waitingForTimedOutRequest, false)
    assert.equal(h.scheduler.hasInFlightRequest, false)
    await h.clock.advance(12000)
    assert.equal(h.calls.length, 1, 'settlement alone must neither resume the old command group nor retry automatically')
    h.scheduler.retry()
    assert.equal(h.scheduler.hasInFlightRequest, true)
    await h.complete()
    assert.equal(h.scheduler.hasInFlightRequest, true, 'wake settled but frame is still awaiting acknowledgment')
    await h.complete()
    assert.equal(h.scheduler.hasInFlightRequest, false)
    assert.deepEqual(h.calls.map((call) => call.name), [frame ? 'wake' : 'clear', 'wake', 'frame'])
    assert.deepEqual(h.calls.at(-1).frame, [9])
    assert.equal(h.results.at(-1).ok, true)
    assert.equal(h.maxActive(), 1)
  }
})

test('manual reaction preempts idle, ignores repeated taps, returns to base, and resets idle cadence', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], idleVariants: [[[2], [3], [1]], [[4], [5], [1]]], animate: true })
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), false, 'scene activation has priority')
  await h.complete()
  await h.complete()
  await h.clock.advance(8000)
  assert.deepEqual(h.calls.at(-1).frame, [2])
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [99]]), true)
  assert.equal(h.scheduler.playReaction('pet', [[70], [80], [1]]), false, 'never queue repeated taps')
  await h.complete()
  assert.equal(h.scheduler.hasInFlightRequest, false, 'frame gate is local waiting, not a native request')
  await h.clock.advance(999)
  assert.deepEqual(h.calls.at(-1).frame, [2])
  await h.clock.advance(1)
  assert.deepEqual(h.calls.at(-1).frame, [7])
  await h.complete()
  await h.clock.advance(1000)
  assert.deepEqual(h.calls.at(-1).frame, [8])
  await h.complete()
  await h.clock.advance(1000)
  assert.deepEqual(h.calls.at(-1).frame, [1], 'manual last frame must be current scene base')
  assert.equal(h.scheduler.playReaction('pet', [[70], [80], [1]]), false, 'last frame must settle before another reaction')
  await h.complete()
  await h.clock.advance(4999)
  assert.equal(h.calls.filter(c => c.name === 'frame').length, 5)
  await h.clock.advance(1)
  assert.equal(h.calls.at(-1).at, 16000, 'accepted manual reaction restarts the eight-second interval')
  assert.deepEqual(h.calls.at(-1).frame, [4], 'idle variants continue alternating')
  assert.equal(h.maxActive(), 1)
  assert.equal(h.calls.filter(c => c.name === 'wake').length, 1, 'reactions do not change wake behavior')
})

test('target change cancels a gated reaction and phase static frame cannot be preempted', async () => {
  const h = harness()
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'waiting', frame: [1], animate: true })
  await flush()
  assert.equal(h.scheduler.playReaction('waiting', [[7], [8], [1]]), true)
  await flush()
  assert.equal(h.scheduler.hasInFlightRequest, false)
  h.scheduler.setScene({ key: 'ready', frame: [9], animate: true })
  assert.equal(h.scheduler.playReaction('ready', [[70], [80], [9]]), false)
  await h.clock.advance(999)
  assert.deepEqual(h.calls.filter(c => c.name === 'frame').map(c => c.frame), [[1]])
  await h.clock.advance(1)
  assert.deepEqual(h.calls.filter(c => c.name === 'frame').map(c => c.frame), [[1], [9]])
  assert.equal(h.scheduler.playReaction('waiting', [[7], [8], [1]]), false)
  assert.equal(h.scheduler.playReaction('ready', [[7], [8], [9]]), true)
  h.scheduler.suspend()
})

test('late manual frame settlement still gates new scene and never resumes old reaction', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet-a', frame: [1], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(1000)
  assert.equal(h.scheduler.playReaction('pet-a', [[7], [8], [1]]), true)
  await flush()
  await h.clock.advance(5000)
  h.scheduler.setScene({ key: 'pet-b', frame: [9], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(999)
  assert.deepEqual(h.calls.filter(c => c.name === 'frame').map(c => c.frame), [[1], [7]])
  await h.clock.advance(1)
  assert.equal(h.calls.at(-1).at, 7000)
  assert.deepEqual(h.calls.at(-1).frame, [9])
  await h.complete()
  assert.equal(h.maxActive(), 1)
})

test('hide discards reaction and foreground resumes current static frame then a fresh idle cadence', async () => {
  const h = harness()
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], idleVariants: [[[2], [3], [1]]], animate: true })
  await h.clock.advance(1000)
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), true)
  await flush()
  h.scheduler.suspend()
  assert.equal(h.scheduler.playReaction('pet', [[70], [80], [1]]), false)
  await h.clock.advance(20000)
  h.scheduler.resume()
  await flush()
  assert.deepEqual(h.calls.filter(c => c.name === 'frame').map(c => c.frame), [[1], [7], [1]])
  await h.clock.advance(7999)
  assert.equal(h.calls.filter(c => c.name === 'frame').length, 3)
  await h.clock.advance(1)
  assert.deepEqual(h.calls.at(-1).frame, [2])
  h.scheduler.suspend()
})

test('failed manual reaction stays stopped until explicit retry, reduced motion never reacts', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], idleVariants: [[[2], [3], [1]]], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(1000)
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), true)
  await flush()
  await h.complete(failed)
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), false)
  await h.clock.advance(60000)
  assert.equal(h.calls.filter(c => c.name === 'frame').length, 2)
  h.scheduler.retry()
  await h.complete()
  await h.complete()
  h.scheduler.setScene({ key: 'reduced', frame: [1], animate: false })
  await h.complete()
  await h.clock.advance(1000)
  await h.complete()
  assert.equal(h.scheduler.playReaction('reduced', [[7], [8], [1]]), false)
  assert.equal(h.scheduler.playReaction('reduced', [[7], [1]]), false)
})

test('slow acknowledgments defer idle without catch-up bursts', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], idleVariants: [[[2], [3], [1]], [[4], [5], [1]]], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(8000)
  for (let index = 0; index < 3; index += 1) {
    await h.clock.advance(9000)
    await h.complete()
    if (index < 2) await h.clock.advance(1000)
  }
  assert.equal(h.clock.now(), 37000)
  await h.clock.advance(999)
  assert.equal(h.calls.filter(c => c.name === 'frame').length, 4)
  await h.clock.advance(1)
  assert.deepEqual(h.calls.at(-1).frame, [4])
  assert.equal(h.calls.at(-1).at, 38000, 'missed cycles are not replayed')
  assert.equal(h.maxActive(), 1)
})

test('manual preemption cannot hide an in-flight idle failure on the same scene', async () => {
  const h = harness({ manual: true })
  h.scheduler.resume()
  h.scheduler.setScene({ key: 'pet', frame: [1], idleVariants: [[[2], [3], [1]]], animate: true })
  await h.complete()
  await h.complete()
  await h.clock.advance(8000)
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), true)
  await h.complete(failed)
  assert.deepEqual(h.results.at(-1), failed)
  await h.clock.advance(20000)
  assert.deepEqual(h.calls.filter(c => c.name === 'frame').map(c => c.frame), [[1], [2]])
  assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), false)
  h.scheduler.retry()
  await h.complete()
  await h.complete()
  assert.deepEqual(h.calls.at(-1).frame, [1])
  assert.equal(h.maxActive(), 1)
})

test('same-scene resume or early retry cannot erase a request failure, including while hidden', async () => {
  for (const action of ['resume-before-failure', 'resume-after-failure', 'retry-before-failure']) {
    const h = harness({ manual: true })
    h.scheduler.resume()
    h.scheduler.setScene({ key: 'pet', frame: [1], animate: true })
    await h.complete()
    if (action === 'retry-before-failure') h.scheduler.retry()
    else {
      h.scheduler.suspend()
      if (action === 'resume-before-failure') h.scheduler.resume()
    }
    await h.complete(failed)
    if (action === 'resume-after-failure') {
      assert.deepEqual(h.results, [], 'hidden failures are retained without updating hidden UI')
      h.scheduler.resume()
    }
    await h.clock.advance(20000)
    assert.deepEqual(h.results.at(-1), failed)
    assert.deepEqual(h.calls.map(c => c.name), ['wake', 'frame'])
    assert.equal(h.scheduler.playReaction('pet', [[7], [8], [1]]), false)
    h.scheduler.retry()
    await h.complete()
    await h.complete()
    assert.equal(h.results.at(-1).ok, true)
    assert.equal(h.maxActive(), 1)
  }
})
