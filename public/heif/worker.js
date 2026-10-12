// Decodes HEIC/HEIF photos off the main thread; see src/pdf/heic.ts.
// libheif is LGPL-3.0 and stays a separate file next to this one (copied there by vite.config.ts).
importScripts('libheif.js')

const ready = new Promise((resolve) => {
  const lib = libheif({ onRuntimeInitialized: () => setTimeout(() => resolve(lib)) })
})

self.onmessage = async ({ data }) => {
  try {
    const lib = await ready
    const images = new lib.HeifDecoder().decode(data)
    // A file can hold several images (bursts, depth maps); the primary one is the photo.
    const image = images.find((i) => i.is_primary()) ?? images[0]
    if (!image) throw new Error('no image')
    const target = { data: new Uint8ClampedArray(image.get_width() * image.get_height() * 4), width: image.get_width(), height: image.get_height() }
    await new Promise((resolve, reject) => image.display(target, (done) => (done ? resolve() : reject(new Error('decoding failed')))))
    self.postMessage({ width: target.width, height: target.height, pixels: target.data.buffer }, [target.data.buffer])
  } catch (e) {
    self.postMessage({ error: String(e && e.message ? e.message : e) })
  }
}
