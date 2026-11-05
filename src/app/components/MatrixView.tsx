import { useMemo } from 'react'

import { cn } from '@/shared/lib/cn'
import { MATRIX_HEIGHT, MATRIX_WIDTH, type MatrixFrame } from '@/shared/egg/types'

interface MatrixViewProps {
  frame: MatrixFrame
  /** 单个点直径（px） */
  dot?: number
  /** 剪影模式：收藏页未遇见项 */
  silhouette?: boolean
  className?: string
  label?: string
}

/**
 * 17×23 背屏辅助预览。主屏主体使用独立绘本插画，预览仍复用背屏帧数据。
 */
export function MatrixView({ frame, dot = 10, silhouette = false, className, label }: MatrixViewProps) {
  const cells = useMemo(() => frame.map((value, index) => ({ index, on: value > 0 })), [frame])
  return (
    <div
      role="img"
      aria-label={label ?? '点阵图案'}
      className={cn('grid shrink-0 gap-0.5', className)}
      style={{
        gridTemplateColumns: `repeat(${MATRIX_WIDTH}, ${dot}px)`,
        gridTemplateRows: `repeat(${MATRIX_HEIGHT}, ${dot}px)`,
      }}
    >
      {cells.map(({ index, on }) => (
        <span
          key={index}
          className={cn(
            'rounded-full',
            on ? (silhouette ? 'bg-muted-foreground/55' : 'bg-primary') : 'bg-surface-muted',
          )}
        />
      ))}
    </div>
  )
}
