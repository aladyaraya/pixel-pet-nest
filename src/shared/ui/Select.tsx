import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { FIELD_BASE } from './fieldStyles'

export interface SelectOption {
  value: string
  /** 可访问名与首字母跳转的唯一来源；不要放图标或 JSX。 */
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'children'> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** 可选视觉渲染；可访问名仍使用 option.label，不要在这里改变文案。 */
  renderLabel?: (option: SelectOption) => ReactNode
  placeholder?: string
  name?: string
  /**
   * 视觉必填标记 + `aria-required`。自定义 button 不参与原生 constraint validation，
   * 提交时的必填校验由页面表单自行实现。
   */
  required?: boolean
  emptyLabel?: string
}

/**
 * 后台 Select：不用原生 `<select>` 的弹层。
 *
 * 原生菜单的配色、圆角、阴影和定位由浏览器 / 操作系统决定，页面上看起来会像另一套控件，
 * 而且无法保证贴着触发器展开。这里用「按钮 + portal listbox」：
 * - 触发器保持 Input 的 44px / 边框 / label / hint / error 形态；
 * - 弹层固定定位到触发器下方（空间不足时向上翻），宽度对齐，滚出视口时跟随；
 * - 键盘 ↑/↓/Home/End/Enter/Space/Esc、首字母跳转和点外部关闭齐全；
 * - 高亮项始终滚进弹层可视区，`role=combobox/listbox/option` + `aria-activedescendant`，
 *   不把焦点从触发器抢走。
 *
 * 页面统一用它，不要自己写 `<select>` 或临时拼下拉（口径见 ui-design 03 §4）。
 */
export function Select({
  className,
  label,
  hint,
  error,
  id,
  value,
  onChange,
  options,
  renderLabel,
  placeholder = '请选择',
  name,
  required,
  emptyLabel = '暂无可选项',
  disabled,
  form,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: SelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  const labelId = `${selectId}-label`
  const listboxId = `${selectId}-listbox`
  const helpId = `${selectId}-help`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef('')
  const typeaheadTimer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<
    { left: number; top: number; width: number; maxHeight: number; placement: 'bottom' | 'top' } | undefined
  >()

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const firstEnabled = useCallback(() => options.findIndex((option) => !option.disabled), [options])

  const nextEnabled = useCallback(
    (from: number, step: 1 | -1) => {
      if (options.length === 0) return -1
      let index = from
      for (let count = 0; count < options.length; count += 1) {
        index = (index + step + options.length) % options.length
        if (!options[index]?.disabled) return index
      }
      return from
    },
    [options],
  )

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gap = 4
    const viewport = 8
    const below = window.innerHeight - rect.bottom - gap - viewport
    const above = rect.top - gap - viewport
    const placement = below >= 160 || below >= above ? 'bottom' : 'top'
    const maxHeight = Math.max(120, Math.min(320, placement === 'bottom' ? below : above))
    const width = Math.min(rect.width, window.innerWidth - viewport * 2)
    const left = Math.min(Math.max(viewport, rect.left), window.innerWidth - width - viewport)
    setPosition({
      left,
      top: placement === 'bottom' ? rect.bottom + gap : rect.top - gap,
      width,
      maxHeight,
      placement,
    })
  }, [])

  const openMenu = useCallback(() => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled())
    setOpen(true)
  }, [firstEnabled, selectedIndex])

  const closeMenu = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  // 长列表里 ↑/↓ 移动 activedescendant 时，浏览器不会自动滚动 listbox。
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return
    const popup = popupRef.current
    const option = popup?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    if (!popup || !option) return
    const popupRect = popup.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    if (optionRect.top < popupRect.top) popup.scrollTop -= popupRect.top - optionRect.top
    else if (optionRect.bottom > popupRect.bottom) popup.scrollTop += optionRect.bottom - popupRect.bottom
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, updatePosition])

  useEffect(() => () => window.clearTimeout(typeaheadTimer.current), [])

  function choose(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    closeMenu()
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      setActiveIndex((index) => nextEnabled(index, event.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? nextEnabled(-1, 1) : nextEnabled(0, -1))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      choose(activeIndex)
      return
    }
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      // 弹层自己吃掉这次 Esc，避免同一按键继续冒泡把外层 Dialog/Sheet 也关掉。
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      typeahead.current += event.key.toLowerCase()
      window.clearTimeout(typeaheadTimer.current)
      typeaheadTimer.current = window.setTimeout(() => { typeahead.current = '' }, 500)
      const query = typeahead.current
      const match = options.findIndex((option) => !option.disabled && option.label.toLowerCase().startsWith(query))
      if (match >= 0) {
        if (!open) setOpen(true)
        setActiveIndex(match)
      }
    }
  }

  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined
  const optionId = (index: number) => `${selectId}-option-${index}`
  const describedBy = Array.from(new Set([ariaDescribedBy, error || hint ? helpId : undefined].filter(Boolean))).join(' ') || undefined
  const visualLabel = selected ? (renderLabel ? renderLabel(selected) : selected.label) : placeholder

  return (
    <div className="w-full">
      {label && (
        <label id={labelId} htmlFor={selectId} className="mb-1.5 block text-caption font-medium text-muted-foreground">
          {label}
          {required && <span aria-hidden className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      <button
        {...props}
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeOption ? optionId(activeIndex) : undefined}
        aria-labelledby={label ? labelId : ariaLabelledBy}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={cn(
          FIELD_BASE,
          'flex min-h-tap items-center justify-between gap-2 pr-3 text-left disabled:cursor-not-allowed',
          '[color-scheme:light] focus-visible:ring-2 focus-visible:ring-ring',
          error && 'border-danger',
          className,
        )}
      >
        <span
          aria-hidden={renderLabel && selected ? true : undefined}
          className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}
        >
          {visualLabel}
        </span>
        {renderLabel && selected && <span className="sr-only">{selected.label}</span>}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-fast', open && 'rotate-180')} aria-hidden />
      </button>
      {name && <input type="hidden" name={name} value={value} form={form} disabled={disabled} />}
      {(error || hint) && (
        <p id={helpId} role={error ? 'alert' : undefined} className={cn('mt-1 text-caption', error ? 'text-danger' : 'text-muted-foreground')}>
          {error ?? hint}
        </p>
      )}
      {open && position && createPortal(
        <div
          ref={popupRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={label ? labelId : ariaLabelledBy}
          className="z-[100] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg [color-scheme:light]"
          style={{
            position: 'fixed',
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
          }}
        >
          {options.length === 0 ? (
            <div role="option" aria-disabled="true" className="min-h-10 px-2 py-2 text-body text-muted-foreground">
              {emptyLabel}
            </div>
          ) : options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <div
                key={option.value}
                id={optionId(index)}
                data-option-index={index}
                role="option"
                aria-label={renderLabel ? option.label : undefined}
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                className={cn(
                  'flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-body',
                  index === activeIndex && 'bg-accent',
                  isSelected && 'font-medium text-primary',
                  option.disabled && 'pointer-events-none opacity-50',
                )}
              >
                <span aria-hidden={renderLabel ? true : undefined} className="min-w-0 truncate">
                  {renderLabel ? renderLabel(option) : option.label}
                </span>
                {isSelected && <Check className="size-4 shrink-0" aria-hidden />}
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
