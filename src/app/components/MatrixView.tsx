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
 * 17×23 点阵渲染（主屏预览与收藏格共用）：点亮格为主色圆点，熄灭格为弱底圆点。
 * 与背屏同一份帧数据——主屏看到的就是背屏的样子。
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
