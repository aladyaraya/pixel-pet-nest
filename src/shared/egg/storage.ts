/* =============================================================================
 * 本地记录：一份带版本号的记录保存 settings、当前 session 和 6 个角色的计数
 * （PRD 06 章「本地最小数据」）。写入统一串行排队，避免竞态覆盖。
 *
 * native 走壳的 setStorage / getStorage（需已同意隐私协议）；
 * 浏览器 / PWA 由 bridge 的 browser adapter 落到 localStorage。
 * 记录损坏或写入不可用时抛错，由调用方说明影响并允许临时体验。
 * ========================================================================== */

import { invokeNative, BridgeError } from '@/shared/bridge'
import { DEFAULT_DURATION_MS } from './types'
import type { EggRecord, EggSession, PetCount } from './types'

export const RECORD_VERSION = 1
const RECORD_KEY = 'egg.record.v1'

export function defaultRecord(): EggRecord {
  return {
    version: RECORD_VERSION,
    settings: { sound: false, flipReveal: false, lastDurationMs: DEFAULT_DURATION_MS, privacyAgreed: null },
    session: null,
    collection: {},
  }
}

function isValidRecord(value: unknown): value is EggRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<EggRecord>
  if (typeof record.version !== 'number') return false
  if (!record.settings || typeof record.settings !== 'object') return false
  const session = record.session
  if (session != null) {
    if (typeof session !== 'object') return false
    const s = session as Partial<EggSession>
    if (
      typeof s.sessionId !== 'string' ||
      typeof s.startedAt !== 'number' ||
      typeof s.deadlineAt !== 'number' ||
      typeof s.durationMs !== 'number' ||
      typeof s.petId !== 'string' ||
      typeof s.phase !== 'string' ||
      (s.revealedAt !== null && typeof s.revealedAt !== 'number') ||
      !Array.isArray(s.hintedPhases)
    ) {
      return false
    }
  }
  if (!record.collection || typeof record.collection !== 'object') return false
  return true
}

/** 读取本地记录；不存在 / 损坏时返回 null（调用方按「允许临时体验」处理） */
export async function loadRecord(): Promise<EggRecord | null> {
  try {
    const { data } = await invokeNative('getStorage', { key: RECORD_KEY })
    if (data == null) return null
    if (!isValidRecord(data)) return null
    return data
  } catch (error) {
    if (error instanceof BridgeError && error.code === 'privacy') throw error
    return null
  }
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
