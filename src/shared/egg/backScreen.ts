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

interface AtomicToolResult {
  isError?: boolean
  content?: unknown
  structuredContent?: Record<string, unknown> | null
}

interface AtomicMcp {
  connect(): Promise<unknown>
  callTool(name: string, args: Record<string, unknown>): Promise<AtomicToolResult>
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

export interface BackScreenResult {
  ok: boolean
  reason: BackScreenReason
  /** 是否为预览模拟桥返回（页面据此显示「预览模拟」标识） */
  simulated: boolean
}

export type BackScreenMode = 'device' | 'simulated' | 'unavailable'

let mode: BackScreenMode | null = null
let connecting: Promise<BackScreenMode> | null = null

function hasMcpObject(): boolean {
  return typeof window !== 'undefined' && typeof window.mcp?.callTool === 'function'
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
    connecting = (async () => {
      if (hasMcpObject()) {
        try {
          await window.mcp!.connect()
          mode = 'device'
          return mode
        } catch {
          // connect 失败：按不可用处理，由页面给重试入口
          mode = 'unavailable'
          return mode
        }
      }
      mode = import.meta.env.DEV ? 'simulated' : 'unavailable'
      return mode
    })().finally(() => {
      connecting = null
    })
  }
  return connecting
}

/** 重置模式缓存（真机重试入口用） */
export function resetBackScreenMode(): void {
  mode = null
  connecting = null
}

function fail(reason: BackScreenReason, simulated = false): BackScreenResult {
  return { ok: false, reason, simulated }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<BackScreenResult> {
  const current = await resolveBackScreenMode()
  if (current === 'unavailable') return fail('unavailable')
  if (current === 'simulated') {
    // 预览模拟桥：不产生真实设备效果，仅让主屏联调流程走通
    return { ok: true, reason: 'ok', simulated: true }
  }
  try {
    const result = await window.mcp!.callTool(name, args)
    if (result?.isError) return fail('call-failed')
    return { ok: true, reason: 'ok', simulated: false }
  } catch {
    return fail('call-failed')
  }
}

/** 提交一帧 17×23 点阵（0 灭、非 0 亮） */
export async function pushFrame(frame: MatrixFrame): Promise<BackScreenResult> {
  if (!Array.isArray(frame) || frame.length !== MATRIX_SIZE) return fail('invalid-frame')
  return callTool('set_back_screen_frame', { frame })
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
