import { useCallback, useRef, type Dispatch } from 'react'
import type { OcrResults } from '../model/ocr'
import type { Page, Sources } from '../model/types'
import type { Action } from '../state'
import { planRecognition } from './scans'

interface Task {
  label: string
  progress: number | null
  cancel?: () => void
}

interface Deps {
  sources: Sources
  ocr: OcrResults
  dispatch: Dispatch<Action>
  setTask: (task: Task | null) => void
  toast: (text: string, note?: boolean) => void
}

const pagesWord = (n: number) => (n === 1 ? 'Seite' : 'Seiten')

/** Returns a function that reads the text of the given pages, with progress in the task bar. */
export function useRecognition({ sources, ocr, dispatch, setTask, toast }: Deps) {
  const running = useRef(false)

  return useCallback(
    async (pages: Page[]) => {
      if (running.current) return
      running.current = true
      // Checking a long document for text takes a moment; the bar only shows if it does.
      const checking = setTimeout(() => setTask({ label: 'Seiten werden geprüft', progress: null }), 250)
      try {
        const jobs = await planRecognition(pages, sources, ocr).finally(() => clearTimeout(checking))
        if (jobs.length === 0) {
          toast(pages.length === 1 ? 'Diese Seite hat schon Text oder ist leer.' : 'Die Seiten haben schon Text oder sind leer.', true)
          return
        }
        await run(jobs, { dispatch, setTask, toast })
      } finally {
        running.current = false
        setTask(null)
      }
    },
    [sources, ocr, dispatch, setTask, toast],
  )
}

async function run(jobs: Awaited<ReturnType<typeof planRecognition>>, { dispatch, setTask, toast }: Omit<Deps, 'sources' | 'ocr'>) {
  const { recognizePages } = await import('./recognize')
  let cancelled = false
  let withText = 0
  let finished = 0
  let last = 0
  const show = (fraction: number) => {
    // The engine reports often; the task bar need not follow every step.
    const now = performance.now()
    if (fraction > 0 && fraction < 1 && now - last < 120) return
    last = now
    const label = jobs.length === 1 ? 'Text wird erkannt' : `Text wird erkannt – Seite ${finished + 1} von ${jobs.length}`
    setTask({ label, progress: (finished + fraction) / jobs.length, cancel: cancel })
  }
  const cancel = () => {
    cancelled = true
    setTask({ label: 'Wird nach dieser Seite beendet', progress: null })
  }
  setTask({ label: 'Texterkennung wird vorbereitet', progress: null, cancel })
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
        dispatch({ type: 'ocr', sourceId: source.id, index, page })
      },
    })
    if (outcome.failed.length) {
      toast(outcome.failed.length === 1 ? 'Auf einer Seite ist die Texterkennung fehlgeschlagen.' : `Auf ${outcome.failed.length} Seiten ist die Texterkennung fehlgeschlagen.`)
    }
    if (outcome.cancelled) {
      toast(withText ? `Abgebrochen. Text auf ${withText} von ${jobs.length} ${pagesWord(jobs.length)} erkannt.` : 'Abgebrochen.', true)
    } else if (withText) {
      toast(`Text auf ${withText} ${pagesWord(withText)} erkannt. Er lässt sich nun suchen und kopieren, und das gesicherte PDF ist durchsuchbar.`, true)
    } else if (!outcome.failed.length) {
      toast('Es wurde kein Text gefunden.', true)
    }
  } catch (e) {
    console.error('Texterkennung konnte nicht starten', e)
    toast('Die Texterkennung konnte nicht gestartet werden.')
  }
}
