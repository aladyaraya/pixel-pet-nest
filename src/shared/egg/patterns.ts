/** 背屏关键帧：标准蛋、沿壳体发展的裂纹、上盖和碗状下壳。 */
import { carveLine, patternToFrame, shiftFrame } from './matrix'
import type { EggPhase, MatrixFrame } from './types'
import type { ReactionKind } from './motion'

/** 主体 13×18，中轴对称、下部饱满；最后两行圆收，不形成柄状细柱。 */
const EGG_FULL = [
  '.................',
  '.................',
  '.................',
  '.......###.......',
  '......#####......',
  '.....#######.....',
  '.....#######.....',
  '....#########....',
  '....#########....',
  '...###########...',
  '...###########...',
  '..#############..',
  '..#############..',
  '..#############..',
  '..#############..',
  '..#############..',
  '...###########...',
  '...###########...',
  '....#########....',
  '.....#######.....',
  '.......###.......',
  '.................',
  '.................',
]

const EGG_OPEN = [
  '.................',
  '.................',
  '...###...........',
  '..#####..........',
  '.#######.........',
  '.##.#.##.........',
  '.................',
  '.......###.......',
  '......#...#......',
  '..........#......',
  '........##.......',
  '........#........',
  '.................',
  '........#........',
  '..#..#..#..#..#..',
  '..#############..',
  '...###########...',
  '...###########...',
  '....#########....',
  '.....#######.....',
  '.......###.......',
  '.................',
  '.................',
]

function build() {
  const waiting = patternToFrame(EGG_FULL)
  const cracking = carveLine(waiting, [[9, 5], [8, 7], [10, 9], [8, 11]], 0)
  const almost = carveLine(cracking, [[8, 11], [6, 12], [8, 14], [6, 16]], 0)
  const ready = patternToFrame(EGG_OPEN)
  return {
    waiting,
    wobble: shiftFrame(waiting, 1, 0),
    cracking,
    almost,
    ready,
    readyAlt: shiftFrame(ready, 1, -1, { x0: 0, y0: 0, x1: 7, y1: 5 }),
  }
}
let cached: ReturnType<typeof build> | null = null

export function eggFrames(): ReturnType<typeof build> {
  if (!cached) cached = build()
  return cached
}

/** 保留旧调用接口。revealed 的角色帧由 petFrame 提供。 */
export function frameForPhase(phase: string): MatrixFrame {
  const frames = eggFrames()
  if (phase === 'cracking') return frames.cracking
  if (phase === 'almost') return frames.almost
  if (phase === 'ready' || phase === 'revealed') return frames.ready
  return frames.waiting
}

/** 最多三帧，最后回到本阶段静帧；调用方负责低频调度与取消。 */
export function phaseAnimationFrames(phase: EggPhase): MatrixFrame[] {
  const frames = eggFrames()
  const base = frameForPhase(phase)
  if (phase === 'waiting') return [base, frames.wobble, base]
  if (phase === 'ready' || phase === 'revealed') return [base, frames.readyAlt, base]
  return [base, shiftFrame(base, 1, 0), base]
}

const idleCache = new Map<EggPhase, MatrixFrame[][]>()
const reactionCache = new Map<string, MatrixFrame[]>()

/** 只移动下壳时，开放上盖不会撞到画布边缘。 */
function sway(base: MatrixFrame, phase: EggPhase, dx: number): MatrixFrame {
  return shiftFrame(base, dx, 0, phase === 'ready' || phase === 'revealed'
    ? { x0: 2, y0: 6, x1: 15, y1: 21 } : undefined)
}

/** 自主动作交替为轻晃、轻轻起伏；始终回到当前阶段的静帧。 */
export function eggIdleVariants(phase: EggPhase): MatrixFrame[][] {
  const cached = idleCache.get(phase)
  if (cached) return cached
  const base = frameForPhase(phase)
  const variants = [
    [sway(base, phase, 1), sway(base, phase, -1), base],
    [shiftFrame(base, 0, -1), shiftFrame(base, 0, 1), base],
  ]
  idleCache.set(phase, variants)
  return variants
}

/** 轻点回应小幅弹动；长按回应壳边闪光。两者都不会改变裂纹阶段。 */
export function eggReactionFrames(phase: EggPhase, kind: ReactionKind): MatrixFrame[] {
  const key = `${phase}:${kind}`
  const cached = reactionCache.get(key)
  if (cached) return cached
  const base = frameForPhase(phase)
  const glint = (y: number) => {
    const frame = [...base]
    frame[y * 17 + 1] = 255
    frame[y * 17 + 15] = 255
    return frame
  }
  const frames = kind === 'tap'
    ? [shiftFrame(base, 0, -1), sway(base, phase, 1), base]
    : [glint(8), glint(6), base]
  reactionCache.set(key, frames)
  return frames
}
