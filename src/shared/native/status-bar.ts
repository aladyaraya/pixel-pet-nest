/* =============================================================================
 * 状态栏前景（图标 / 时间）—— 默认值唯一来源
 *
 * 壳不会按页面内容自动适配：不设置时真机可能按系统默认给浅色（白色）图标，浅色页面上
 * 几乎不可见。预览里的模拟状态栏会自动切对比度，**不能当作真机验收依据**。
 *
 * App 入口在渲染前调 `initStatusBar()`：按页面主体背景色 `--background` 的相对亮度
 * 设一次默认前景（浅底 → 深色图标、深底 → 浅色图标），常规页面不用自己调。
 *
 * 顶部底色与 `--background` 不同的页面（深色沉浸式页 / 游戏页等）用
 * `useStatusBarStyle(light)` 覆盖，卸载时自动恢复默认值。
 * 口径见 references/07-mobile-adaptation.md §8。
 * ========================================================================== */

import { useEffect } from 'react'

import { invokeNative } from '@/shared/bridge'

/** 与白色 / 黑色前景对比度相等的交叉点（WCAG 相对亮度） */
const LUMINANCE_CROSSOVER = 0.179

let defaultLight: boolean | undefined

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** 读页面主体背景色 `--background` 的实际颜色（`rgb(var(--x))` 由浏览器解析成 rgb(...)） */
function readBackgroundLight(): boolean | null {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;width:0;height:0;background-color:rgb(var(--background))'
  document.documentElement.appendChild(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()

  const match = color.match(/^rgba?\(([^)]+)\)$/)
  if (!match) return null
  const channels = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  if (channels.length < 3 || channels.some((value) => !Number.isFinite(value))) return null
  // 透明（样式还没生效 / --background 配错）时不猜，保留壳的当前值
  if (channels.length > 3 && channels[3] === 0) return null

  return relativeLuminance([channels[0], channels[1], channels[2]]) <= LUMINANCE_CROSSOVER
}

function resolveDefaultLight(): boolean | null {
  if (defaultLight === undefined) defaultLight = readBackgroundLight() ?? undefined
  return defaultLight ?? null
}

async function applyStatusBarStyle(light: boolean | null): Promise<void> {
  if (import.meta.env.VITE_APP_TARGET === 'pwa' || light === null) return
  try {
    await invokeNative('setStatusBarStyle', { light })
  } catch {
    // 旧壳没有该接口 / 调用失败：不打断页面
  }
}

/** 启动时调用一次（App 入口在渲染前调用；Admin 是独立部署的响应式 Web，不进壳、不调用）。 */
export function initStatusBar(): void {
  if (import.meta.env.VITE_APP_TARGET === 'pwa') return
  void applyStatusBarStyle(resolveDefaultLight())
}

/**
 * 页面级覆盖：`light: true` 浅色前景（顶部底色偏深）、`false` 深色前景（偏浅）。
 * 卸载时恢复入口按 `--background` 推导的默认值——从深色页返回浅色页不用手写复位。
 */
export function useStatusBarStyle(light: boolean): void {
  useEffect(() => {
    if (import.meta.env.VITE_APP_TARGET === 'pwa') return
    void applyStatusBarStyle(light)
    return () => {
      void applyStatusBarStyle(resolveDefaultLight())
    }
  }, [light])
}
