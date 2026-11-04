import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './layout/AppShell'
import { HomePage } from './pages/HomePage'

/**
 * App UI 路由表（初始只有一页占位页；页面按需求逐个新增）。
 * 新增页面：在 pages/ 下建文件 → 在这里挂一条 Route（不要在组件里内联定义页面）。
 */
export function App() {
  return (
    <Routes>
      {/* 沉浸式页（不套 AppShell：游戏对局 / 沉浸式播放器等）挂在下面这行之前——
          它们自己用 `h-screen-dvh` 铺满可视区；`assemble-scenario.mjs` 里 `shell: false` 的路由会自动插到这里
          （游戏也可以留在 AppShell 内做壳内形态，见 ui-design-skill 的 05 §0） */}
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
