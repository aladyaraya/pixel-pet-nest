import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { useModalLayer } from './useModalLayer'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * 应用内弹层：手机上从底部升起（bottom sheet），≥768px 居中显示。
 *
 * 什么时候用它而不是原生 showModal：
 *  - 需要自定义内容（表单、多选、富文本）时用本组件；
 *  - 只是「确认 / 取消」这类标准弹窗，App UI 里优先用原生 showModal（体验更贴近系统）。
 */
export function Dialog({ open, onClose, title, description, children, footer, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const zIndex = useModalLayer(open, onClose, panelRef)

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-overlay/50 md:items-center md:py-4"
      style={{ zIndex }}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : '对话框'}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'min-w-0 w-full max-h-[100dvh] overflow-y-auto overscroll-contain [overflow-wrap:anywhere] animate-dialog-in bg-surface text-surface-foreground shadow-lg',
          'rounded-t-xl pb-safe-bottom',
          'md:max-h-[calc(100dvh-2rem)] md:w-[min(92vw,520px)] md:rounded-xl md:pb-0',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0 flex-1">
            {title && <h2 id={titleId} className="text-title font-semibold">{title}</h2>}
            {description && <p id={descriptionId} className="mt-1 text-caption text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children && <div className="min-w-0 px-4 py-4">{children}</div>}
        {footer && <div className="flex min-w-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_a]:min-h-11 max-md:[&_a]:min-w-11 max-md:[&_a]:inline-flex max-md:[&_a]:items-center [&>*]:min-w-0 [&>*]:max-w-full [&>*]:flex-wrap [&>*]:whitespace-normal">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
