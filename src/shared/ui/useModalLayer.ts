import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

// Private shared behavior for Dialog and AdminSheet. One stack owns both focus and
// the scroll lock, so closing a lower layer never unlocks an open upper layer.
interface ModalLayer {
  panel: HTMLElement
  restoreFocus: HTMLElement | null
}
interface ModalStack {
  layers: ModalLayer[]
  overflow: string
  overflowPriority: string
  paddingRight: string
  paddingRightPriority: string
  paddingApplied: boolean
  nextZIndex: number
}
const stacks = new WeakMap<Document, ModalStack>()
const focusableSelector = 'a[href], area[href], button, input, select, textarea, iframe, [tabindex], [contenteditable="true"]'

function focusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => element.tabIndex >= 0
      && !element.matches(':disabled')
      && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden')
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
}

function focusInside(panel: HTMLElement) {
  const preferred = panel.querySelector<HTMLElement>('[autofocus], [data-modal-initial-focus]')
    ?? (panel.contains(panel.ownerDocument.activeElement) ? panel.ownerDocument.activeElement as HTMLElement : null)
  const elements = focusableElements(panel)
  const target = preferred && elements.includes(preferred) ? preferred : elements[0] ?? panel
  target.focus({ preventScroll: true })
}

export function useModalLayer(open: boolean, onClose: () => void, panelRef: RefObject<HTMLDivElement | null>) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [zIndex, setZIndex] = useState(50)
  const previousOpen = useRef(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  if (open && !previousOpen.current && typeof document !== 'undefined') {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  previousOpen.current = open

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    const doc = panel.ownerDocument
    let stack = stacks.get(doc)
    if (!stack) {
      stack = {
        layers: [],
        overflow: '',
        overflowPriority: '',
        paddingRight: '',
        paddingRightPriority: '',
        paddingApplied: false,
        nextZIndex: 50,
      }
      stacks.set(doc, stack)
    }
    if (stack.layers.length === 0) {
      stack.overflow = doc.body.style.getPropertyValue('overflow')
      stack.overflowPriority = doc.body.style.getPropertyPriority('overflow')
      stack.paddingRight = doc.body.style.getPropertyValue('padding-right')
      stack.paddingRightPriority = doc.body.style.getPropertyPriority('padding-right')
      stack.nextZIndex = 50

      // 隐藏根滚动条会让页面可用宽度增加 scrollbarWidth，内容容器随之横向跳一下。
      // 从 body 右侧补同样的宽度，关闭最后一层时再还原；overlay 滚动条平台算出 0，不补。
      // 前提：页面滚动由 body / root 承担，且内容不靠 body 居中。若页面把滚动交给内层容器，
      // 或 body 用 flex/justify-center 居中，这段补偿不适用，需要按实际滚动容器处理（见 07 §9 / ui 03 §9.3）。
      const view = doc.defaultView
      const scrollbarWidth = view ? Math.max(0, view.innerWidth - doc.documentElement.clientWidth) : 0
      if (scrollbarWidth > 0) {
        const currentPadding = view ? view.getComputedStyle(doc.body).paddingRight : ''
        const basePadding = currentPadding && currentPadding !== 'auto' ? currentPadding : '0px'
        doc.body.style.setProperty(
          'padding-right',
          `calc(${basePadding} + ${scrollbarWidth}px)`,
          stack.paddingRightPriority,
        )
        stack.paddingApplied = true
      }

      doc.body.style.setProperty('overflow', 'hidden')
    }
    const layer: ModalLayer = {
      panel,
      restoreFocus: triggerRef.current,
    }
    stack.layers.push(layer)
    setZIndex(stack.nextZIndex++)
    const isTop = () => stack.layers[stack.layers.length - 1] === layer
    focusInside(panel)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeRef.current()
      } else if (event.key === 'Tab') {
        const elements = focusableElements(panel)
        const first = elements[0]
        const last = elements[elements.length - 1]
        const active = doc.activeElement
        if (!first || !panel.contains(active) || active === panel
          || (event.shiftKey ? active === first : active === last)) {
          event.preventDefault()
          ;(event.shiftKey ? last ?? panel : first ?? panel).focus({ preventScroll: true })
        }
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (isTop() && !panel.contains(event.target as Node)) focusInside(panel)
    }
    doc.addEventListener('keydown', onKeyDown)
    doc.addEventListener('focusin', onFocusIn)
    return () => {
      const wasTop = isTop()
      doc.removeEventListener('keydown', onKeyDown)
      doc.removeEventListener('focusin', onFocusIn)
      const index = stack.layers.indexOf(layer)
      if (index >= 0) stack.layers.splice(index, 1)
      // If a lower layer disappears first, its trigger becomes the upper
      // layer's return target rather than a detached element in that panel.
      for (const remaining of stack.layers) {
        if (remaining.restoreFocus && panel.contains(remaining.restoreFocus)) {
          remaining.restoreFocus = layer.restoreFocus
        }
      }
      if (stack.layers.length === 0) {
        if (stack.overflow) doc.body.style.setProperty('overflow', stack.overflow, stack.overflowPriority)
        else doc.body.style.removeProperty('overflow')
        if (stack.paddingApplied) {
          if (stack.paddingRight) {
            doc.body.style.setProperty('padding-right', stack.paddingRight, stack.paddingRightPriority)
          } else {
            doc.body.style.removeProperty('padding-right')
          }
          stack.paddingApplied = false
        }
      }
      if (!wasTop) return
      const top = stack.layers[stack.layers.length - 1]
      const target = layer.restoreFocus
      if (target?.isConnected && (!top || top.panel.contains(target))) target.focus({ preventScroll: true })
      else if (top) focusInside(top.panel)
    }
  }, [open, panelRef])

  return zIndex
}
