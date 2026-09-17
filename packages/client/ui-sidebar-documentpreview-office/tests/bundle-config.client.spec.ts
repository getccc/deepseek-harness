/** The browser bundle drops SheetJS's Node requires on every host path separator. */
import { describe, expect, it } from 'vitest'
import bundleConfig from '../tsdown.config.ts'

type Transform = (code: string, id: string) => { code: string } | null

interface NamedPlugin {
  name?: string
  transform?: Transform
}

function pluginList(value: unknown): NamedPlugin[] {
  if (Array.isArray(value)) return value.flatMap(pluginList)
  return typeof value === 'object' && value !== null ? [value] : []
}

function sheetjsTransform(): Transform {
  const client = bundleConfig({ env: {} }).find(config => config.name?.endsWith('/client') === true)
  const plugin = pluginList(client?.plugins).find(candidate => candidate.name === 'dsh-office-sheetjs-browser-only')
  if (plugin?.transform === undefined) throw new Error('the client bundle has no SheetJS browser-only transform')
  return plugin.transform
}

const SOURCE = 'var fs = require("fs"); var strmod = require(\'stream\'); var zip = require("jszip");'

describe('SheetJS browser-only transform', () => {
  it.each([
    ['POSIX', '/repo/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.mjs'],
    ['Windows', 'D:\\repo\\node_modules\\.pnpm\\xlsx@0.18.5\\node_modules\\xlsx\\xlsx.mjs'],
  ])('replaces the fs and stream requires for a %s module id', (_host, id) => {
    expect(sheetjsTransform()(SOURCE, id)?.code).toBe('var fs = undefined; var strmod = undefined; var zip = require("jszip");')
  })

  it('leaves modules outside SheetJS untouched', () => {
    expect(sheetjsTransform()(SOURCE, 'D:\\repo\\node_modules\\jszip\\lib\\index.js')).toBeNull()
  })
})
