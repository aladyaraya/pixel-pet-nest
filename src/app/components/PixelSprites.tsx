import { petVisuals, pixelEggImage, pixelNestImage, type PixelImage, type PixelMotion } from '@/shared/egg/pixelVisuals'
import type { EggPhase } from '@/shared/egg/types'

export type { PixelMotion } from '@/shared/egg/pixelVisuals'

function ImagePaths({ image, silhouette = false }: { image: PixelImage; silhouette?: boolean }) {
  return <g transform={image.size === 32 ? 'scale(2)' : undefined}>
    {silhouette ? <path className="paint-silhouette" d={image.silhouette} />
      : image.paths.map(({ paint, d }) => <path key={paint} className={`paint-${paint}`} d={d} />)}
  </g>
}

export interface PixelPetSpriteProps {
  petId: string
  motion: PixelMotion | null
  frame: number
  thumbnail?: boolean
  silhouette?: boolean
}

/** Pure rendering: no timers, sounds, input handlers, state changes, or device writes. */
export function PixelPetSprite({ petId, motion, frame, thumbnail = false, silhouette = false }: PixelPetSpriteProps) {
  const visual = petVisuals[petId]
  if (!visual) throw new Error(`未知像素角色：${petId}`)
  const sequence = motion ? visual.motions[motion] : null
  const image = thumbnail ? visual.thumbnail : sequence ? sequence[Math.max(0, Math.floor(frame)) % sequence.length] : visual.main
  return <svg className="pixel-pet-sprite" viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true" focusable="false" data-pixel-motion={motion ?? 'still'} data-pixel-frame={frame}>
    <path className="paint-ground" d="M22 58h20v1h5v2H17v-2h5z" />
    <g className="pixel-pet-shape"><ImagePaths image={image} silhouette={silhouette} /></g>
  </svg>
}

export interface PixelEggSpriteProps {
  phase: EggPhase
  motion: PixelMotion | null
  frame: number
  breaking?: boolean
}

export function PixelEggSprite({ phase, motion, frame, breaking = false }: PixelEggSpriteProps) {
  return <svg className="pixel-egg-sprite" viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true" focusable="false" data-pixel-motion={motion ?? 'still'} data-pixel-frame={frame}>
    <ImagePaths image={pixelEggImage(phase, motion, frame, breaking)} />
  </svg>
}

const nests = [pixelNestImage(false), pixelNestImage(true)]
export function PixelNest({ broken = false }: { broken?: boolean }) {
  return <svg className="pixel-nest" viewBox="0 0 64 64" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <ImagePaths image={nests[broken ? 1 : 0]} />
  </svg>
}
