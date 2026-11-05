import { ChevronDown, Monitor, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEgg } from '@/shared/egg/EggProvider'
import { TIER_LABEL, type PetTier } from '@/shared/egg/types'
import { Button } from '@/shared/ui/Button'
import { MatrixView } from './MatrixView'

export const TIER_RULES: Record<PetTier, string> = {
  low: '不足 3 分钟',
  normal: '3 至不足 7 分钟',
  high: '7 至不足 10 分钟',
  ornate: '10 分钟及以上',
}

export function TierBadge({ tier }: { tier: PetTier }) {
  return <span className="pet-tier" data-tier={tier}><span aria-hidden className="tier-seed" />{TIER_LABEL[tier]}宠物</span>
}

/** 无法读到原记录时保留它，重试成功前不展示空收藏或提供写入操作。 */
export function RecordLoadNotice() {
  const { loadError, retryLoad } = useEgg()
  if (!loadError) return <div className="page text-center text-muted-foreground" role="status">正在读取进度…</div>
  return <section className="page" aria-labelledby="record-load-title">
    <div className="duration-card space-y-4" role="alert">
      <TriangleAlert className="size-6 text-warning" aria-hidden />
      <h1 id="record-load-title" className="text-title font-semibold">暂时读不到你的进度</h1>
      <p className="text-body">{loadError}</p>
      <p className="text-caption text-muted-foreground">读取成功后再继续孵化。</p>
      <Button variant="outline" block onClick={retryLoad}>重新读取</Button>
    </div>
  </section>
}

export function SaveNotice() {
  const { storageWarning, saving, retrySave } = useEgg()
  if (!storageWarning) return null
  return (
    <div className="save-notice" role="status">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-body">{storageWarning}</p>
      <Button variant="outline" loading={saving} onClick={() => void retrySave()}>重试保存</Button>
    </div>
  )
}

/** A small, honest preview of the current device target; artwork remains the main scene. */
export function BackScreenPanel() {
  const { backScreenMode, backScreenStatus, backScreenFrame, retryBackScreen, settings, session, phase, revealing } = useEgg()
  const active = !!session && (phase !== 'revealed' || revealing)
  const failed = backScreenStatus === 'failed' || backScreenStatus === 'unavailable'
  const hint = failed ? '背屏暂时没接上'
    : backScreenMode === 'simulated' ? '背屏预览模拟中（非真机）'
      : backScreenStatus === 'ok' && backScreenFrame ? '背屏显示中'
        : !active && settings.backScreenPetId ? '已选择，背屏待连接'
          : !active && !settings.backScreenPetId ? '未设置背屏伙伴' : '背屏待连接'
  return (
    <details className="back-screen-panel">
      <summary>
        <Monitor className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{hint}</span>
        <ChevronDown className="size-4 back-screen-chevron" aria-hidden />
      </summary>
      <div className="back-screen-content">
        {backScreenFrame ? <MatrixView frame={backScreenFrame} dot={4} label="背屏画面预览" className="back-screen-matrix" /> : null}
        <div className="min-w-0 space-y-2">
          <p className="text-caption text-muted-foreground">{active ? '背面的小小动静，和这颗蛋一起变化。' : settings.backScreenPetId ? '你的伙伴，换一种小小的模样陪着你。' : '在收藏里，选一只已经遇见的伙伴。'}</p>
          {backScreenStatus !== 'ok' && (failed || active || settings.backScreenPetId) ? (
            <Button variant="outline" aria-label="重试背屏连接" onClick={retryBackScreen}>
              <RotateCcw className="size-4" aria-hidden />重试
            </Button>
          ) : null}
        </div>
      </div>
    </details>
  )
}
