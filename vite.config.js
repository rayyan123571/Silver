import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron loads the renderer from this dev server (port 5199) in development,
// and from the ./dist folder (relative paths) in production. 5199 avoids the
// default 5173, which other Vite projects/leftover processes often already hold.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5199,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
