import { useEffect, useId, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { PHASE_LABEL, type EggPhase, type PetTier } from '@/shared/egg/types'
import { useEgg } from '@/shared/egg/EggProvider'
import { sfx } from '@/shared/egg/audio'
import { PixelEggSprite, PixelNest } from './PixelSprites'
import { usePixelInteraction } from './usePixelInteraction'

export interface EggSceneProps {
  phase: EggPhase
  tier?: PetTier | null
  breaking?: boolean
  interactive?: boolean
  /** Only the live incubation scene may send an egg response to the back screen. */
  sessionId?: string
  className?: string
}

export function EggScene({ phase, tier, breaking = false, interactive = false, sessionId, className }: EggSceneProps) {
  const { reducedMotion, isForeground, reactToBackScreenEgg } = useEgg()
  const hintId = useId()
  const [breakingFrame, setBreakingFrame] = useState(0)
  useEffect(() => {
    setBreakingFrame(0)
    if (!breaking || reducedMotion || !isForeground) return
    let next = 0
    const timer = window.setInterval(() => {
      next += 1
      setBreakingFrame(Math.min(3, next))
      if (next >= 3) window.clearInterval(timer)
    }, 300)
    return () => window.clearInterval(timer)
  }, [breaking, reducedMotion, isForeground])
  const enabled = interactive && !breaking
  const art = usePixelInteraction({
    enabled, identity: `${sessionId ?? 'home'}:${phase}:${breaking}`, reducedMotion, foreground: isForeground,
    onReaction: kind => { sfx.eggReaction(kind); if (sessionId) reactToBackScreenEgg(sessionId, kind) },
  })
  const Tag = enabled ? 'button' : 'div'
  return <Tag
    ref={art.elementRef}
    {...(enabled ? { type: 'button' as const, ...art.handlers, 'aria-describedby': hintId, 'aria-keyshortcuts': 'Enter Space Shift+Enter' } : { role: 'img' })}
    aria-label={enabled ? '轻碰这颗蛋' : `小窝里的蛋，${PHASE_LABEL[phase]}`}
    className={cn('egg-scene', enabled && 'art-interactive', breaking && 'egg-breaking', className)}
    data-phase={phase} data-tier={tier ?? undefined} data-reacting={art.reacting ? 'true' : 'false'}
    data-motion={art.motion ?? 'still'} data-frame={art.frame} data-reaction-count={art.reactionCount}
  >
    <PixelNest />
    <PixelEggSprite phase={phase} motion={art.motion} frame={breaking ? breakingFrame : art.frame} breaking={breaking} />
    {enabled && <>
      <span id={hintId} className="sr-only">轻点听听动静，按住陪它一会儿。互动不改变孵化时间。Shift 加 Enter 也可以陪伴。</span>
      <span className={cn('pet-art-speech egg-art-speech', !art.reacting && 'is-hidden')} aria-live="polite">{art.reacting ? art.motion === 'hold' ? '安心等一会儿，我们很快见面。' : '听，里面好像动了一下。' : ''}</span>
    </>}
  </Tag>
}
