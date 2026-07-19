import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@': resolve('src') } },
    build: { outDir: 'dist/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@': resolve('src') } },
    build: {
      outDir: 'dist/preload',
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@': resolve('src') } },
    plugins: [react()],
    build: { outDir: resolve('dist/renderer'), emptyOutDir: true }
  }
})
