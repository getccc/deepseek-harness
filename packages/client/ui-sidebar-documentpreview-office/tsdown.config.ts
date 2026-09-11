import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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

/** The sheets preset's stylesheet, as the source imports it. */
const UNIVER_STYLES = '@univerjs/preset-sheets-core/lib/index.css?inline'
const UNIVER_STYLES_ID = '\0dsh-office-univer-styles'
const require = createRequire(import.meta.url)

/**
 * The shared preset reads an inline stylesheet relative to its importer, which
 * cannot reach a package's file. This resolves the one bare specifier the
 * plugin imports to the installed file and exports its text, before the
 * preset's own inline loader sees the request.
 */
const univerStyles: NonNullable<UserConfig['plugins']> = [{
  name: 'dsh-office-univer-styles',
  resolveId(source) {
    return source === UNIVER_STYLES ? UNIVER_STYLES_ID : null
  },
  async load(id) {
    if (id !== UNIVER_STYLES_ID) return null
    const file = require.resolve(UNIVER_STYLES.slice(0, -'?inline'.length))
    this.addWatchFile(file)
    return `export default ${JSON.stringify(await readFile(file, 'utf8'))};`
  },
}]

export default (options: Parameters<typeof bundle>[0]): UserConfig[] => bundle(options).map((config) => {
  if (config.name?.endsWith('/client') !== true) return config
  const inputOptions = typeof config.inputOptions === 'object' && config.inputOptions !== null ? config.inputOptions : {}
  const resolve = 'resolve' in inputOptions && typeof inputOptions.resolve === 'object' && inputOptions.resolve !== null
    ? inputOptions.resolve
    : {}
  const outputOptions = typeof config.outputOptions === 'object' && config.outputOptions !== null ? config.outputOptions : {}
  return {
    ...config,
    plugins: [univerStyles, config.plugins, sheetjsBrowserOnly],
    inputOptions: { ...inputOptions, resolve: { ...resolve, aliasFields: [['browser']] } },
    // Univer's text layout loads hyphenation patterns through dynamic imports,
    // one per language; the module loader's `require` cannot fetch a chunk, so
    // every pattern rides in the one bundle.
    outputOptions: { ...outputOptions, inlineDynamicImports: true },
  }
})
