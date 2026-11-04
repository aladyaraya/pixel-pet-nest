import { BridgeError, type BridgeMode, type CapsuleSdk } from './types'

const PROBE_TIMEOUT = 1500

declare global {
  interface Window {
    capsule?: CapsuleSdk
  }
}

export interface BridgeHandle {
  mode: BridgeMode
  sdk: CapsuleSdk
}

async function probeNative(sdk: CapsuleSdk): Promise<boolean> {
  let timer = 0
  try {
    const result = await Promise.race([
      sdk.invoke('canIUse', { args: 'getSystemInfo' }),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT)
      }),
    ])
    return result?.ok !== false && result?.data === true && !/:fail\b/i.test(String(result?.errMsg ?? ''))
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

function forcedMode(): 'mock' | 'native' | undefined {
  if (!import.meta.env.DEV) return undefined
  const param = new URLSearchParams(window.location.search).get('bridge')
  if (param === 'mock' || param === 'native') return param
  return undefined
}

async function mockHandle(): Promise<BridgeHandle> {
  if (import.meta.env.DEV) {
    const { createMockSdk } = await import('./mock')
    return { mode: 'mock', sdk: createMockSdk() }
  }
  throw new BridgeError('unsupported', 'initBridge', '原生能力不可用')
}

let cached: Promise<BridgeHandle> | undefined

export function loadBridge(): Promise<BridgeHandle> {
  if (cached) return cached
  cached = (async (): Promise<BridgeHandle> => {
    if (import.meta.env.VITE_APP_TARGET === 'pwa') {
      const { createBrowserSdk } = await import('./browser')
      return { mode: 'browser', sdk: createBrowserSdk() }
    }
    const forced = forcedMode()
    if (forced === 'mock') return mockHandle()
    const sdk = window.capsule
    if (sdk && typeof sdk.invoke === 'function' && await probeNative(sdk)) {
      return { mode: 'native', sdk }
    }
    if (import.meta.env.DEV && forced !== 'native') return mockHandle()
    throw new BridgeError('unsupported', 'initBridge', '原生能力不可用')
  })()
  return cached
}
