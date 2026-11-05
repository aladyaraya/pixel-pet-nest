/** Original pixel artwork. Source polygons are rasterised once onto an integer grid;
 * the renderer emits one orthogonal SVG path per paint, never thousands of DOM pixels. */
import type { EggPhase } from './types'

export type PixelMotion = 'idle-a' | 'idle-b' | 'tap' | 'hold'
export const PIXEL_PAINT = {
  K: 'ink', P: 'paper', C: 'cream', S: 'shell', H: 'shell-shade', U: 'sunlight',
  R: 'rose', T: 'terra', L: 'leaf', D: 'leaf-shade', B: 'sky', N: 'sky-shade',
  V: 'lavender', M: 'plum', G: 'gold', A: 'sand', O: 'cocoa', E: 'ground',
} as const
type Ink = keyof typeof PIXEL_PAINT
type Point = readonly [number, number]
export interface PixelImage {
  size: 32 | 64
  rows: readonly string[]
  paths: readonly { paint: string; d: string }[]
  silhouette: string
}
export interface PetPixelVisual {
  main: PixelImage
  thumbnail: PixelImage
  motions: Record<PixelMotion, readonly PixelImage[]>
}

class Pixels {
  readonly grid: string[][]
  constructor(readonly size: 32 | 64 = 64) {
    this.grid = Array.from({ length: size }, () => Array<string>(size).fill('.'))
  }
  dot(x: number, y: number, ink: Ink) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= this.size || y < 0 || y >= this.size) {
      throw new Error(`像素画越界：${this.size}×${this.size} (${x},${y})`)
    }
    this.grid[y][x] = ink
  }
  rect(x: number, y: number, w: number, h: number, ink: Ink) {
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) this.dot(px, py, ink)
  }
  line(points: readonly Point[], ink: Ink, width = 1) {
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i]
      const count = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
      for (let step = 0; step <= count; step += 1) {
        const t = count ? step / count : 0
        this.rect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), width, width, ink)
      }
    }
  }
  shape(points: readonly Point[], ink: Ink, outlined = true) {
    if (points.some(([x, y]) => !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > this.size || y > this.size)) {
      throw new Error('像素轮廓必须位于整数画布内')
    }
    const mask = new Set<number>()
    const minX = Math.max(0, Math.min(...points.map(([x]) => x)))
    const maxX = Math.min(this.size, Math.max(...points.map(([x]) => x)))
    const minY = Math.max(0, Math.min(...points.map(([, y]) => y)))
    const maxY = Math.min(this.size, Math.max(...points.map(([, y]) => y)))
    for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) {
      let inside = false
      for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
        const [ax, ay] = points[a], [bx, by] = points[b]
        if ((ay > y + .5) !== (by > y + .5) && x + .5 < (bx - ax) * (y + .5 - ay) / (by - ay) + ax) inside = !inside
      }
      if (inside) mask.add(y * this.size + x)
    }
    for (const index of mask) {
      const x = index % this.size, y = Math.floor(index / this.size)
      const edge = outlined && (!mask.has(index - 1) || !mask.has(index + 1) || !mask.has(index - this.size) || !mask.has(index + this.size))
      this.dot(x, y, edge ? 'K' : ink)
    }
  }
  image(): PixelImage {
    if (this.grid.some((row, y) => row.some((ink, x) => ink !== '.' && (x === 0 || y === 0 || x === this.size - 1 || y === this.size - 1)))) {
      throw new Error('像素画需要保留至少一格安全边距')
    }
    const paths = new Map<string, string[]>()
    const silhouette: string[] = []
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size;) {
        const ink = this.grid[y][x]
        let end = x + 1
        while (end < this.size && this.grid[y][end] === ink) end += 1
        if (ink !== '.') {
          const run = `M${x} ${y}h${end - x}v1h${x - end}z`
          const group = paths.get(ink) ?? []
          group.push(run); paths.set(ink, group); silhouette.push(run)
        }
        x = end
      }
    }
    return { size: this.size, rows: this.grid.map((row) => row.join('')),
      paths: [...paths].map(([ink, data]) => ({ paint: PIXEL_PAINT[ink as Ink], d: data.join('') })),
      silhouette: silhouette.join('') }
  }
}

interface Pose { motion: PixelMotion | null; step: number; value: number; hold: boolean; tap: boolean; blink: boolean }
function pose(motion: PixelMotion | null, frame: number): Pose {
  const beats = motion === 'tap' ? [1, 2, 3, 1, 0] : motion === 'hold' ? [1, 2, 3, 4, 2, 0] : [1, 2, 1, 0]
  const step = Math.max(0, Math.floor(frame)) % beats.length
  const value = motion ? beats[step] : 0
  return { motion, step, value, hold: motion === 'hold' && value > 0, tap: motion === 'tap' && value > 0,
    blink: value > 0 && (motion === 'idle-a' || motion === 'hold') }
}
function face(c: Pixels, x: number, y: number, p: Pose, gap = 10) {
  if (p.blink && p.motion === 'idle-a' && p.value > 0 && p.step !== 1) {
    c.rect(x, y + 1, 2, 1, 'K'); c.rect(x + gap, y + 1, 2, 1, 'K')
  } else if (p.blink) {
    c.line([[x - 1, y], [x, y + 1], [x + 2, y + 1]], 'K')
    c.line([[x + gap - 1, y + 1], [x + gap + 1, y + 1], [x + gap + 2, y]], 'K')
  } else {
    c.rect(x, y, 2, p.tap && p.step === 1 ? 1 : 3, 'K'); c.rect(x + gap, y, 2, 3, 'K')
    if (!p.tap) { c.dot(x, y, 'P'); c.dot(x + gap, y, 'P') }
  }
  c.rect(x - 3, y + 4, 3, 2, 'R'); c.rect(x + gap + 3, y + 4, 3, 2, 'R')
  c.line([[x + 4, y + 5], [x + 5, y + 6], [x + 7, y + 5]], 'K')
}
function star(c: Pixels, x: number, y: number, ink: Ink = 'G', large = false) {
  const r = large ? 3 : 2
  c.rect(x, y - r, 1, r * 2 + 1, ink); c.rect(x - r, y, r * 2 + 1, 1, ink)
  if (large) c.rect(x - 1, y - 1, 3, 3, ink)
  c.dot(x, y, 'P')
}
function heart(c: Pixels, x: number, y: number, ink: Ink = 'R') {
  c.shape([[x, y + 1], [x + 2, y], [x + 4, y + 2], [x + 6, y], [x + 8, y + 1], [x + 8, y + 4], [x + 4, y + 8], [x, y + 4]], ink, false)
}

function potato(c: Pixels, p: Pose) {
  const bend = p.hold ? 4 : p.motion === 'idle-b' || p.tap ? p.value : 0
  c.line([[31, 27], [32, 18], [29, 14]], 'D', 2)
  c.shape([[31, 22], [22, 21], [16, 15 - bend], [15, 8 + bend], [21, 8 + bend], [29, 13], [33, 20]], 'L')
  c.shape([[33, 21], [34, 13], [42, 7 + bend], [48, 7 + bend], [47, 15], [40, 21]], 'L')
  c.line([[20, 12 + bend], [29, 19]], 'D'); c.line([[43, 11 + bend], [35, 19]], 'D')
  c.shape([[23, 26], [35, 25], [45, 29], [50, 36], [51, 45], [47, 51], [38, 55], [24, 54], [15, 49], [12, 41], [15, 32]], 'A')
  c.shape([[44, 31], [48, 38], [48, 45], [43, 50], [28, 52], [18, 47], [21, 51], [34, 54], [45, 50], [49, 43]], 'O', false)
  c.line([[20, 31], [17, 35], [17, 39]], 'C', 2)
  c.rect(22, 46, 2, 1, 'O'); c.dot(42, 33, 'O'); c.rect(38, 49, 1, 2, 'O')
  face(c, 24, 36, p)
  if (p.hold && p.value > 2) heart(c, 46, 23)
}
function duck(c: Pixels, p: Pose) {
  const sit = p.hold ? Math.min(3, p.value) : 0, step = p.tap ? p.value % 2 : 0
  c.shape([[21, 48], [26, 48], [26, 53 - step * 2], [31, 55 - step * 2], [20, 55 - step * 2], [21, 52 - step * 2]], 'G')
  c.shape([[37, 48], [42, 48], [42, 52 + step], [48, 55], [36, 55], [37, 52]], 'G')
  c.shape([[11, 30 + sit], [8, 27 + sit], [8, 35 + sit], [13, 43 + sit], [22, 49 + sit], [37, 50 + sit], [45, 45 + sit], [49, 36 + sit], [44, 29 + sit], [32, 27 + sit], [24, 30 + sit]], 'S')
  c.shape([[15, 39 + sit], [22, 44 + sit], [35, 45 + sit], [44, 40 + sit], [41, 46 + sit], [34, 48 + sit], [23, 47 + sit]], 'C', false)
  c.shape([[30, 13 + sit], [37, 10 + sit], [44, 13 + sit], [48, 20 + sit], [46, 28 + sit], [40, 33 + sit], [28, 31 + sit], [26, 23 + sit], [27, 17 + sit]], 'S')
  c.line([[32, 12 + sit], [31, 8 + sit], [34, 6 + sit]], 'K'); c.line([[35, 11 + sit], [37, 7 + sit], [40, 7 + sit]], 'K')
  c.shape([[44, 21 + sit], [55, 22 + sit], [58, 25 + sit], [55, 28 + sit], [44, 28 + sit]], 'G')
  c.line([[47, 25 + sit], [54, 25 + sit]], 'T')
  if (p.blink) c.line([[39, 18 + sit], [41, 19 + sit], [43, 18 + sit]], 'K')
  else { c.rect(40, 17 + sit, 2, 3, 'K'); c.dot(40, 17 + sit, 'P') }
  c.rect(38, 23 + sit, 4, 2, 'R')
  const wing = p.tap ? p.value + 2 : p.hold ? p.value : p.motion === 'idle-b' ? p.value : 0
  c.shape([[23, 35 + sit], [30, 32 + sit - wing], [37, 33 + sit - wing], [37, 38 + sit], [30, 42 + sit], [25, 40 + sit]], 'H')
  c.line([[27, 36 + sit], [31, 37 + sit], [34, 36 + sit]], 'C')
}
function ghost(c: Pixels, p: Pose) {
  const hide = p.hold ? p.value : 0, lift = p.tap ? p.value + 1 : p.motion === 'idle-b' ? p.value : 0
  c.shape([[16, 28], [10, 33], [12, 37], [18, 33]], 'H')
  c.shape([[47, 28], [54, 32], [52, 36], [46, 33]], 'H')
  c.shape([[17, 22], [47, 22], [50, 51], [44, 48], [40, 53], [33, 49], [28, 53], [22, 49], [15, 52]], 'A')
  c.rect(19, 27, 3, 16, 'C'); c.rect(44, 29, 3, 17, 'O')
  c.line([[22, 24], [42, 24]], 'O')
  if (hide > 1) {
    c.shape([[16, 24], [31, 24 - hide], [48, 24], [45, 28], [18, 28]], 'H')
    face(c, 24, 35 + hide, p)
  } else {
    c.shape([[17, 24], [12, 15 - lift], [25, 17 - lift], [32, 24], [25, 27]], 'S')
    c.shape([[32, 24], [39, 16 - lift], [53, 14 - lift], [47, 24], [38, 28]], 'S')
    c.line([[24, 18 - lift], [25, 23]], 'O'); c.line([[40, 18 - lift], [39, 23]], 'O')
    face(c, 24, 33, p)
  }
  c.rect(39, 43, 5, 1, 'O'); c.rect(40, 46, 3, 1, 'O')
  if (p.tap && p.value > 1) star(c, 55, 21, 'G')
}
function cloud(c: Pixels, p: Pose) {
  const tuck = p.hold ? 2 : 0
  c.shape([[10, 31], [13, 26], [19, 25], [20, 19], [25, 16], [31, 17], [35, 22], [40, 19], [47, 20], [51, 26], [51, 31], [57, 34], [58, 40], [54, 47], [45, 50], [18, 50], [10, 46], [6, 39], [7, 34]], 'B')
  c.shape([[10, 35], [15, 31], [23, 33], [23, 24 + tuck], [28, 21 + tuck], [33, 25 + tuck], [35, 30], [42, 25], [47, 28], [47, 34], [53, 36], [53, 42], [47, 46], [18, 46], [11, 42]], 'P', false)
  face(c, 23, 35 + tuck, { ...p, blink: p.motion === 'idle-a' && p.value > 0 ? p.step !== 1 : !p.tap || p.step !== 1 })
  c.line([[17, 48], [23, 49]], 'N'); c.line([[42, 48], [48, 46]], 'N')
  const b = p.motion === 'idle-b' || p.hold || p.tap ? p.value : 0
  c.shape([[46, 17 - b], [47, 11 - b], [50, 9 - b], [55, 10 - b], [57, 14 - b], [54, 18 - b], [49, 18 - b], [45, 21 - b]], 'C')
  c.line([[50, 12 - b], [53, 12 - b], [50, 15 - b], [53, 15 - b]], 'N')
  if (p.hold && p.value > 2) star(c, 12, 23, 'G')
}
function question(c: Pixels, p: Pose) {
  c.shape([[22, 30], [38, 29], [46, 34], [50, 41], [49, 49], [42, 55], [24, 56], [15, 51], [12, 43], [15, 35]], 'R')
  c.shape([[43, 34], [47, 41], [46, 48], [40, 52], [24, 53], [19, 50], [23, 54], [40, 54], [48, 49], [49, 41]], 'T', false)
  c.line([[21, 34], [18, 38], [18, 41]], 'C', 2)
  face(c, 23, 40, p)
  if (p.hold) {
    heart(c, 27, 15, 'M'); heart(c, 28, 15, 'V')
    if (p.value > 2) star(c, 42, 18, 'G')
  } else {
    const hop = p.tap ? p.value + 1 : p.motion === 'idle-b' ? p.value : 0
    c.shape([[24, 9 - hop], [28, 6 - hop], [37, 6 - hop], [41, 10 - hop], [41, 16 - hop], [34, 21 - hop], [34, 24 - hop], [29, 24 - hop], [29, 18 - hop], [35, 14 - hop], [35, 11 - hop], [30, 11 - hop], [29, 14 - hop], [24, 14 - hop]], 'M')
    c.rect(30, 26 - hop, 4, 3, 'M'); c.rect(28, 8 - hop, 7, 1, 'V')
  }
}
function tiny(c: Pixels, p: Pose) {
  const rise = p.tap || p.motion === 'idle-b' ? -p.value : p.hold ? p.value : 0
  c.shape([[29, 14 + rise], [35, 14 + rise], [39, 20 + rise], [43, 29 + rise], [44, 38 + rise], [39, 45 + rise], [25, 45 + rise], [20, 38 + rise], [21, 29 + rise], [25, 20 + rise]], 'S')
  c.line([[28, 21 + rise], [25, 27 + rise], [24, 31 + rise]], 'P', 2)
  face(c, 26, 29 + rise, p, 9)
  c.shape([[14, 37], [20, 41], [25, 36], [31, 41], [37, 36], [43, 41], [50, 37], [49, 47], [43, 54], [33, 57], [22, 54], [16, 47]], 'C')
  c.shape([[46, 44], [43, 49], [34, 53], [24, 51], [20, 48], [23, 53], [33, 55], [42, 53], [47, 47]], 'H', false)
  c.rect(23, 44, 2, 2, 'A'); c.rect(37, 49, 2, 2, 'A')
  if (p.hold && p.value > 2) heart(c, 44, 25)
}

function cat(c: Pixels, p: Pose) {
  const curl = p.hold
  const tail = p.tap || p.motion === 'idle-b' || p.hold ? p.value : 0
  c.shape([[40, 51], [48, 51], [53, 47], [54, 39], [51 - tail, 33], [49 - tail, 31], [53, 32], [57, 38], [58, 45], [54, 53], [47, 57], [37, 56]], 'G')
  c.line([[49, 53], [54, 48], [55, 42]], 'C')
  c.shape(curl ? [[22, 34], [38, 33], [47, 39], [49, 48], [44, 54], [23, 56], [15, 51], [15, 42]] : [[24, 31], [35, 31], [39, 37], [43, 50], [40, 55], [17, 55], [16, 50], [19, 39]], 'V')
  c.shape(curl ? [[26, 43], [39, 42], [42, 48], [38, 52], [25, 52]] : [[25, 36], [33, 36], [36, 43], [36, 51], [23, 51], [23, 43]], 'C', false)
  const y = curl ? 9 + Math.min(3, p.value) : 0
  c.shape([[14, 22 + y], [14, 9 + y], [23, 15 + y], [33, 15 + y], [42, 9 + y], [43, 24 + y], [40, 31 + y], [33, 35 + y], [23, 34 + y], [16, 29 + y]], 'V')
  c.shape([[17, 15 + y], [18, 22 + y], [23, 19 + y]], 'R', false)
  c.shape([[39, 15 + y], [39, 22 + y], [34, 19 + y]], 'R', false)
  face(c, 22, 23 + y, p, 10)
  c.rect(29, 20 + y, 2, 2, 'G'); c.rect(30, 19 + y, 2, 1, 'G')
  c.line([[13, 28 + y], [18, 29 + y]], 'K'); c.line([[39, 29 + y], [45, 28 + y]], 'K')
  if (!curl) { c.line([[25, 47], [25, 54]], 'M'); c.line([[34, 47], [34, 54]], 'M') }
}
function fawn(c: Pixels, p: Pose) {
  c.shape([[26, 33], [38, 33], [43, 39], [43, 49], [39, 52], [25, 51], [22, 44]], 'A')
  c.shape([[24, 46], [29, 46], [29, 57], [22, 57]], 'A'); c.shape([[36, 46], [42, 46], [44, 57], [36, 57]], 'A')
  c.rect(22, 54, 7, 3, 'O'); c.rect(36, 54, 8, 3, 'O')
  c.shape([[29, 35], [35, 35], [37, 44], [32, 49], [27, 45]], 'C', false)
  c.rect(25, 39, 2, 2, 'P'); c.rect(39, 42, 2, 2, 'P')
  const down = p.hold ? p.value : p.tap ? 1 : 0
  c.line([[25, 22 + down], [23, 12 + down], [18, 8 + down], [18, 4 + down]], 'K', 2)
  c.line([[23, 13 + down], [26, 8 + down], [26, 5 + down]], 'K', 2)
  c.line([[39, 22 + down], [41, 12 + down], [46, 8 + down], [46, 4 + down]], 'K', 2)
  c.line([[41, 13 + down], [38, 8 + down], [38, 5 + down]], 'K', 2)
  c.line([[25, 21 + down], [24, 13 + down]], 'G'); c.line([[40, 21 + down], [41, 13 + down]], 'G')
  star(c, 18, 5 + down, p.motion === 'idle-b' && p.step === 0 ? 'C' : 'G', p.tap)
  star(c, 47, 5 + down, p.motion === 'idle-b' && p.step === 1 ? 'C' : 'G', p.tap)
  c.shape([[25, 23 + down], [17, 17 + down], [11, 18 + down], [14, 24 + down], [23, 27 + down]], 'A')
  c.shape([[39, 23 + down], [47, 17 + down], [53, 18 + down], [50, 24 + down], [41, 27 + down]], 'A')
  c.line([[16, 20 + down], [23, 24 + down]], 'R'); c.line([[48, 20 + down], [41, 24 + down]], 'R')
  c.shape([[25, 20 + down], [39, 20 + down], [44, 26 + down], [41, 34 + down], [35, 39 + down], [28, 39 + down], [21, 33 + down], [20, 26 + down]], 'A')
  c.shape([[27, 31 + down], [36, 31 + down], [39, 35 + down], [35, 38 + down], [28, 37 + down], [25, 35 + down]], 'C', false)
  face(c, 25, 27 + down, p, 11); c.rect(30, 32 + down, 4, 2, 'O')
}
function penguin(c: Pixels, p: Pose) {
  const flap = p.tap ? p.value + 1 : p.motion === 'idle-b' ? p.value : 0
  c.shape([[24, 27], [15, 31 - flap], [7, 46 - flap], [17, 43], [23, 48], [32, 44], [42, 48], [48, 43], [57, 46 - flap], [49, 31 - flap], [40, 27]], 'M')
  c.shape([[17, 34 - flap], [11, 42 - flap], [18, 39], [24, 43], [27, 32]], 'V', false)
  c.shape([[46, 34 - flap], [52, 42 - flap], [45, 39], [40, 43], [36, 32]], 'V', false)
  c.shape([[24, 12], [31, 9], [39, 12], [43, 19], [43, 29], [47, 39], [45, 49], [39, 54], [25, 54], [19, 49], [18, 40], [22, 29], [21, 20]], 'N')
  c.shape([[25, 22], [28, 19], [32, 23], [36, 19], [40, 22], [39, 29], [42, 37], [41, 46], [36, 50], [27, 49], [23, 44], [23, 35]], 'C', false)
  face(c, 26, 24, p, 10)
  c.shape([[29, 29], [35, 29], [36, 31], [32, 34], [28, 31]], 'G')
  c.shape([[23, 52], [28, 52], [29, 57], [19, 57]], 'G'); c.shape([[36, 52], [41, 52], [45, 57], [35, 57]], 'G')
  if (p.hold) {
    const fold = Math.min(3, p.value)
    c.shape([[20, 31], [27 + fold, 36], [32 + fold, 44], [32, 51], [23, 49], [19, 43]], 'M')
    c.shape([[43, 31], [36 - fold, 36], [31 - fold, 45], [32, 51], [41, 49], [45, 43]], 'V')
    c.line([[40 - fold, 39], [32, 44 + fold]], 'M')
  }
  c.rect(28, 34, 8, 3, 'M'); c.rect(31, 34, 2, 2, 'G')
}
function phoenix(c: Pixels, p: Pose) {
  const wing = p.hold ? 6 : p.tap ? -p.value * 2 : p.motion === 'idle-b' ? p.value : 0
  c.shape([[29, 39], [29, 48], [23, 57], [18, 58], [24, 49], [25, 41]], 'T')
  c.shape([[31, 40], [35, 40], [36, 51], [33, 60], [30, 52]], 'G')
  c.shape([[36, 40], [40, 42], [42, 49], [49, 57], [44, 58], [37, 51]], 'T')
  c.line([[28, 45], [23, 53]], 'G'); c.line([[38, 45], [44, 54]], 'G')
  if (p.hold) {
    const fold = Math.min(3, p.value)
    c.shape([[28, 29], [23, 30], [19 + fold, 27], [18 + fold, 35], [15 + fold, 38], [20, 40], [20, 45], [26, 44], [29, 39]], 'T')
    c.shape([[37, 29], [42, 30], [46 - fold, 27], [47 - fold, 35], [50 - fold, 38], [45, 40], [45, 45], [39, 44], [36, 39]], 'T')
    c.line([[23, 34], [22, 40], [26, 41]], 'G', 2); c.line([[42, 34], [43, 40], [39, 41]], 'G', 2)
  } else {
    c.shape([[28, 29], [21, 27 + wing], [12, 20 + wing], [5, 18 + wing], [8, 29 + wing], [5, 28 + wing], [10, 37 + wing], [8, 38 + wing], [18, 44], [28, 42]], 'T')
    c.shape([[37, 29], [44, 27 + wing], [52, 20 + wing], [59, 18 + wing], [56, 29 + wing], [59, 28 + wing], [54, 37 + wing], [56, 38 + wing], [46, 44], [37, 42]], 'T')
    c.shape([[26, 32], [18, 31 + wing], [10, 24 + wing], [13, 33 + wing], [21, 39], [27, 39]], 'G', false)
    c.shape([[39, 32], [47, 31 + wing], [54, 24 + wing], [51, 33 + wing], [43, 39], [38, 39]], 'G', false)
    c.line([[11, 32 + wing], [22, 40]], 'H'); c.line([[53, 32 + wing], [43, 40]], 'H')
  }
  c.shape([[30, 22], [37, 23], [40, 33], [37, 44], [30, 46], [26, 40], [27, 30]], 'G')
  c.shape([[31, 28], [35, 28], [36, 37], [32, 41], [29, 36]], 'C', false)
  c.shape([[29, 12], [36, 10], [41, 14], [42, 21], [37, 26], [30, 26], [26, 21], [26, 16]], 'G')
  c.shape([[40, 18], [47, 20], [40, 23]], 'H')
  if (p.blink) c.line([[35, 17], [37, 18], [39, 17]], 'K')
  else { c.rect(36, 16, 2, 3, 'K'); c.dot(36, 16, 'P') }
  c.rect(34, 21, 3, 2, 'R')
  const crown = p.hold ? p.value % 2 : 0
  c.shape([[28, 13], [22, 7 - crown], [24, 4], [31, 9], [32, 3], [35, 3], [36, 9], [42, 5], [44, 7], [38, 13]], 'T')
  c.rect(30, 10, 9, 2, 'G')
  if (p.hold || p.tap) { star(c, 15, 12, 'G', p.value > 2); star(c, 50, 13, 'G') }
}
function whale(c: Pixels, p: Pose) {
  const orbit = p.hold ? p.value : p.motion === 'idle-b' ? p.value : 0
  const y = 13 + orbit
  c.line([[17, y + 4], [22, y + 1], [43, y + 1], [50, y + 4], [52, y + 7], [47, y + 10], [25, y + 10], [17, y + 7], [17, y + 4]], 'G', 2)
  star(c, p.motion === 'idle-b' && p.value > 0 ? 21 + p.value * 8 : 38, y, 'G', true)
  const tail = p.tap ? p.value : 0
  c.shape([[41, 34], [48, 34], [52, 28 - tail], [58, 27 - tail], [58, 33], [53, 38], [59, 42 + tail], [59, 47 + tail], [53, 46], [48, 41], [41, 42]], 'B')
  c.shape([[17, 27], [30, 25], [40, 29], [46, 36], [45, 45], [37, 51], [21, 52], [11, 47], [7, 40], [9, 32]], 'B')
  c.shape([[11, 41], [19, 45], [34, 45], [43, 40], [41, 46], [35, 49], [22, 50], [14, 46]], 'C', false)
  c.shape([[28, 42], [36, 42], [38, 49], [34, 56], [29, 54], [27, 49]], 'B')
  c.line([[31, 46], [33, 51]], 'N')
  c.line([[17, 30], [24, 28], [31, 28]], 'P')
  if (p.blink) c.line([[16, 36], [18, 37], [20, 36]], 'K')
  else { c.rect(17, 34, 2, 3, 'K'); c.dot(17, 34, 'P') }
  c.rect(12, 39, 3, 2, 'R'); c.line([[21, 40], [24, 41], [26, 40]], 'K')
  if (p.tap) { star(c, 9, 24 - p.value, 'B'); c.rect(13, 20 - p.value, 2, 2, 'B') }
  if (p.hold && p.value > 1) c.line([[13, 35], [16, 40], [29, 44], [43, 42], [51, 38]], 'G')
}
function dragon(c: Pixels, p: Pose) {
  const tail = p.tap || p.motion === 'idle-b' ? p.value : 0
  c.shape([[39, 45], [46, 50], [52, 50], [54, 46 - tail], [52, 43 - tail], [56, 43 - tail], [59, 47], [57, 54], [50, 58], [40, 56], [35, 51]], 'L')
  c.line([[43, 53], [50, 55], [55, 52]], 'D')
  c.shape([[36, 32], [43, 27], [52, 18], [52, 26], [56, 30], [52, 32], [53, 39], [47, 37], [43, 44], [37, 41]], 'D')
  c.shape([[40, 34], [49, 24], [49, 31], [51, 35], [46, 34], [42, 40]], 'L', false)
  c.shape([[28, 25], [36, 25], [38, 38], [43, 43], [44, 51], [38, 56], [23, 56], [17, 50], [19, 43], [27, 37]], 'L')
  c.shape([[29, 31], [33, 31], [34, 41], [39, 46], [36, 52], [25, 52], [22, 48], [25, 43], [29, 39]], 'C', false)
  c.rect(22, 53, 9, 3, 'D'); c.rect(36, 53, 7, 3, 'D')
  const bow = p.hold ? Math.min(3, p.value) : p.tap ? p.value % 2 : 0
  c.shape([[20, 13 + bow], [30, 11 + bow], [37, 15 + bow], [38, 24 + bow], [32, 29 + bow], [20, 30 + bow], [11, 27 + bow], [10, 21 + bow], [16, 19 + bow]], 'L')
  c.shape([[12, 22 + bow], [23, 22 + bow], [24, 27 + bow], [15, 28 + bow], [11, 26 + bow]], 'C', false)
  c.dot(14, 23 + bow, 'D')
  if (p.blink) c.line([[25, 18 + bow], [27, 19 + bow], [29, 18 + bow]], 'K')
  else { c.rect(26, 17 + bow, 2, 3, 'K'); c.dot(26, 17 + bow, 'P') }
  c.rect(26, 23 + bow, 4, 2, 'R')
  c.shape([[22, 13 + bow], [20, 5 + bow], [25, 8 + bow], [29, 3 + bow], [32, 9 + bow], [38, 6 + bow], [36, 14 + bow]], 'G')
  c.rect(24, 12 + bow, 10, 2, 'H'); c.rect(28, 10 + bow, 2, 2, 'V')
  if (p.motion === 'idle-b' && p.value > 0) c.dot(p.step === 1 ? 34 : 25, 10 + bow, 'P')
  if (p.hold) {
    c.shape([[23, 34], [19, 37], [19, 42], [23, 46], [28, 46], [25, 43], [24, 39], [26, 35]], 'G')
    c.shape([[32, 35], [28, 38], [24, 39], [24, 42], [30, 43], [35, 39]], 'L')
    if (p.value > 1) star(c, 43, 9, 'G')
  } else c.shape([[31, 34], [27, 38], [23, 38], [23, 41], [30, 42], [35, 38]], 'L')
}

const painters: Record<string, (canvas: Pixels, state: Pose) => void> = {
  sprout_potato: potato, late_duck: duck, box_ghost: ghost, nap_cloud: cloud,
  question_face: question, tiny_egg: tiny, crescent_cat: cat, star_fawn: fawn,
  cape_penguin: penguin, solar_phoenix: phoenix, ring_whale: whale, moon_crown_dragon: dragon,
}

/** Dedicated 32×32 drawings: simplified silhouettes and facial landmarks, not downsampling. */
function thumbnail(id: string): PixelImage {
  const c = new Pixels(32)
  const eyes = (x: number, y: number, gap = 5) => { c.rect(x, y, 1, 2, 'K'); c.rect(x + gap, y, 1, 2, 'K'); c.dot(x + 2, y + 3, 'K') }
  switch (id) {
    case 'sprout_potato':
      c.line([[16, 15], [16, 9]], 'D')
      c.shape([[16, 11], [11, 10], [7, 5], [7, 2], [12, 3], [17, 8]], 'L')
      c.shape([[16, 10], [18, 4], [24, 2], [24, 6], [21, 10]], 'L')
      c.shape([[12, 13], [20, 13], [25, 16], [27, 22], [24, 27], [17, 29], [9, 27], [6, 23], [6, 18]], 'A')
      c.line([[10, 17], [9, 20]], 'C'); eyes(12, 19); c.dot(21, 25, 'O'); break
    case 'late_duck':
      c.rect(11, 26, 5, 3, 'G'); c.rect(20, 26, 5, 3, 'G')
      c.shape([[5, 15], [11, 17], [13, 14], [13, 8], [17, 4], [22, 4], [26, 8], [26, 13], [23, 16], [26, 21], [23, 26], [15, 28], [8, 24]], 'S')
      c.shape([[24, 10], [29, 11], [30, 13], [24, 15]], 'G')
      c.rect(21, 9, 1, 2, 'K'); c.line([[14, 19], [20, 18], [18, 23], [14, 22]], 'H')
      c.line([[17, 4], [16, 2], [18, 2]], 'K'); break
    case 'box_ghost':
      c.shape([[8, 10], [24, 10], [26, 28], [22, 26], [19, 29], [16, 26], [12, 29], [8, 27], [6, 29]], 'A')
      c.shape([[8, 11], [5, 5], [13, 6], [16, 11], [20, 6], [27, 5], [24, 12], [17, 14]], 'S')
      c.rect(9, 15, 2, 8, 'C'); eyes(12, 17); c.rect(21, 23, 2, 1, 'O'); break
    case 'nap_cloud':
      c.shape([[5, 16], [7, 11], [11, 10], [13, 6], [18, 7], [21, 11], [25, 10], [28, 14], [27, 17], [30, 20], [28, 25], [23, 27], [8, 27], [3, 23], [2, 19]], 'B')
      c.shape([[6, 18], [10, 16], [13, 12], [17, 13], [20, 17], [25, 17], [27, 21], [23, 24], [8, 24]], 'P', false)
      c.rect(10, 19, 3, 1, 'K'); c.rect(18, 19, 3, 1, 'K'); c.dot(15, 22, 'K')
      c.shape([[24, 8], [24, 3], [28, 2], [30, 5], [28, 8]], 'C'); break
    case 'question_face':
      c.shape([[10, 15], [22, 15], [26, 19], [27, 25], [23, 29], [11, 29], [6, 25], [6, 20]], 'R')
      c.line([[12, 5], [13, 3], [19, 3], [21, 5], [21, 8], [17, 10], [17, 12]], 'M', 2)
      c.rect(17, 13, 2, 1, 'M'); eyes(12, 21); c.dot(9, 19, 'C'); break
    case 'tiny_egg':
      c.shape([[14, 5], [18, 5], [22, 12], [23, 20], [19, 24], [12, 24], [9, 19], [10, 12]], 'S'); eyes(13, 14)
      c.shape([[6, 18], [10, 21], [13, 18], [17, 21], [21, 18], [25, 21], [27, 18], [26, 25], [22, 29], [13, 30], [8, 26]], 'C')
      c.line([[11, 26], [17, 28], [23, 26]], 'H'); break
    case 'crescent_cat':
      c.shape([[19, 26], [24, 26], [27, 22], [27, 17], [25, 14], [29, 17], [30, 23], [26, 29], [19, 29]], 'G')
      c.shape([[12, 16], [19, 16], [23, 26], [21, 29], [8, 29], [7, 26]], 'V')
      c.shape([[7, 12], [7, 3], [12, 7], [17, 7], [22, 3], [22, 13], [19, 18], [11, 18]], 'V')
      eyes(11, 11); c.rect(14, 20, 4, 6, 'C'); c.dot(15, 9, 'G'); break
    case 'star_fawn':
      c.line([[12, 10], [10, 5], [8, 3], [8, 1]], 'K'); c.line([[10, 6], [12, 3]], 'K')
      c.line([[21, 10], [23, 5], [25, 3], [25, 1]], 'K'); c.line([[23, 6], [21, 3]], 'K')
      star(c, 7, 3, 'G'); star(c, 26, 3, 'G')
      c.shape([[12, 17], [21, 17], [23, 23], [23, 30], [19, 30], [18, 25], [15, 25], [14, 30], [10, 30], [10, 23]], 'A')
      c.shape([[11, 10], [5, 8], [6, 12], [10, 14], [13, 19], [20, 19], [23, 14], [28, 12], [29, 8], [22, 10]], 'A')
      eyes(13, 12); c.rect(15, 17, 4, 1, 'C'); c.dot(13, 23, 'P'); break
    case 'cape_penguin':
      c.shape([[11, 13], [6, 15], [2, 25], [8, 23], [11, 26], [23, 26], [25, 23], [30, 25], [26, 15], [21, 13]], 'M')
      c.shape([[12, 4], [19, 4], [23, 9], [22, 14], [25, 23], [22, 28], [11, 28], [7, 23], [10, 14], [9, 9]], 'N')
      c.shape([[12, 12], [15, 10], [17, 12], [20, 10], [21, 17], [23, 22], [20, 26], [13, 26], [10, 22]], 'C', false)
      eyes(13, 12); c.rect(15, 16, 3, 2, 'G'); c.rect(10, 28, 5, 2, 'G'); c.rect(19, 28, 5, 2, 'G'); break
    case 'solar_phoenix':
      c.shape([[15, 11], [9, 12], [2, 7], [3, 15], [2, 18], [7, 22], [13, 22]], 'T')
      c.shape([[18, 11], [24, 12], [30, 7], [29, 15], [30, 18], [25, 22], [19, 22]], 'T')
      c.line([[4, 12], [10, 18], [13, 18]], 'G'); c.line([[28, 12], [23, 18], [19, 18]], 'G')
      c.shape([[14, 9], [19, 9], [21, 17], [18, 23], [20, 29], [17, 31], [15, 24], [12, 29], [9, 29], [13, 21]], 'G')
      c.shape([[13, 6], [17, 4], [21, 7], [23, 10], [20, 13], [14, 12]], 'G')
      c.line([[14, 6], [11, 2]], 'T'); c.line([[17, 5], [17, 1]], 'T'); c.line([[19, 6], [23, 2]], 'T'); c.dot(19, 7, 'K'); break
    case 'ring_whale':
      c.line([[8, 6], [12, 3], [23, 3], [27, 6], [23, 9], [12, 9], [8, 6]], 'G'); star(c, 19, 3, 'G')
      c.shape([[22, 17], [27, 14], [30, 13], [29, 19], [31, 24], [27, 23], [23, 21]], 'B')
      c.shape([[7, 13], [16, 12], [22, 15], [25, 21], [22, 26], [15, 28], [7, 26], [3, 22], [3, 17]], 'B')
      c.shape([[5, 22], [11, 24], [21, 23], [19, 26], [9, 26]], 'C', false)
      c.shape([[14, 23], [19, 23], [19, 30], [15, 28]], 'B'); c.rect(8, 18, 1, 2, 'K'); c.rect(10, 22, 2, 1, 'K'); break
    case 'moon_crown_dragon':
      c.shape([[19, 22], [24, 25], [28, 24], [27, 21], [30, 23], [30, 27], [26, 30], [19, 28]], 'L')
      c.shape([[18, 16], [24, 11], [27, 8], [27, 15], [29, 19], [25, 18], [22, 23]], 'D')
      c.shape([[14, 12], [19, 12], [19, 19], [23, 23], [22, 29], [12, 29], [8, 25], [10, 21], [14, 18]], 'L')
      c.shape([[9, 6], [16, 5], [20, 9], [19, 14], [13, 16], [5, 14], [4, 11], [8, 10]], 'L')
      c.shape([[10, 6], [9, 1], [13, 3], [15, 1], [17, 4], [20, 2], [18, 7]], 'G')
      c.dot(14, 9, 'K'); c.rect(6, 12, 5, 2, 'C'); c.rect(15, 21, 4, 5, 'C'); break
  }
  return c.image()
}

function petImage(id: string, motion: PixelMotion | null, frame: number) {
  const canvas = new Pixels()
  painters[id](canvas, pose(motion, frame))
  return canvas.image()
}

export const petVisuals: Readonly<Record<string, PetPixelVisual>> = Object.fromEntries(Object.keys(painters).map((id) => [id, {
  main: petImage(id, null, 0), thumbnail: thumbnail(id),
  motions: {
    'idle-a': Array.from({ length: 4 }, (_, frame) => petImage(id, 'idle-a', frame)),
    'idle-b': Array.from({ length: 4 }, (_, frame) => petImage(id, 'idle-b', frame)),
    tap: Array.from({ length: 5 }, (_, frame) => petImage(id, 'tap', frame)),
    hold: Array.from({ length: 6 }, (_, frame) => petImage(id, 'hold', frame)),
  },
}]))

function room(c: Pixels) {
  c.shape([[6, 12], [9, 9], [55, 9], [58, 12], [58, 48], [6, 48]], 'U', false)
  c.rect(9, 12, 20, 24, 'C'); c.rect(11, 14, 16, 20, 'P')
  c.rect(18, 14, 2, 20, 'S'); c.rect(11, 23, 16, 2, 'S')
  c.rect(8, 35, 23, 2, 'S')
  c.shape([[14, 38], [27, 38], [41, 52], [23, 52]], 'C', false)
  c.rect(52, 41, 1, 10, 'D')
  c.shape([[52, 44], [47, 41], [46, 35], [50, 36], [53, 41]], 'L', false)
  c.shape([[53, 46], [54, 40], [59, 38], [59, 43]], 'L', false)
  c.shape([[48, 49], [57, 49], [56, 55], [49, 55]], 'T')
  c.rect(47, 48, 11, 2, 'H')
  c.line([[7, 55], [58, 55]], 'E', 2)
}
function nest(c: Pixels, broken: boolean) {
  c.shape([[14, 52], [22, 50], [42, 50], [51, 52], [53, 56], [47, 61], [17, 61], [10, 57]], 'A')
  c.shape([[17, 52], [24, 51], [42, 51], [48, 54], [44, 57], [21, 57], [15, 55]], 'O', false)
  c.line([[13, 57], [19, 59], [46, 59], [51, 57]], 'H')
  c.line([[17, 56], [24, 60]], 'C'); c.line([[25, 57], [31, 60]], 'C'); c.line([[44, 56], [38, 60]], 'C')
  if (broken) {
    c.shape([[7, 46], [11, 49], [14, 45], [17, 48], [18, 44], [20, 50], [18, 54], [11, 54]], 'C')
    c.shape([[47, 49], [51, 46], [54, 49], [58, 46], [57, 52], [53, 55], [48, 53]], 'C')
    c.rect(13, 51, 3, 1, 'H'); c.rect(51, 52, 3, 1, 'H')
  }
}
export function pixelNestImage(broken = false): PixelImage {
  const c = new Pixels(); room(c); nest(c, broken); return c.image()
}

/** Width 32, height 44; widest around 65% of height, with a round, broad base. */
const eggOutline: readonly Point[] = [[29, 7], [35, 7], [39, 11], [43, 18], [46, 26], [48, 34], [48, 40], [46, 45], [42, 49], [37, 51], [27, 51], [22, 49], [18, 45], [16, 40], [16, 34], [18, 26], [21, 18], [25, 11]]
function wholeEgg(c: Pixels, phase: EggPhase, dx = 0) {
  c.shape(eggOutline.map(([x, y]) => [x + dx, y] as const), 'C')
  c.shape([[42 + dx, 22], [46 + dx, 32], [46 + dx, 40], [42 + dx, 46], [36 + dx, 49], [28 + dx, 49], [22 + dx, 46], [27 + dx, 48], [35 + dx, 47], [41 + dx, 42], [44 + dx, 34]], 'S', false)
  c.line([[29 + dx, 13], [25 + dx, 19], [22 + dx, 27]], 'P', 2)
  c.rect(38 + dx, 24, 2, 2, 'H'); c.rect(26 + dx, 38, 2, 2, 'H'); c.rect(36 + dx, 43, 1, 2, 'H')
  if (phase !== 'waiting') c.line([[34 + dx, 17], [31 + dx, 22], [35 + dx, 25], [30 + dx, 29]], 'K')
  if (phase === 'almost' || phase === 'ready') c.line([[30 + dx, 29], [34 + dx, 33], [28 + dx, 37], [32 + dx, 40]], 'K')
  if (phase === 'ready') c.line([[34 + dx, 33], [40 + dx, 34], [43 + dx, 31]], 'K')
}
const shellSeam: readonly Point[] = [[16, 34], [18, 35], [23, 31], [28, 35], [33, 31], [38, 35], [43, 31], [48, 34]]
function seamAt(x: number) {
  for (let i = 1; i < shellSeam.length; i += 1) {
    const [x0, y0] = shellSeam[i - 1], [x1, y1] = shellSeam[i]
    if (x <= x1) return Math.round(y0 + (y1 - y0) * (x - x0) / (x1 - x0))
  }
  return 34
}
const eggCache = new Map<string, PixelImage>()
export function pixelEggImage(phase: EggPhase, motion: PixelMotion | null, frame: number, breaking = false): PixelImage {
  const key = `${phase}:${motion}:${frame}:${breaking}`
  const cached = eggCache.get(key)
  if (cached) return cached
  const c = new Pixels()
  const state = pose(motion, frame)
  const open = breaking || phase === 'revealed'
  if (open) {
    const original = new Pixels(); wholeEgg(original, 'ready')
    const lift = Math.min(3, Math.max(0, frame)) * 3
    original.grid.forEach((row, y) => row.forEach((ink, x) => {
      if (ink === '.') return
      const seam = seamAt(x), upper = y < seam
      const py = y + 4 - (upper ? lift : 0)
      if (py < 1 || py > 62 || x < 1 || x > 62) throw new Error('蛋壳动作超出像素安全边距')
      c.dot(x, py, y === seam || y === seam - 1 ? 'K' : ink as Ink)
    }))
    if (frame > 0) { star(c, 10, 35, 'G', true); star(c, 53, 27, 'G') }
    if (frame > 1) star(c, 54, 42, 'G')
  } else {
    const dx = state.tap && state.step % 2 === 0 ? 1 : state.motion === 'idle-b' && state.value === 2 ? -1 : 0
    wholeEgg(c, phase, dx)
    if (motion === 'idle-a' && state.value > 0) star(c, 24, 24 - state.value, 'P')
    if (phase === 'ready') { star(c, 10, 27, 'G'); star(c, 54, 23, 'G') }
    if (state.hold) { heart(c, 46, 18); c.rect(31 + dx, 32, 3, 1, 'H') }
  }
  const aligned = new Pixels()
  if (!open) c.grid.forEach((row, y) => row.forEach((ink, x) => { if (ink !== '.') aligned.dot(x, y + 4, ink as Ink) }))
  const result = open ? c.image() : aligned.image(); eggCache.set(key, result); return result
}
