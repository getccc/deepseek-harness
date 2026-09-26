import { defineConfig } from 'tsdown'

// The main process bundles its workspace dependencies, because electron-builder
// collects only real npm dependencies into the installed application. Electron
// is the host and `electron-updater` is collected that way, so both stay
// external; everything else is inlined and needs no resolution at runtime.
export default defineConfig([
  {
    entry: { main: 'dist/types/main.js' },
    outDir: 'dist',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['electron', 'electron-updater'],
  },
  {
    // Sandboxed Electron preloads run as CommonJS even though this application is ESM.
    entry: { preload: 'dist/types/preload.js' },
    outDir: 'dist',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['electron'],
  },
])
