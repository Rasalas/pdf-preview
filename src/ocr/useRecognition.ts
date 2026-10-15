import { useCallback, useRef, useState, type Dispatch } from 'react'
import type { OcrResults } from '../model/ocr'
import type { Page, Sources } from '../model/types'
import type { Action } from '../state'
import { planRecognition } from './scans'

export interface Task {
  label: string
  progress: number | null
  cancel?: () => void
}

interface Deps {
  sources: Sources
  ocr: OcrResults
  dispatch: Dispatch<Action>
  toast: (text: string, note?: boolean) => void
}

const pagesWord = (n: number) => (n === 1 ? 'Seite' : 'Seiten')

/**
 * Reads the text of pages, one run at a time, with its own status beside the app's task so that
 * saving or printing can go on meanwhile. Automatic runs stay quiet unless something fails.
 */
export function useRecognition({ sources, ocr, dispatch, toast }: Deps) {
  const running = useRef(false)
  const [status, setStatus] = useState<Task | null>(null)
  // Also covers checking the pages first, before any status shows.
  const [busy, setBusy] = useState(false)

  const recognise = useCallback(
    async (pages: Page[], auto = false) => {
      if (running.current) return
      running.current = true
      setBusy(true)
      // Checking a long document for text takes a moment; the status only shows if it does.
      const checking = auto ? undefined : setTimeout(() => setStatus({ label: 'Seiten werden geprüft', progress: null }), 250)
      try {
        const jobs = await planRecognition(pages, sources, ocr).finally(() => clearTimeout(checking))
        if (jobs.length === 0) {
          if (!auto) toast(pages.length === 1 ? 'Diese Seite hat schon Text oder ist leer.' : 'Die Seiten haben schon Text oder sind leer.', true)
          return
        }
        await run(jobs, auto, { dispatch, setStatus, toast })
      } finally {
        running.current = false
        setBusy(false)
        setStatus(null)
      }
    },
    [sources, ocr, dispatch, toast],
  )

  return { recognise, status, running: busy }
}

interface RunDeps extends Pick<Deps, 'dispatch' | 'toast'> {
  setStatus: (status: Task | null) => void
}

async function run(jobs: Awaited<ReturnType<typeof planRecognition>>, auto: boolean, { dispatch, setStatus, toast }: RunDeps) {
  const { recognizePages } = await import('./recognize')
  let cancelled = false
  let withText = 0
  let empty = 0
  let finished = 0
  let last = 0
  const show = (fraction: number) => {
    // The engine reports often; the task bar need not follow every step.
    const now = performance.now()
    if (fraction > 0 && fraction < 1 && now - last < 120) return
    last = now
    const label = jobs.length === 1 ? 'Text wird erkannt' : `Text wird erkannt – Seite ${finished + 1} von ${jobs.length}`
    setStatus({ label, progress: (finished + fraction) / jobs.length, cancel: cancel })
  }
  const cancel = () => {
    cancelled = true
    setStatus({ label: 'Wird nach dieser Seite beendet', progress: null })
  }
  setStatus({ label: 'Texterkennung wird vorbereitet', progress: null, cancel })
  try {
    const outcome = await recognizePages(jobs, {
      cancelled: () => cancelled,
      start: (done) => {
        finished = done
        if (!cancelled) show(0)
      },
      progress: (fraction) => !cancelled && show(fraction),
      page: ({ source, index }, page) => {
        if (page.lines.length) withText++
        else empty++
        dispatch({ type: 'ocr', sourceId: source.id, index, page })
      },
    })
    if (outcome.failed.length) {
      toast(outcome.failed.length === 1 ? 'Auf einer Seite ist die Texterkennung fehlgeschlagen.' : `Auf ${outcome.failed.length} Seiten ist die Texterkennung fehlgeschlagen.`)
    }
    // Nobody asked for an automatic run, so only failures are worth a word.
    if (auto) return
    if (outcome.cancelled) {
      toast(withText ? `Abgebrochen. Text auf ${withText} von ${jobs.length} ${pagesWord(jobs.length)} erkannt.` : 'Abgebrochen.', true)
    } else if (withText) {
      toast(`Text auf ${withText} ${pagesWord(withText)} erkannt. Er lässt sich nun suchen und kopieren, und das gesicherte PDF ist durchsuchbar.`, true)
      if (empty) toast(`${empty === 1 ? 'Auf einer Seite' : `Auf ${empty} Seiten`} wurde kein Text gefunden. Liegt eine Seite seitlich, zuerst aufrichten.`, true)
    } else if (!outcome.failed.length) {
      toast('Es wurde kein Text gefunden. Liegt die Seite seitlich, zuerst aufrichten.', true)
    }
  } catch (e) {
    console.error('Texterkennung konnte nicht starten', e)
    if (!auto) toast('Die Texterkennung konnte nicht gestartet werden.')
  }
}
