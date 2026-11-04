import { useNavigate } from 'react-router-dom'
import { ChevronRight, Egg, Volume2 } from 'lucide-react'

import { Button } from '@/shared/ui/Button'
import { Card, CardBody } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'
import { useEgg } from '@/shared/egg/EggProvider'
import { sfx } from '@/shared/egg/audio'
import { PETS, petFrame } from '@/shared/egg/pets'
import { MatrixView } from '@/app/components/MatrixView'
import { usePageTitle } from '@/app/layout/PageTitle'
import { formatRelativeTime } from '@/shared/lib/format'

export function CollectionPage() {
  usePageTitle('收藏')
  const navigate = useNavigate()
  const { loaded, record, session, phase, settings } = useEgg()
  const { toast } = useToast()

  if (!loaded) return null

  const active = session != null && phase !== 'revealed'
  const metCount = PETS.filter((pet) => (record.collection[pet.id]?.count ?? 0) > 0).length

  return (
    <div className="page flex min-h-full flex-col gap-4">
      <div className="flex items-baseline justify-between pt-1">
        <h2 className="text-title font-semibold">收藏</h2>
        <span className="text-body text-muted-foreground">已遇见 {metCount} / {PETS.length}</span>
      </div>

      {metCount === 0 ? (
        <EmptyState
          title="还没有遇见任何角色"
          description="孵一颗蛋，揭晓后角色会收进这里。"
          action={
            <Button onClick={() => navigate('/')}>
              <Egg className="size-4" aria-hidden />
              去孵一颗
            </Button>
          }
        />
      ) : null}

      <ul className="space-y-2">
        {PETS.map((pet) => {
          const entry = record.collection[pet.id]
          const met = (entry?.count ?? 0) > 0
          return (
            <li key={pet.id}>
              <Card>
                <CardBody className="flex items-center gap-3 p-3">
                  <MatrixView
                    frame={petFrame(pet.id)}
                    dot={5}
                    silhouette={!met}
                    label={met ? `${pet.name}点阵图` : `${pet.name}剪影（未遇见）`}
                    className="rounded-md bg-surface-muted p-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={met ? 'text-body font-medium text-foreground' : 'text-body font-medium text-muted-foreground'}>{pet.name}</span>
                      {met ? (
                        <span className="text-caption text-muted-foreground">
                          · {entry?.count} 次
                        </span>
                      ) : (
                        <span className="text-caption text-muted-foreground">· 未遇见</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-caption text-muted-foreground">
                      {met ? pet.quote : '还没见到这一只'}
                    </p>
                    {met && entry?.lastRevealedAt ? (
                      <p className="text-caption text-muted-foreground">
                        最近 {formatRelativeTime(new Date(entry.lastRevealedAt).toISOString())}
                      </p>
                    ) : null}
                  </div>
                  {met ? (
                    <button
                      type="button"
                      aria-label={`重听${pet.name}的文案`}
                      onClick={() => {
                        if (settings.sound) sfx.meet()
                        toast({ title: `${pet.name}：${pet.quote}` })
                      }}
                      className="flex size-11 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
                    >
                      <Volume2 className="size-5" aria-hidden />
                    </button>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          )
        })}
      </ul>

      <div className="mt-auto space-y-2 pb-2">
        {active ? (
          <Button block onClick={() => navigate('/hatch')}>
            回到这颗蛋
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button block onClick={() => navigate('/')}>
            孵一颗
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
