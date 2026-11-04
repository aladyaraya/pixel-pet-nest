import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import '@/shared/styles/globals.css'

import { AuthProvider } from '@/shared/auth/AuthProvider'
import { NativeProvider } from '@/shared/native/NativeProvider'
import { initSafeArea } from '@/shared/native/safe-area'
import { initStatusBar } from '@/shared/native/status-bar'
import { initViewportUnitsPolyfill } from '@/shared/native/viewport-units'
import { ToastProvider } from '@/shared/ui/Toast'
import { PwaProvider } from '@/shared/pwa/PwaProvider'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')
const app = import.meta.env.VITE_APP_TARGET === 'pwa'
  ? <PwaProvider><App /></PwaProvider>
  : <App />

// 不阻塞首屏；壳值未就绪时保留 token 兜底，PWA 直接保留真实 env 安全区。
void initSafeArea()

// svh / lvh / dvh 兜底：老内核不认这些单位时，由它把实测值写进 --1svh / --1dvh / --1lvh；
// 原生支持的浏览器零副作用（见 shared/native/viewport-units.ts）。tailwind.config.js 的
// h-dvh / min-h-dvh / h-svh … 都消费这三个变量。
initViewportUnitsPolyfill()

// 状态栏前景默认值：壳不设置时可能是白色图标，浅色页面会看不清；按页面主体背景色先兜一次。
// 顶部底色与 --background 不同的页面用 useStatusBarStyle() 覆盖（见 shared/native/status-bar.ts）。
initStatusBar()

createRoot(container).render(
  <StrictMode>
    <NativeProvider>
      <ToastProvider>
        <AuthProvider>
          {/* WebView 里加载本地资源时没有服务端路由，统一用 HashRouter */}
          <HashRouter>
            {/* 屏幕方向（capsule/manifest.json 的 orientation）由壳在原生层锁定、
                平台预览也按该字段限制横竖屏切换，H5 侧不做任何方向处理 */}
            {app}
          </HashRouter>
        </AuthProvider>
      </ToastProvider>
    </NativeProvider>
  </StrictMode>,
)
