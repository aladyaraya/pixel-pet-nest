/* =============================================================================
 * 孵蛋状态机（PRD 06 章）：以保存的到期时间计算进度，页面定时器只负责刷新。
 *
 * 一致性规则：
 *   - 每次进入先读记录，再计算当前阶段，最后更新主屏和背屏；
 *   - 恢复时跳过已过去的中间阶段；连续多次触发到期只提示一次；
 *   - 前台连续运行用单调时钟校验，设备时间跳变时按已运行时长重算；
 *   - 背屏单通道串行提交，恢复只呈现当前目标，丢弃过期的待发命令；
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
import { sfx, setSoundEnabled, setAudioForeground, unlockAudio } from './audio'
import { BackScreenScheduler } from './backScreenScheduler'
import {
  defaultRecord,
  loadRecord,
  RecordMigrationError,
  RecordReadError,
  saveRecord,
} from './storage'
import { PET_BY_ID, petFrame, pickPetId, type Pet } from './pets'
import { petIdleVariants, petReactionFrames } from './petMotionFrames'
import { eggFrames, eggIdleVariants, eggReactionFrames, frameForPhase } from './patterns'
import type { ReactionKind } from './motion'
import {
  DEFAULT_DURATION_MS,
  formatDuration,
  isValidDuration,
  PHASE_BOUNDARIES,
  tierForDuration,
  type EggPhase,
  type EggRecord,
  type EggSession,
  type EggSettings,
  type MatrixFrame,
} from './types'

/** 翻面判定阈值（加速度 z 轴，m/s²）：正面朝下约 -9.8，正面朝上约 +9.8 */
const FACE_DOWN_Z = -5
const FACE_UP_Z = 5
const FLIP_POLL_MS = 400
/** 已到期仍未揭晓时，最多保持亮屏 30 秒（PRD 06 章） */
const KEEP_ON_AFTER_READY_MS = 30_000
/** 时钟跳变判定阈值 */
const CLOCK_JUMP_MS = 3_000
const REVEAL_TRANSITION_MS = 1_200
const DUE_VIBRATION_GAP_MS = 250

export function computePhase(session: EggSession, now: number): EggPhase {
  if (session.phase === 'revealed' || session.revealedAt != null) return 'revealed'
  const progress = progressOf(session, now)
  if (progress >= 1) return 'ready'
  if (progress >= PHASE_BOUNDARIES.almost) return 'almost'
  if (progress >= PHASE_BOUNDARIES.cracking) return 'cracking'
  return 'waiting'
}

export function remainingMsOf(session: EggSession, now: number): number {
  return Math.max(0, session.deadlineAt - now)
}

export function progressOf(session: EggSession, now: number): number {
  const raw = session.durationMs > 0 ? 1 - remainingMsOf(session, now) / session.durationMs : 1
  return Math.min(1, Math.max(0, raw))
}

export type BackScreenStatus = 'unknown' | 'ok' | 'unavailable' | 'failed'

export interface EggContextValue {
  /** 本地记录是否已加载完成 */
  loaded: boolean
  /** 读取失败时保留原记录，所有写入暂停。 */
  loadError: string | null
  /** 不含原始存档内容的读档排查代码。 */
  loadErrorCode: string | null
  retryLoad: () => void
  starting: boolean
  saving: boolean
  /** 仅新鲜揭晓的短暂破壳过渡；刷新不会重播。 */
  revealing: boolean
  record: EggRecord
  settings: EggSettings
  session: EggSession | null
  /** 实时阶段（无进行中局为 null） */
  phase: EggPhase | null
  remainingMs: number
  progress: number
  /** 揭晓过渡结束后才公开当前局角色。 */
  pet: Pet | null
  backScreenMode: BackScreenMode
  backScreenStatus: BackScreenStatus
  /** 当前背屏目标的主屏预览，不代表硬件已成功接收。 */
  backScreenFrame: MatrixFrame | null
  /** 「这次收藏还没保存」等存储告警 */
  storageWarning: string | null
  /** 减少动态（系统偏好）：不做帧动画 */
  reducedMotion: boolean
  /** 页面可见且原生宿主处于前台，供纯展示动作暂停使用。 */
  isForeground: boolean
  collectionCount: number
  startSession: (durationMs?: number) => Promise<void>
  reveal: () => Promise<void>
  abortSession: () => Promise<void>
  retrySave: () => Promise<void>
  updateSettings: (patch: Partial<EggSettings>) => void
  selectBackScreenPet: (petId: string | null) => Promise<void>
  /** 仅表示临时动作被接受，不代表设备已显示。 */
  reactToBackScreenPet: (petId: string, kind: ReactionKind) => boolean
  reactToBackScreenEgg: (sessionId: string, kind: ReactionKind) => boolean
  /** 背屏失败后的重试入口 */
  retryBackScreen: () => void
}

const EggContext = createContext<EggContextValue | null>(null)

export function EggProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [record, setRecord] = useState<EggRecord>(defaultRecord)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [backScreenMode, setBackScreenMode] = useState<BackScreenMode>('unavailable')
  const [backScreenStatus, setBackScreenStatus] = useState<BackScreenStatus>('unknown')
  const [backScreenFrame, setBackScreenFrame] = useState<MatrixFrame | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [isForeground, setIsForeground] = useState(() => document.visibilityState !== 'hidden')

  const recordRef = useRef(record)
  const loadedRef = useRef(false)
  const loadGeneration = useRef(0)
  const pendingStart = useRef<Promise<void> | null>(null)
  const pendingWrites = useRef(0)
  const writeSeq = useRef(0)
  const readyNotified = useRef(false)
  const dueVibrationTail = useRef<{ sessionId: string; timer: number } | null>(null)
  const storageWarningRef = useRef<string | null>(null)
  const reducedMotionRef = useRef(false)
  const revealingSession = useRef<string | null>(null)
  const revealTimer = useRef<number | null>(null)
  const nativeForeground = useRef(true)
  const pageActive = useRef(true)
  const foregroundRef = useRef(isForeground)
  const backScreenEngaged = useRef(false)
  const schedulerRef = useRef<BackScreenScheduler | null>(null)
  const keepScreenOnTimer = useRef<number | null>(null)
  const monoBase = useRef<{ wall: number; mono: number } | null>(null)
  const flipStop = useRef(false)
  const flipGeneration = useRef(0)
  // 跨阶段／前后台保留占用，避免旧请求未回执时叠加传感器轮询。
  const flipReadPending = useRef(false)

  const session = record.session
  const phase = session ? computePhase(session, now) : null
  const pet = session && phase === 'revealed' && !revealing ? PET_BY_ID[session.petId] ?? null : null

  const cancelDueVibrationTail = useCallback(() => {
    if (dueVibrationTail.current) window.clearTimeout(dueVibrationTail.current.timer)
    dueVibrationTail.current = null
  }, [])

  const vibrateDue = useCallback((sessionId: string) => {
    cancelDueVibrationTail()
    // 到期振动独立于音效开关；保留原有后台第一发行为，不依赖设备回执排第二发。
    void invokeNative('vibrateShort', { type: 'medium' }).catch(() => undefined)
    if (!foregroundRef.current || document.visibilityState === 'hidden') return
    const tail = { sessionId, timer: 0 }
    tail.timer = window.setTimeout(() => {
      if (dueVibrationTail.current !== tail) return
      dueVibrationTail.current = null
      const current = recordRef.current.session
      if (!loadedRef.current || !foregroundRef.current || document.visibilityState === 'hidden' ||
        current?.sessionId !== sessionId || computePhase(current, Date.now()) !== 'ready') return
      void invokeNative('vibrateShort', { type: 'medium' }).catch(() => undefined)
    }, DUE_VIBRATION_GAP_MS)
    dueVibrationTail.current = tail
  }, [cancelDueVibrationTail])

  /* 用户手势只负责解锁音频；恢复前台不会补播以前未能播放的音效。 */
  useEffect(() => {
    const unlockFromGesture = (event: Event) => {
      if (!foregroundRef.current || document.visibilityState === 'hidden') return
      if (event.type === 'keydown' && (event as KeyboardEvent).repeat) return
      unlockAudio()
    }
    setAudioForeground(foregroundRef.current && document.visibilityState !== 'hidden')
    document.addEventListener('pointerdown', unlockFromGesture, true)
    document.addEventListener('keydown', unlockFromGesture, true)
    document.addEventListener('click', unlockFromGesture, true)
    return () => {
      document.removeEventListener('pointerdown', unlockFromGesture, true)
      document.removeEventListener('keydown', unlockFromGesture, true)
      document.removeEventListener('click', unlockFromGesture, true)
      cancelDueVibrationTail()
      setAudioForeground(false)
    }
  }, [cancelDueVibrationTail])

  if (!schedulerRef.current) {
    schedulerRef.current = new BackScreenScheduler({
      commands: { wake: wakeBackScreen, frame: pushFrame, clear: clearFrame, sleep: sleepBackScreen },
      onFrame: setBackScreenFrame,
      onPending: () => setBackScreenStatus('unknown'),
      onResult: (result) => {
        setBackScreenStatus(result.ok ? 'ok' : result.reason === 'unavailable' ? 'unavailable' : 'failed')
        if (result.ok) setBackScreenMode(result.simulated ? 'simulated' : 'device')
      },
    })
  }

  const publishStorageWarning = useCallback((warning: string | null) => {
    storageWarningRef.current = warning
    setStorageWarning(warning)
  }, [])

  const saveSnapshot = useCallback(async (next: EggRecord, warning: string) => {
    if (!loadedRef.current) return false
    const seq = ++writeSeq.current
    pendingWrites.current += 1
    setSaving(true)
    try {
      await saveRecord(next)
      if (seq === writeSeq.current) publishStorageWarning(null)
      return true
    } catch (error) {
      nativeLog.w('egg', 'record save failed', String(error))
      if (seq === writeSeq.current) publishStorageWarning(warning)
      return false
    } finally {
      pendingWrites.current -= 1
      setSaving(pendingWrites.current > 0)
    }
  }, [publishStorageWarning])

  const persist = useCallback((next: EggRecord, warning = '进度与设置还没保存，请重试') => {
    if (!loadedRef.current) return Promise.resolve(false)
    recordRef.current = next
    setRecord(next)
    return saveSnapshot(next, warning)
  }, [saveSnapshot])

  /* 先校正再发布时间，避免页面短暂进入错误 ready 阶段并触发振动/揭晓。 */
  const refreshNow = useCallback(() => {
    const wall = Date.now()
    const mono = performance.now()
    const current = recordRef.current.session
    if (current && current.phase !== 'revealed') {
      const base = monoBase.current
      if (!base) {
        monoBase.current = { wall, mono }
      } else {
        const drift = wall - (base.wall + mono - base.mono)
        if (Math.abs(drift) > CLOCK_JUMP_MS) {
          monoBase.current = { wall, mono }
          // 平移原始时间轴，连续多次跳变仍保留全部已经等待的时间。
          void persist({
            ...recordRef.current,
            session: {
              ...current,
              startedAt: current.startedAt + drift,
              deadlineAt: current.deadlineAt + drift,
            },
          })
          toast({ title: '检测到系统时间变化，已按实际等待时长继续', tone: 'warning' })
        }
      }
    }
    setNow(wall)
    return wall
  }, [persist, toast])

  const retryLoad = useCallback(() => {
    if (loadedRef.current) return
    loadGeneration.current += 1
    loadedRef.current = false
    setLoaded(false)
    setLoadError(null)
    setLoadErrorCode(null)
    setLoadAttempt(attempt => attempt + 1)
  }, [])

  /* ---------- 初始化：读记录 + 背屏模式 + 减少动态偏好 ---------- */
  useEffect(() => {
    let cancelled = false
    const generation = loadGeneration.current
    const isCancelled = () => cancelled || generation !== loadGeneration.current
    loadedRef.current = false
    setLoaded(false)
    setLoadError(null)
    setLoadErrorCode(null)
    // 背屏服务可能迟迟不返回；本地进度和前屏不依赖它完成连接。
    void resolveBackScreenMode().then((mode) => {
      if (!isCancelled()) setBackScreenMode(mode)
    }).catch(() => {
      if (!isCancelled()) setBackScreenMode('unavailable')
    })
    ;(async () => {
      let privacyAgreed: boolean | null = null
      try {
        const privacy = await invokeNative('privacy.getStatus')
        if (typeof privacy?.agreed === 'boolean') privacyAgreed = privacy.agreed
      } catch {
        // 查询失败不影响主流程
      }
      if (isCancelled()) return
      let next: EggRecord
      try {
        next = await loadRecord() ?? defaultRecord()
      } catch (error) {
        if (isCancelled()) return
        if (error instanceof RecordMigrationError) {
          next = error.record
          publishStorageWarning(error.message)
        } else {
          const bridgeError = error instanceof BridgeError ? error : null
          const code = error instanceof RecordReadError ? error.code
            : bridgeError?.code === 'privacy' ? 'EGG_PRIVACY'
              : bridgeError?.apiName === 'initBridge' ? 'EGG_BRIDGE_INIT'
                : bridgeError?.code === 'timeout' ? 'EGG_STORAGE_TIMEOUT' : 'EGG_STORAGE_READ'
          setLoadErrorCode(code)
          setLoadError(code === 'EGG_PRIVACY'
            ? '请先完成隐私授权，再重新读取本机记录。'
            : code === 'EGG_BRIDGE_INIT'
              ? '设备存储连接尚未就绪，原有记录会保留。请稍后重新读取。'
              : code === 'EGG_STORAGE_TIMEOUT'
                ? '读取进度与收藏超时，原有记录会保留。请重新读取。'
                : code === 'EGG_RECORD_FORMAT' || code === 'EGG_RECORD_VERSION'
                  ? '暂时无法识别本机记录，原有进度与收藏已保留。请保留排查代码，以便处理。'
                  : '暂时无法读取进度与收藏，原有记录会保留。请重试。')
          nativeLog.w('egg', 'record load failed', {
            code, attempt: loadAttempt + 1, api: bridgeError?.apiName, bridgeCode: bridgeError?.code,
          })
          return
        }
      }
      if (isCancelled()) return
      if (privacyAgreed !== null) next.settings = { ...next.settings, privacyAgreed }
      recordRef.current = next
      setRecord(next)
      setSoundEnabled(next.settings.sound)
      readyNotified.current = next.session?.hintedPhases.includes('ready') ?? false
      const wall = Date.now()
      monoBase.current = { wall, mono: performance.now() }
      setNow(wall)
      loadedRef.current = true
      setLoadError(null)
      setLoadErrorCode(null)
      setLoaded(true)
    })()
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (mq) {
      reducedMotionRef.current = mq.matches
      setReducedMotion(mq.matches)
      const onChange = (e: MediaQueryListEvent) => {
        reducedMotionRef.current = e.matches
        setReducedMotion(e.matches)
      }
      mq.addEventListener?.('change', onChange)
      return () => {
        cancelled = true
        loadedRef.current = false
        mq.removeEventListener?.('change', onChange)
      }
    }
    return () => {
      cancelled = true
      loadedRef.current = false
    }
  }, [loadAttempt, publishStorageWarning])

  /* ---------- 背屏目标：未揭晓局 > 当前选择；历史揭晓不抢回选择 ---------- */
  const syncBackScreen = useCallback((release = false) => {
    if (!loadedRef.current) return
    const sampledNow = refreshNow()
    const current = recordRef.current
    const currentSession = current.session
    const currentPhase = currentSession ? computePhase(currentSession, sampledNow) : null
    const animate = !reducedMotionRef.current
    if (currentSession && revealingSession.current === currentSession.sessionId) {
      backScreenEngaged.current = true
      schedulerRef.current!.setScene({
        key: `${currentSession.sessionId}:breaking`, frame: eggFrames().readyAlt,
      })
    } else if (currentSession && currentPhase && currentPhase !== 'revealed') {
      backScreenEngaged.current = true
      schedulerRef.current!.setScene({
        key: `${currentSession.sessionId}:${currentPhase}:${animate}`,
        frame: frameForPhase(currentPhase), idleVariants: eggIdleVariants(currentPhase), animate,
      })
    } else {
      const petId = current.settings.backScreenPetId
      if (petId && Object.prototype.hasOwnProperty.call(PET_BY_ID, petId) && current.collection[petId]?.count > 0) {
        backScreenEngaged.current = true
        schedulerRef.current!.setScene({
          key: `pet:${petId}:${animate}`, frame: petFrame(petId), idleVariants: petIdleVariants(petId), animate,
        })
      } else if (release || backScreenEngaged.current) {
        // 没有展示对象时沿用原有结束流程，不在首次空记录加载时改变系统背屏。
        schedulerRef.current!.setScene({ key: 'idle', frame: null })
      }
    }
  }, [refreshNow])

  useEffect(() => {
    syncBackScreen()
  }, [loaded, session?.sessionId, phase, record.settings.backScreenPetId, revealing, reducedMotion, syncBackScreen])

  const cancelRevealTransition = useCallback(() => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    revealTimer.current = null
    revealingSession.current = null
    setRevealing(false)
  }, [])

  useEffect(() => () => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    revealTimer.current = null
    revealingSession.current = null
  }, [])

  /* ---------- 定时器：按到期时间刷新 ---------- */
  useEffect(() => {
    if (!session || phase === 'revealed') return
    const timer = window.setInterval(refreshNow, 250)
    return () => window.clearInterval(timer)
  }, [session, phase, refreshNow])

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

  /* ---------- 阶段变化：文案 / 音效 / 振动 ---------- */
  useEffect(() => {
    if (!session || !loaded) return
    const sampledNow = refreshNow()
    const currentSession = recordRef.current.session
    if (!currentSession || currentSession.sessionId !== session.sessionId) return
    const current = computePhase(currentSession, sampledNow)
    const hinted = currentSession.hintedPhases

    if (current === 'ready' && !readyNotified.current) {
      readyNotified.current = true
      const dueToast = () => toast({ title: '孵好了，翻过来看看。', tone: 'success' })
      dueToast()
      if (recordRef.current.settings.sound) sfx.due()
      vibrateDue(currentSession.sessionId)
    }

    if (!hinted.includes(current) && current !== 'revealed') {
      const nextSession: EggSession = { ...currentSession, phase: current, hintedPhases: [...hinted, current] }
      void persist({ ...recordRef.current, session: nextSession })
      if (current === 'waiting') {
        toast({ title: `${formatDuration(currentSession.durationMs)}后，看看里面是谁。` })
      } else if (current === 'cracking') {
        toast({ title: '里面好像动了一下。' })
        if (recordRef.current.settings.sound) sfx.stage()
      }
    }

  }, [session, phase, loaded, persist, refreshNow, toast, vibrateDue])

  /* ---------- 生命周期：回前台只提交当前阶段 ---------- */
  useEffect(() => {
    let offShow: (() => void) | undefined
    let offHide: (() => void) | undefined
    let cancelled = false
    const updateForeground = () => {
      const foreground = nativeForeground.current && pageActive.current && document.visibilityState !== 'hidden'
      foregroundRef.current = foreground
      setIsForeground(foreground)
      setAudioForeground(foreground)
      if (foreground) {
        // 先从记录重算目标，再恢复通道，不补播离开期间的动画。
        syncBackScreen()
        schedulerRef.current!.resume()
        const current = recordRef.current.session
        if (current && computePhase(current, Date.now()) === 'ready' && recordRef.current.settings.flipReveal) {
          flipStop.current = false
        }
      } else {
        cancelDueVibrationTail()
        flipStop.current = true
        flipGeneration.current += 1
        schedulerRef.current!.suspend()
      }
    }
    const onPageHide = () => {
      pageActive.current = false
      updateForeground()
    }
    const onPageShow = () => {
      pageActive.current = true
      updateForeground()
    }
    document.addEventListener('visibilitychange', updateForeground)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    updateForeground()
    // 尽早订阅读档期间的前后台变化；读档成功后再装一次，补回首次桥接失败时的漏订。
    void (async () => {
      try {
        offShow = await onNativeEvent('appShow', () => {
          nativeForeground.current = true
          updateForeground()
        })
        if (cancelled) {
          offShow()
          return
        }
        offHide = await onNativeEvent('appHide', () => {
          nativeForeground.current = false
          updateForeground()
        })
        if (cancelled) offHide()
      } catch {
        // 浏览器预览没有事件通道，忽略
      }
    })()
    return () => {
      cancelled = true
      offShow?.()
      offHide?.()
      document.removeEventListener('visibilitychange', updateForeground)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      schedulerRef.current!.suspend()
      cancelDueVibrationTail()
      setAudioForeground(false)
      foregroundRef.current = false
      flipStop.current = true
    }
  }, [loaded, syncBackScreen, cancelDueVibrationTail])

  /* ---------- 动作：开始一局 ---------- */
  const startSession = useCallback(
    (durationMs?: number): Promise<void> => {
      if (pendingStart.current) return pendingStart.current
      if (!loadedRef.current) return Promise.reject(new Error('正在读取本地记录，请稍后'))
      const chosen = durationMs ?? recordRef.current.settings.lastDurationMs ?? DEFAULT_DURATION_MS
      if (!isValidDuration(chosen)) return Promise.reject(new RangeError('请选择 1 秒到 180 分钟之间的时长'))

      setStarting(true)
      const run = async () => {
        cancelDueVibrationTail()
        cancelRevealTransition()
        const nowTs = Date.now()
        const tier = tierForDuration(chosen)
        const nextSession: EggSession = {
          sessionId: `egg_${nowTs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          tier,
          durationMs: chosen,
          startedAt: nowTs,
          deadlineAt: nowTs + chosen,
          petId: pickPetId(tier),
          phase: 'waiting',
          revealedAt: null,
          hintedPhases: [],
        }
        readyNotified.current = false
        monoBase.current = { wall: nowTs, mono: performance.now() }
        setNow(nowTs)
        const saved = persist({
          ...recordRef.current,
          settings: { ...recordRef.current.settings, lastDurationMs: chosen },
          session: nextSession,
        })
        if (recordRef.current.settings.sound) sfx.start()
        syncBackScreen()
        await saved
      }
      const task = run().finally(() => {
        pendingStart.current = null
        setStarting(false)
      })
      pendingStart.current = task
      return task
    },
    [persist, syncBackScreen, cancelRevealTransition, cancelDueVibrationTail],
  )

  /* ---------- 动作：揭晓（收藏与揭晓状态同一份记录一起更新） ---------- */
  const reveal = useCallback(async () => {
    const nowTs = refreshNow()
    const current = recordRef.current.session
    if (!loadedRef.current || !current || computePhase(current, nowTs) !== 'ready') return
    cancelDueVibrationTail()
    const petId = current.petId
    const prev = recordRef.current.collection[petId] ?? { count: 0, lastRevealedAt: null }
    const nextSession: EggSession = { ...current, phase: 'revealed', revealedAt: nowTs }
    const nextRecord: EggRecord = {
      ...recordRef.current,
      settings: { ...recordRef.current.settings, backScreenPetId: petId },
      session: nextSession,
      collection: {
        ...recordRef.current.collection,
        [petId]: { count: prev.count + 1, lastRevealedAt: nowTs },
      },
    }
    cancelRevealTransition()
    if (!reducedMotionRef.current) {
      revealingSession.current = current.sessionId
      setRevealing(true)
      revealTimer.current = window.setTimeout(() => {
        revealTimer.current = null
        if (revealingSession.current !== current.sessionId) return
        revealingSession.current = null
        setRevealing(false)
        syncBackScreen()
      }, REVEAL_TRANSITION_MS)
    }
    // 状态、计数和背屏选择同步更新引用，连续点击不可能重复入藏。
    const saved = persist(nextRecord, '这次收藏还没保存，请重试')
    if (recordRef.current.settings.sound) sfx.crack()
    syncBackScreen()
    await saved
    if (recordRef.current.session?.sessionId !== current.sessionId) return
    try {
      await invokeNative('vibrateShort', { type: 'light' })
    } catch {
      // 预览环境无振动
    }
  }, [persist, refreshNow, cancelRevealTransition, syncBackScreen, cancelDueVibrationTail])

  /* ---------- 动作：重试保存（同一 sessionId，不重复加次数） ---------- */
  const retrySave = useCallback(async () => {
    if (!loadedRef.current) return
    const snapshot = recordRef.current
    const saved = await saveSnapshot(snapshot, snapshot.session?.phase === 'revealed'
      ? '这次收藏还没保存，请重试' : '原有记录还没保存，请重试')
    if (saved && recordRef.current === snapshot) {
      toast({ title: snapshot.session?.phase === 'revealed' ? '收藏已保存' : '记录已保存', tone: 'success' })
    }
  }, [saveSnapshot, toast])

  /* ---------- 动作：结束本局（恢复已选伙伴，否则释放背屏；释放亮屏） ---------- */
  const abortSession = useCallback(async () => {
    if (!loadedRef.current) return
    readyNotified.current = false
    monoBase.current = null
    flipStop.current = true
    cancelDueVibrationTail()
    cancelRevealTransition()
    const saved = persist({ ...recordRef.current, session: null })
    syncBackScreen(true)
    try {
      await invokeNative('setKeepScreenOn', { keepScreenOn: false })
    } catch {
      // 预览环境忽略
    }
    await saved
  }, [persist, cancelRevealTransition, syncBackScreen, cancelDueVibrationTail])

  /* ---------- 翻面自动揭晓（实验）：ready 后监听加速度 z 轴翻正 ---------- */
  useEffect(() => {
    if (!loaded || phase !== 'ready' || !session) return
    if (!record.settings.flipReveal) return
    flipStop.current = !foregroundRef.current || document.visibilityState === 'hidden'
    const canReadSensor = () => loadedRef.current && foregroundRef.current && document.visibilityState !== 'hidden'
    const timer = window.setInterval(async () => {
      if (flipStop.current || !canReadSensor() || flipReadPending.current) return
      const generation = flipGeneration.current
      flipReadPending.current = true
      try {
        const { values } = await invokeNative('getSensor', { type: 'accelerometer' })
        if (generation !== flipGeneration.current || flipStop.current || !canReadSensor() ||
          recordRef.current.session?.sessionId !== session.sessionId) return
        const z = values?.[2] ?? 0
        if (z > FACE_UP_Z) {
          flipStop.current = true
          await reveal()
        }
      } catch {
        // 传感器不可用：静默停止，主按钮始终可用
        if (generation === flipGeneration.current) flipStop.current = true
      } finally {
        flipReadPending.current = false
      }
    }, FLIP_POLL_MS)
    return () => {
      flipStop.current = true
      flipGeneration.current += 1
      window.clearInterval(timer)
    }
  }, [loaded, phase, session, record.settings.flipReveal, reveal])

  /* ---------- 设置 ---------- */
  const updateSettings = useCallback(
    (patch: Partial<EggSettings>) => {
      if (!loadedRef.current) return
      // 背屏选择只走带所有权与保存状态校验的专用动作。
      if ('backScreenPetId' in patch) return
      if (patch.lastDurationMs !== undefined && !isValidDuration(patch.lastDurationMs)) return
      const next: EggRecord = {
        ...recordRef.current,
        settings: { ...recordRef.current.settings, ...patch },
      }
      if (patch.sound !== undefined) {
        const newlyEnabled = patch.sound && !recordRef.current.settings.sound
        setSoundEnabled(patch.sound)
        if (newlyEnabled) {
          unlockAudio()
          sfx.enable()
        }
      }
      void persist(next)
    },
    [persist],
  )

  const selectBackScreenPet = useCallback(async (petId: string | null) => {
    if (!loadedRef.current || pendingWrites.current > 0 || storageWarningRef.current || revealingSession.current) return
    const current = recordRef.current
    if (current.session && computePhase(current.session, refreshNow()) !== 'revealed') return
    if (petId !== null && (!Object.prototype.hasOwnProperty.call(PET_BY_ID, petId) ||
      (current.collection[petId]?.count ?? 0) <= 0)) return
    if ((current.settings.backScreenPetId ?? null) === petId) return
    const saved = persist({ ...current, settings: { ...current.settings, backScreenPetId: petId } }, '背屏选择还没保存，请重试')
    syncBackScreen(true)
    await saved
  }, [persist, refreshNow, syncBackScreen])

  const canReact = useCallback((kind: ReactionKind) =>
    (kind === 'tap' || kind === 'hold') && loadedRef.current && foregroundRef.current &&
    document.visibilityState !== 'hidden' && !reducedMotionRef.current && !revealingSession.current &&
    pendingWrites.current === 0 && !storageWarningRef.current, [])

  const reactToBackScreenPet = useCallback((petId: string, kind: ReactionKind): boolean => {
    if (!canReact(kind)) return false
    syncBackScreen()
    if (!canReact(kind)) return false
    const current = recordRef.current
    if (current.session && computePhase(current.session, Date.now()) !== 'revealed') return false
    if (current.settings.backScreenPetId !== petId || !Object.prototype.hasOwnProperty.call(PET_BY_ID, petId) ||
      (current.collection[petId]?.count ?? 0) <= 0) return false
    return schedulerRef.current!.playReaction(`pet:${petId}:true`, petReactionFrames(petId, kind))
  }, [canReact, syncBackScreen])

  const reactToBackScreenEgg = useCallback((sessionId: string, kind: ReactionKind): boolean => {
    if (!canReact(kind)) return false
    syncBackScreen()
    if (!canReact(kind)) return false
    const current = recordRef.current.session
    if (!current || current.sessionId !== sessionId) return false
    const currentPhase = computePhase(current, Date.now())
    if (currentPhase === 'revealed') return false
    return schedulerRef.current!.playReaction(`${sessionId}:${currentPhase}:true`, eggReactionFrames(currentPhase, kind))
  }, [canReact, syncBackScreen])

  const retryBackScreen = useCallback(() => {
    if (!loadedRef.current) return
    const scheduler = schedulerRef.current!
    if (scheduler.hasInFlightRequest) {
      if (scheduler.waitingForTimedOutRequest) scheduler.retry()
      return
    }
    resetBackScreenMode()
    syncBackScreen()
    // 连接等待由实际命令触发，统一占用串行通道并受同一个超时诊断保护。
    // sync 可能刚好推进到新阶段并提交目标，此时不再重复提交。
    if (!scheduler.hasInFlightRequest) scheduler.retry()
  }, [syncBackScreen])

  const collectionCount = useMemo(
    () => Object.values(record.collection).filter((c) => c.count > 0).length,
    [record.collection],
  )

  const value = useMemo<EggContextValue>(
    () => ({
      loaded,
      loadError,
      loadErrorCode,
      retryLoad,
      starting,
      saving,
      revealing,
      record,
      settings: record.settings,
      session,
      phase,
      remainingMs: session ? remainingMsOf(session, now) : 0,
      progress: session ? progressOf(session, now) : 0,
      pet,
      backScreenMode,
      backScreenStatus,
      backScreenFrame,
      storageWarning,
      reducedMotion,
      isForeground,
      collectionCount,
      startSession,
      reveal,
      abortSession,
      retrySave,
      updateSettings,
      selectBackScreenPet,
      reactToBackScreenPet,
      reactToBackScreenEgg,
      retryBackScreen,
    }),
    [
      loaded,
      loadError,
      loadErrorCode,
      retryLoad,
      starting,
      saving,
      revealing,
      record,
      record.settings,
      session,
      phase,
      now,
      pet,
      backScreenMode,
      backScreenStatus,
      backScreenFrame,
      storageWarning,
      reducedMotion,
      isForeground,
      collectionCount,
      startSession,
      reveal,
      abortSession,
      retrySave,
      updateSettings,
      selectBackScreenPet,
      reactToBackScreenPet,
      reactToBackScreenEgg,
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
