import type { PwaBuildContext, PwaProjectConfig } from './gen/api/v1/pwa'
export type { PwaBuildContext, PwaProjectConfig } from './gen/api/v1/pwa'

export interface PwaHtmlTag {
  tag: string
  attrs: Record<string, string>
  source: string
}
export const PUBLIC_BACKEND_KEYS: (keyof NonNullable<PwaBuildContext['publicBackend']>)[]
export const PWA_MIME_TYPES: Record<string, string>
export function readPwaContext(root: string, contextPath?: string): PwaBuildContext
export function readPwaProjectConfig(root: string): PwaProjectConfig
export function pwaViteEnv(context: PwaBuildContext): Record<string, string>
export function checkPwaCapabilities(root: string, context: PwaBuildContext): {
  required: string[]
  supported: string[]
  runtimeAuthorization: { capability: string; status: 'pending-runtime-authorization' }[]
}
export function pwaRuntime(context: PwaBuildContext): Pick<PwaBuildContext, 'environment' | 'publicAppId' | 'buildId' | 'appBasePath' | 'assetBasePath' | 'origin'>
export function localIconPath(root: string, source: string, materialized?: string): string
export function sha256(data: string | Uint8Array): string
export function canonicalJson(value: unknown): string
export function pwaContextSha256(context: PwaBuildContext): string
export function htmlTags(html: string): PwaHtmlTag[]
export function pwaHead(context: PwaBuildContext): Pick<PwaHtmlTag, 'tag' | 'attrs'>[]
export function transformPwaHtml(html: string, context: PwaBuildContext): string
