import { defineConfig } from 'tsdown'

// Sandboxed Electron preloads run as CommonJS even though this application is ESM,
// so the compiled preload is re-emitted in that format beside the main process.
export default defineConfig({
  entry: { preload: 'dist/preload.js' },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
