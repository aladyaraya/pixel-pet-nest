import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { PageTitleProvider } from './PageTitle'
import { TopBleedScrim } from './TopBleedScrim'

/** 一级（Tab）路由：不显示返回按钮。新增 Tab 页时把路径加到这里 */
const ROOT_ROUTES = new Set(['/'])

/**
 * App UI 外壳：可滚动内容区 + **按需出现的**顶栏。
 *
 * **顶栏只在当前页声明了标题时才渲染**：页面调 `usePageTitle('任务列表')` 才出顶栏，
 * 没声明就不渲染（不需要顶栏的页面——比如初始占位页——就不声明，初始态因此不会先冒出一条
 * 空顶栏，也就不会把 `APP_NAME` 这类脚手架占位值显示出来）。没有顶栏时，滚动容器把顶部安全区
 * 垫成页面主体背景色（`.safe-top-backdrop`）——状态栏区域不会透出滚动内容。
 * **顶部穿透是页面级例外**：顶部是全出血媒体（banner / 图集 / 封面）的二级页调 `useTopBleed()`，
 * 媒体贴到屏幕最顶、叠在媒体上的控件自己用 `top-safe-top` 避开状态栏；媒体滚走后正文会经过
 * 状态栏区域——此时由 `TopBleedScrim` 自动挂一层「页面背景色 → 透明」的渐变垫底（随正文
 * 滚入渐显），避免文字与状态栏图标叠在一起（见 references/07-mobile-adaptation.md §2）。
 *
 * **不含底部导航**——导航按用户需求再加（需求里没有的入口一个都不要加）。
 * 需要底部导航时的判据与做法见 references/04-routing.md。
 *
 * 移动端要点：
 *  - 高度用 dvh 而不是 vh，避免 WebView 地址栏/手势条导致的 100vh 溢出；
 *  - 有顶栏时顶栏吃顶部安全区，无顶栏时滚动容器把顶部安全区垫成页面背景色（穿透页除外）；
 *  - 只有内容区滚动，页面本身不滚（overscroll 不会带动整页橡皮筋）；
 *  - **顶栏只放“返回 + 标题 + 本页动作”**：全局偏好类入口不属于顶栏
 *    （见 ui-design-skill 的 references/02-app-ui-mobile-h5.md §2 与 §7）；
 *  - 标题由页面自己声明，不用维护路由→标题的映射表。
 */
export function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [pageTitle, setPageTitle] = useState<string>()
  const [topBleed, setTopBleed] = useState(false)

  const isRoot = ROOT_ROUTES.has(pathname)
  const hasHeader = pageTitle !== undefined

  useEffect(() => {
    // 三个页面各自从顶部开始；从图鉴底部返回时不沿用旧滚动位置。
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [pathname])

  // 「顶部穿透」与顶栏二选一：同时声明时穿透被顶栏盖住、不会生效——dev 环境提示一下，
  // 免得页面"声明了穿透却没效果"而排查不到原因（生产构建会整段移除）。
  useEffect(() => {
    if (import.meta.env.DEV && hasHeader && topBleed) {
      console.warn('[app-shell] 本页同时声明了顶栏标题与 useTopBleed()：要穿透就不要 usePageTitle()（顶栏会盖住穿透区）。')
    }
  }, [hasHeader, topBleed])

  return (
    <div className="flex h-screen-dvh flex-col bg-background text-foreground">
      {hasHeader && (
        <header className="z-20 shrink-0 border-b border-border bg-surface/95 backdrop-blur pt-safe-top">
          {/* px-4：与 .page 的内容左右对齐（1 个 4px 阶差都没有） */}
          <div className="flex min-h-12 items-center gap-2 px-4">
            {!isRoot && (
              <button
                type="button"
                onClick={() => {
                  if (!(window.history.state?.idx > 0)) navigate('/', { replace: true })
                  else navigate(-1)
                }}
                aria-label="返回"
                className="-ml-2 flex size-11 items-center justify-center rounded-md text-foreground active:bg-accent"
              >
                <ChevronLeft className="size-6" />
              </button>
            )}
            <h1 className="flex-1 truncate text-title font-semibold">{pageTitle}</h1>
          </div>
        </header>
      )}

      {/* 无顶栏时顶部安全区由滚动容器垫成页面背景色；顶部穿透页（useTopBleed）去掉垫色 */}
      <main
        ref={mainRef}
        className={cn('min-h-0 flex-1 scroll-y', !hasHeader && !topBleed && 'safe-top-backdrop')}
      >
        <PageTitleProvider onChange={setPageTitle} onTopBleedChange={setTopBleed}>
          <Outlet />
        </PageTitleProvider>
      </main>

      {/* 穿透页：状态栏垫底渐变（随正文滚入渐显；换页时按 pathname 重挂载、重算浓度） */}
      {topBleed && !hasHeader && <TopBleedScrim key={pathname} scroller={mainRef} />}
    </div>
  )
}
