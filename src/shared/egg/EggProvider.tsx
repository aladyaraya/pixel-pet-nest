/* =============================================================================
 * 孵蛋状态机（PRD 06 章）：以保存的到期时间计算进度，页面定时器只负责刷新。
 *
 * 一致性规则：
 *   - 每次进入先读记录，再计算当前阶段，最后更新主屏和背屏；
 *   - 恢复时跳过已过去的中间阶段；连续多次触发到期只提示一次；
 *   - 前台连续运行用单调时钟校验，设备时间跳变时按已运行时长重算；
 *   - 背屏「恢复只提交当前阶段，丢弃过期请求」（提交带序号，过期结果丢弃）；
 *   - 揭晓与收藏计数在同一份记录里更新，串行写入成功后才算收藏完成。
 * ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
 useRef,
  useState,
  type ReactNode,
} from 'react'

import { invokeNative, onNativeEvent, BridgeError, nativeLog } from '@/shared/bridge'
import { useToast } from '@/shared/ui/Toast'
import {
  clearFrame,
  pushFrame,
  resetBackScreenMode,
  resolveBackScreenMode,
  sleepBackScreen,
  wakeBackScreen,
  type BackScreenMode,
} from './backScreen'
import { sfx, setSoundEnabled } from './audio'
import { setNarrationEnabled, speak } from './speech'
import {
  defaultRecord,
  loadRecord,
  saveRecord,
} from './storage'
import { PET_BY_ID, petFrame, pickPetId, type Pet } from './pets'
import { eggFrames, frameForPhase } from './patterns'
import {
  DEMO_DURATION_MS,
  NORMAL_DURATION_MS,
  PHASE_BOUNDARIES,
  type EggMode,
  type EggPhase,
  type EggRecord,
  type EggSession,
  type EggSettings,
} from './types'

/** 翻面判定阈值（加速度 z 轴，m/s²）：正面朝下约 -9.8，正面朝上约 +9.8 */
const FACE_DOWN_Z = -5
const FACE_UP_Z = 5
const FLIP_POLL_MS = 400
/** 已到期仍未揭晓时，最多保持亮屏 30 秒（PRD 06 章） */
const KEEP_ON_AFTER_READY_MS = 30_000
/** 时钟跳变判定阈值 */
const CLOCK_JUMP_MS = 3_000

export function computePhase(session: EggSession, now: number): EggPhase {
  if (session.phase === 'revealed' || session.revealedAt != null) return 'revealed'
  const elapsed = now - session.startedAt
  const progress = session.durationMs > 0 ? elapsed / session.durationMs : 1
  if (progress >= 1) return 'ready'
  if (progress >= PHASE_BOUNDARIES.almost) return 'almost'
  if (progress >= PHASE_BOUNDARIES.cracking) return 'cracking'
  return 'waiting'
}

export function remainingMsOf(session: EggSession, now: number): number {
  return Math.max(0, session.deadlineAt - now)
}

export function progressOf(session: EggSession, now: number): number {
  const raw = session.durationMs > 0 ? (now - session.startedAt) / session.durationMs : 1
  return Math.min(1, Math.max(0, raw))
}

export type BackScreenStatus = 'unknown' | 'ok' | 'unavailable' | 'failed'

export interface EggContextValue {
  /** 本地记录是否已加载完成 */
  loaded: boolean
  record: EggRecord
  settings: EggSettings
  session: EggSession | null
  /** 实时阶段（无进行中局为 null） */
  phase: EggPhase | null
  remainingMs: number
  progress: number
  /** 当前局角色；未揭晓时也对内可用（页面不得提前展示） */
  pet: Pet | null
  backScreenMode: BackScreenMode
  backScreenStatus: BackScreenStatus
  /** 「这次收藏还没保存」等存储告警 */
  storageWarning: string | null
  /** 减少动态（系统偏好）：不做帧动画 */
  reducedMotion: boolean
  collectionCount: number
  startSession: (mode: EggMode) => Promise<void>
  reveal: () => Promise<void>
  abortSession: () => Promise<void>
  retrySave: () => Promise<void>
  updateSettings: (patch: Partial<EggSettings>) => void
  /** 背屏失败后的重试入口 */
  retryBackScreen: () => void
}

const EggContext = createContext<EggContextValue | null>(null)

export function EggProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [record, setRecord] = useState<EggRecord>(defaultRecord)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [backScreenMode, setBackScreenMode] = useState<BackScreenMode>('unavailable')
  const [backScreenStatus, setBackScreenStatus] = useState<BackScreenStatus>('unknown')
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  const recordRef = useRef(record)
  recordRef.current = record
  const submitSeq = useRef(0)
  const readyNotified = useRef(false)
  const wobbleTimer = useRef<number | null>(null)
  const wobbleOn = useRef(false)
  const keepScreenOnTimer = useRef<number | null>(null)
  const monoBase = useRef<{ wall: number; mono: number } | null>(null)
  const flipStop = useRef(false)

  const session = record.session
  const phase = session ? computePhase(session, now) : null
  const pet = session ? PET_BY_ID[session.petId] ?? null : null

  const persist = useCallback(async (next: EggRecord) => {
    setRecord(next)
    try {
      await saveRecord(next)
      setStorageWarning(null)
    } catch (error) {
      nativeLog.w('egg', 'record save failed', String(error))
      setStorageWarning('这次收藏还没保存，请重试')
    }
  }, [])

  /* ---------- 初始化：读记录 + 背屏模式 + 减少动态偏好 ---------- */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const mode = await resolveBackScreenMode()
      if (!cancelled) setBackScreenMode(mode)
      try {
        const privacy = await invokeNative('privacy.getStatus')
        if (!cancelled && privacy && privacy.agreed === false) {
          const next: EggRecord = {
            ...recordRef.current,
            settings: { ...recordRef.current.settings, privacyAgreed: false },
          }
          setRecord(next)
          recordRef.current = next
        } else if (!cancelled && privacy && privacy.agreed === true && recordRef.current.settings.privacyAgreed === null) {
          const next: EggRecord = {
            ...recordRef.current,
            settings: { ...recordRef.current.settings, privacyAgreed: true },
          }
          setRecord(next)
          recordRef.current = next
        }
      } catch {
        // 查询失败不影响主流程
      }
      try {
        const loadedRecord = await loadRecord()
        if (cancelled) return
        if (loadedRecord) {
          setRecord(loadedRecord)
          recordRef.current = loadedRecord
          setSoundEnabled(loadedRecord.settings.sound)
          setNarrationEnabled(loadedRecord.settings.narration)
        }
      } catch (error) {
        if (error instanceof BridgeError && error.code === 'privacy') {
          const next: EggRecord = {
            ...recordRef.current,
            settings: { ...recordRef.current.settings, privacyAgreed: false },
          }
          setRecord(next)
          recordRef.current = next
        }
      }
      if (!cancelled) setLoaded(true)
    })()
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (mq) {
      setReducedMotion(mq.matches)
      const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
      mq.addEventListener?.('change', onChange)
      return () => {
        cancelled = true
        mq.removeEventListener?.('change', onChange)
      }
    }
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------- 背屏提交：带序号，过期请求丢弃 ---------- */
  const submitPhaseFrame = useCallback(
    async (target: EggPhase, petId: string) => {
      submitSeq.current += 1
      const seq = submitSeq.current
      const frame = target === 'revealed' ? petFrame(petId) : frameForPhase(target)
      const result = await pushFrame(frame)
      if (seq !== submitSeq.current) return
      setBackScreenStatus(result.ok ? 'ok' : 'failed')
      if (result.ok && result.simulated) setBackScreenMode('simulated')
    },
    [],
  )

  /* ---------- 定时器：按到期时间刷新 ---------- */
  useEffect(() => {
    if (!session || phase === 'revealed') return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [session, phase])

  /* ---------- 单调时钟校验：设备时间跳变时按已运行时长重算 ---------- */
  useEffect(() => {
    if (!session || phase === 'revealed') return
    if (!monoBase.current) monoBase.current = { wall: Date.now(), mono: performance.now() }
    const base = monoBase.current
    const expectedWall = base.wall + (performance.now() - base.mono)
    const drift = Date.now() - expectedWall
    if (Math.abs(drift) > CLOCK_JUMP_MS) {
      const elapsed = performance.now() - base.mono
      const nextSession: EggSession = {
        ...session,
        deadlineAt: Date.now() + Math.max(0, session.durationMs - elapsed),
      }
      monoBase.current = { wall: Date.now(), mono: performance.now() }
      void persist({ ...recordRef.current, session: nextSession })
      toast({ title: '检测到系统时间变化，已按实际等待时长继续', tone: 'warning' })
    }
  }, [session, phase, now, persist, toast])

  /* ---------- 亮屏保持 ---------- */
  useEffect(() => {
    const keep = async (on: boolean) => {
      try {
        await invokeNative('setKeepScreenOn', { keepScreenOn: on })
      } catch {
        // 浏览器预览不支持时忽略
      }
    }
    if (session && phase !== 'revealed') {
      void keep(true)
      if (keepScreenOnTimer.current) window.clearTimeout(keepScreenOnTimer.current)
      if (phase === 'ready') {
        keepScreenOnTimer.current = window.setTimeout(() => void keep(false), KEEP_ON_AFTER_READY_MS)
      }
    } else {
      if (keepScreenOnTimer.current) window.clearTimeout(keepScreenOnTimer.current)
      keepScreenOnTimer.current = null
      void keep(false)
    }
    return () => {
      if (keepScreenOnTimer.current) window.clearTimeout(keepScreenOnTimer.current)
      keepScreenOnTimer.current = null
    }
  }, [session, phase])

  /* ---------- 阶段变化：文案 / 音效 / 振动 / 背屏 ---------- */
  useEffect(() => {
    if (!session || !loaded) return
    const current = computePhase(session, Date.now())
    const hinted = session.hintedPhases

    if (current === 'ready' && !readyNotified.current) {
      readyNotified.current = true
      const dueToast = () => toast({ title: '孵好了，翻过来看看。', tone: 'success' })
      dueToast()
      if (recordRef.current.settings.sound) sfx.due()
      speak('孵好了，翻过来看看。')
      try {
        void invokeNative('vibrateShort', { type: 'medium' })
      } catch {
        // 预览环境无振动
      }
    }

    if (!hinted.includes(current) && current !== 'revealed') {
      const nextSession: EggSession = { ...session, phase: current, hintedPhases: [...hinted, current] }
      void persist({ ...recordRef.current, session: nextSession })
      if (current === 'waiting') {
        toast({ title: '三分钟后，看看里面是谁。' })
        speak('三分钟后，看看里面是谁。')
      } else if (current === 'cracking') {
        toast({ title: '里面好像动了一下。' })
        speak('里面好像动了一下。')
        if (recordRef.current.settings.sound) sfx.stage()
      }
    }

    if (current !== 'revealed') {
      void submitPhaseFrame(current, session.petId)
    }
  }, [session, phase, loaded, persist, submitPhaseFrame, toast])

  /* ---------- 轻晃动画：等待阶段每 8 秒两帧交替（减少动态时跳过） ---------- */
  useEffect(() => {
    if (phase !== 'waiting' || reducedMotion || !session) return
    const tick = async () => {
      wobbleOn.current = !wobbleOn.current
      submitSeq.current += 1
      const seq = submitSeq.current
      const frame = wobbleOn.current ? eggFrames().wobble : eggFrames().waiting
      const result = await pushFrame(frame)
      if (seq !== submitSeq.current) return
      setBackScreenStatus(result.ok ? 'ok' : 'failed')
    }
    wobbleTimer.current = window.setInterval(tick, 1000)
    return () => {
      if (wobbleTimer.current) window.clearInterval(wobbleTimer.current)
      wobbleTimer.current = null
    }
  }, [phase, reducedMotion, session])

  /* ---------- 生命周期：回前台只提交当前阶段 ---------- */
  useEffect(() => {
    let offShow: (() => void) | undefined
    let offHide: (() => void) | undefined
    ;(async () => {
      try {
        offShow = await onNativeEvent('appShow', () => {
          setNow(Date.now())
          const current = recordRef.current.session
          if (current) {
            const next = computePhase(current, Date.now())
            if (next !== 'revealed') void submitPhaseFrame(next, current.petId)
          }
        })
        offHide = await onNativeEvent('appHide', () => {
          flipStop.current = true
        })
      } catch {
        // 浏览器预览没有事件通道，忽略
      }
    })()
    return () => {
      offShow?.()
      offHide?.()
      flipStop.current = true
    }
  }, [submitPhaseFrame])

  /* ---------- 动作：开始一局 ---------- */
  const startSession = useCallback(
    async (mode: EggMode) => {
      const nowTs = Date.now()
      const durationMs = mode === 'demo' ? DEMO_DURATION_MS : NORMAL_DURATION_MS
      const nextSession: EggSession = {
        sessionId: `egg_${nowTs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        mode,
        durationMs,
        startedAt: nowTs,
        deadlineAt: nowTs + durationMs,
        petId: pickPetId(),
        phase: 'waiting',
        revealedAt: null,
        hintedPhases: [],
      }
      readyNotified.current = false
      monoBase.current = { wall: nowTs, mono: performance.now() }
      setNow(nowTs)
      await persist({ ...recordRef.current, session: nextSession })
      await wakeBackScreen().then((r) => {
        if (r.ok) setBackScreenStatus('ok')
        else setBackScreenStatus('failed')
      })
      await submitPhaseFrame('waiting', nextSession.petId)
      if (recordRef.current.settings.sound) sfx.start()
      speak('三分钟后，看看里面是谁。')
    },
    [persist, submitPhaseFrame],
  )

  /* ---------- 动作：揭晓（收藏与揭晓状态同一份记录一起更新） ---------- */
  const reveal = useCallback(async () => {
    const current = recordRef.current.session
    if (!current || current.phase === 'revealed') return
    const nowTs = Date.now()
    const petId = current.petId
    const prev = recordRef.current.collection[petId] ?? { count: 0, lastRevealedAt: null }
    const nextSession: EggSession = { ...current, phase: 'revealed', revealedAt: nowTs }
    const nextRecord: EggRecord = {
      ...recordRef.current,
      session: nextSession,
      collection: {
        ...recordRef.current.collection,
        [petId]: { count: prev.count + 1, lastRevealedAt: nowTs },
      },
    }
    setRecord(nextRecord)
    recordRef.current = nextRecord
    setNow(nowTs)
    try {
      await saveRecord(nextRecord)
      setStorageWarning(null)
    } catch (error) {
      nativeLog.w('egg', 'reveal save failed', String(error))
      setStorageWarning('这次收藏还没保存，请重试')
    }
    try {
      await invokeNative('vibrateShort', { type: 'light' })
    } catch {
      // 预览环境无振动
    }
    if (recordRef.current.settings.sound) sfx.crack()
    const pet = PET_BY_ID[petId]
    if (pet) speak(`${pet.name}。${pet.quote}`)
    submitSeq.current += 1
    const seq = submitSeq.current
    const result = await pushFrame(petFrame(petId))
    if (seq === submitSeq.current) setBackScreenStatus(result.ok ? 'ok' : 'failed')
  }, [])

  /* ---------- 动作：重试保存（同一 sessionId，不重复加次数） ---------- */
  const retrySave = useCallback(async () => {
    try {
      await saveRecord(recordRef.current)
      setStorageWarning(null)
      toast({ title: '收藏已保存', tone: 'success' })
    } catch {
      setStorageWarning('这次收藏还没保存，请重试')
    }
  }, [toast])

  /* ---------- 动作：结束本局（保留收藏，释放背屏与亮屏） ---------- */
  const abortSession = useCallback(async () => {
    readyNotified.current = false
    monoBase.current = null
    flipStop.current = true
    await clearFrame()
    await sleepBackScreen()
    try {
      await invokeNative('setKeepScreenOn', { keepScreenOn: false })
    } catch {
      // 预览环境忽略
    }
    await persist({ ...recordRef.current, session: null })
  }, [persist])

  /* ---------- 翻面自动揭晓（实验）：ready 后监听加速度 z 轴翻正 ---------- */
  useEffect(() => {
    if (phase !== 'ready' || !session) return
    if (!recordRef.current.settings.flipReveal) return
    flipStop.current = false
    const timer = window.setInterval(async () => {
      if (flipStop.current) return
      try {
        const { values } = await invokeNative('getSensor', { type: 'accelerometer' })
        const z = values?.[2] ?? 0
        if (z > FACE_UP_Z) {
          flipStop.current = true
          await reveal()
        }
      } catch {
        // 传感器不可用：静默停止，主按钮始终可用
        flipStop.current = true
      }
    }, FLIP_POLL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [phase, session, reveal])

  /* ---------- 设置 ---------- */
  const updateSettings = useCallback(
    (patch: Partial<EggSettings>) => {
      const next: EggRecord = {
        ...recordRef.current,
        settings: { ...recordRef.current.settings, ...patch },
      }
      if (patch.sound !== undefined) setSoundEnabled(patch.sound)
      if (patch.narration !== undefined) setNarrationEnabled(patch.narration)
      void persist(next)
    },
    [persist],
  )

  const retryBackScreen = useCallback(() => {
    resetBackScreenMode()
    void resolveBackScreenMode().then((mode) => {
      setBackScreenMode(mode)
      setBackScreenStatus('unknown')
      const current = recordRef.current.session
      if (current) {
        const next = computePhase(current, Date.now())
        if (next !== 'revealed') void submitPhaseFrame(next, current.petId)
      }
    })
  }, [submitPhaseFrame])

  const collectionCount = useMemo(
    () => Object.values(record.collection).filter((c) => c.count > 0).length,
    [record.collection],
  )

  const value = useMemo<EggContextValue>(
    () => ({
      loaded,
      record,
      settings: record.settings,
      session,
      phase,
      remainingMs: session ? remainingMsOf(session, now) : 0,
      progress: session ? progressOf(session, now) : 0,
      pet,
      backScreenMode,
      backScreenStatus,
      storageWarning,
      reducedMotion,
      collectionCount,
      startSession,
      reveal,
      abortSession,
      retrySave,
      updateSettings,
      retryBackScreen,
    }),
    [
      loaded,
      record,
      record.settings,
      session,
      phase,
      now,
      pet,
      backScreenMode,
      backScreenStatus,
      storageWarning,
      reducedMotion,
      collectionCount,
      startSession,
      reveal,
      abortSession,
      retrySave,
      updateSettings,
      retryBackScreen,
    ],
  )

  return <EggContext.Provider value={value}>{children}</EggContext.Provider>
}

export function useEgg(): EggContextValue {
  const ctx = useContext(EggContext)
  if (!ctx) throw new Error('useEgg 必须在 EggProvider 内使用')
  return ctx
}

export { FACE_DOWN_Z, FACE_UP_Z }
