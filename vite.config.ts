import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative paths, so the same build works on GitHub Pages, GitLab Pages and in the desktop app.
  base: './',
  worker: { format: 'es' },
  define: { __APP_VERSION__: JSON.stringify(version) },
})
