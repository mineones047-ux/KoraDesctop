import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The renderer only ever runs inside Electron's Chromium (128+; current
    // baseline is Electron 44 / Chromium 152), so shipping modern,
    // un-transpiled syntax is safe and slightly smaller/faster.
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})