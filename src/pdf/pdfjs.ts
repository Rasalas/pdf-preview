import type { AnnotationMode, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { rotatedSize } from '../model/pages'
import type { Rotation, Source } from '../model/types'

let library: Promise<typeof import('pdfjs-dist')> | undefined

/**
 * pdf.js is large, so it is only loaded once a document needs it.
 * The legacy build polyfills APIs (Map#getOrInsertComputed, Math.sumPrecise) that the modern
 * build uses unguarded and that Safari and older Chrome versions lack.
 */
export function loadPdfjs() {
  library ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    // One shared worker, started from our own entry so it gets the polyfills too.
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    return pdfjs
  })
  return library
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()
// Oldest first. Decoded images take 4 bytes per pixel, so only a budget's worth stays.
const bitmaps = new Map<string, Promise<ImageBitmap>>()
const bitmapPixels = new Map<string, number>()
const BITMAP_BUDGET = 100_000_000
// More than any screen shows; larger images (scans, 100 MP photos) are shrunk once decoded.
const MAX_BITMAP_PIXELS = 4096 * 4096

// Copied into the build by vite.config.ts. Absolute, because the worker resolves relative URLs against itself.
const asset = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href

export function openPdf(source: Pick<Source, 'id' | 'bytes'>): Promise<PDFDocumentProxy> {
  let doc = docs.get(source.id)
  if (!doc) {
    // pdf.js transfers the buffer to its worker, so it gets a copy.
    doc = loadPdfjs().then(
      (pdfjs) =>
        pdfjs.getDocument({
          data: source.bytes!.slice(),
          wasmUrl: asset('wasm'),
          iccUrl: asset('iccs'),
          cMapUrl: asset('cmaps'),
          standardFontDataUrl: asset('standard_fonts'),
        }).promise,
    )
    doc.catch(() => docs.delete(source.id))
    docs.set(source.id, doc)
  }
  return doc
}

function openImage(source: Source): Promise<ImageBitmap> {
  let bitmap = bitmaps.get(source.id)
  if (bitmap) bitmaps.delete(source.id) // re-added below, as the most recently used
  else {
    bitmap = decodeImage(source).then((b) => {
      bitmapPixels.set(source.id, b.width * b.height)
      evictBitmaps(source.id)
      return b
    })
    bitmap.catch(() => bitmaps.delete(source.id))
  }
  bitmaps.set(source.id, bitmap)
  return bitmap
}

async function decodeImage(source: Source): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(new Blob([source.bytes! as BlobPart], { type: source.mime! }))
  const pixels = bitmap.width * bitmap.height
  if (pixels <= MAX_BITMAP_PIXELS) return bitmap
  const scale = Math.sqrt(MAX_BITMAP_PIXELS / pixels)
  const small = await createImageBitmap(bitmap, {
    resizeWidth: Math.floor(bitmap.width * scale),
    resizeHeight: Math.floor(bitmap.height * scale),
    resizeQuality: 'high',
  })
  bitmap.close()
  return small
}

function evictBitmaps(keep: string) {
  let total = 0
  for (const pixels of bitmapPixels.values()) total += pixels
  for (const id of bitmaps.keys()) {
    if (total <= BITMAP_BUDGET) break
    if (id === keep || !bitmapPixels.has(id)) continue // still decoding
    total -= bitmapPixels.get(id)!
    const evicted = bitmaps.get(id)!
    bitmaps.delete(id)
    bitmapPixels.delete(id)
    // A render may be about to draw it; closing right away would make that throw.
    evicted.then((b) => setTimeout(() => b.close(), 5000))
  }
}

// Rendering many pages at once starves the main thread; queue them.
let running = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiting.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

export interface FormRender {
  /** Leaves form fields out of the page and hands them over as small canvases by widget id (a checkbox has one per state). */
  onCanvases?: (canvases: Map<string, HTMLCanvasElement[]>) => void
  /** Draws these values into the form fields instead of the ones stored in the PDF, by widget id. */
  entries?: Map<string, unknown>
}

/** Renders a page so that it is `cssWidth` CSS pixels wide at the device's pixel ratio. */
export function renderPage(
  canvas: HTMLCanvasElement,
  source: Source,
  index: number,
  rotation: Rotation,
  cssWidth: number,
  signal: AbortSignal,
  forms: FormRender = {},
): Promise<void> {
  return slot(async () => {
    if (signal.aborted) return
    const size = rotatedSize(source.pages[index], rotation)
    const scale = (cssWidth / size.width) * Math.min(window.devicePixelRatio || 1, 2)

    if (source.kind === 'pdf') {
      const pdfjs = await loadPdfjs()
      const doc = await openPdf(source)
      const page = await doc.getPage(index + 1)
      if (signal.aborted) return
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
      const target = document.createElement('canvas')
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      // pdf.js fills the map with one canvas per widget, or an array of them (checkboxes: checked, unchecked).
      const widgets = new Map<string, HTMLCanvasElement | HTMLCanvasElement[]>()
      const mode = formMode(pdfjs.AnnotationMode, doc, forms, widgets)
      const task: RenderTask = page.render({ canvas: target, viewport, ...mode })
      const abort = () => task.cancel()
      signal.addEventListener('abort', abort)
      try {
        await task.promise
      } catch (e) {
        if (signal.aborted) return
        throw e
      } finally {
        signal.removeEventListener('abort', abort)
      }
      copyTo(canvas, target)
      forms.onCanvases?.(new Map([...widgets].map(([id, c]) => [id, [c].flat()])))
      return
    }

    const w = Math.ceil(size.width * scale)
    const h = Math.ceil(size.height * scale)
    const target = document.createElement('canvas')
    target.width = w
    target.height = h
    const ctx = target.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    if (source.kind === 'image') {
      const bitmap = await openImage(source)
      if (signal.aborted) return
      ctx.translate(w / 2, h / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      const [dw, dh] = rotation % 180 === 0 ? [w, h] : [h, w]
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh)
    }
    copyTo(canvas, target)
  })
}

function formMode(
  modes: typeof AnnotationMode,
  doc: PDFDocumentProxy,
  { onCanvases, entries }: FormRender,
  widgets: Map<string, HTMLCanvasElement | HTMLCanvasElement[]>,
) {
  if (onCanvases) return { annotationMode: modes.ENABLE_FORMS, annotationCanvasMap: widgets as Map<string, HTMLCanvasElement> }
  if (!entries) return {}
  // The storage belongs to the document; render() reads it right away, so concurrent renders do not mix.
  for (const [id, value] of entries) doc.annotationStorage.setValue(id, { value })
  return { annotationMode: modes.ENABLE_STORAGE }
}

// Rendering offscreen and copying avoids flashing a blank canvas while a re-render is in progress.
function copyTo(canvas: HTMLCanvasElement, from: HTMLCanvasElement) {
  canvas.width = from.width
  canvas.height = from.height
  canvas.getContext('2d')!.drawImage(from, 0, 0)
}

const thumbs = new Map<string, Promise<string>>()

/** Returns an object URL for a cached thumbnail. Duplicated pages share one. */
export function thumbnailUrl(
  source: Source,
  index: number,
  rotation: Rotation,
  cssWidth: number,
  entries?: Map<string, unknown> | null,
): Promise<string> {
  const key = `${source.id}:${index}:${rotation}:${cssWidth}${entries ? `:${JSON.stringify([...entries])}` : ''}`
  let url = thumbs.get(key)
  if (!url) {
    url = (async () => {
      const canvas = document.createElement('canvas')
      await renderPage(canvas, source, index, rotation, cssWidth, new AbortController().signal, { entries: entries ?? undefined })
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r))
      return URL.createObjectURL(blob!)
    })()
    url.catch(() => thumbs.delete(key))
    thumbs.set(key, url)
  }
  return url
}

/** Renders selectable text over a page. Returns the text spans in text-item order. */
export async function renderTextLayer(
  container: HTMLDivElement,
  source: Source,
  index: number,
  rotation: Rotation,
  cssWidth: number,
  signal: AbortSignal,
): Promise<HTMLElement[]> {
  const page = await (await openPdf(source)).getPage(index + 1)
  if (signal.aborted) return []
  const scale = cssWidth / rotatedSize(source.pages[index], rotation).width
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
  const target = document.createElement('div')
  target.className = 'textLayer'
  target.style.setProperty('--total-scale-factor', String(scale))
  const { TextLayer } = await loadPdfjs()
  const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: target, viewport })
  const abort = () => layer.cancel()
  signal.addEventListener('abort', abort)
  try {
    await layer.render()
  } catch (e) {
    if (signal.aborted) return []
    throw e
  } finally {
    signal.removeEventListener('abort', abort)
  }
  container.replaceChildren(target)
  return layer.textDivs
}
