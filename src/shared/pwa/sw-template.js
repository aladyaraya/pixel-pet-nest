const config = __PWA_CONFIG__
const prefix = `pwa:${config.environment}:${config.publicAppId}:app:`
const cacheName = `${prefix}${config.buildId}:shell`
const entries = new Map(config.precache.map((entry) => [new URL(entry.url, self.location.origin).href, entry.type]))
const indexUrl = new URL(config.navigationUrl, self.location.origin).href
const offlineUrl = new URL(config.offlineUrl, self.location.origin).href
const appUrl = new URL(config.appBasePath, self.location.origin).href
const checks = new Map()

function isPublicResponse(response, type) {
  return response.ok && !response.redirected && response.type !== 'opaque'
    && !/no-store|private/i.test(response.headers.get('cache-control') || '')
    && (response.headers.get('content-type') || '').split(';')[0].trim() === type
}

async function clearAppCaches() {
  for (const name of await caches.keys()) {
    if (name.startsWith(prefix)) await caches.delete(name)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const responses = await Promise.all([...entries].map(async ([url, type]) => {
      const response = await fetch(url, { cache: 'reload', credentials: 'omit' })
      if (!isPublicResponse(response, type)) throw new Error('PWA precache response invalid')
      return [url, response]
    }))
    const cache = await caches.open(cacheName)
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)))
  })())
})

async function navigation() {
  try {
    const response = await fetch(indexUrl, { cache: 'no-cache', credentials: 'omit' })
    if (response.status === 410) await clearAppCaches()
    return response
  } catch {
    const cache = await caches.open(cacheName)
    return (await cache.match(indexUrl)) || (await cache.match(offlineUrl))
      || new Response('当前离线，请联网后重试', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}

async function staticResponse(request, url) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(url.href)
  if (cached) return cached
  // 自然接管的新 worker 仍须服务旧窗口已经预缓存的精确依赖。
  for (const name of await caches.keys()) {
    if (!name.startsWith(prefix) || name === cacheName) continue
    const old = await (await caches.open(name)).match(url.href)
    if (old) return old
  }
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin
      || request.headers.has('authorization') || url.search
      || !url.pathname.startsWith(config.appBasePath)) return
  if (request.mode === 'navigate' && (url.href === appUrl || url.href === `${appUrl}index.html` || url.href === indexUrl)) {
    event.respondWith(navigation())
  } else if (entries.has(url.href) && !url.pathname.endsWith('.html')) {
    event.respondWith(staticResponse(request, url))
  } else if (url.pathname.startsWith(`${config.appBasePath}releases/`)) {
    event.respondWith((async () => {
      let cached
      for (const name of await caches.keys()) {
        if (!name.startsWith(prefix)) continue
        const response = await (await caches.open(name)).match(url.href)
        if (response) { cached = response; break }
      }
      if (request.mode === 'navigate' && cached) {
        try {
          const response = await fetch(request)
          if (response.status === 410) await clearAppCaches()
          return response
        } catch { return cached }
      }
      return cached && !url.pathname.endsWith('.html') ? cached : fetch(request)
    })())
  }
})

async function scopedWindows() {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter((client) => {
      const url = new URL(client.url)
      return url.origin === self.location.origin && url.pathname.startsWith(config.appBasePath)
    })
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ((await scopedWindows()).length) return
    const names = (await caches.keys()).filter((name) => name.startsWith(prefix))
    const keep = new Set([...names.slice(-2), cacheName])
    for (const name of names) {
      if (!keep.has(name)) await caches.delete(name)
    }
  })())
})

self.addEventListener('message', (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  if (message.type === 'PWA_UPDATE_REVOKED' && event.source) {
    for (const check of checks.values()) {
      if (check.ids.has(event.source.id)) {
        check.safe = false
        check.resolve(false)
      }
    }
    return
  }
  if (message.type === 'PWA_UPDATE_STATE') {
    const check = checks.get(message.requestId)
    if (!check || !event.source || !check.pending.has(event.source.id)) return
    check.pending.delete(event.source.id)
    check.safe = check.safe && message.canReload === true
    if (!check.pending.size) check.resolve(check.safe)
    return
  }
  if (message.type !== 'PWA_REQUEST_UPDATE' || !event.source || checks.size) return
  event.waitUntil((async () => {
    if (typeof event.source.url !== 'string') return
    const sourceUrl = new URL(event.source.url)
    if (sourceUrl.origin !== self.location.origin || !sourceUrl.pathname.startsWith(config.appBasePath)) return
    const windows = await scopedWindows()
    if (!windows.some((client) => client.id === event.source.id)) return
    const requestId = crypto.randomUUID()
    if (checks.size) return
    let timer
    const safe = await new Promise((resolve) => {
      const ids = new Set(windows.map((client) => client.id))
      const check = { ids, pending: new Set(ids), safe: true, resolve }
      checks.set(requestId, check)
      windows.forEach((client) => client.postMessage({ type: 'PWA_CHECK_UPDATE', requestId, buildId: config.buildId }))
      timer = setTimeout(() => resolve(false), 3000)
    })
    clearTimeout(timer)
    const current = await scopedWindows()
    const check = checks.get(requestId)
    checks.delete(requestId)
    if (!safe || !check.safe || current.length !== windows.length || current.some((client) => !check.ids.has(client.id))) {
      windows.forEach((client) => client.postMessage({ type: 'PWA_UPDATE_CANCELLED' }))
      event.source.postMessage({ type: 'PWA_UPDATE_DEFERRED' })
      return
    }
    try { await self.skipWaiting() }
    catch { windows.forEach((client) => client.postMessage({ type: 'PWA_UPDATE_CANCELLED' })) }
  })())
})
