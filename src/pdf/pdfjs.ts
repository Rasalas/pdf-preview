import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { rotatedSize } from '../model/pages'
import type { Rotation, Source } from '../model/types'

let library: Promise<typeof import('pdfjs-dist')> | undefined

/** pdf.js is large, so it is only loaded once a document needs it. */
export function loadPdfjs() {
  library ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
    return pdfjs
  })
  return library
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()
const bitmaps = new Map<string, Promise<ImageBitmap>>()

export function openPdf(source: Pick<Source, 'id' | 'bytes'>): Promise<PDFDocumentProxy> {
  let doc = docs.get(source.id)
  if (!doc) {
    // pdf.js transfers the buffer to its worker, so it gets a copy.
    doc = loadPdfjs().then((pdfjs) => pdfjs.getDocument({ data: source.bytes!.slice() }).promise)
    doc.catch(() => docs.delete(source.id))
    docs.set(source.id, doc)
  }
  return doc
}

function openImage(source: Source): Promise<ImageBitmap> {
  let bitmap = bitmaps.get(source.id)
  if (!bitmap) {
    bitmap = createImageBitmap(new Blob([source.bytes! as BlobPart], { type: source.mime! }))
    bitmaps.set(source.id, bitmap)
  }
  return bitmap
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

/** Renders a page so that it is `cssWidth` CSS pixels wide at the device's pixel ratio. */
export function renderPage(
  canvas: HTMLCanvasElement,
  source: Source,
  index: number,
  rotation: Rotation,
  cssWidth: number,
  signal: AbortSignal,
): Promise<void> {
  return slot(async () => {
    if (signal.aborted) return
    const size = rotatedSize(source.pages[index], rotation)
    const scale = (cssWidth / size.width) * Math.min(window.devicePixelRatio || 1, 2)

    if (source.kind === 'pdf') {
      const page = await (await openPdf(source)).getPage(index + 1)
      if (signal.aborted) return
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
      const target = document.createElement('canvas')
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      const task: RenderTask = page.render({ canvas: target, viewport })
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

// Rendering offscreen and copying avoids flashing a blank canvas while a re-render is in progress.
function copyTo(canvas: HTMLCanvasElement, from: HTMLCanvasElement) {
  canvas.width = from.width
  canvas.height = from.height
  canvas.getContext('2d')!.drawImage(from, 0, 0)
}

const thumbs = new Map<string, Promise<string>>()

/** Returns an object URL for a cached thumbnail. Duplicated pages share one. */
export function thumbnailUrl(source: Source, index: number, rotation: Rotation, cssWidth: number): Promise<string> {
  const key = `${source.id}:${index}:${rotation}:${cssWidth}`
  let url = thumbs.get(key)
  if (!url) {
    url = (async () => {
      const canvas = document.createElement('canvas')
      await renderPage(canvas, source, index, rotation, cssWidth, new AbortController().signal)
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
