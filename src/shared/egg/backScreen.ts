/* =============================================================================
 * 背屏（背面点阵屏）接入层 —— 本工程唯一的背屏出口。
 *
 * 平台事实（连接器 ic_atomic_990001「背面点阵屏」，2026-11-04 目录快照）：
 *   - 走独立的原子 MCP 桥 window.mcp，不属于 capsule.invoke 接口索引；
 *   - 调用前先 await window.mcp.connect() 检查设备服务，仅有对象不代表可用；
 *   - set_back_screen_frame 入参 { frame: number[391] }：17 列 × 23 行行优先一维
 *     亮度数组（下标 y*17+x），元素 0–255，0 为灭；该版本不支持 text 参数；
 *   - clear_back_screen_frame 清除自定义帧并恢复 agent 状态显示；wake_up_back_screen /
 *     sleep_back_screen 点亮 / 熄灭背屏；
 *   - Promise 拒绝或 isError=true 都按失败处理；错误原因不向用户透传原文。
 *
 * 环境分层：
 *   - 真机 APK：window.mcp 可用，走真实提交；
 *   - 浏览器预览（dev）：没有 window.mcp，用模拟桥（页面显著标识「预览模拟」）；
 *   - 生产构建无壳：明确不可用，不假装成功（主屏预览顶上）。
 * ========================================================================== */

import type { MatrixFrame } from './types'
import { MATRIX_SIZE } from './types'

interface AtomicMcp {
  connect(): Promise<unknown>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

declare global {
  interface Window {
    mcp?: AtomicMcp
  }
}

export type BackScreenReason =
  | 'ok'
  | 'unavailable' // 当前环境没有背屏（浏览器 / 无壳）
  | 'connect-failed' // connect 失败或桥不可用
  | 'call-failed' // 提交 / 清除失败
  | 'invalid-frame'
  | 'invalid-response'
  | 'timeout' // 已提示超时，但原生请求可能仍在执行，不能视为已取消

export interface BackScreenResult {
  ok: boolean
  reason: BackScreenReason
  /** 是否为预览模拟桥返回（页面据此显示「预览模拟」标识） */
  simulated: boolean
}

export type BackScreenMode = 'device' | 'simulated' | 'unavailable'

let mode: BackScreenMode | null = null
let connecting: Promise<BackScreenMode> | null = null
let connectionGeneration = 0
let unavailableReason: BackScreenReason = 'unavailable'

/** 只记录固定诊断分类与数字错误码，绝不输出回执文本、帧或异常原文。 */
function diagnose(operation: string, code: string, errorCode?: unknown): void {
  const numericCode = typeof errorCode === 'number' && Number.isFinite(errorCode) ? ' errorCode=' + errorCode : ''
  console.warn('[back-screen] connector=ic_atomic_990001 operation=' + operation + ' code=' + code + numericCode)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasAcknowledgment(value: unknown): boolean {
  // 设备可能返回中文文本，也可能使用 text/MCP 包装；不依赖解析出的结构化字段。
  if (typeof value === 'string') return value.trim().length > 0
  if (!isObject(value)) return false
  if (value.isError === false) return true
  if (typeof value.text === 'string' && value.text.trim().length > 0) return true
  if (Array.isArray(value.content)) return true
  return isObject(value.structuredContent)
}

/**
 * 解析当前背屏模式（带缓存）：
 * - 有 window.mcp 且 connect 成功 → device；
 * - dev 预览没有桥 → simulated（模拟提交，页面显著标识）；
 * - 生产构建没有桥 → unavailable（不假装成功）。
 */
export async function resolveBackScreenMode(): Promise<BackScreenMode> {
  if (mode) return mode
  if (!connecting) {
    const generation = connectionGeneration
    const remember = (next: BackScreenMode, reason: BackScreenReason = 'unavailable') => {
      // 手动重连后，旧连接的迟到结果不能覆盖新的连接状态。
      if (generation === connectionGeneration) {
        mode = next
        unavailableReason = reason
      }
      return next
    }
    connecting = (async () => {
      const bridge = typeof window === 'undefined' ? undefined : window.mcp
      if (bridge) {
        if (typeof bridge.callTool !== 'function' || typeof bridge.connect !== 'function') {
          diagnose('connect', 'bridge-incomplete')
          return remember('unavailable')
        }
        try {
          const result = await bridge.connect()
          // connect 的成功载荷未定义，void 仍兼容；明确失败绝不缓存为 device。
          if (result === false || (isObject(result) && result.isError === true)) {
            diagnose('connect', 'connect-failed', isObject(result) ? result.errorCode : undefined)
            return remember('unavailable', 'connect-failed')
          }
          return remember('device')
        } catch {
          diagnose('connect', 'connect-rejected')
          return remember('unavailable', 'connect-failed')
        }
      }
      return remember(import.meta.env.DEV ? 'simulated' : 'unavailable')
    })().finally(() => {
      if (generation === connectionGeneration) connecting = null
    })
  }
  return connecting
}

/** 重置模式缓存（真机重试入口用） */
export function resetBackScreenMode(): void {
  connectionGeneration += 1
  mode = null
  connecting = null
  unavailableReason = 'unavailable'
}

function fail(reason: BackScreenReason, simulated = false): BackScreenResult {
  return { ok: false, reason, simulated }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<BackScreenResult> {
  const generation = connectionGeneration
  const current = await resolveBackScreenMode()
  if (generation !== connectionGeneration) return fail('connect-failed')
  if (current === 'unavailable') {
    diagnose(name, unavailableReason)
    return fail(unavailableReason)
  }
  if (current === 'simulated') {
    // 预览模拟桥：不产生真实设备效果，仅让主屏联调流程走通
    return { ok: true, reason: 'ok', simulated: true }
  }
  try {
    const result = await window.mcp!.callTool(name, args)
    if (isObject(result) && result.isError === true) {
      diagnose(name, 'tool-is-error', result.errorCode)
      return fail('call-failed')
    }
    if (!hasAcknowledgment(result)) {
      diagnose(name, 'invalid-response')
      return fail('invalid-response')
    }
    return { ok: true, reason: 'ok', simulated: false }
  } catch {
    diagnose(name, 'tool-rejected')
    return fail('call-failed')
  }
}

/** 提交一帧 17×23 点阵（0 灭、非 0 亮） */
export async function pushFrame(frame: MatrixFrame): Promise<BackScreenResult> {
  if (!Array.isArray(frame) || frame.length !== MATRIX_SIZE) {
    diagnose('set_back_screen_frame', 'invalid-frame')
    return fail('invalid-frame')
  }
  // 不能用 every：它会跳过稀疏数组中的空槽。
  for (let index = 0; index < MATRIX_SIZE; index += 1) {
    if (!Number.isInteger(frame[index]) || frame[index] < 0 || frame[index] > 255) {
      diagnose('set_back_screen_frame', 'invalid-frame')
      return fail('invalid-frame')
    }
  }
  return callTool('set_back_screen_frame', { frame: frame.slice() })
}

/** 清除背屏自定义帧，恢复系统 agent 状态显示 */
export async function clearFrame(): Promise<BackScreenResult> {
  return callTool('clear_back_screen_frame', {})
}

/** 点亮背屏（不改变总开关） */
export async function wakeBackScreen(): Promise<BackScreenResult> {
  return callTool('wake_up_back_screen', {})
}

/** 熄灭背屏 */
export async function sleepBackScreen(): Promise<BackScreenResult> {
  return callTool('sleep_back_screen', {})
}
