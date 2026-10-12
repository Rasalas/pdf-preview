// SVG has no pixels of its own. It is drawn through an <img>, because createImageBitmap rejects SVG blobs in some browsers.

// Long edge of the raster in px: A4 at 300 dpi, sharp enough for printing.
const RASTER_EDGE = 2480
// Browsers fall back to this for an SVG with neither size nor viewBox.
const DEFAULT_SIZE = { width: 300, height: 150 }
const SVG_NS = 'http://www.w3.org/2000/svg'
const UNITS: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 }

/** A length attribute in CSS px; null for percentages, missing or invalid values. */
export function svgLength(value: string | null): number | null {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i.exec(value ?? '')
  const unit = match ? (match[2] ? UNITS[match[2].toLowerCase()] : 1) : undefined
  const n = match && unit ? parseFloat(match[1]) * unit : 0
  return n > 0 ? n : null
}

/** Intrinsic size in CSS px: width and height if given, completed from the viewBox's proportions. */
export function svgSize(width: string | null, height: string | null, viewBox: string | null): { width: number; height: number } {
  const [, , vw, vh] = viewBox?.trim().split(/[\s,]+/).map(Number) ?? []
  const view = vw > 0 && vh > 0 ? { width: vw, height: vh } : null
  const w = svgLength(width)
  const h = svgLength(height)
  if (w && h) return { width: w, height: h }
  if (!view) return { width: w ?? DEFAULT_SIZE.width, height: h ?? DEFAULT_SIZE.height }
  if (w) return { width: w, height: (w * view.height) / view.width }
  if (h) return { width: (h * view.width) / view.height, height: h }
  return view
}

/** Draws the SVG at 2480 px on its long edge. `size` is its intrinsic size in CSS px, for the page. */
export async function rasterizeSvg(text: string): Promise<{ canvas: HTMLCanvasElement; size: { width: number; height: number } }> {
  const withNamespace = /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(text) ? text : text.replace(/<svg\b/i, `<svg xmlns="${SVG_NS}"`)
  const doc = new DOMParser().parseFromString(withNamespace, 'image/svg+xml')
  const root = doc.documentElement
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('not an SVG')

  const size = svgSize(root.getAttribute('width'), root.getAttribute('height'), root.getAttribute('viewBox'))
  const scale = RASTER_EDGE / Math.max(size.width, size.height)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  // Explicit pixel dimensions: Firefox needs them, and WebKit would otherwise draw at the intrinsic size and scale up.
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG could not be drawn'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
    return { canvas, size }
  } finally {
    URL.revokeObjectURL(url)
  }
}
