import { mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readPwaContext, localIconPath } from './pwa-context.mjs'

export const PWA_ICONS = [
  { file: 'apple-touch-icon.png', size: 180, purpose: 'any' },
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'icon-1024.png', size: 1024, purpose: 'any' },
  { file: 'maskable-512.png', size: 512, purpose: 'maskable' },
]

export async function makePwaIcons(root, outDir = path.join(root, 'dist/pwa'), context = readPwaContext(root)) {
  const source = localIconPath(root, context.iconSource)
  const metadata = await sharp(source, { limitInputPixels: 64 * 1024 * 1024 }).metadata()
  if (!['png', 'svg'].includes(metadata.format) || !metadata.width || metadata.width !== metadata.height || (metadata.pages ?? 1) !== 1) {
    throw new Error('PWA 图标源必须是可解码的方形单帧 PNG/SVG')
  }
  const iconsDir = path.join(outDir, 'icons')
  mkdirSync(iconsDir, { recursive: true })
  for (const icon of PWA_ICONS) {
    const side = icon.purpose === 'maskable' ? Math.floor(icon.size * 0.56) : icon.size
    const content = await sharp(source, { limitInputPixels: 64 * 1024 * 1024 }).rotate()
      .resize(side, side, { fit: 'contain', background: context.backgroundColor })
      .flatten({ background: context.backgroundColor }).removeAlpha().png().toBuffer()
    const offset = Math.floor((icon.size - side) / 2)
    await sharp({ create: { width: icon.size, height: icon.size, channels: 3, background: context.backgroundColor } })
      .composite([{ input: content, top: offset, left: offset }]).flatten({ background: context.backgroundColor })
      .removeAlpha().png().toFile(path.join(iconsDir, icon.file))
  }
  return PWA_ICONS.map((icon) => ({ src: `${context.appBasePath}icons/${icon.file}`, sizes: `${icon.size}x${icon.size}`, type: 'image/png', purpose: icon.purpose }))
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)))
  try { await makePwaIcons(root); console.log('PWA PNG 图标已生成') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
