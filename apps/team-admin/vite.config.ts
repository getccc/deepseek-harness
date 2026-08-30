import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/** npm packages that ride the cached vendor chunk, by directory name. */
const VENDOR_ROOTS: readonly string[] = ['react', 'react-dom', 'antd', '@ant-design', 'scheduler']

export default defineConfig({
  // Relative asset URLs: the Control Plane serves this build under a path
  // prefix it owns, and the index must resolve its chunks from there rather
  // than from the site root.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: { index: src('./index.html') },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        // Ant Design and React change on a dependency bump; this application
        // changes far more often. Keeping them apart means editing a view
        // re-hashes the small chunk and returning administrators keep the
        // cached large one.
        manualChunks(id: string): string | undefined {
          return VENDOR_ROOTS.some(root => id.includes(`/node_modules/${root}/`)) ? 'vendor' : undefined
        },
      },
    },
  },
  resolve: {
    // One instance per shared npm identity: a bare specifier otherwise resolves
    // from the importer's directory, and a second React copy would split hook
    // and element identity between the app and Ant Design.
    dedupe: ['react', 'react-dom'],
  },
})
