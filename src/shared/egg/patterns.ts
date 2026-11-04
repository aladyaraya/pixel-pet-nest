/* =============================================================================
 * 17×23 点阵图案库：蛋的阶段形态（背屏与主屏预览共用同一份图案）。
 * 图案按 17 列 × 23 行绘制，'#' 点亮、'.' 熄灭；四周留安全边距。
 * 阶段（PRD 03 章）：
 *   等待 0–50%   完整蛋壳（轻晃：2 帧交替、约每秒 1 帧）
 *   快了 50–85% 一条较粗裂纹
 *   快出来了 85–100% 裂纹扩展、蛋壳上部略偏移
 *   可揭晓 到期后 裂开的蛋壳 + 问号
 * ========================================================================== */

import { carveLine, patternToFrame, shiftFrame, drawLine } from './matrix'
import type { MatrixFrame } from './types'

/** 完整蛋壳（居中的蛋形，上下留安全边距） */
const EGG_FULL = [
  '.................',
  '.................',
  '.................',
  '......#####......',
  '.....#######.....',
  '....#########....',
  '....##########...',
  '...############..',
  '...############..',
  '...############..',
  '...############..',
  '...############..',
  '...############..',
  '...############..',
  '....##########...',
  '....#########....',
  '.....#######.....',
  '......#####......',
  '......####.......',
  '......####.......',
  '......####.......',
  '.................',
  '.................',
]

/** 裂开的蛋壳：左右两半，中间留给问号 */
const EGG_SHELL_BROKEN = [
  '.................',
  '.................',
  '.#####.....#####.',
  '.#####.....#####.',
  '.######...######.',
  '.######...######.',
  '.#######.#######.',
  '.#######.#######.',
  '.#######.#######.',
  '.#######.#######.',
  '.#######.#######.',
  '.#######.#######.',
  '.#######.#######.',
  '.######...######.',
  '.######...######.',
  '.#####.....#####.',
  '.#####.....#####.',
  '.####.......####.',
  '.####.......####.',
  '.................',
  '.................',
  '.................',
  '.................',
]

function eggFullFrame(): MatrixFrame {
  return patternToFrame(EGG_FULL)
}

/** 快了：一条较粗裂纹（蛋壳上不亮的折线缝隙，2 格宽） */
function eggCrackFrame(): MatrixFrame {
  const frame = eggFullFrame()
  return carveLine(frame, [
    [10, 4],
    [11, 6],
    [9, 8],
    [10, 10],
    [9, 12],
  ], 0)
}

/** 快出来了：裂纹扩展 + 蛋壳上部略偏移（右上块移位形成错位） */
function eggAlmostFrame(): MatrixFrame {
  let frame = eggFullFrame()
  frame = shiftFrame(frame, 1, 0, { x0: 9, y0: 0, x1: 16, y1: 7 })
  frame = carveLine(frame, [
    [12, 3],
    [10, 5],
    [12, 7],
    [10, 9],
    [11, 12],
    [9, 14],
    [10, 17],
  ], 1)
  frame = carveLine(frame, [
    [12, 7],
    [14, 8],
  ], 0)
  return frame
}

/** 可揭晓：裂开的蛋壳 + 问号 */
function eggBrokenFrame(): MatrixFrame {
  let frame = patternToFrame(EGG_SHELL_BROKEN)
  frame = drawLine(frame, [
    [6, 4],
    [9, 4],
    [9, 6],
    [8, 7],
    [7, 8],
    [7, 9],
    [8, 10],
    [9, 11],
  ])
  frame = drawLine(frame, [
    [8, 13],
    [8, 14],
  ])
  return frame
}

let cached: {
  waiting: MatrixFrame
  wobble: MatrixFrame
  cracking: MatrixFrame
  almost: MatrixFrame
  ready: MatrixFrame
  readyAlt: MatrixFrame
} | null = null

function build(): NonNullable<typeof cached> {
  const waiting = eggFullFrame()
  const ready = eggBrokenFrame()
  return {
    waiting,
    // 轻晃 2 帧：蛋左右各偏 1 格（设备侧动画不可用时由 App 定时交替提交）
    wobble: shiftFrame(waiting, 1, 0),
    cracking: eggCrackFrame(),
    almost: eggAlmostFrame(),
    ready,
    // 破壳 2 帧的第二帧：两半壳再各向外让 1 格，露出更大的问号空间
    readyAlt: shiftFrame(ready, -1, 0, { x0: 0, y0: 0, x1: 8, y1: 22 }),
  }
}

/** 蛋的阶段图案（懒构建并缓存） */
export function eggFrames(): NonNullable<typeof cached> {
  if (!cached) cached = build()
  return cached
}

/** 按阶段取背屏主帧 */
export function frameForPhase(phase: string): MatrixFrame {
  const frames = eggFrames()
  switch (phase) {
    case 'cracking':
      return frames.cracking
    case 'almost':
      return frames.almost
    case 'ready':
    case 'revealed':
      return frames.ready
    default:
      return frames.waiting
  }
}
