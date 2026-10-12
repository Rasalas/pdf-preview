import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  // Relative paths, so the same build works on GitHub Pages, GitLab Pages and in the desktop app.
  base: './',
  worker: { format: 'es' },
  define: { __APP_VERSION__: JSON.stringify(version) },
})

/**
 * Files pdf.js fetches at runtime: image decoders (JPEG 2000, JBIG2, CCITT), colour profiles,
 * CMaps and standard fonts. Without them scanned pages render blank. Served under pdfjs/.
 */
function pdfjsAssets(): Plugin {
  const root = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
  const dirs = ['wasm', 'iccs', 'cmaps', 'standard_fonts']
  // quickjs runs JavaScript embedded in PDFs, which the app never enables.
  const files = dirs.flatMap((dir) => readdirSync(join(root, dir)).filter((f) => !f.startsWith('quickjs')).map((f) => `${dir}/${f}`))
  const types: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript' }
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const file = decodeURIComponent(req.url!.split('?')[0].slice(1))
        if (!files.includes(file) || !existsSync(join(root, file))) return next()
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
        res.end(readFileSync(join(root, file)))
      })
    },
    generateBundle() {
      for (const file of files) this.emitFile({ type: 'asset', fileName: `pdfjs/${file}`, source: readFileSync(join(root, file)) })
    },
  }
}
