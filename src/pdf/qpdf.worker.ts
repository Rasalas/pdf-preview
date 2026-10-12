import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'
import { decrypt, type DecryptResult } from './qpdf'

self.onmessage = async ({ data }: MessageEvent<{ bytes: Uint8Array; passwords: Uint8Array[] }>) => {
  let result: DecryptResult
  try {
    result = await decrypt(wasmUrl, data.bytes, data.passwords)
  } catch (e) {
    console.error(e)
    result = { error: 'failed' }
  }
  self.postMessage(result, { transfer: 'bytes' in result ? [result.bytes.buffer] : [] })
}
