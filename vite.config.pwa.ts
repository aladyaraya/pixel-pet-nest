import { defineConfig, loadEnv } from 'vite'
import { fromRoot, sharedViteConfig } from './vite.shared'
import { readPwaContext, checkPwaCapabilities, pwaViteEnv, pwaRuntime, transformPwaHtml } from './scripts/pwa-context.mjs'

export default defineConfig(({ mode }) => {
  const root = fromRoot('.')
  const context = readPwaContext(root)
  checkPwaCapabilities(root, context)
  const envPrefix = '__PWA_NO_AUTO_PUBLIC_ENV__'
  const env = loadEnv(mode, root, envPrefix)
  if (Object.keys(env).length || Object.keys(process.env).some((key) => key.startsWith(envPrefix))) {
    throw new Error('PWA 禁止自动暴露环境变量；公开配置只能来自 publicBackend 白名单')
  }
  return {
    ...sharedViteConfig,
    base: context.assetBasePath,
    envPrefix,
    define: {
      'import.meta.env.VITE_APP_TARGET': JSON.stringify('pwa'),
      'import.meta.env.VITE_PWA_RUNTIME': JSON.stringify(pwaRuntime(context)),
      ...Object.fromEntries(Object.entries(pwaViteEnv(context)).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
    },
    plugins: [...(sharedViteConfig.plugins ?? []), {
      name: 'ai-builder:pwa-head',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => transformPwaHtml(html, context),
      },
    }],
    build: {
      ...sharedViteConfig.build,
      outDir: fromRoot('./dist/pwa'),
      emptyOutDir: true,
      rollupOptions: { input: fromRoot('./index.html') },
    },
  }
})
