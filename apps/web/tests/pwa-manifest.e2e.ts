import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="./manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Welinkin Work',
    short_name: 'Welinkin Work',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships a favicon carrying the product mark at the full icon width', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The mark is a two-tone raster inlined as a data URI and drawn to the whole
  // 50-unit width. Both tones read on a light and a dark ground, so the icon
  // carries no colour-scheme swap.
  expect(favicon).toMatch(/<svg[^>]*viewBox="0 0 50 50"/)
  expect(favicon).toMatch(/<image[^>]*width="50"[^>]*href="data:image\/png;base64,/)
  expect(favicon).not.toContain('prefers-color-scheme')
})
