import type { PwaRuntime } from '../bridge/types'

function storageKey(key: string): string {
  if (import.meta.env.VITE_APP_TARGET !== 'pwa') return 'app.' + key
  const runtime = import.meta.env.VITE_PWA_RUNTIME as PwaRuntime | undefined
  if (!runtime?.environment || !runtime.publicAppId) throw new Error('应用配置不可用')
  const scope = document.querySelector('meta[name="ui-scope"]')?.getAttribute('content') === 'admin' ? 'admin' : 'app'
  return `pwa:${encodeURIComponent(runtime.environment)}:${encodeURIComponent(runtime.publicAppId)}:${scope}:${key}`
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(storageKey(key))
      if (raw === null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },

  set(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(storageKey(key), JSON.stringify(value))
    } catch {
      // 隐私模式或配额超限：静默降级为不持久化，不影响主流程
    }
  },

  remove(key: string): void {
    try {
      window.localStorage.removeItem(storageKey(key))
    } catch {
      // ignore
    }
  },
}
