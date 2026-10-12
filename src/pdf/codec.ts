import type { Raster } from './raster'

export interface Opened {
  width: number
  height: number
  /** RGB pixels at the given size, or null when the canvas cannot hold them. */
  read(width: number, height: number): Raster | null
  close(): void
}

/** The browser-only part of image compression, behind a seam so the rest runs in tests. */
export interface Codec {
  openJpeg(bytes: Uint8Array): Promise<Opened>
  encodeJpeg(raster: Raster, quality: number): Promise<Uint8Array | null>
}

// Safari on iOS refuses canvases beyond this and silently draws nothing.
const MAX_CANVAS_PIXELS = 16_000_000

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 0
}

function read(bitmap: ImageBitmap, width: number, height: number): Raster | null {
  if (width * height > MAX_CANVAS_PIXELS) return null
  // Halving step by step averages like a box filter; one big jump would alias.
  let source: CanvasImageSource = bitmap
  let temp: HTMLCanvasElement | undefined
  let w = bitmap.width
  let h = bitmap.height
  const draw = (nw: number, nh: number) => {
    const canvas = makeCanvas(nw, nh)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, nw, nh)
    if (temp) release(temp)
    temp = canvas
    source = canvas
    w = nw
    h = nh
  }
  while (w >= width * 2 && h >= height * 2) draw(Math.floor(w / 2), Math.floor(h / 2))
  if (w !== width || h !== height || !temp) draw(width, height)
  const last = temp as HTMLCanvasElement
  const rgba = last.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data
  release(last)
  const data = new Uint8Array(width * height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    data[j] = rgba[i]
    data[j + 1] = rgba[i + 1]
    data[j + 2] = rgba[i + 2]
  }
  return { width, height, channels: 3, data }
}

async function encodeJpeg(raster: Raster, quality: number): Promise<Uint8Array | null> {
  const { width, height, channels, data } = raster
  if (width * height > MAX_CANVAS_PIXELS) return null
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(width, height)
  for (let i = 0, j = 0; j < image.data.length; i += channels, j += 4) {
    image.data[j] = data[i]
    image.data[j + 1] = data[channels === 3 ? i + 1 : i]
    image.data[j + 2] = data[channels === 3 ? i + 2 : i]
    image.data[j + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  release(canvas)
  // Browsers answer with PNG when they cannot write JPEG.
  return blob?.type === 'image/jpeg' ? new Uint8Array(await blob.arrayBuffer()) : null
}

export const browserCodec: Codec = {
  async openJpeg(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
    return { width: bitmap.width, height: bitmap.height, read: (w, h) => read(bitmap, w, h), close: () => bitmap.close() }
  },
  encodeJpeg,
}
