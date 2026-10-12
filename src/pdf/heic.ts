// HEIC/HEIF photos for browsers that cannot open them (everything but Safari). Decoding runs in a worker:
// libheif takes seconds for a phone photo. Its files are served from heif/ next to the app, never from a CDN.

let worker: Worker | undefined
let idle: ReturnType<typeof setTimeout> | undefined

export interface Decoded {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

/** Decodes the primary image of a HEIC/HEIF file to RGBA. EXIF rotation is already applied by libheif. */
export function decodeHeic(bytes: Uint8Array): Promise<Decoded> {
  clearTimeout(idle)
  const current = (worker ??= new Worker(new URL('heif/worker.js', document.baseURI)))
  return new Promise<Decoded>((resolve, reject) => {
    current.onmessage = ({ data }) => {
      if (data.error) reject(new Error(data.error))
      else resolve({ width: data.width, height: data.height, pixels: new Uint8ClampedArray(data.pixels) })
    }
    current.onerror = (e) => {
      drop()
      reject(new Error(e.message || 'worker failed'))
    }
    current.postMessage(bytes.slice())
  }).finally(() => {
    // The wasm heap never shrinks, so the worker goes away once the batch is done.
    idle = setTimeout(drop, 10_000)
  })
}

function drop() {
  worker?.terminate()
  worker = undefined
}
