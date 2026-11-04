import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './layout/AppShell'
import { StartPage } from './pages/StartPage'
import { HatchPage } from './pages/HatchPage'
import { CollectionPage } from './pages/CollectionPage'

/**
 * App UI 路由表：开始页（主屏）、孵化及揭晓页、收藏页。
 * 新增页面：在 pages/ 下建文件 → 在这里挂一条 Route（不要在组件里内联定义页面）。
 */
export function App() {
  return (
    <Routes>
      {/* 沉浸式页（不套 AppShell：游戏对局 / 沉浸式播放器等）挂在下面这行之前——
          它们自己用 `h-screen-dvh` 铺满可视区；`assemble-scenario.mjs` 里 `shell: false` 的路由会自动插到这里 */}
      <Route element={<AppShell />}>
        <Route index element={<StartPage />} />
        <Route path="hatch" element={<HatchPage />} />
        <Route path="collection" element={<CollectionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
