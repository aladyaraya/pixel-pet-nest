/* =============================================================================
 * 17×23 点阵工具：图案定义（字符串画）→ 帧数组（行优先一维亮度数组）。
 * 背屏接口 set_back_screen_frame 的入参契约：长度必须为 391、元素 0–255、0 为灭。
 * ========================================================================== */

import { MATRIX_HEIGHT, MATRIX_SIZE, MATRIX_WIDTH, type MatrixFrame } from './types'

/** 把 17 列宽、23 行高的字符串画转成帧数组。'#' / '*' 为点亮，其余为灭 */
export function patternToFrame(rows: readonly string[]): MatrixFrame {
  if (rows.length !== MATRIX_HEIGHT) {
    throw new Error(`点阵图案必须为 ${MATRIX_HEIGHT} 行，实际 ${rows.length} 行`)
  }
  const frame: MatrixFrame = new Array(MATRIX_SIZE).fill(0)
  rows.forEach((row, y) => {
    if (row.length !== MATRIX_WIDTH) {
      throw new Error(`点阵图案第 ${y} 行必须为 ${MATRIX_WIDTH} 列，实际 ${row.length} 列`)
    }
    for (let x = 0; x < MATRIX_WIDTH; x += 1) {
      frame[y * MATRIX_WIDTH + x] = row[x] === '#' || row[x] === '*' ? 255 : 0
    }
  })
  return frame
}

/** 帧数组转回字符串画（调试与测试用） */
export function frameToPattern(frame: MatrixFrame): string[] {
  if (frame.length !== MATRIX_SIZE) {
    throw new Error(`帧长度必须为 ${MATRIX_SIZE}，实际 ${frame.length}`)
  }
  const rows: string[] = []
  for (let y = 0; y < MATRIX_HEIGHT; y += 1) {
    let row = ''
    for (let x = 0; x < MATRIX_WIDTH; x += 1) {
      row += frame[y * MATRIX_WIDTH + x] > 0 ? '#' : '.'
    }
    rows.push(row)
  }
  return rows
}

/** 剪影：把图案整体调暗为轮廓感（用于收藏页未遇见项），亮格保留、暗格不变 */
export function toSilhouette(frame: MatrixFrame, level = 90): MatrixFrame {
  return frame.map((v) => (v > 0 ? level : 0))
}

/** 原地平移一份图案（用于「上部略偏移」的裂纹阶段），返回新帧 */
export function shiftFrame(
  frame: MatrixFrame,
  dx: number,
  dy: number,
  region?: { x0: number; y0: number; x1: number; y1: number },
): MatrixFrame {
  const out: MatrixFrame = new Array(MATRIX_SIZE).fill(0)
  for (let y = 0; y < MATRIX_HEIGHT; y += 1) {
    for (let x = 0; x < MATRIX_WIDTH; x += 1) {
      const i = y * MATRIX_WIDTH + x
      if (frame[i] === 0) continue
      if (region && (x < region.x0 || x > region.x1 || y < region.y0 || y > region.y1)) {
        out[i] = frame[i]
        continue
      }
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < MATRIX_WIDTH && ny >= 0 && ny < MATRIX_HEIGHT) {
        out[ny * MATRIX_WIDTH + nx] = frame[i]
      }
    }
  }
  return out
}

/** 在帧上熄灭一段折线（裂纹 = 蛋壳上不亮的缝隙） */
export function carveLine(frame: MatrixFrame, points: ReadonlyArray<readonly [number, number]>, width = 1): MatrixFrame {
  const out = [...frame]
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let s = 0; s <= steps; s += 1) {
      const t = steps === 0 ? 0 : s / steps
      const cx = Math.round(x0 + (x1 - x0) * t)
      const cy = Math.round(y0 + (y1 - y0) * t)
      for (let ox = -width; ox <= width; ox += 1) {
        for (let oy = -width; oy <= width; oy += 1) {
          const nx = cx + ox
          const ny = cy + oy
          if (nx >= 0 && nx < MATRIX_WIDTH && ny >= 0 && ny < MATRIX_HEIGHT) {
            out[ny * MATRIX_WIDTH + nx] = 0
          }
        }
      }
    }
  }
  return out
}

/** 在帧上点亮一段折线（问号、叶脉等笔触） */
export function drawLine(frame: MatrixFrame, points: ReadonlyArray<readonly [number, number]>, width = 0): MatrixFrame {
  const out = [...frame]
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let s = 0; s <= steps; s += 1) {
      const t = steps === 0 ? 0 : s / steps
      const cx = Math.round(x0 + (x1 - x0) * t)
      const cy = Math.round(y0 + (y1 - y0) * t)
      for (let ox = -width; ox <= width; ox += 1) {
        for (let oy = -width; oy <= width; oy += 1) {
          const nx = cx + ox
          const ny = cy + oy
          if (nx >= 0 && nx < MATRIX_WIDTH && ny >= 0 && ny < MATRIX_HEIGHT) {
            out[ny * MATRIX_WIDTH + nx] = 255
          }
        }
      }
    }
  }
  return out
}
