import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Both shells consume this build: Electron and Tauri each point at the dev server in
// development and at dist/ in production. Relative base so file:// loading works.
export default defineConfig({
  plugins: [vue()],
  base: './',
  server: { port: 5173, strictPort: true }
})
