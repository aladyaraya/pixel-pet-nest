/* =============================================================================
 * 孵蛋小应用的领域类型：一局孵化、阶段、角色与本地记录。
 * 计时以「保存的到期时间」为准，页面定时器只负责刷新（见 PRD 06 章）。
 * ========================================================================== */

/** 背屏 / 主屏共用的孵化阶段 */
export type EggPhase = 'waiting' | 'cracking' | 'almost' | 'ready' | 'revealed'

export const PET_TIERS = ['low', 'normal', 'high', 'ornate'] as const
export type PetTier = (typeof PET_TIERS)[number]

export const TIER_LABEL: Record<PetTier, string> = {
  low: '低级',
  normal: '普通',
  high: '高级',
  ornate: '华丽',
}

/** 一局孵化。字段与 PRD「本地最小数据」一致：至少包含这些字段 */
export interface EggSession {
  sessionId: string
  /** 开局时锁定；迁移的历史局没有等级，不重新抽取角色 */
  tier: PetTier | null
  /** 本局时长（ms），新局为 1 秒至 180 分钟的整秒数 */
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
  /** 上次选择的有效时长（ms），新一局默认沿用 */
  lastDurationMs: number
  /** 隐私同意状态缓存 */
  privacyAgreed: boolean | null
  /** 已拥有、用于背屏陪伴的宠物；旧记录默认不选择 */
  backScreenPetId?: string | null
}

export interface PetCount {
  count: number
  lastRevealedAt: number | null
}

/** 带版本号的本地记录：settings + 当前 session + 各角色的计数 */
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

export const MIN_DURATION_MS = 1_000
export const MAX_DURATION_MS = 180 * 60 * 1000
export const DEFAULT_DURATION_MS = 3 * 60 * 1000

export function isValidDuration(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isInteger(ms) &&
    ms >= MIN_DURATION_MS && ms <= MAX_DURATION_MS && ms % 1000 === 0
}

/** 等级仅由开局选择的时长确定，边界采用左闭右开区间。 */
export function tierForDuration(ms: number): PetTier {
  if (!isValidDuration(ms)) throw new RangeError('请选择 1 秒到 180 分钟之间的时长')
  if (ms < 3 * 60_000) return 'low'
  if (ms < 7 * 60_000) return 'normal'
  if (ms < 10 * 60_000) return 'high'
  return 'ornate'
}

/** 精确到秒；不把边界附近的时长四舍五入到另一等级。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes} 分钟 ${seconds} 秒` : `${minutes} 分钟`
}
