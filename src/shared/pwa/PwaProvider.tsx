import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '@/shared/ui/Dialog'
import { Button } from '@/shared/ui/Button'
import { useToast } from '@/shared/ui/Toast'

const runtime = import.meta.env.VITE_PWA_RUNTIME as {
  origin: string
  appBasePath: string
  buildId: string
} | undefined
const blockers = new Set<symbol>()
const dirtyControls = new Set<EventTarget>()
let revokeUpdate: (() => void) | undefined

export function clearPwaDraftState(container: HTMLElement): void {
  for (const control of dirtyControls) {
    if (control instanceof Node && container.contains(control)) dirtyControls.delete(control)
  }
}

export function usePwaUpdateBlocker(active: boolean): void {
  const key = useRef(Symbol())
  useEffect(() => {
    if (active) {
      blockers.add(key.current)
      revokeUpdate?.()
    }
    const current = key.current
    return () => { blockers.delete(current) }
  }, [active])
}

interface PwaState {
  updateAvailable: boolean
  requestUpdate: () => void
}
const PwaContext = createContext<PwaState>({ updateAvailable: false, requestUpdate: () => undefined })

export function usePwaUpdate(): PwaState {
  return useContext(PwaContext)
}

function canReload(): boolean {
  for (const control of dirtyControls) {
    if (control instanceof Node && !control.isConnected) dirtyControls.delete(control)
  }
  return blockers.size === 0 && dirtyControls.size === 0
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const accepted = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD || !runtime || window.top !== window.self
        || !window.isSecureContext || !('serviceWorker' in navigator)) return
    if (window.location.origin !== runtime.origin || !window.location.pathname.startsWith(runtime.appBasePath)) return
    let cancelled = false
    let currentRegistration: ServiceWorkerRegistration | undefined
    let lastUpdate = 0
    let refreshed = false
    const hadController = Boolean(navigator.serviceWorker.controller)
    const freezeState = new Map<HTMLElement, boolean>()
    let freezeTimer = 0
    const freeze = () => {
      window.clearTimeout(freezeTimer)
      freezeTimer = window.setTimeout(() => revokeUpdate?.(), 5000)
      for (const element of document.body.children) {
        if (!(element instanceof HTMLElement) || freezeState.has(element)) continue
        freezeState.set(element, element.inert)
        element.inert = true
      }
    }
    const unfreeze = () => {
      window.clearTimeout(freezeTimer)
      for (const [element, inert] of freezeState) element.inert = inert
      freezeState.clear()
    }
    revokeUpdate = () => {
      accepted.current = false
      currentRegistration?.waiting?.postMessage({ type: 'PWA_UPDATE_REVOKED' })
      unfreeze()
    }
    const listeners: Array<() => void> = []
    const listen = (target: EventTarget, event: string, listener: EventListener) => {
      target.addEventListener(event, listener)
      listeners.push(() => target.removeEventListener(event, listener))
    }
    const trackDraft: EventListener = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
          || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) {
        dirtyControls.add(event.target)
        revokeUpdate?.()
      }
    }
    listen(document, 'input', trackDraft)
    listen(document, 'change', trackDraft)
    listen(navigator.serviceWorker, 'message', (event) => {
      const messageEvent = event as MessageEvent
      const message = messageEvent.data
      if (!message || typeof message !== 'object' || !currentRegistration) return
      if (message.type === 'PWA_CHECK_UPDATE') {
        const waiting = currentRegistration.waiting
        if (!waiting || messageEvent.source !== waiting) return
        const safe = hadController && accepted.current && canReload()
        if (safe) freeze()
        waiting.postMessage({ type: 'PWA_UPDATE_STATE', requestId: message.requestId, canReload: safe, currentBuildId: runtime.buildId })
        if (!safe) setUpdateAvailable(true)
      } else if (message.type === 'PWA_UPDATE_CANCELLED' && messageEvent.source === currentRegistration.waiting) {
        unfreeze()
      } else if (message.type === 'PWA_UPDATE_DEFERRED' && messageEvent.source === currentRegistration.waiting) {
        unfreeze()
        toast({ title: '其他窗口尚未确认更新，请保存后再试', tone: 'warning' })
      }
    })
    listen(navigator.serviceWorker, 'controllerchange', () => {
      if (!hadController || !accepted.current || !canReload() || refreshed) {
        unfreeze()
        return
      }
      refreshed = true
      window.location.reload()
    })
    const refreshUpdate = () => {
      if (!currentRegistration || document.visibilityState !== 'visible' || Date.now() - lastUpdate < 60_000) return
      lastUpdate = Date.now()
      void currentRegistration.update().catch(() => undefined)
    }
    listen(document, 'visibilitychange', refreshUpdate)
    listen(window, 'pageshow', refreshUpdate)
    void navigator.serviceWorker.register(`${runtime.appBasePath}sw.js`, {
      scope: runtime.appBasePath,
      updateViaCache: 'none',
    }).then((result) => {
      if (cancelled) return
      currentRegistration = result
      setRegistration(result)
      setUpdateAvailable(Boolean(result.waiting))
      listen(result, 'updatefound', () => {
        revokeUpdate?.()
        const installing = result.installing
        if (!installing) return
        listen(installing, 'statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable(true)
          if (installing.state === 'redundant') toast({ title: '离线资源准备失败，联网时仍可正常使用', tone: 'warning' })
        })
      })
    }).catch(() => {
      if (!cancelled) toast({ title: '离线功能暂不可用，联网时仍可正常使用', tone: 'warning' })
    })
    return () => {
      cancelled = true
      revokeUpdate = undefined
      unfreeze()
      listeners.forEach((dispose) => dispose())
    }
  }, [toast])

  const confirmUpdate = () => {
    setConfirmOpen(false)
    if (!canReload()) {
      toast({ title: '请先保存当前内容或完成进行中的操作', tone: 'warning' })
      return
    }
    const waiting = registration?.waiting
    if (!waiting) {
      setUpdateAvailable(false)
      return
    }
    accepted.current = true
    waiting.postMessage({ type: 'PWA_REQUEST_UPDATE' })
  }

  return (
    <PwaContext.Provider value={{ updateAvailable, requestUpdate: () => setConfirmOpen(true) }}>
      {children}
      {updateAvailable && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-safe-bottom">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-body text-surface-foreground">
            <span className="min-w-0 flex-1">新版本已准备好</span>
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>更新</Button>
          </div>
        </div>
      )}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="更新应用"
        description="请先保存内容；所有已打开的应用窗口确认后才会更新。"
        footer={<><Button variant="secondary" onClick={() => setConfirmOpen(false)}>稍后</Button><Button onClick={confirmUpdate}>确认更新</Button></>}
      />
    </PwaContext.Provider>
  )
}
