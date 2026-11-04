/* =============================================================================
 * 音效：Web Audio 实时合成，不落音频文件、无外链。
 * 开关默认关闭；AudioContext 必须在用户手势后创建 / 恢复。
 * ========================================================================== */

let ctx: AudioContext | null = null
let enabled = false

type AudioCtor = typeof AudioContext

function getCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & { webkitAudioContext?: AudioCtor }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = getCtor()
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

export function setSoundEnabled(next: boolean): void {
  enabled = next
  if (next) {
    const context = ensureCtx()
    void context?.resume().catch(() => undefined)
  }
}

function tone(freq: number, durationMs: number, options: { type?: OscillatorType; gain?: number; delayMs?: number; slideTo?: number } = {}): void {
  if (!enabled) return
  const context = ensureCtx()
  if (!context) return
  const { type = 'sine', gain = 0.18, delayMs = 0, slideTo } = options
  const start = context.currentTime + delayMs / 1000
  const end = start + durationMs / 1000
  const osc = context.createOscillator()
  const amp = context.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), end)
  }
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.015)
  amp.gain.exponentialRampToValueAtTime(0.0001, end)
  osc.connect(amp).connect(context.destination)
  osc.start(start)
  osc.stop(end + 0.05)
}

function noiseBurst(durationMs: number, gain = 0.12): void {
  if (!enabled) return
  const context = ensureCtx()
  if (!context) return
  const frames = Math.floor((context.sampleRate * durationMs) / 1000)
  const buffer = context.createBuffer(1, frames, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i += 1) {
    // 裂纹质感：衰减白噪声
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  }
  const src = context.createBufferSource()
  src.buffer = buffer
  const amp = context.createGain()
  amp.gain.value = gain
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1800
  src.connect(filter).connect(amp).connect(context.destination)
  src.start()
}

export const sfx = {
  /** 开始一局：轻快两音上行 */
  start(): void {
    tone(523.25, 140, { type: 'triangle' })
    tone(783.99, 220, { type: 'triangle', delayMs: 120 })
  },
  /** 阶段变化的轻响（里面好像动了一下） */
  stage(): void {
    tone(659.25, 120, { type: 'sine', gain: 0.12 })
  },
  /** 到期：两声柔和提示（配合短振） */
  due(): void {
    tone(587.33, 200, { type: 'sine', gain: 0.2 })
    tone(880, 320, { type: 'sine', gain: 0.2, delayMs: 220 })
  },
  /** 破壳（约 1 秒）：噪声 + 低频下滑 + 一声明亮的叮 */
  crack(): void {
    noiseBurst(260, 0.14)
    tone(220, 700, { type: 'sawtooth', gain: 0.1, slideTo: 55 })
    tone(1318.51, 500, { type: 'sine', gain: 0.16, delayMs: 520 })
    tone(1760, 420, { type: 'sine', gain: 0.1, delayMs: 640 })
  },
  /** 遇见角色：一声叮 */
  meet(): void {
    tone(1046.5, 260, { type: 'triangle', gain: 0.16 })
    tone(1567.98, 300, { type: 'triangle', gain: 0.1, delayMs: 110 })
  },
}
