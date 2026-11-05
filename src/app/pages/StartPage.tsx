import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, ChevronRight, Egg, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { useToast } from '@/shared/ui/Toast'
import { useEgg } from '@/shared/egg/EggProvider'
import { APP_NAME } from '@/shared/config/app'
import { DEFAULT_DURATION_MS, PHASE_LABEL, formatDuration, isValidDuration, tierForDuration, TIER_LABEL } from '@/shared/egg/types'
import { PETS, PET_BY_ID } from '@/shared/egg/pets'
import { EggScene } from '@/app/components/EggScene'
import { PetArtwork } from '@/app/components/PetArtwork'
import { RecordLoadNotice, SaveNotice, TierBadge } from '@/app/components/EggUI'

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

export function StartPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { loaded, starting, settings, session, phase, remainingMs, collectionCount, revealing, startSession, abortSession, updateSettings } = useEgg()
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  const [minutes, setMinutes] = useState('3')
  const [seconds, setSeconds] = useState('0')
  const [busy, setBusy] = useState(false)
  const initialized = useRef(false)
  const startLock = useRef(false)
  const durationFields = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const keepFocusedInputVisible = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const input = document.activeElement
        if (!(input instanceof HTMLInputElement) || !durationFields.current?.contains(input)) return
        const scroller = input.closest('main')
        if (!scroller) return
        const viewport = window.visualViewport
        const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 16
        const rect = input.getBoundingClientRect()
        if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom
      })
    }
    window.addEventListener('resize', keepFocusedInputVisible)
    window.visualViewport?.addEventListener('resize', keepFocusedInputVisible)
    document.addEventListener('focusin', keepFocusedInputVisible)
    // dvh 的布局更新可能晚于 resize 的首个 rAF；等滚动容器变小后再校正。
    const scroller = document.querySelector('main')
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keepFocusedInputVisible)
    if (scroller) resizeObserver?.observe(scroller)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', keepFocusedInputVisible)
      window.visualViewport?.removeEventListener('resize', keepFocusedInputVisible)
      document.removeEventListener('focusin', keepFocusedInputVisible)
    }
  }, [])

  useEffect(() => {
    if (!loaded || initialized.current) return
    initialized.current = true
    const saved = isValidDuration(settings.lastDurationMs) ? settings.lastDurationMs : DEFAULT_DURATION_MS
    setMinutes(String(Math.floor(saved / 60_000)))
    setSeconds(String((saved / 1000) % 60))
  }, [loaded, settings.lastDurationMs])

  const durationMs = (Number(minutes) * 60 + Number(seconds)) * 1000
  const valid = /^\d+$/.test(minutes) && /^\d+$/.test(seconds)
    && Number(seconds) <= 59 && isValidDuration(durationMs)
  const tier = valid ? tierForDuration(durationMs) : null
  const active = session != null && phase !== 'revealed'
  const selectedPet = !revealing && settings.backScreenPetId ? PET_BY_ID[settings.backScreenPetId] : null
  const rememberDuration = () => {
    if (loaded && valid && durationMs !== settings.lastDurationMs) updateSettings({ lastDurationMs: durationMs })
  }

  const begin = async (chosen: number, replace = false) => {
    if (startLock.current || !loaded || starting) return
    startLock.current = true
    setBusy(true)
    try {
      if (replace) await abortSession()
      await startSession(chosen)
      navigate('/hatch')
    } catch {
      toast({ title: '暂时无法开始，请重试', tone: 'warning' })
    } finally {
      startLock.current = false
      setBusy(false)
    }
  }
  const onStart = () => {
    if (!loaded || !valid || busy || starting) return
    if (active) setPendingStart(durationMs)
    else void begin(durationMs)
  }

  if (!loaded) return <RecordLoadNotice />

  return (
    <div className="page story-page start-page">
      <div className="start-toolbar">
        <span className="story-wordmark"><Egg className="size-5" aria-hidden />{APP_NAME}</span>
        <button type="button" className="sound-toggle" aria-pressed={settings.sound}
          onClick={() => updateSettings({ sound: !settings.sound })}>
          {settings.sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
          音效 {settings.sound ? '开' : '关'}
        </button>
      </div>
      <div className="start-intro">
        <h1>留一点时间，<br />等一个小伙伴。</h1>
        <p>放下手机，让小小的惊喜慢慢发生。</p>
      </div>
      <EggScene phase={revealing ? 'ready' : active && phase ? phase : 'waiting'}
        tier={active ? session?.tier : tier} interactive={!revealing} breaking={revealing}
        sessionId={active ? session?.sessionId : undefined} className="start-egg-scene" />

      {active && session ? (
        <section className="active-egg-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body font-semibold">这颗蛋还在孵化</span>
            <span className="text-title font-semibold tabular-nums text-primary">{formatCountdown(remainingMs)}</span>
          </div>
          <p className="text-caption text-muted-foreground">
            阶段：{phase ? PHASE_LABEL[phase] : ''}{session.tier ? ' · ' + TIER_LABEL[session.tier] + '宠物' : ''}
          </p>
          <Button block onClick={() => navigate('/hatch')}>继续孵化<ArrowUpRight className="size-4" aria-hidden /></Button>
        </section>
      ) : null}
      <SaveNotice />

      <section className="duration-card" aria-label="孵化设置">
        <div className="duration-card-heading">
          <span className="text-body font-semibold">{active ? '下一颗，想等多久？' : '这一次，想等多久？'}</span>
          <span aria-live="polite">{tier ? <TierBadge tier={tier} /> : <span className="text-caption text-muted-foreground">等待有效时长</span>}</span>
        </div>
        <div ref={durationFields} className="duration-fields" role="group" aria-label="自定义计时时长">
          <Input label="分钟" inputMode="numeric" pattern="[0-9]*" value={minutes} className="duration-input"
            disabled={busy || starting} aria-describedby="duration-help" aria-invalid={!valid}
            onChange={(event) => setMinutes(event.target.value)} onBlur={rememberDuration} />
          <span className="duration-colon" aria-hidden>:</span>
          <Input label="秒" inputMode="numeric" pattern="[0-9]*" value={seconds} className="duration-input"
            disabled={busy || starting} aria-describedby="duration-help" aria-invalid={!valid}
            onChange={(event) => setSeconds(event.target.value)} onBlur={rememberDuration} />
        </div>
        <p id="duration-help" className={'text-caption ' + (valid ? 'text-muted-foreground' : 'text-warning')} role={valid ? undefined : 'alert'}>
          {valid ? '可设置 1 秒至 180 分钟' : '请输入 1 秒至 180 分钟，秒数须为 0–59'}
        </p>
        <Button size="lg" block loading={busy || starting} disabled={!valid} onClick={onStart}>
          <Egg className="size-5" aria-hidden />
          {valid ? '孵一颗 · ' + formatDuration(durationMs) : '设置时长后开始'}
        </Button>
      </section>
      <p className="start-instruction">把手机正面朝下放，背屏会慢慢裂开</p>
      <button type="button" onClick={() => navigate('/collection')} className="collection-entry">
        {selectedPet ? <PetArtwork petId={selectedPet.id} thumbnail className="selected-pet-thumb" /> : <span className="collection-entry-icon"><Egg className="size-5" aria-hidden /></span>}
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-body font-medium">收藏 · 已遇见 {collectionCount} / {PETS.length}</span>
          <span className="block text-caption text-muted-foreground">{selectedPet ? '已选伙伴 · ' + selectedPet.name : '每一次相遇，都好好收起来'}</span>
        </span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </button>
      <p className={'local-note ' + (settings.privacyAgreed === false ? 'text-warning' : 'text-muted-foreground')}>
        {settings.privacyAgreed === false ? '同意隐私协议后，进度和收藏才能保存在本机' : '进度与收藏只保存在本机'}
      </p>
      <Dialog open={pendingStart !== null} onClose={() => setPendingStart(null)} title="结束这颗蛋？"
        description="当前这一局会被结束，收藏会保留。确认后开始新的一局。"
        footer={<>
          <Button variant="ghost" onClick={() => setPendingStart(null)}>继续孵化</Button>
          <Button loading={busy || starting} onClick={() => {
            const pending = pendingStart
            setPendingStart(null)
            if (pending !== null) void begin(pending, true)
          }}>结束并重孵</Button>
        </>} />
    </div>
  )
}
