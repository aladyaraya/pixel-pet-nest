import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Egg, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'
import { useEgg } from '@/shared/egg/EggProvider'
import { PHASE_LABEL, DEFAULT_DURATION_MS, isValidDuration } from '@/shared/egg/types'
import { usePageTitle } from '@/app/layout/PageTitle'
import { EggScene } from '@/app/components/EggScene'
import { PetArtwork } from '@/app/components/PetArtwork'
import { PixelNest } from '@/app/components/PixelSprites'
import { BackScreenPanel, RecordLoadNotice, SaveNotice, TierBadge } from '@/app/components/EggUI'

const PHASE_HINT: Record<string, string> = {
  waiting: '它在里面，做着一个小小的梦。',
  cracking: '嘘，里面好像动了一下。',
  almost: '就快见面了，再等一小会儿。',
  ready: '小伙伴准备好了，来和它见面吧。',
}

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

export function HatchPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const {
    loaded, starting, saving, session, phase, remainingMs, pet, settings,
    storageWarning, revealing, reveal, startSession, abortSession, updateSettings,
  } = useEgg()
  const [confirmAbort, setConfirmAbort] = useState(false)
  const [ending, setEnding] = useState(false)
  const met = phase === 'revealed' && !revealing
  usePageTitle(met ? '初次见面' : '孵化中')

  if (!loaded) return <RecordLoadNotice />
  if (!session) return (
    <div className="page flex min-h-full flex-col items-center justify-center gap-4">
      <EmptyState title="还没有正在孵的蛋" description="回到开始页，孵一颗属于自己的蛋。"
        action={<Button onClick={() => navigate('/')}><Egg className="size-4" aria-hidden />去开始</Button>} />
    </div>
  )

  const progress = Math.max(0, Math.min(1, 1 - remainingMs / session.durationMs))
  const endSession = async () => {
    setEnding(true)
    try {
      await abortSession()
      setConfirmAbort(false)
      navigate('/')
      toast({ title: '已结束这一局' })
    } catch {
      toast({ title: '暂时无法结束，请重试', tone: 'warning' })
    } finally {
      setEnding(false)
    }
  }

  return (
    <div className="page story-page hatch-page">
      <div className="hatch-heading">
        <span className="story-eyebrow">{met ? '一次小小的相遇' : revealing ? '惊喜正在发生' : '给等待一点温柔'}</span>
        {session.tier ? <TierBadge tier={session.tier} /> : null}
      </div>

      {met && pet ? (
        <div className="pet-meeting-scene">
          <PixelNest broken />
          <PetArtwork petId={pet.id} interactive className="hatch-pet-art" />
        </div>
      ) : (
        <EggScene phase={revealing ? 'ready' : phase ?? 'waiting'} tier={session.tier}
          breaking={revealing} interactive={!revealing} sessionId={session.sessionId} className="hatch-egg-scene" />
      )}

      <div className="hatch-story">
        {met ? <p className="interaction-hint">轻点打个招呼，按住陪它一会儿</p> : null}
        {revealing ? <p role="status" className="text-title font-semibold">正在破壳…</p> : met && pet ? (
          <>
            <h2 className="pet-meeting-name">{pet.name}</h2>
            <p className="pet-meeting-quote">“{pet.quote}”</p>
            <p className="meeting-save-state" role="status">
              {!saving && !storageWarning ? <Check className="size-3.5" aria-hidden /> : null}
              {saving ? '正在保存收藏…' : storageWarning ? '收藏待保存' : '已收进收藏'}
            </p>
          </>
        ) : (
          <>
            <div className="hatch-countdown" aria-live="off">{formatCountdown(remainingMs)}</div>
            <p className="text-caption text-muted-foreground">{phase ? PHASE_LABEL[phase] : ''}</p>
            <div className="hatch-progress" role="progressbar" aria-label="孵化进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress * 100)}>
              <span style={{ transform: 'scaleX(' + progress + ')' }} />
            </div>
            <p className="hatch-phase-hint" aria-live="polite">{PHASE_HINT[phase ?? 'waiting']}</p>
          </>
        )}
      </div>
      <SaveNotice />

      <div className="hatch-actions">
        {revealing ? <div className="reveal-wait-note">蛋壳轻轻打开，小伙伴就要来了。</div> : met ? (
          <>
            <Button size="lg" block loading={starting} disabled={saving || !!storageWarning} onClick={() => {
              const duration = session.tier === null
                ? isValidDuration(settings.lastDurationMs) ? settings.lastDurationMs : DEFAULT_DURATION_MS
                : session.durationMs
              void startSession(duration).catch(() => toast({ title: '暂时无法开始，请重试', tone: 'warning' }))
            }}><Egg className="size-5" aria-hidden />再孵一颗</Button>
            <Button variant="outline" block onClick={() => navigate('/collection')}>去看看收藏</Button>
          </>
        ) : phase === 'ready' ? (
          <Button size="lg" block onClick={() => void reveal()}><Sparkles className="size-5" aria-hidden />看看是谁</Button>
        ) : (
          <div className="waiting-note">
            <p>已经开始了，放下手机等一会儿</p>
            <span>提前翻回也能看到进度，放下还是同一颗蛋</span>
          </div>
        )}
      </div>
      <BackScreenPanel />
      {!met && !revealing ? (
        <>
          <div className="flip-setting">
            <div>
              <p id="flip-label" className="text-body">翻面自动揭晓</p>
              <p className="text-caption text-muted-foreground">实验功能，需真机验证</p>
            </div>
            <button type="button" role="switch" aria-labelledby="flip-label" aria-checked={settings.flipReveal}
              className="egg-switch" data-checked={settings.flipReveal}
              onClick={() => updateSettings({ flipReveal: !settings.flipReveal })}>
              <span aria-hidden />
            </button>
          </div>
          <Button variant="ghost" block onClick={() => setConfirmAbort(true)} className="end-egg-button">结束这颗蛋</Button>
        </>
      ) : null}

      <Dialog open={confirmAbort} onClose={() => { if (!ending) setConfirmAbort(false) }} title="结束这颗蛋？"
        description="这一局会被结束，收藏会保留。"
        footer={<>
          <Button variant="ghost" disabled={ending} onClick={() => setConfirmAbort(false)}>继续孵</Button>
          <Button loading={ending} onClick={() => void endSession()}>结束</Button>
        </>} />
    </div>
  )
}
