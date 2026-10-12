import react from '@vitejs/plugin-react'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pdfjsAssets(), libheifAssets(), ocrAssets()],
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

/**
 * libheif opens HEIC photos in browsers that cannot (public/heif/worker.js loads it). It is LGPL-3.0,
 * so it ships as an untouched separate file with its licence text beside it. Served under heif/.
 */
function libheifAssets(): Plugin {
  const root = fileURLToPath(new URL('./node_modules/libheif-js/libheif-wasm/', import.meta.url))
  const files: Record<string, string> = { 'libheif.js': 'libheif.js', 'libheif.wasm': 'libheif.wasm', 'LICENSE.txt': 'LICENSE' }
  const types: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.txt': 'text/plain' }
  return {
    name: 'libheif-assets',
    configureServer(server) {
      server.middlewares.use('/heif/', (req, res, next) => {
        const name = decodeURIComponent(req.url!.split('?')[0].slice(1))
        if (!files[name]) return next()
        res.setHeader('Content-Type', types[extname(name)])
        res.end(readFileSync(join(root, files[name])))
      })
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: `heif/${name}`, source: readFileSync(join(root, file)) })
    },
  }
}

/**
 * Text recognition runs from our own origin: tesseract.js would fetch its worker and engine from a CDN
 * by default. Only the LSTM engines are copied (three, for browsers with and without SIMD); the language
 * data lives in public/ocr/lang. Served under ocr/.
 */
function ocrAssets(): Plugin {
  const dir = (name: string) => fileURLToPath(new URL(`./node_modules/${name}/`, import.meta.url))
  const [js, core] = [dir('tesseract.js'), dir('tesseract.js-core')]
  const files: Record<string, string> = {
    'worker.min.js': join(js, 'dist/worker.min.js'),
    'worker.min.js.LICENSE.txt': join(js, 'dist/worker.min.js.LICENSE.txt'),
    'LICENSE-tesseract.js.txt': join(js, 'LICENSE.md'),
    'LICENSE-tesseract.js-core.txt': join(core, 'LICENSE'),
  }
  for (const file of readdirSync(core).filter((f) => f.endsWith('-lstm.wasm.js'))) files[`core/${file}`] = join(core, file)
  const types: Record<string, string> = { '.js': 'text/javascript', '.txt': 'text/plain' }
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr/', (req, res, next) => {
        const name = decodeURIComponent(req.url!.split('?')[0].slice(1))
        if (!files[name]) return next()
        res.setHeader('Content-Type', types[extname(name)])
        res.end(readFileSync(files[name]))
      })
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) })
    },
  }
}
