import type { Worker } from 'tesseract.js'
import type { RawBlock } from '../model/ocr'

// Copied into the build by vite.config.ts (worker, engine) and public/ocr (language data). Nothing comes from a CDN.
const asset = (path: string) => new URL(`ocr/${path}`, document.baseURI).href

/** Tesseract's LSTM-only mode. The "best" float models need an engine build that is not shipped. */
const LSTM_ONLY = 1

let worker: Promise<Worker> | undefined
let idle: ReturnType<typeof setTimeout> | undefined
let onProgress: ((fraction: number) => void) | undefined

function start(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    // tesseract.js never settles its promise when the language data cannot be loaded; only this handler hears of it.
    const fail = (e: unknown) => reject(new Error(String(e)))
    import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker(['deu', 'eng'], LSTM_ONLY, {
          workerPath: asset('worker.min.js'),
          corePath: asset('core'),
          langPath: asset('lang'),
          // The worker script is same-origin, so it needs no blob wrapper (which strict CSPs would block).
          workerBlobURL: false,
          cacheMethod: 'none',
          logger: (m) => {
            if (m.status === 'recognizing text') onProgress?.(m.progress)
          },
          errorHandler: fail,
        }),
      )
      .then(resolve, reject)
  })
}

function engine(): Promise<Worker> {
  clearTimeout(idle)
  if (!worker) {
    const created = start()
    // A failed start (offline desktop app with a damaged install, blocked worker) must not stick.
    created.catch(() => worker === created && (worker = undefined))
    worker = created
  }
  return worker
}

/** Loads the engine and the language data (a few MB, once per run), so the first page is not slowed by it. */
export async function prepare(): Promise<void> {
  await engine()
}

/**
 * The canvas as a binary PGM file, which the engine reads as it is. Encoding a PNG instead would
 * freeze Safari's page for half a second per sheet, and the engine reduces everything to grey anyway.
 */
export function toPgm(canvas: HTMLCanvasElement): Uint8Array {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height)
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`)
  const pgm = new Uint8Array(header.length + width * height)
  pgm.set(header)
  // Leptonica's own weights (0.3, 0.5, 0.2), so the result is what the engine would have made of the colours.
  for (let i = 0, o = header.length; i < data.length; i += 4, o++) pgm[o] = (data[i] * 77 + data[i + 1] * 128 + data[i + 2] * 51) >> 8
  return pgm
}

/** Reads a page image. `dpi` tells the engine how large the text is; `progress` reports 0 to 1. */
export async function recognize(canvas: HTMLCanvasElement, dpi: number, progress?: (fraction: number) => void): Promise<RawBlock[] | null> {
  const tesseract = await engine()
  const image = toPgm(canvas)
  onProgress = progress
  try {
    await tesseract.setParameters({ user_defined_dpi: String(Math.round(dpi)) })
    // The engine takes raw file bytes; its typings only list the other kinds of image.
    const { data } = await tesseract.recognize(image as unknown as Parameters<Worker['recognize']>[0], {}, { blocks: true })
    return data.blocks
  } catch (e) {
    // After an engine error (out of memory, say) the next page gets a fresh one.
    drop()
    throw e
  } finally {
    onProgress = undefined
  }
}

function drop() {
  const old = worker
  worker = undefined
  old?.then((w) => w.terminate()).catch(() => undefined)
}

/** The engine's memory never shrinks, so it goes away once a batch is done. */
export function release(): void {
  clearTimeout(idle)
  idle = setTimeout(drop, 15_000)
}
