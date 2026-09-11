import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-sidebar-documentpreview-office', ['lib/types/index.js'])

/**
 * The renderer libraries ship Node fallbacks behind their `browser` manifest
 * field: JSZip's stream adapter and SheetJS's file and stream readers. The
 * browser build must follow that field, or the inlined Node paths reach the
 * module loader's `require` at load time and no bundle boots.
 */
const SHEETJS_NODE_REQUIRES = /require\((['"])(?:fs|stream)\1\)/gu

/**
 * SheetJS also reaches `fs` and `stream` through guarded dynamic `require`
 * calls that no manifest field rewrites; the module loader's injected
 * `require` makes the guard pass and the lookup throw, so those calls read as
 * absent, which is what SheetJS handles for a browser.
 */
const sheetjsBrowserOnly: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-office-sheetjs-browser-only',
  transform(code, id) {
    if (!id.includes('/node_modules/xlsx/')) return null
    return { code: code.replace(SHEETJS_NODE_REQUIRES, 'undefined'), map: null }
  },
}]

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map((config) => {
  if (config.name?.endsWith('/client') !== true) return config
  const inputOptions = typeof config.inputOptions === 'object' && config.inputOptions !== null ? config.inputOptions : {}
  const resolve = 'resolve' in inputOptions && typeof inputOptions.resolve === 'object' && inputOptions.resolve !== null
    ? inputOptions.resolve
    : {}
  return {
    ...config,
    plugins: [config.plugins, sheetjsBrowserOnly],
    inputOptions: { ...inputOptions, resolve: { ...resolve, aliasFields: [['browser']] } },
  }
})
