/* =============================================================================
 * 本地记录：一份带版本号的记录保存 settings、当前 session 和各角色的计数
 * （PRD 06 章「本地最小数据」）。写入统一串行排队，避免竞态覆盖。
 *
 * native 走壳的 setStorage / getStorage（需已同意隐私协议）；
 * 浏览器 / PWA 由 bridge 的 browser adapter 落到 localStorage。
 * 读取失败或记录损坏时保留原数据，由调用方阻止覆盖并提供重新读取入口。
 * ========================================================================== */

import { invokeNative } from '@/shared/bridge'
import { PET_BY_ID } from './pets'
import { DEFAULT_DURATION_MS, isValidDuration, PET_TIERS, PHASE_LABEL, tierForDuration } from './types'
import type { EggPhase, EggRecord, EggSession, PetCount, PetTier } from './types'

export const RECORD_VERSION = 2
// key 保持不变，版本迁移只更新内容，避免已有收藏被遗留在旧 key 下。
const RECORD_KEY = 'egg.record.v1'

export function defaultRecord(): EggRecord {
  return {
    version: RECORD_VERSION,
    settings: { sound: false, flipReveal: false, lastDurationMs: DEFAULT_DURATION_MS, privacyAgreed: null, backScreenPetId: null },
    session: null,
    collection: {},
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPhase(value: unknown): value is EggPhase {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PHASE_LABEL, value)
}

/** 纯解析/迁移：旧局保留既定角色与时间，收藏次数、日期不重新计算。 */
export function migrateRecord(value: unknown): EggRecord | null {
  if (!isObject(value) || (value.version !== 1 && value.version !== RECORD_VERSION)) return null
  if (!isObject(value.settings) || !isObject(value.collection)) return null

  const collection: Record<string, PetCount> = {}
  for (const [petId, entry] of Object.entries(value.collection)) {
    if (!isObject(entry) || typeof entry.count !== 'number' ||
      !Number.isSafeInteger(entry.count) || entry.count < 0 ||
      (entry.lastRevealedAt !== null && !isTimestamp(entry.lastRevealedAt))) return null
    Object.defineProperty(collection, petId, {
      value: { count: entry.count, lastRevealedAt: entry.lastRevealedAt },
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  let session: EggSession | null = null
  if (value.session != null) {
    const s = value.session
    if (!isObject(s) || typeof s.sessionId !== 'string' || !s.sessionId ||
      !isTimestamp(s.startedAt) || !isTimestamp(s.deadlineAt) ||
      !isTimestamp(s.durationMs) || s.durationMs <= 0 ||
      typeof s.petId !== 'string' || !Object.prototype.hasOwnProperty.call(PET_BY_ID, s.petId) ||
      !isPhase(s.phase) || (s.revealedAt !== null && !isTimestamp(s.revealedAt)) ||
      !Array.isArray(s.hintedPhases) || !s.hintedPhases.every(isPhase)) return null

    const tier = value.version === 1 ? null : s.tier
    if (tier !== null && (typeof tier !== 'string' || !PET_TIERS.includes(tier as PetTier))) return null
    if (tier !== null && (!isValidDuration(s.durationMs) || tierForDuration(s.durationMs) !== tier ||
      PET_BY_ID[s.petId].tier !== tier)) return null

    session = {
      sessionId: s.sessionId,
      tier: tier as PetTier | null,
      durationMs: s.durationMs,
      startedAt: s.startedAt,
      deadlineAt: s.deadlineAt,
      petId: s.petId,
      phase: s.phase,
      revealedAt: s.revealedAt,
      hintedPhases: [...s.hintedPhases],
    }
  }

  const settings = value.settings
  return {
    version: RECORD_VERSION,
    settings: {
      sound: settings.sound === true,
      flipReveal: settings.flipReveal === true,
      lastDurationMs: isValidDuration(settings.lastDurationMs) ? settings.lastDurationMs : DEFAULT_DURATION_MS,
      privacyAgreed: typeof settings.privacyAgreed === 'boolean' ? settings.privacyAgreed : null,
      backScreenPetId: typeof settings.backScreenPetId === 'string' &&
        Object.prototype.hasOwnProperty.call(PET_BY_ID, settings.backScreenPetId) &&
        collection[settings.backScreenPetId]?.count > 0 ? settings.backScreenPetId : null,
    },
    session,
    collection,
  }
}

/** 迁移已在内存完成，但保存失败：上层继续使用 record，并提供重试保存入口。 */
export class RecordMigrationError extends Error {
  readonly record: EggRecord

  constructor(record: EggRecord) {
    super('原有记录还没保存，请重试')
    this.name = 'RecordMigrationError'
    this.record = record
  }
}

/** 仅明确不存在（data: null）返回 null；失败或未知格式不能当作空收藏覆盖。 */
export async function loadRecord(): Promise<EggRecord | null> {
  const { data } = await invokeNative('getStorage', { key: RECORD_KEY })
  if (data === null) return null
  const record = migrateRecord(data)
  if (!record) throw new Error('本地记录格式暂时无法读取')
  if (isObject(data) && data.version === 1) {
    try {
      await saveRecord(record)
    } catch {
      throw new RecordMigrationError(record)
    }
  }
  return record
}

let writeChain: Promise<void> = Promise.resolve()

/** 串行写入；任一环失败即 reject（调用方保留内存结果并提示重试） */
export function saveRecord(record: EggRecord): Promise<void> {
  const run = writeChain.then(async () => {
    await invokeNative('setStorage', { key: RECORD_KEY, data: record })
  })
  writeChain = run.catch(() => undefined)
  return run
}

export function emptyCount(): PetCount {
  return { count: 0, lastRevealedAt: null }
}
