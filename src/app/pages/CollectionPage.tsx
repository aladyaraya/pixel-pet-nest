import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, Egg, Monitor, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { useToast } from '@/shared/ui/Toast'
import { useEgg } from '@/shared/egg/EggProvider'
import { PETS, PET_BY_ID } from '@/shared/egg/pets'
import { PET_TIERS, TIER_LABEL } from '@/shared/egg/types'
import { PetArtwork } from '@/app/components/PetArtwork'
import { BackScreenPanel, RecordLoadNotice, SaveNotice, TierBadge, TIER_RULES } from '@/app/components/EggUI'
import { usePageTitle } from '@/app/layout/PageTitle'
import { formatRelativeTime } from '@/shared/lib/format'

export function CollectionPage() {
  usePageTitle('收藏')
  const navigate = useNavigate()
  const { loaded, record, session, phase, settings, saving, storageWarning, revealing, selectBackScreenPet, backScreenMode, backScreenStatus } = useEgg()
  const { toast } = useToast()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  if (!loaded) return <RecordLoadNotice />
  if (revealing) return <div className="page text-center" role="status">正在破壳…</div>

  const active = session != null && phase !== 'revealed'
  const metCount = PETS.filter((pet) => (record.collection[pet.id]?.count ?? 0) > 0).length
  const selectedId = settings.backScreenPetId ?? null
  const selectedPet = selectedId ? PET_BY_ID[selectedId] : null
  const detailPet = detailId ? PET_BY_ID[detailId] : null
  const detailEntry = detailId ? record.collection[detailId] : null
  const detailSelected = !!detailId && detailId === selectedId
  const canChoose = !active && !saving && !storageWarning && !choosing
  const selectPet = async (petId: string | null) => {
    if (!canChoose) return
    setChoosing(true)
    try {
      await selectBackScreenPet(petId)
    } catch {
      toast({ title: '这次选择还没完成，请重试', tone: 'warning' })
    } finally {
      setChoosing(false)
    }
  }
  const displayHint = active ? '背屏正在孵蛋'
    : selectedPet ? backScreenMode === 'simulated' ? '已选择 · 预览模拟，非真机'
      : backScreenStatus === 'ok' ? '正在背屏陪伴你' : '已选择，背屏待连接'
      : '选一个伙伴，带到背屏上'

  return (
    <div className="page story-page collection-page">
      <div className="collection-heading">
        <div><span className="story-eyebrow">把每次相遇，好好收藏</span><h2>遇见的小伙伴</h2></div>
        <div className="collection-count"><strong>{metCount}</strong><span>/ {PETS.length}</span></div>
      </div>
      <p className="sr-only">已遇见 {metCount} / {PETS.length}</p>
      <div className="collection-progress" aria-hidden><span style={{ transform: 'scaleX(' + metCount / PETS.length + ')' }} /></div>
      {selectedPet ? (
        <button type="button" className="chosen-companion" onClick={() => setDetailId(selectedPet.id)} aria-label={'查看当前伙伴' + selectedPet.name}>
          <PetArtwork petId={selectedPet.id} thumbnail className="selected-pet-thumb" />
          <span className="min-w-0 flex-1 text-left"><span className="block text-body font-semibold">{selectedPet.name}</span><span className="block text-caption text-muted-foreground">{displayHint}</span></span>
          <Monitor className="size-4" aria-hidden /><ChevronRight className="size-4" aria-hidden />
        </button>
      ) : (
        <p className="collection-guide"><Sparkles className="size-4 shrink-0" aria-hidden />{metCount ? displayHint : '孵一颗蛋，和第一位小伙伴见面吧。'}</p>
      )}
      {!detailPet ? <SaveNotice /> : null}
      {saving && !storageWarning ? <p role="status" className="text-caption text-muted-foreground">正在保存记录…</p> : null}

      {PET_TIERS.map((tier) => (
        <section key={tier} aria-labelledby={'collection-' + tier} className="pet-group">
          <div className="pet-group-heading">
            <h3 id={'collection-' + tier}><TierBadge tier={tier} /></h3>
            <span className="text-caption text-muted-foreground">{TIER_RULES[tier]}</span>
          </div>
          <ul className="pet-grid">
            {PETS.filter((pet) => pet.tier === tier).map((pet) => {
              const entry = record.collection[pet.id]
              const met = (entry?.count ?? 0) > 0
              const selected = pet.id === selectedId
              return (
                <li key={pet.id}>
                  <button type="button" className="pet-card" data-owned={met} data-selected={selected} data-tier={tier}
                    aria-label={'查看' + pet.name} disabled={!met} onClick={() => setDetailId(pet.id)}>
                    <div className="pet-card-art">
                      <PetArtwork petId={pet.id} thumbnail silhouette={!met} className="collection-pet-art" />
                      {selected ? <span className="pet-selected-mark" aria-label="已选伙伴"><Check className="size-3.5" aria-hidden /></span> : null}
                    </div>
                    <span className="pet-card-name">{pet.name}</span>
                    <span className="pet-card-count">{met ? '遇见 ' + entry.count + ' 次' : '还未遇见'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      <BackScreenPanel />
      <Button block onClick={() => navigate(active ? '/hatch' : '/')} className="collection-return">
        <Egg className="size-4" aria-hidden />{active ? '回到这颗蛋' : '孵一颗'}<ChevronRight className="size-4" aria-hidden />
      </Button>

      <Dialog open={!!detailPet} onClose={() => setDetailId(null)} title={detailPet?.name}
        description={detailPet ? TIER_LABEL[detailPet.tier] + '宠物 · ' + TIER_RULES[detailPet.tier] : undefined}
        className="pet-detail-dialog">
        {detailPet && detailEntry ? (
          <div className="pet-detail">
            <div className="detail-companion-stage"><PetArtwork key={detailPet.id} petId={detailPet.id} interactive className="detail-pet-art" /></div>
            <p className="interaction-hint">轻点打个招呼，按住陪它一会儿</p>
            <p className="pet-detail-quote">“{detailPet.quote}”</p>
            <div className="pet-detail-history">
              <span>遇见 <strong>{detailEntry.count}</strong> 次</span>
              {detailEntry.lastRevealedAt ? <span>最近 {formatRelativeTime(new Date(detailEntry.lastRevealedAt).toISOString())}</span> : null}
            </div>
            <SaveNotice />
            {active ? <p className="text-caption text-muted-foreground">这颗蛋还在孵化，揭晓或结束后可更换</p>
              : storageWarning ? <p className="text-caption text-warning">先保存记录，再选择背屏伙伴</p>
                : saving ? <p className="text-caption text-muted-foreground">正在保存，请稍等一下</p> : null}
            <Button block size="lg" variant={detailSelected ? 'outline' : 'primary'} disabled={!canChoose} loading={choosing}
              onClick={() => void selectPet(detailSelected ? null : detailPet.id)}>
              <Monitor className="size-4" aria-hidden />{detailSelected ? '停止展示' : '放到背屏'}
            </Button>
            {detailSelected ? <p role="status" className="text-caption text-muted-foreground">{displayHint}</p> : null}
            {detailSelected || backScreenStatus === 'failed' || backScreenStatus === 'unavailable' ? <BackScreenPanel /> : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
