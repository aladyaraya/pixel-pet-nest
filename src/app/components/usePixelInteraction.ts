import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import type { ArtMotionKind, ReactionKind } from '@/shared/egg/motion'

const HOLD_MS = 600
const MOVE_LIMIT = 10
const IDLE_GAPS = [8000, 10000, 12000]
type Gesture = { id: number; x: number; y: number; consumed: boolean }

/** Pure presentation state. Gestures never write records or own a device connection. */
export function usePixelInteraction(options: {
  enabled: boolean
  identity: string
  reducedMotion: boolean
  foreground: boolean
  onReaction: (kind: ReactionKind) => void
}) {
  const [motion, setMotion] = useState<ArtMotionKind | null>(null)
  const [frame, setFrame] = useState(0)
  const [reactionCount, setReactionCount] = useState(0)
  const [inView, setInView] = useState(true)
  const element = useRef<HTMLElement | null>(null)
  const latest = useRef(options)
  latest.current = options
  const live = useRef(false)
  const current = useRef<ArtMotionKind | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const spaceDown = useRef(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const motionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleIndex = useRef(0)
  const idleVariant = useRef(0)
  const motionStartedAt = useRef(0)
  const queueIdle = useRef<() => void>(() => undefined)

  const cancelGesture = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current)
    holdTimer.current = null
    gesture.current = null
    spaceDown.current = false
  }, [])
  const cancelMotion = useCallback(() => {
    if (motionTimer.current !== null) clearTimeout(motionTimer.current)
    if (idleTimer.current !== null) clearTimeout(idleTimer.current)
    motionTimer.current = idleTimer.current = null
    current.current = null
    setMotion(null)
    setFrame(0)
  }, [])

  const play = useCallback((kind: ArtMotionKind) => {
    if (!live.current) return false
    const manual = kind === 'tap' || kind === 'hold'
    if (current.current === 'tap' || current.current === 'hold') return false
    if (motionTimer.current !== null) clearTimeout(motionTimer.current)
    if (idleTimer.current !== null) clearTimeout(idleTimer.current)
    idleTimer.current = null
    current.current = kind
    motionStartedAt.current = performance.now()
    setMotion(kind)
    setFrame(latest.current.reducedMotion ? 1 : 0)
    if (manual) {
      idleIndex.current = 0
      setReactionCount(value => value + 1)
      latest.current.onReaction(kind)
    }
    const duration = kind === 'hold' ? 1800 : kind === 'tap' ? 1000 : 1200
    const step = kind === 'tap' ? 200 : 300
    let elapsed = 0
    const tick = () => {
      if (!live.current) return
      elapsed += latest.current.reducedMotion ? duration : step
      if (elapsed >= duration) {
        current.current = null
        motionTimer.current = null
        setMotion(null)
        setFrame(0)
        queueIdle.current()
      } else {
        setFrame(elapsed / step)
        motionTimer.current = setTimeout(tick, step)
      }
    }
    motionTimer.current = setTimeout(tick, latest.current.reducedMotion ? duration : step)
    return true
  }, [])

  queueIdle.current = () => {
    if (!live.current || latest.current.reducedMotion) return
    const gap = IDLE_GAPS[idleIndex.current % IDLE_GAPS.length]
    idleIndex.current += 1
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null
      play(idleVariant.current++ % 2 ? 'idle-b' : 'idle-a')
    }, Math.max(1000, motionStartedAt.current + gap - performance.now()))
  }

  const elementRef = useCallback((node: HTMLElement | null) => { element.current = node }, [])
  useEffect(() => {
    if (!options.enabled || !element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? true))
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [options.enabled, options.identity])

  useEffect(() => {
    const resume = () => {
      live.current = options.enabled && options.foreground && inView && document.visibilityState !== 'hidden'
      cancelGesture()
      cancelMotion()
      idleIndex.current = idleVariant.current = 0
      motionStartedAt.current = performance.now()
      if (live.current) queueIdle.current()
    }
    const secondPointer = (event: globalThis.PointerEvent) => {
      if (gesture.current && gesture.current.id !== event.pointerId) cancelGesture()
    }
    const suspend = () => { live.current = false; cancelGesture(); cancelMotion() }
    document.addEventListener('visibilitychange', resume)
    document.addEventListener('scroll', cancelGesture, true)
    document.addEventListener('pointerdown', secondPointer, true)
    window.addEventListener('blur', cancelGesture)
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', resume)
    resume()
    return () => {
      live.current = false
      cancelGesture()
      cancelMotion()
      document.removeEventListener('visibilitychange', resume)
      document.removeEventListener('scroll', cancelGesture, true)
      document.removeEventListener('pointerdown', secondPointer, true)
      window.removeEventListener('blur', cancelGesture)
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', resume)
    }
  }, [options.enabled, options.identity, options.foreground, options.reducedMotion, inView, cancelGesture, cancelMotion])

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!live.current || !event.isPrimary || event.button !== 0) { cancelGesture(); return }
    if (current.current === 'tap' || current.current === 'hold') return
    cancelGesture()
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, consumed: false }
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      const pending = gesture.current
      if (!pending || !live.current) return
      pending.consumed = true
      play('hold')
    }, HOLD_MS)
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const pending = gesture.current
    if (pending && (pending.id !== event.pointerId || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > MOVE_LIMIT)) cancelGesture()
  }
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const pending = gesture.current
    cancelGesture()
    if (pending?.id === event.pointerId && !pending.consumed) play('tap')
  }
  const onClick = (event: MouseEvent<HTMLElement>) => {
    // Pointer activation was handled on release. detail=0 is assistive/programmatic activation.
    if (event.detail === 0) play('tap')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (event.repeat) return
    if (event.key === 'Enter') play(event.shiftKey ? 'hold' : 'tap')
    else spaceDown.current = true
  }
  const onKeyUp = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== ' ') return
    event.preventDefault()
    if (spaceDown.current) { spaceDown.current = false; play('tap') }
  }
  return {
    motion, frame, reactionCount, elementRef,
    reacting: motion === 'tap' || motion === 'hold',
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancelGesture,
      onPointerLeave: cancelGesture, onBlur: cancelGesture, onClick, onKeyDown, onKeyUp,
      onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault() },
  }
}
