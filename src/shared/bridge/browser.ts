import capabilities from './browser-capabilities.json'
import { BridgeError, type CapsuleSdk, type NativeNetworkStatus, type NativeParams, type PwaRuntime } from './types'

const supported = new Set<string>(capabilities.supported)
const imageUrls = new Set<string>()

export function releaseBrowserImageUrls(urls?: readonly string[]): void {
  for (const url of urls ?? [...imageUrls]) {
    if (imageUrls.delete(url)) URL.revokeObjectURL(url)
  }
}

function available(api: string): boolean {
  if (!supported.has(api)) return false
  switch (api) {
    case 'request':
      return typeof fetch === 'function' && typeof AbortController === 'function'
    case 'getLocation':
      return window.isSecureContext && typeof navigator.geolocation?.getCurrentPosition === 'function'
    case 'setClipboardData':
      return window.isSecureContext && typeof navigator.clipboard?.writeText === 'function'
    case 'getClipboardData':
      return window.isSecureContext && typeof navigator.clipboard?.readText === 'function'
    case 'shareText':
      return window.isSecureContext && typeof navigator.share === 'function'
    case 'chooseImage':
      return 'files' in document.createElement('input') && typeof URL.createObjectURL === 'function'
    case 'setStorage':
    case 'getStorage':
    case 'removeStorage':
      try {
        return typeof window.localStorage?.getItem === 'function'
      } catch {
        return false
      }
    case 'canIUse':
    case 'getNetworkType':
    case 'hideKeyboard':
      return true
    default:
      return false
  }
}

function browserError(api: string, error: unknown): BridgeError {
  if (error instanceof BridgeError) return error
  const name = (error as { name?: string } | null)?.name
  const code = name === 'NotAllowedError' || name === 'SecurityError'
    ? 'denied'
    : name === 'AbortError' ? 'cancelled' : 'unknown'
  return new BridgeError(code, api, '浏览器操作失败', error)
}

function networkStatus(): NativeNetworkStatus {
  const connected = navigator.onLine
  const type = connected ? 'unknown' : 'none'
  return { networkType: type, type, connected, isConnected: connected, metered: null }
}

function storageKey(key: unknown): string {
  if (typeof key !== 'string' || !key) throw new BridgeError('not-found', 'storage', '存储键无效')
  const runtime = import.meta.env.VITE_PWA_RUNTIME as PwaRuntime | undefined
  if (!runtime?.environment || !runtime.publicAppId) {
    throw new BridgeError('unknown', 'storage', '应用配置不可用')
  }
  const scope = document.querySelector('meta[name="ui-scope"]')?.getAttribute('content') === 'admin' ? 'admin' : 'app'
  return `pwa:${encodeURIComponent(runtime.environment)}:${encodeURIComponent(runtime.publicAppId)}:${scope}:${key}`
}

async function request(params: NativeParams<'request'>): Promise<Record<string, unknown>> {
  const url = new URL(params.url)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new BridgeError('not-found', 'request', '请求地址无效')
  }
  const method = (params.method ?? 'GET').toUpperCase()
  const headers = new Headers(params.header)
  let body: string | undefined
  if (params.data != null && !['GET', 'HEAD', 'DELETE'].includes(method)) {
    body = typeof params.data === 'string' ? params.data : JSON.stringify(params.data)
  }
  if (['POST', 'PUT'].includes(method) && !headers.has('Content-Type')) {
    headers.set('Content-Type', (params.dataType ?? 'json') === 'json' ? 'application/json' : 'text/plain')
  }
  const controller = new AbortController()
  const timeout = params.timeout ?? 60000
  if (!Number.isFinite(timeout)) throw new BridgeError('not-found', 'request', '超时时间无效')
  const timer = window.setTimeout(() => controller.abort(), Math.min(65000, Math.max(1, timeout)))
  try {
    const response = await fetch(url.href, { method, headers, body, signal: controller.signal })
    let data: unknown
    if (params.responseType === 'arraybuffer') data = await response.arrayBuffer()
    else {
      const text = await response.text()
      data = text
      if (params.responseType === 'json' || (params.responseType !== 'text' && (params.dataType ?? 'json') === 'json')) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }
    }
    return { statusCode: response.status, data, header: Object.fromEntries(response.headers.entries()) }
  } catch (error) {
    if (controller.signal.aborted) throw new BridgeError('timeout', 'request', '请求超时', error)
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function getLocation(params: NativeParams<'getLocation'>): Promise<Record<string, unknown>> {
  if (params.type && params.type !== 'wgs84') {
    return Promise.reject(new BridgeError('unsupported', 'getLocation', '不支持该坐标系'))
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: coords.speed,
        accuracy: coords.accuracy,
        altitude: coords.altitude,
        verticalAccuracy: coords.altitudeAccuracy,
        horizontalAccuracy: coords.accuracy,
      }),
      (error) => reject(new BridgeError(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unknown', 'getLocation', '定位失败', error)),
      { enableHighAccuracy: params.isHighAccuracy ?? false, timeout: 15000, maximumAge: 0 },
    )
  })
}

function chooseImage(params: NativeParams<'chooseImage'>): Promise<Record<string, unknown>> {
  const sources = params.sourceType?.length ? params.sourceType : ['album', 'camera']
  if (!sources.includes('album') && !sources.includes('camera')) {
    return Promise.reject(new BridgeError('not-found', 'chooseImage', '图片来源无效'))
  }
  const count = params.count ?? 9
  if (!Number.isFinite(count)) return Promise.reject(new BridgeError('not-found', 'chooseImage', '图片数量无效'))
  const cameraOnly = !sources.includes('album')
  const input = document.createElement('input')
  if (cameraOnly && !('capture' in input)) {
    return Promise.reject(new BridgeError('unsupported', 'chooseImage', '当前浏览器不支持拍照选择'))
  }
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = !cameraOnly && count > 1
  if (cameraOnly) input.setAttribute('capture', 'environment')
  input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0'
  return new Promise((resolve, reject) => {
    let settled = false
    let focusTimer = 0
    const finish = (error?: BridgeError) => {
      if (settled) return
      settled = true
      window.clearTimeout(focusTimer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onHide)
      input.remove()
      if (error) {
        reject(error)
        return
      }
      const urls: string[] = []
      try {
        const files = Array.from(input.files ?? []).slice(0, cameraOnly ? 1 : Math.max(1, Math.floor(count)))
        if (!files.length) throw new BridgeError('cancelled', 'chooseImage', '已取消')
        if (files.some((file) => !file.type.startsWith('image/'))) throw new BridgeError('not-found', 'chooseImage', '请选择图片')
        const tempFiles = files.map((file) => {
          const path = URL.createObjectURL(file)
          imageUrls.add(path)
          urls.push(path)
          return { path, size: file.size }
        })
        resolve({ tempFilePaths: urls, tempFiles })
      } catch (failure) {
        releaseBrowserImageUrls(urls)
        reject(browserError('chooseImage', failure))
      }
    }
    const onFocus = () => {
      focusTimer = window.setTimeout(() => finish(), 300)
    }
    const onHide = () => finish(new BridgeError('cancelled', 'chooseImage', '已取消'))
    input.addEventListener('change', () => finish(), { once: true })
    input.addEventListener('cancel', onHide, { once: true })
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onHide)
    document.body.appendChild(input)
    try {
      input.click()
    } catch (error) {
      finish(browserError('chooseImage', error))
    }
  })
}

export function createBrowserSdk(): CapsuleSdk {
  const listeners = new Map<string, Map<(payload: unknown) => void, () => void>>()
  const invoke = async (api: string, raw?: unknown): Promise<Record<string, unknown>> => {
    try {
      if (!available(api)) throw new BridgeError('unsupported', api, '当前浏览器不支持此功能')
      const params = (raw ?? {}) as Record<string, unknown>
      let result: Record<string, unknown> = {}
      switch (api) {
        case 'canIUse':
          result = { data: available(String(params.args ?? params.schema ?? params.api ?? '')) }
          break
        case 'request':
          result = await request(params as NativeParams<'request'>)
          break
        case 'getLocation':
          result = await getLocation(params as NativeParams<'getLocation'>)
          break
        case 'getNetworkType':
          result = { ...networkStatus() }
          break
        case 'setClipboardData':
          if (typeof params.data !== 'string') throw new BridgeError('not-found', api, '剪贴板内容无效')
          await navigator.clipboard.writeText(params.data)
          break
        case 'getClipboardData':
          result = { data: await navigator.clipboard.readText() }
          break
        case 'shareText':
          if (typeof params.text !== 'string') throw new BridgeError('not-found', api, '分享内容无效')
          await navigator.share({ text: params.text, title: typeof params.title === 'string' ? params.title : undefined })
          break
        case 'hideKeyboard':
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          break
        case 'setStorage': {
          const key = storageKey(params.key)
          const data = JSON.stringify(params.data)
          if (data === undefined) throw new BridgeError('not-found', api, '存储内容无效')
          window.localStorage.setItem(key, data)
          break
        }
        case 'getStorage': {
          const value = window.localStorage.getItem(storageKey(params.key))
          result = { data: value === null ? null : JSON.parse(value) }
          break
        }
        case 'removeStorage':
          window.localStorage.removeItem(storageKey(params.key))
          break
        case 'chooseImage':
          result = await chooseImage(params as NativeParams<'chooseImage'>)
          break
        default:
          throw new BridgeError('unsupported', api, '当前浏览器不支持此功能')
      }
      return { ...result, ok: true, errMsg: `${api}:ok` }
    } catch (error) {
      throw browserError(api, error)
    }
  }
  const off: CapsuleSdk['off'] = (channel, handler) => {
    const group = listeners.get(channel)
    group?.get(handler)?.()
    group?.delete(handler)
    if (!group?.size) listeners.delete(channel)
  }
  const on: CapsuleSdk['on'] = (channel, handler) => {
    if (!['appShow', 'appHide', 'networkStatusChange'].includes(channel)) {
      throw new BridgeError('unsupported', channel, '当前浏览器不支持此事件')
    }
    off(channel, handler)
    const bindings: Array<[EventTarget, string, EventListener]> = []
    const bind = (target: EventTarget, event: string, callback: EventListener) => {
      target.addEventListener(event, callback)
      bindings.push([target, event, callback])
    }
    if (channel === 'networkStatusChange') {
      bind(window, 'online', () => handler(networkStatus()))
      bind(window, 'offline', () => handler(networkStatus()))
    } else {
      bind(document, 'visibilitychange', () => {
        if ((document.visibilityState === 'visible') === (channel === 'appShow')) handler({})
      })
      if (channel === 'appShow') bind(window, 'pageshow', () => handler({}))
      else bind(window, 'pagehide', () => handler({}))
    }
    if (!listeners.has(channel)) listeners.set(channel, new Map())
    listeners.get(channel)!.set(handler, () => {
      bindings.forEach(([target, event, callback]) => target.removeEventListener(event, callback))
    })
  }
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) releaseBrowserImageUrls()
  })
  return { invoke, on, off }
}
