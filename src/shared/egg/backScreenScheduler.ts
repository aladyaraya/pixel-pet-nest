import type { BackScreenResult } from './backScreen'
import type { MatrixFrame } from './types'

export interface BackScreenScene {
  /** 同一目标的稳定标识；阶段、角色或减少动态偏好变化时更新。 */
  key: string
  /** null 代表释放自定义画面，按 clear → sleep 顺序执行。 */
  frame: MatrixFrame | null
  /** 两组交替的自主动作；保留 animationFrames 供已有调用方兼容。 */
  idleVariants?: readonly (readonly MatrixFrame[])[]
  animationFrames?: readonly MatrixFrame[]
  animate?: boolean
}

export interface BackScreenCommands {
  wake: () => Promise<BackScreenResult>
  frame: (frame: MatrixFrame) => Promise<BackScreenResult>
  clear: () => Promise<BackScreenResult>
  sleep: () => Promise<BackScreenResult>
}

export interface BackScreenClock {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => unknown
  clearTimeout: (handle: unknown) => void
}

interface Job {
  generation: number
  sceneRevision: number
  frame: MatrixFrame | null
  activate: boolean
  /** -1 为场景静态帧；>= 0 为一次短动画中的帧。 */
  animationIndex: number
  kind: 'scene' | 'reaction' | 'idle'
  frames?: MatrixFrame[]
}

const IDLE_INTERVALS_MS = [8_000, 10_000, 12_000] as const
const FRAME_MS = 1_000
export const BACK_SCREEN_REQUEST_TIMEOUT_MS = 10_000

/**
 * 业务调度器：所有四类背屏命令共用一个串行通道。
 * 已交给设备的命令无法撤回；每次 await 后重新核对代次，丢弃旧场景的剩余命令。
 * 暂停保留最后一帧，不假设硬件支持后台动画。失败后只接受手动 retry。
 */
export class BackScreenScheduler {
  private readonly commands: BackScreenCommands
  private readonly clock: BackScreenClock
  private readonly onFrame: (frame: MatrixFrame | null) => void
  private readonly onResult: (result: BackScreenResult) => void
  private readonly onPending: () => void
  private scene: BackScreenScene | null = null
  private generation = 0
  private sceneRevision = 0
  private pending: Job | null = null
  private running = false
  private paused = true
  private failed = false
  private timer: unknown = null
  private idleAnchor = 0
  private idleIntervalIndex = 0
  private idleVariantIndex = 0
  private sceneReady = false
  private reactionActive = false
  private lastFrameSettledAt = -Infinity
  private frameGate: { timer: unknown; resolve: (allowed: boolean) => void } | null = null
  private inFlight = false
  private timedOutInFlight = false
  private failureResult: BackScreenResult | null = null
  private failureReported = false

  constructor(options: {
    commands: BackScreenCommands
    clock?: BackScreenClock
    onFrame?: (frame: MatrixFrame | null) => void
    onResult?: (result: BackScreenResult) => void
    onPending?: () => void
  }) {
    this.commands = options.commands
    this.clock = options.clock ?? {
      now: () => performance.now(),
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
    this.onFrame = options.onFrame ?? (() => undefined)
    this.onResult = options.onResult ?? (() => undefined)
    this.onPending = options.onPending ?? (() => undefined)
  }

  setScene(scene: BackScreenScene): void {
    if (this.scene?.key === scene.key) return
    this.sceneRevision += 1
    this.scene = scene
    this.replacePending()
  }

  /** 接受一次临时动作，不改变长期目标；连点不排队，也不能抢掉目标静帧。 */
  playReaction(sceneKey: string, frames: readonly MatrixFrame[]): boolean {
    if (this.paused || this.failed || !this.sceneReady || this.reactionActive ||
      !this.scene?.frame || !this.scene.animate || this.scene.key !== sceneKey || frames.length !== 3) return false
    this.invalidate()
    this.reactionActive = true
    this.idleAnchor = this.clock.now()
    this.idleIntervalIndex = 0
    const sequence = [...frames.slice(0, 2), this.scene.frame]
    this.enqueue({
      generation: this.generation, sceneRevision: this.sceneRevision, frame: sequence[0], activate: false,
      kind: 'reaction', animationIndex: 0, frames: sequence,
    })
    return true
  }

  suspend(): void {
    this.paused = true
    this.sceneReady = false
    this.invalidate()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.replacePending()
  }

  retry(): void {
    if (this.timedOutInFlight) {
      this.reportTimeout()
      return
    }
    this.failed = false
    this.failureResult = null
    this.failureReported = false
    this.replacePending()
  }

  /** 只读状态：超时未取消原生请求，调用方此时也不能另起连接重试。 */
  get waitingForTimedOutRequest(): boolean {
    return this.timedOutInFlight
  }

  /** 只在实际命令等待回执期间为 true；重连也必须等待这一占用结束。 */
  get hasInFlightRequest(): boolean {
    return this.inFlight
  }

  private reportTimeout(): void {
    if (!this.paused) {
      this.failureReported = true
      this.onResult({ ok: false, reason: 'timeout', simulated: false })
    }
  }

  private reportFailure(): void {
    if (this.failureResult && !this.paused && !this.failureReported) {
      this.failureReported = true
      this.onResult(this.failureResult)
    }
  }

  private invalidate(): void {
    this.generation += 1
    this.pending = null
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
    this.reactionActive = false
    if (this.frameGate) {
      this.clock.clearTimeout(this.frameGate.timer)
      this.frameGate.resolve(false)
      this.frameGate = null
    }
  }

  private replacePending(): void {
    this.invalidate()
    this.sceneReady = false
    this.idleIntervalIndex = 0
    this.idleVariantIndex = 0
    if (!this.scene) return
    this.onFrame(this.scene.frame)
    this.reportFailure()
    if (!this.failed) this.onPending()
    if (this.paused || this.failed) return
    this.enqueue({ generation: this.generation, sceneRevision: this.sceneRevision, frame: this.scene.frame, activate: true, kind: 'scene', animationIndex: -1 })
  }

  private isCurrent(job: Job): boolean {
    return !this.paused && !this.failed && job.generation === this.generation
  }

  private enqueue(job: Job): void {
    if (!this.isCurrent(job)) return
    this.pending = job
    this.onFrame(job.frame)
    void this.pump()
  }

  /** 全部 set_frame 共用的间隔；可取消的本地等待不占原生命令，也不启动 watchdog。 */
  private waitForFrameSlot(job: Job): Promise<boolean> {
    const delay = this.lastFrameSettledAt + FRAME_MS - this.clock.now()
    if (delay <= 0) return Promise.resolve(this.isCurrent(job))
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => {
        this.frameGate = null
        resolve(this.isCurrent(job))
      }, delay)
      this.frameGate = { timer, resolve }
    })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending) {
        const job = this.pending
        this.pending = null
        if (!this.isCurrent(job)) continue
        const commands = job.frame === null
          ? [
            { tool: 'clear_back_screen_frame', run: this.commands.clear },
            { tool: 'sleep_back_screen', run: this.commands.sleep },
          ]
          : [
            ...(job.activate ? [{ tool: 'wake_up_back_screen', run: this.commands.wake }] : []),
            { tool: 'set_back_screen_frame', run: () => this.commands.frame(job.frame!) },
          ]
        let completedResult: BackScreenResult | null = null
        for (const command of commands) {
          if (!this.isCurrent(job)) break
          const isFrame = command.tool === 'set_back_screen_frame'
          if (isFrame && !await this.waitForFrameSlot(job)) break
          if (!this.isCurrent(job)) break
          if (isFrame && job.kind === 'idle' && job.animationIndex === 0) this.idleAnchor = this.clock.now()
          let result: BackScreenResult
          let awaiting = true
          this.inFlight = true
          const watchdog = this.clock.setTimeout(() => {
            if (!awaiting) return
            // 超时诊断属于整个占用中的通道：即便目标已改变也不能继续排队。
            this.timedOutInFlight = true
            this.failureResult = { ok: false, reason: 'timeout', simulated: false }
            this.failureReported = false
            this.failed = true
            this.sceneReady = false
            this.invalidate()
            console.warn(`[back-screen] connector=ic_atomic_990001 tool=${command.tool} code=request-timeout`)
            this.reportTimeout()
          }, BACK_SCREEN_REQUEST_TIMEOUT_MS)
          try {
            result = await command.run()
          } catch {
            result = { ok: false, reason: 'call-failed', simulated: false }
          } finally {
            awaiting = false
            this.clock.clearTimeout(watchdog)
            // 只在真实 Promise settle 后释放占用；绝不使用 Promise.race 假装取消。
            this.inFlight = false
            this.timedOutInFlight = false
            // 过期帧也可能已到达硬件，仍必须让它持有至少一秒。
            if (isFrame) this.lastFrameSettledAt = this.clock.now()
          }
          // 人工抢占、暂停恢复只换播放代次，不能抹掉同一展示目标的真实失败。
          // 只有确实换了目标，旧目标的非超时失败才不影响新目标。
          if (!result.ok && !this.failed && job.sceneRevision === this.sceneRevision) {
            this.failed = true
            this.failureResult = result
            this.failureReported = false
            this.sceneReady = false
            this.invalidate()
            this.reportFailure()
            break
          }
          if (!this.isCurrent(job)) break
          completedResult = result
        }
        if (this.isCurrent(job) && completedResult) {
          // wake 成功不足以证明画面已送达；整组命令成功后才报告完成。
          this.onResult(completedResult)
          this.scheduleAnimation(job)
        }
      }
    } finally {
      this.running = false
      // enqueue 可能在最后一个命令完成的同一轮微任务中替换目标。
      if (this.pending) void this.pump()
    }
  }

  private idleVariants(): readonly (readonly MatrixFrame[])[] {
    if (!this.scene?.frame || !this.scene.animate) return []
    if (this.scene.idleVariants?.length) return this.scene.idleVariants
    return this.scene.animationFrames?.length ? [this.scene.animationFrames] : []
  }

  private scheduleAnimation(job: Job): void {
    if (!this.isCurrent(job)) return
    if (job.kind === 'scene') {
      this.sceneReady = true
      this.idleAnchor = this.clock.now()
      this.scheduleIdle(job)
      return
    }
    const frames = job.frames!
    const nextIndex = job.animationIndex + 1
    if (nextIndex >= frames.length) {
      if (job.kind === 'reaction') this.reactionActive = false
      this.scheduleIdle(job)
      return
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      if (!this.isCurrent(job)) return
      this.enqueue({ ...job, frame: frames[nextIndex], activate: false, animationIndex: nextIndex })
    }, FRAME_MS)
  }

  private scheduleIdle(job: Job): void {
    const variants = this.idleVariants()
    if (!variants.length || !this.isCurrent(job)) return
    const interval = IDLE_INTERVALS_MS[this.idleIntervalIndex % IDLE_INTERVALS_MS.length]
    this.idleIntervalIndex += 1
    // 按动作开始计算周期；慢回执只延后，绝不补播多个错过的动作。
    const delay = Math.max(FRAME_MS, this.idleAnchor + interval - this.clock.now())
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      if (!this.isCurrent(job) || !this.scene?.frame) return
      const variant = variants[this.idleVariantIndex % variants.length]
      this.idleVariantIndex += 1
      const frames = [...variant.slice(0, 2), this.scene.frame]
      this.enqueue({
        generation: job.generation, sceneRevision: job.sceneRevision, frame: frames[0], activate: false,
        kind: 'idle', animationIndex: 0, frames,
      })
    }, delay)
  }
}
