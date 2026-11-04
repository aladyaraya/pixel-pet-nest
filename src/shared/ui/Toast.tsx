import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastOptions {
  title: string
  /** 仅 Admin（桌面卡片）展示；App UI 的胶囊只显示 title，补充说明并入 title */
  description?: string
  tone?: ToastTone
  /** 毫秒，默认 2600；Admin 的 0 不自动关闭，App 的非正数按默认时长关闭 */
  duration?: number
}

interface ToastItem extends Required<Omit<ToastOptions, 'description'>> {
  id: number
  description?: string
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined, dismiss: () => undefined })

const TONE_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const

const TONE_CLASS = {
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const

/** App UI（含小游戏）用移动端胶囊样式；Admin 保持桌面卡片样式（同一套组件，按入口区分）。 */
const IS_ADMIN_UI = document.querySelector('meta[name="ui-scope"]')?.getAttribute('content') === 'admin'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = (nextId.current += 1)
      const duration = options.duration ?? 2600
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        tone: options.tone ?? 'info',
        duration: !IS_ADMIN_UI && duration <= 0 ? 2600 : duration,
      }
      setItems((prev) => [...prev.slice(-2), item])
      if (item.duration > 0) window.setTimeout(() => dismiss(id), item.duration)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(() => ({ toast, dismiss }), [toast, dismiss])

  if (!IS_ADMIN_UI) {
    return (
      <ToastContext.Provider value={value}>
        {children}
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] pt-safe-top"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-2 px-4 pt-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="animate-fade-in pointer-events-auto w-fit max-w-full rounded-full bg-toast px-4 py-2 text-body leading-6 text-toast-foreground shadow-md"
              >
                <p className="break-words text-center">{item.title}</p>
              </div>
            ))}
          </div>
        </div>
      </ToastContext.Provider>
    )
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-safe-top md:items-end md:px-6"
        role="status"
        aria-live="polite"
      >
        {items.map((item) => {
          const Icon = TONE_ICON[item.tone]
          return (
            <div
              key={item.id}
              className={cn(
                'animate-slide-up pointer-events-auto flex w-full max-w-sm items-start gap-2.5',
                'rounded-md border border-border bg-surface p-3 shadow-md',
              )}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', TONE_CLASS[item.tone])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 break-words text-caption text-muted-foreground">{item.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="-m-2 flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground active:bg-accent"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
