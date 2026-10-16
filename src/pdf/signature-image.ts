import { newId } from '../model/ids'
import { SignatureFileError, type Signature } from '../model/signatures'

const MAX_EDGE = 800

/**
 * A signature from a scan or photo: the paper turns transparent, the ink keeps its colour, and the
 * picture is cut to the signature. A PNG that already has transparency stays as it is.
 */
export async function signatureFromImage(file: Blob): Promise<Signature> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new SignatureFileError('Das Bild kann dieser Browser nicht öffnen.')
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (!hasTransparency(image.data)) knockOutPaper(image.data)
  const box = inkBox(image)
  if (!box) throw new SignatureFileError('Auf dem Bild ist keine Unterschrift zu erkennen.')
  const out = document.createElement('canvas')
  out.width = box.w
  out.height = box.h
  out.getContext('2d')!.putImageData(image, -box.x, -box.y)
  return { id: newId(), w: box.w, h: box.h, paths: [], image: out.toDataURL('image/png') }
}

function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true
  return false
}

const luminance = (rgba: Uint8ClampedArray, i: number) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]

/** Alpha from how much darker than the paper a pixel is; colour unmixed from the paper so edges keep no halo. */
export function knockOutPaper(rgba: Uint8ClampedArray) {
  const histogram = Array.from({ length: 256 }, () => 0)
  for (let i = 0; i < rgba.length; i += 4) histogram[Math.round(luminance(rgba, i))]++
  // Most of a signature picture is paper, so the median is paper; the darkest percent is ink.
  const paper = percentile(histogram, 0.5)
  const ink = percentile(histogram, 0.01)
  const light = paper * 0.88
  if (light - ink < 24) {
    rgba.fill(0)
    return
  }
  const paperColour = averageNear(rgba, paper)
  for (let i = 0; i < rgba.length; i += 4) {
    const a = Math.min(1, Math.max(0, (light - luminance(rgba, i)) / (light - ink)))
    for (let c = 0; c < 3; c++) rgba[i + c] = a > 0 ? Math.min(255, Math.max(0, (rgba[i + c] - paperColour[c] * (1 - a)) / a)) : 0
    rgba[i + 3] = Math.round(a * 255)
  }
}

function percentile(histogram: number[], q: number): number {
  const total = histogram.reduce((a, b) => a + b, 0)
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += histogram[v]
    if (seen >= total * q) return v
  }
  return 255
}

function averageNear(rgba: Uint8ClampedArray, level: number): [number, number, number] {
  const sum = [0, 0, 0]
  let n = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (Math.abs(luminance(rgba, i) - level) > 8) continue
    for (let c = 0; c < 3; c++) sum[c] += rgba[i + c]
    n++
  }
  return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : [level, level, level]
}

/** The visible part with a little room around it, or null when nothing shows. */
function inkBox({ data, width, height }: ImageData) {
  let [x0, y0, x1, y1] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 40) continue
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) return null
  const pad = 4
  const x = Math.max(0, x0 - pad)
  const y = Math.max(0, y0 - pad)
  return { x, y, w: Math.min(width, x1 + pad + 1) - x, h: Math.min(height, y1 + pad + 1) - y }
}
