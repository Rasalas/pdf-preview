/** EXIF orientation: where the stored image's first row and column sit when displayed (1 = upright). */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

// Displayed (X, Y) in 0..1, Y down, from stored column s and row t: X = xs*s + xt*t + x0, Y = ys*s + yt*t + y0.
const MAP: Record<Orientation, [xs: number, xt: number, x0: number, ys: number, yt: number, y0: number]> = {
  1: [1, 0, 0, 0, 1, 0],
  2: [-1, 0, 1, 0, 1, 0],
  3: [-1, 0, 1, 0, -1, 1],
  4: [1, 0, 0, 0, -1, 1],
  5: [0, 1, 0, 1, 0, 0],
  6: [0, -1, 1, 1, 0, 0],
  7: [0, -1, 1, -1, 0, 1],
  8: [0, 1, 0, -1, 0, 1],
}

/** Orientation stored in a JPEG's EXIF block. Unreadable or missing data counts as upright. */
export function readOrientation(bytes: Uint8Array): Orientation {
  try {
    return scanJpeg(bytes)
  } catch {
    return 1
  }
}

function scanJpeg(bytes: Uint8Array): Orientation {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 2
  while (pos + 4 <= bytes.length && bytes[pos] === 0xff) {
    const marker = bytes[pos + 1]
    if (marker === 0xff) pos++ // fill byte
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) pos += 2 // markers without a length
    else if (marker === 0xda || marker === 0xd9) return 1 // image data starts: no EXIF will follow
    else {
      const end = pos + 2 + view.getUint16(pos + 2)
      const isExif = marker === 0xe1 && String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === 'Exif'
      if (isExif) return tiffOrientation(bytes, pos + 10, end)
      pos = end
    }
  }
  return 1
}

/** Reads tag 0x0112 from a TIFF block at `start` (also what PNG's eXIf chunk holds). */
export function tiffOrientation(bytes: Uint8Array, start: number, end = bytes.length): Orientation {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, Math.min(end, bytes.length))
    const order = view.getUint16(start)
    if (order !== 0x4949 && order !== 0x4d4d) return 1
    const little = order === 0x4949
    if (view.getUint16(start + 2, little) !== 42) return 1
    const ifd = start + view.getUint32(start + 4, little)
    const count = view.getUint16(ifd, little)
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12
      if (view.getUint16(entry, little) !== 0x0112) continue
      const type = view.getUint16(entry + 2, little)
      const value = type === 3 ? view.getUint16(entry + 8, little) : type === 4 ? view.getUint32(entry + 8, little) : 0
      return value >= 1 && value <= 8 ? (value as Orientation) : 1
    }
  } catch {
    // Truncated block.
  }
  return 1
}

/** PDF matrix [a b c d e f] that draws an image XObject upright on a page of `width` x `height` points. */
export function orientationMatrix(o: Orientation, width: number, height: number): [number, number, number, number, number, number] {
  const [xs, xt, x0, ys, yt, y0] = MAP[o]
  // Image space has y up, so stored row t = 1 - y; the page's y is up while Y above is down.
  return [width * xs, -height * ys, -width * xt, height * yt, width * (xt + x0), height * (1 - yt - y0)]
}

/** Rearranges RGBA pixels so that an image stored with orientation `o` is upright. */
export function orientPixels(rgba: Uint8Array, width: number, height: number, o: Orientation) {
  if (o === 1) return { rgba, width, height }
  const [xs, xt, x0, ys, yt, y0] = MAP[o]
  const [w, h] = o >= 5 ? [height, width] : [width, height]
  const out = new Uint8Array(rgba.length)
  const px = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length >> 2)
  const target = new Uint32Array(out.buffer)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const x = xs * c + xt * r + x0 * (w - 1)
      const y = ys * c + yt * r + y0 * (h - 1)
      target[y * w + x] = px[r * width + c]
    }
  }
  return { rgba: out, width: w, height: h }
}
