import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Egg, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react'

import { Button } from '@/shared/ui/Button'
import { Card, CardBody } from '@/shared/ui/Card'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/Feedback'
import { useToast } from '@/shared/ui/Toast'
import { cn } from '@/shared/lib/cn'
import { useEgg } from '@/shared/egg/EggProvider'
import { eggFrames } from '@/shared/egg/patterns'
import { petFrame } from '@/shared/egg/pets'
import { PHASE_LABEL } from '@/shared/egg/types'
import { MatrixView } from '@/app/components/MatrixView'
import { usePageTitle } from '@/app/layout/PageTitle'

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

const PHASE_HINT: Record<string, string> = {
  waiting: '把手机正面朝下放，背屏会慢慢裂开',
  cracking: '蛋壳上出现了一道裂纹',
  almost: '裂纹越来越多了，就快出来',
  ready: '孵好了，翻过来看看。',
}

export function HatchPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const {
    loaded,
    session,
    phase,
    remainingMs,
    pet,
    settings,
    backScreenMode,
    backScreenStatus,
    storageWarning,
    reducedMotion,
    reveal,
    startSession,
    abortSession,
    retrySave,
    retryBackScreen,
    updateSettings,
  } = useEgg()

  const [confirmAbort, setConfirmAbort] = useState(false)
  const [breaking, setBreaking] = useState(false)
  const [breakFrame, setBreakFrame] = useState(0)
  const breakTimer = useRef<number | null>(null)

  const revealed = phase === 'revealed'
  usePageTitle(revealed ? '揭晓' : '孵化中')

  /* 破壳节奏：0–1 秒两帧交替（约每秒 1 帧），随后定格角色；减少动态时直接显示结果 */
  useEffect(() => {
    if (!revealed || reducedMotion) {
      setBreaking(false)
      return
    }
    setBreaking(true)
    setBreakFrame(0)
    let frame = 0
    breakTimer.current = window.setInterval(() => {
      frame += 1
      setBreakFrame(frame % 2)
      if (frame >= 2) {
        if (breakTimer.current) window.clearInterval(breakTimer.current)
        breakTimer.current = null
        setBreaking(false)
      }
    }, 500)
    return () => {
      if (breakTimer.current) window.clearInterval(breakTimer.current)
      breakTimer.current = null
    }
  }, [revealed, reducedMotion])

  if (!loaded) return null

  if (!session) {
    return (
      <div className="page flex min-h-full flex-col items-center justify-center gap-4">
        <EmptyState
          title="还没有正在孵的蛋"
          description="回到开始页，孵一颗属于自己的蛋。"
          action={
            <Button onClick={() => navigate('/')}>
              <Egg className="size-4" aria-hidden />
              去开始
            </Button>
          }
        />
      </div>
    )
  }

  const frames = eggFrames()
  const previewFrame = revealed
    ? breaking
      ? breakFrame === 0
        ? frames.ready
        : frames.readyAlt
      : pet
        ? petFrame(pet.id)
        : frames.ready
    : frames[phase ?? 'waiting']

  const backScreenHint = (() => {
    if (backScreenStatus === 'ok') {
      return backScreenMode === 'simulated' ? '背屏预览模拟中（非真机）' : '背屏显示中'
    }
    if (backScreenStatus === 'failed') return '背屏暂时没接上'
    return '背屏待连接'
  })()

  return (
    <div className="page flex min-h-full flex-col gap-5">
      {/* 倒计时每秒刷新但不进读屏播报区；阶段与结果文本才播报（PRD：读屏不每秒报倒计时） */}
      <div className="flex flex-col items-center gap-1 pt-2">
        {revealed ? (
          <span className="text-title font-semibold">孵出来了</span>
        ) : (
          <>
            <span aria-live="off" className="text-display tabular-nums font-semibold text-primary">
              {formatCountdown(remainingMs)}
            </span>
            <span className="text-caption text-muted-foreground">
              {phase ? PHASE_LABEL[phase] : ''}
              {session.mode === 'demo' ? ' · 演示模式' : ''}
            </span>
          </>
        )}
        {session.mode === 'demo' ? (
          <span className="mt-1 rounded-full bg-warning px-3 py-1 text-caption font-medium text-warning-foreground">
            演示模式 · 20 秒
          </span>
        ) : null}
      </div>

      <div className="flex flex-col items-center gap-4">
        <MatrixView
          frame={previewFrame}
          dot={11}
          label={revealed && pet ? `已孵出的角色：${pet.name}` : `蛋的当前阶段：${phase ? PHASE_LABEL[phase] : ''}`}
          className="rounded-lg bg-surface/60 p-3"
        />
        <p aria-live="polite" className="min-h-[22px] text-center text-body text-muted-foreground">
          {revealed && pet ? `${pet.name}：${pet.quote}` : PHASE_HINT[phase ?? 'waiting']}
        </p>
      </div>

      {/* 背屏状态 */}
      <div className="flex items-center justify-center gap-2 text-caption">
        <span className={cn('text-muted-foreground')}>{backScreenHint}</span>
        {backScreenStatus === 'failed' || backScreenStatus === 'unknown' ? (
          <button
            type="button"
            onClick={retryBackScreen}
            className="inline-flex min-h-tap items-center gap-1 rounded-md px-2 text-primary active:bg-accent"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            重试
          </button>
        ) : null}
      </div>

      {storageWarning ? (
        <Card className="border-warning/40">
          <CardBody className="flex items-center justify-between gap-3 p-3">
            <span className="flex items-center gap-2 text-body text-warning">
              <TriangleAlert className="size-4" aria-hidden />
              {storageWarning}
            </span>
            <Button size="sm" variant="outline" onClick={() => void retrySave()}>
              重试保存
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-auto space-y-3 pb-2">
        {!revealed ? (
          <>
            {phase === 'ready' ? (
              <Button size="lg" block onClick={() => void reveal()}>
                <Sparkles className="size-5" aria-hidden />
                看看是谁
              </Button>
            ) : (
              <div className="rounded-lg border border-border bg-surface px-4 py-3 text-center">
                <p className="text-body">已经开始了，放下手机等一会儿</p>
                <p className="mt-1 text-caption text-muted-foreground">提前翻回也能看到进度，放下还是同一颗蛋</p>
              </div>
            )}

            <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <span className="text-body">
                翻面自动揭晓
                <span className="ml-2 text-caption text-muted-foreground">实验功能，真机验证后生效</span>
              </span>
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={settings.flipReveal}
                onChange={(e) => updateSettings({ flipReveal: e.target.checked })}
              />
            </label>

            <Button
              variant="ghost"
              block
              onClick={() => setConfirmAbort(true)}
            >
              结束这颗蛋
            </Button>
          </>
        ) : (
          <>
            <Card>
              <CardBody className="flex flex-col items-center gap-2 p-4">
                <span className="text-display font-semibold">{pet?.name}</span>
                <span className="text-body text-muted-foreground">{pet?.quote}</span>
                <span className="text-caption text-muted-foreground">已收进收藏</span>
              </CardBody>
            </Card>
            <div className="space-y-2">
              <Button
                size="lg"
                block
                onClick={() => void startSession(session.mode, session.durationMs)}
              >
                <Egg className="size-5" aria-hidden />
                再孵一颗
              </Button>
              <Button variant="outline" block onClick={() => navigate('/collection')}>
                去看看收藏
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={confirmAbort}
        onClose={() => setConfirmAbort(false)}
        title="结束这颗蛋？"
        description="这一局会被结束，收藏会保留。"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmAbort(false)}>
              继续孵
            </Button>
            <Button
              onClick={() => {
                setConfirmAbort(false)
                void abortSession().then(() => {
                  toast({ title: '已结束这一局' })
                  navigate('/')
                })
              }}
            >
              结束
            </Button>
          </div>
        }
      />
    </div>
  )
}
