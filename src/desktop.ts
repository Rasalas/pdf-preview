// Native integration for the Tauri desktop app. The Tauri packages load on demand, so the web build stays lean.

export const isDesktop = '__TAURI_INTERNALS__' in window

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/** Files the OS asked the app to open, as File objects ready for import. */
export async function takeOpenedFiles(): Promise<File[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const paths = await invoke<string[]>('take_opened_files')
  return Promise.all(
    paths.map(async (path) => {
      const name = path.split(/[\\/]/).pop()!
      const ext = name.split('.').pop()!.toLowerCase()
      return new File([await readFile(path)], name, { type: TYPES[ext] ?? '' })
    }),
  )
}

/** Calls `handler` whenever the OS hands the running app more files (macOS "Open with"). */
export async function onFilesOpened(handler: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen('files-opened', handler)
}

/** Asks where to save; returns false if the user cancelled. */
export async function saveWithDialog(bytes: Uint8Array, name: string): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const ext = name.split('.').pop()!.toLowerCase()
  const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
  if (!path) return false
  await writeFile(path, bytes)
  return true
}

/** Opens the PDF in the system viewer, which handles printing better than the webview. */
export async function openInSystemViewer(bytes: Uint8Array, name: string) {
  const { tempDir, join } = await import('@tauri-apps/api/path')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const { openPath } = await import('@tauri-apps/plugin-opener')
  const path = await join(await tempDir(), name)
  await writeFile(path, bytes)
  await openPath(path)
}

export async function openExternal(url: string) {
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}
