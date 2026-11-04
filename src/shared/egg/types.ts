/* =============================================================================
 * 孵蛋小应用的领域类型：一局孵化、阶段、角色与本地记录。
 * 计时以「保存的到期时间」为准，页面定时器只负责刷新（见 PRD 06 章）。
 * ========================================================================== */

/** 背屏 / 主屏共用的孵化阶段 */
export type EggPhase = 'waiting' | 'cracking' | 'almost' | 'ready' | 'revealed'

export type EggMode = 'normal' | 'demo'

/** 一局孵化。字段与 PRD「本地最小数据」一致：至少包含这些字段 */
export interface EggSession {
  sessionId: string
  mode: EggMode
  /** 本局时长（ms）：正式 180000，演示 20000 */
  durationMs: number
  /** 开始时间戳（ms，设备时钟） */
  startedAt: number
  /** 到期时间戳（ms，设备时钟）；阶段计算以它为准 */
  deadlineAt: number
  /** 本局角色（开始时一次抽取，之后不变） */
  petId: string
  /** 当前阶段 */
  phase: EggPhase
  /** 揭晓时间戳；未揭晓为 null */
  revealedAt: number | null
  /** 中途提示已播过的阶段（只在新进程恢复时补一次，避免重复） */
  hintedPhases: EggPhase[]
}

export interface EggSettings {
  /** 音效开关（默认关） */
  sound: boolean
  /** 翻面自动揭晓（需真机验证，默认关） */
  flipReveal: boolean
  /** 上次选择的正式模式时长（ms），新一局默认沿用 */
  lastDurationMs: number
  /** 隐私同意状态缓存 */
  privacyAgreed: boolean | null
}

export interface PetCount {
  count: number
  lastRevealedAt: number | null
}

/** 带版本号的本地记录：settings + 当前 session + 6 个角色的计数 */
export interface EggRecord {
  version: number
  settings: EggSettings
  session: EggSession | null
  collection: Record<string, PetCount>
}

/** 17×23 点阵图案：23 行 × 17 列的行优先一维亮度数组（0 灭，255 亮） */
export type MatrixFrame = number[]

export const MATRIX_WIDTH = 17
export const MATRIX_HEIGHT = 23
export const MATRIX_SIZE = MATRIX_WIDTH * MATRIX_HEIGHT

export const PHASE_LABEL: Record<EggPhase, string> = {
  waiting: '等待',
  cracking: '快了',
  almost: '快出来了',
  ready: '可揭晓',
  revealed: '已揭晓',
}

/** 阶段进度边界（PRD 03 章）：0–50 等待 / 50–85 快了 / 85–100 快出来了 / 到期后可揭晓 */
export const PHASE_BOUNDARIES = { cracking: 0.5, almost: 0.85 }

export const NORMAL_DURATION_MS = 3 * 60 * 1000
export const DEMO_DURATION_MS = 20 * 1000

/** 正式模式可选的计时时长（ms）：1 / 3 / 5 / 10 分钟 */
export const DURATION_OPTIONS_MS = [60_000, 3 * 60_000, 5 * 60_000, 10 * 60_000]
export const DEFAULT_DURATION_MS = NORMAL_DURATION_MS

/** 时长的人话标签：不足 1 分钟按秒，否则按分钟 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  return `${Math.round(totalSeconds / 60)} 分钟`
}
