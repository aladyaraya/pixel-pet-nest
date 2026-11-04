import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Egg, Volume2, VolumeX } from 'lucide-react'

import { Button } from '@/shared/ui/Button'
import { Card, CardBody } from '@/shared/ui/Card'
import { Dialog } from '@/shared/ui/Dialog'
import { cn } from '@/shared/lib/cn'
import { useEgg } from '@/shared/egg/EggProvider'
import { eggFrames } from '@/shared/egg/patterns'
import { DURATION_OPTIONS_MS, DEFAULT_DURATION_MS, PHASE_LABEL, formatDuration, type EggMode } from '@/shared/egg/types'
import { MatrixView } from '@/app/components/MatrixView'

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function TogglePill({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-tap items-center gap-1.5 rounded-full border px-3 text-caption transition-colors duration-fast',
        on ? 'border-primary bg-primary-soft text-foreground' : 'border-border bg-surface text-muted-foreground',
      )}
    >
      {icon}
      {label}
      <span className={on ? 'text-foreground' : 'text-muted-foreground'}>{on ? '开' : '关'}</span>
    </button>
  )
}

export function StartPage() {
  const navigate = useNavigate()
  const {
    loaded,
    settings,
    session,
    phase,
    remainingMs,
    collectionCount,
    startSession,
    abortSession,
    updateSettings,
  } = useEgg()
  const [pendingStart, setPendingStart] = useState<{ mode: EggMode; durationMs: number } | null>(null)
  const [durationMs, setDurationMs] = useState(
    () => settings.lastDurationMs || DEFAULT_DURATION_MS,
  )

  const active = session != null && phase !== 'revealed'
  const privacyMissing = loaded && settings.privacyAgreed === false

  const onStart = (mode: EggMode) => {
    const chosen = mode === 'demo' ? 0 : durationMs
    if (active) {
      setPendingStart({ mode, durationMs: chosen })
      return
    }
    void startSession(mode, chosen || undefined).then(() => navigate('/hatch'))
  }

  return (
    <div className="page flex min-h-full flex-col">
      {/* 开始页顶部：音效开关（默认关闭） */}
      <div className="flex items-center justify-end gap-2">
        <TogglePill
          on={settings.sound}
          onClick={() => updateSettings({ sound: !settings.sound })}
          icon={settings.sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
          label="音效"
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6">
        <MatrixView
          frame={eggFrames().waiting}
          dot={12}
          label="一颗还没开始的蛋"
          className="rounded-lg bg-surface/60 p-3"
        />

        {active && session ? (
          <Card className="w-full">
            <CardBody className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-body font-medium">这颗蛋还在孵化</span>
                <span className="text-title tabular-nums text-primary">{formatCountdown(remainingMs)}</span>
              </div>
              <p className="text-caption text-muted-foreground">
                阶段：{phase ? PHASE_LABEL[phase] : ''}
                {session.mode === 'demo' ? ' · 演示模式' : ''}
              </p>
              <Button block onClick={() => navigate('/hatch')}>
                继续孵化
              </Button>
            </CardBody>
          </Card>
        ) : null}

        <div className="w-full space-y-3">
          <div className="flex items-center justify-center gap-2" role="group" aria-label="计时时长">
            {DURATION_OPTIONS_MS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={durationMs === option}
                onClick={() => {
                  setDurationMs(option)
                  updateSettings({ lastDurationMs: option })
                }}
                className={cn(
                  'min-h-tap rounded-full border px-3.5 text-body transition-colors duration-fast',
                  durationMs === option
                    ? 'border-primary bg-primary-soft text-foreground'
                    : 'border-border bg-surface text-muted-foreground',
                )}
              >
                {formatDuration(option)}
              </button>
            ))}
          </div>
          <Button size="lg" block onClick={() => onStart('normal')}>
            <Egg className="size-5" aria-hidden />
            孵一颗 · {formatDuration(durationMs)}
          </Button>
          <Button size="lg" variant="outline" block onClick={() => onStart('demo')}>
            体验一局 · 20 秒
          </Button>
        </div>

        <p className="text-center text-body text-muted-foreground">把手机正面朝下放，背屏会慢慢裂开</p>

        {privacyMissing ? (
          <p className="text-center text-caption text-warning">
            同意隐私协议后，进度和收藏才能保存在本机
          </p>
        ) : (
          <p className="text-center text-caption text-muted-foreground">进度与收藏只保存在本机</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate('/collection')}
        className="mb-2 flex min-h-tap items-center justify-center gap-1 rounded-md text-body text-muted-foreground active:bg-accent"
      >
        收藏 · 已遇见 {collectionCount} / 6
        <ChevronRight className="size-4" aria-hidden />
      </button>

      <Dialog
        open={pendingStart !== null}
        onClose={() => setPendingStart(null)}
        title="结束这颗蛋？"
        description="当前这一局会被结束，收藏会保留。确认后开始新的一局。"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingStart(null)}>
              继续孵化
            </Button>
            <Button
              onClick={() => {
                const pending = pendingStart
                setPendingStart(null)
                if (!pending) return
                void abortSession()
                  .then(() => startSession(pending.mode, pending.durationMs || undefined))
                  .then(() => navigate('/hatch'))
              }}
            >
              结束并重孵
            </Button>
          </div>
        }
      />
    </div>
  )
}
