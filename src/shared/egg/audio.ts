/* 本地 Web Audio 小音效：圆润的像素音色，无音频下载、外链或背景循环。
 * 只在用户手势里解锁音频；关闭声音、隐藏或系统中断时丢弃未播完的声音。
 */
import type { ReactionKind } from './motion'

type AudioCtor = typeof AudioContext
type Note = {
  pitch: number
  duration: number
  delay?: number
  wave?: OscillatorType
  gain?: number
  slide?: number
  noise?: boolean
}
type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] }
type PendingCue = { notes: readonly Note[]; expires: number }

let ctx: AudioContext | null = null
let enabled = false
let foreground = true
let resumePending = false
let resumeTicket = 0
let unlockAttemptAt = -Infinity
let pendingCue: PendingCue | null = null
const voices = new Set<Voice>()

function audible(): boolean {
  return enabled && foreground && typeof document !== 'undefined' && document.visibilityState !== 'hidden'
}

function release(voice: Voice): void {
  voices.delete(voice)
  voice.source.onended = null
  for (const node of voice.nodes) {
    try { node.disconnect() } catch { /* 已释放的节点无需再次处理。 */ }
  }
}

function stopSounds(): void {
  pendingCue = null
  for (const voice of voices) {
    try { voice.source.stop() } catch { /* 系统中断或节点已经结束。 */ }
    release(voice)
  }
}

/** 仅应用保存的偏好；读取设置本身不创建音频上下文。 */
export function setSoundEnabled(next: boolean): void {
  enabled = next
  if (!next) { resumeTicket++; resumePending = false; stopSounds() }
}

export function setAudioForeground(next: boolean): void {
  foreground = next
  if (!next) { resumeTicket++; resumePending = false; stopSounds() }
}

/** 在 pointerdown／keydown／读屏激活等用户手势内调用。 */
export function unlockAudio(): void {
  if (!audible() || typeof window === 'undefined') return
  if (!ctx || ctx.state === 'closed') {
    const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext
    if (!Ctor) return
    try {
      stopSounds()
      ctx = new Ctor()
      const context = ctx
      context.onstatechange = () => {
        // interrupted / suspended 的声音不能在系统恢复后突然接着播放。
        if (ctx === context && context.state !== 'running') {
          resumeTicket++; resumePending = false; stopSounds()
        }
      }
    } catch { ctx = null; return }
  }
  const context = ctx
  if (context.state === 'running') return
  // 每个新手势都可再次尝试；不等待一个被自动播放策略挂起的旧 Promise。
  resumePending = true
  unlockAttemptAt = performance.now()
  const ticket = ++resumeTicket
  try {
    void context.resume().then(() => {
      if (context !== ctx || ticket !== resumeTicket) return
      resumePending = false
      const cue = pendingCue
      pendingCue = null
      if (cue && audible() && context.state === 'running' && performance.now() <= cue.expires) {
        render(context, cue.notes)
      }
    }).catch(() => { if (context === ctx && ticket === resumeTicket) { resumePending = false; pendingCue = null } })
  } catch { resumePending = false; pendingCue = null }
}

const frequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12)

function render(context: AudioContext, notes: readonly Note[]): void {
  stopSounds()
  const origin = context.currentTime + 0.008
  try {
    for (const note of notes) {
      const start = origin + (note.delay ?? 0) / 1000
      const end = start + note.duration / 1000
      const amp = context.createGain()
      const filter = context.createBiquadFilter()
      filter.type = note.noise ? 'bandpass' : 'lowpass'
      filter.frequency.value = note.noise ? 1250 : note.wave === 'square' ? 1400 : 2800
      filter.Q.value = note.noise ? 0.7 : 0.5
      let source: OscillatorNode | AudioBufferSourceNode
      if (note.noise) {
        source = context.createBufferSource()
        const length = Math.max(1, Math.floor(context.sampleRate * note.duration / 1000))
        const buffer = context.createBuffer(1, length, context.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
        source.buffer = buffer
      } else {
        source = context.createOscillator()
        source.type = note.wave ?? 'triangle'
        source.frequency.setValueAtTime(frequency(note.pitch), start)
        if (note.slide !== undefined) source.frequency.exponentialRampToValueAtTime(frequency(note.slide), end)
      }
      // 柔和起音、短尾音；限制峰值，避免方波与破壳声刺耳。
      amp.gain.setValueAtTime(0.0001, start)
      amp.gain.exponentialRampToValueAtTime(note.gain ?? 0.1, start + 0.012)
      amp.gain.exponentialRampToValueAtTime(0.0001, end)
      const voice: Voice = { source, nodes: [source, filter, amp] }
      voices.add(voice)
      source.onended = () => release(voice)
      source.connect(filter).connect(amp).connect(context.destination)
      source.start(start)
      source.stop(end + 0.015)
    }
  } catch { stopSounds() } // 缺少音频能力或系统中断不影响孵化与收藏。
}

function play(notes: readonly Note[]): void {
  if (!audible() || !ctx) return
  if (ctx.state === 'running') render(ctx, notes)
  else if (resumePending && performance.now() - unlockAttemptAt <= 150) {
    // 只给当前手势的第一声留出短暂解锁时间，绝不积压播放列表。
    pendingCue = { notes, expires: performance.now() + 150 }
  }
}

type PetVoice = { pitches: readonly number[]; wave: OscillatorType; pace: number; slide?: number }
const PET_VOICES: Readonly<Record<string, PetVoice>> = {
  tiny_egg: { pitches: [76, 79, 76], wave: 'triangle', pace: 110 },
  sprout_potato: { pitches: [60, 64, 67], wave: 'triangle', pace: 140 },
  question_face: { pitches: [67, 69, 74, 71], wave: 'sine', pace: 115, slide: 2 },
  late_duck: { pitches: [74, 71, 74], wave: 'square', pace: 105, slide: -2 },
  box_ghost: { pitches: [72, 67, 74], wave: 'sine', pace: 155, slide: -3 },
  nap_cloud: { pitches: [55, 62], wave: 'sine', pace: 210, slide: -1 },
  crescent_cat: { pitches: [69, 76, 72], wave: 'triangle', pace: 135, slide: 1 },
  star_fawn: { pitches: [79, 83, 86], wave: 'sine', pace: 125 },
  cape_penguin: { pitches: [60, 67, 72], wave: 'square', pace: 145 },
  solar_phoenix: { pitches: [72, 76, 79, 84], wave: 'triangle', pace: 140 },
  ring_whale: { pitches: [48, 55, 60], wave: 'sine', pace: 185, slide: 3 },
  moon_crown_dragon: { pitches: [57, 64, 69, 64], wave: 'triangle', pace: 160, slide: -1 },
}

export const sfx = {
  enable(): void {
    play([{ pitch: 72, duration: 120 }, { pitch: 79, duration: 180, delay: 100, gain: 0.075 }])
  },
  start(): void {
    play([72, 76, 79].map((pitch, i) => ({ pitch, duration: 210, delay: i * 110, gain: 0.11 })))
  },
  stage(): void {
    play([{ pitch: 76, duration: 105, gain: 0.055 }, { pitch: 81, duration: 145, delay: 100, gain: 0.04 }])
  },
  due(): void {
    play([
      { pitch: 74, duration: 220, wave: 'sine', gain: 0.16 },
      { pitch: 81, duration: 320, delay: 250, wave: 'sine', gain: 0.14 },
      { pitch: 86, duration: 400, delay: 510, wave: 'triangle', gain: 0.08 },
    ])
  },
  crack(): void {
    play([
      { pitch: 0, noise: true, duration: 90, gain: 0.1 },
      { pitch: 0, noise: true, duration: 100, delay: 180, gain: 0.08 },
      { pitch: 60, duration: 140, gain: 0.075, slide: 55 },
      ...[72, 76, 79, 84].map((pitch, i) => ({ pitch, duration: 280, delay: 420 + i * 130, gain: 0.09 })),
    ])
  },
  meet(): void {
    play([{ pitch: 84, duration: 210, gain: 0.09 }, { pitch: 91, duration: 260, delay: 130, gain: 0.055 }])
  },
  eggReaction(kind: ReactionKind): void {
    play(kind === 'tap'
      ? [{ pitch: 67, duration: 100, gain: 0.09, slide: 64 }, { pitch: 72, duration: 150, delay: 110, gain: 0.055 }]
      : [{ pitch: 60, duration: 550, wave: 'sine', gain: 0.065 }, { pitch: 67, duration: 650, delay: 240, wave: 'sine', gain: 0.05 }])
  },
  petReaction(petId: string, kind: ReactionKind): void {
    const voice = PET_VOICES[petId]
    if (!voice) return
    if (kind === 'tap') {
      play(voice.pitches.map((pitch, i) => ({ pitch, wave: voice.wave, delay: i * voice.pace,
        duration: voice.pace + 100, gain: voice.wave === 'square' ? 0.055 : 0.095,
        slide: voice.slide === undefined ? undefined : pitch + voice.slide })))
    } else {
      // 亲昵回应放慢并落回根音；高音角色降八度，低音角色保留手机易听见的音区。
      const pitches = [...voice.pitches.slice(0, 3), voice.pitches[0]]
      const transpose = voice.pitches[0] < 60 ? 0 : -12
      play(pitches.map((pitch, i) => ({ pitch: pitch + transpose, wave: 'sine', delay: i * 260,
        duration: 440, gain: i === 0 ? 0.08 : 0.06, slide: pitch + transpose + (i % 2 === 0 ? 0.3 : -0.3) })))
    }
  },
}
