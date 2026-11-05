import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { PET_BY_ID } from '@/shared/egg/pets'
import { sfx } from '@/shared/egg/audio'
import { useEgg } from '@/shared/egg/EggProvider'
import { PixelPetSprite } from './PixelSprites'
import { usePixelInteraction } from './usePixelInteraction'

export interface PetArtworkProps {
  petId: string
  interactive?: boolean
  silhouette?: boolean
  thumbnail?: boolean
  className?: string
}

export function PetArtwork({ petId, interactive = false, silhouette = false, thumbnail = false, className }: PetArtworkProps) {
  const { reducedMotion, isForeground, reactToBackScreenPet } = useEgg()
  const hintId = useId()
  const pet = PET_BY_ID[petId]
  const enabled = interactive && !silhouette && !!pet
  const art = usePixelInteraction({
    enabled, identity: petId, reducedMotion, foreground: isForeground,
    onReaction: kind => { sfx.petReaction(petId, kind); reactToBackScreenPet(petId, kind) },
  })
  if (!pet) return null
  const Tag = enabled ? 'button' : 'div'
  return <Tag
    ref={art.elementRef}
    {...(enabled ? { type: 'button' as const, ...art.handlers, 'aria-describedby': hintId, 'aria-keyshortcuts': 'Enter Space Shift+Enter' } : { role: 'img' })}
    aria-label={enabled ? `逗逗${pet.name}` : silhouette ? `${pet.name}，还未遇见` : pet.name}
    className={cn('pet-art', enabled && 'art-interactive', silhouette && 'is-silhouette', thumbnail && 'is-thumbnail', className)}
    data-pet={petId} data-tier={pet.tier} data-reacting={art.reacting ? 'true' : 'false'}
    data-motion={art.motion ?? 'still'} data-frame={art.frame} data-reaction-count={art.reactionCount}
  >
    <PixelPetSprite petId={petId} motion={art.motion} frame={art.frame} thumbnail={thumbnail} silhouette={silhouette} />
    {enabled && <>
      <span id={hintId} className="sr-only">轻点打个招呼，按住陪它一会儿。键盘按 Enter 或空格打招呼，Shift 加 Enter 陪伴。</span>
      <span className={cn('pet-art-speech', !art.reacting && 'is-hidden')} aria-live="polite">{art.reacting ? art.motion === 'hold' ? '嗯，就这样陪我一会儿。' : pet.quote : ''}</span>
    </>}
  </Tag>
}
