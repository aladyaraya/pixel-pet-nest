import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getBridgeMode, initBridge, invokeNative, nativeLog, onNativeEvent } from '@/shared/bridge'
import type { BridgeMode, NativeNetworkStatus, NativeSystemInfo } from '@/shared/bridge/types'

interface NativeContextValue {
  /** 宿主模式；ready 为 false 时还是 undefined */
  mode: BridgeMode | undefined
  ready: boolean
  systemInfo: NativeSystemInfo | null
  network: NativeNetworkStatus | null
}

const NativeContext = createContext<NativeContextValue>({
  mode: undefined,
  ready: false,
  systemInfo: null,
  network: null,
})

/**
 * 原生运行态 Provider：探测宿主、读系统信息、订阅网络与内存事件。
 * App / Admin 两棵树各挂一次。
 *
 * 安全区不在这里处理：App 入口在渲染前调 `initSafeArea()`（src/shared/native/safe-area.ts），
 * 由它把 `--safe-*` 四个方向的值写进 <html>（真机读壳值、预览用模拟值）。
 */
export function NativeProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<BridgeMode | undefined>(undefined)
  const [systemInfo, setSystemInfo] = useState<NativeSystemInfo | null>(null)
  const [network, setNetwork] = useState<NativeNetworkStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const disposers: Array<() => void> = []

    const subscribe = async (subscription: Promise<() => void>) => {
      const dispose = await subscription
      if (cancelled) dispose()
      else disposers.push(dispose)
    }
    const updateNetwork = (value: NativeNetworkStatus) => {
      if (!cancelled) setNetwork(value)
    }

    void (async () => {
      try {
        const bridgeMode = await initBridge()
        if (cancelled) return
        setMode(bridgeMode)

        if (bridgeMode !== 'browser') {
          try {
            const info = await invokeNative('getSystemInfo')
            if (!cancelled) setSystemInfo(info)
          } catch {
            // 系统信息失败不阻塞首屏
          }
        }
        if (cancelled) return
        try {
          updateNetwork(await invokeNative('getNetworkType'))
        } catch {
          // 离线不影响首屏
        }
        if (cancelled) return
        await subscribe(onNativeEvent('appShow', () => {
          if (cancelled) return
          void invokeNative('getNetworkType').then(updateNetwork).catch(() => undefined)
        }))
        if (cancelled) return
        await subscribe(onNativeEvent('networkStatusChange', updateNetwork))
        if (cancelled) return
        if (bridgeMode !== 'browser') {
          await subscribe(onNativeEvent('memoryWarning', ({ level }) => {
            if (!cancelled) nativeLog.w('NativeProvider', `memoryWarning level=${level}`)
          }))
        }
      } catch {
        // 宿主不可用不阻塞页面，也不产生启动提示
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
      disposers.forEach((dispose) => dispose())
    }
  }, [])

  const value = useMemo<NativeContextValue>(
    () => ({ mode: mode ?? getBridgeMode(), ready, systemInfo, network }),
    [mode, ready, systemInfo, network],
  )

  return <NativeContext.Provider value={value}>{children}</NativeContext.Provider>
}

export function useNative(): NativeContextValue {
  return useContext(NativeContext)
}
