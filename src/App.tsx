import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { type MarkupStyle, type Signature, type Tool } from './components/AnnotationLayer'
import { EmptyState } from './components/EmptyState'
import { MarkupBar } from './components/MarkupBar'
import { SignatureDialog } from './components/SignatureDialog'
import { Icon, type IconName } from './components/icons'
import { Menu, type MenuItem } from './components/Menu'
import { PAGES_MIME, Sidebar } from './components/Sidebar'
import { Viewer, type ActiveHit, type Markup, type Zoom } from './components/Viewer'
import { rotatedSize } from './model/pages'
import type { Page } from './model/types'
import { A4, ACCEPT, ImportError, blankSource, importFile } from './pdf/import'
import { countMatches, normalizeQuery, pageStrings } from './pdf/text'
import { clearSession, loadSession, saveSession, type Session } from './persist'
import { findAnnotation, initialState, pagesOf, reducer } from './state'
import type { Annotation } from './model/types'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4]
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Strg+'

interface Task {
  label: string
  progress: number | null
  cancel?: () => void
}

interface Toast {
  id: number
  text: string
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const pages = pagesOf(state)
  const selection = useMemo(() => new Set(state.selection), [state.selection])
  const selectedPages = pages.filter((p) => selection.has(p.id))

  const [zoom, setZoom] = useState<Zoom>('fit')
  const [scale, setScale] = useState(1)
  const [scrollRequest, setScrollRequest] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(() => innerWidth > 720)
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('sidebarWidth')) || 200)
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'page' | 'document' } | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [dropping, setDropping] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const insertAt = useRef<number | null>(null)
  // Saving starts only once the user has decided about a stored session, so it is never overwritten by accident.
  const [persisting, setPersisting] = useState(false)

  const [markupOpen, setMarkupOpen] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [style, setStyle] = useState<MarkupStyle>({ color: '#e5383b', width: 2, size: 14 })
  const [highlightColor, setHighlightColor] = useState('#ffd400')
  const [signatures, setSignatures] = useState<Signature[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('signatures') ?? '[]')
    } catch {
      return []
    }
  })
  const [signature, setSignature] = useState<Signature | null>(null)
  const [signatureDialog, setSignatureDialog] = useState(false)
  useEffect(() => localStorage.setItem('signatures', JSON.stringify(signatures)), [signatures])

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ query: string; pages: Map<string, number>; done: boolean }>({ query: '', pages: new Map(), done: true })
  const [activeHit, setActiveHit] = useState<ActiveHit | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const q = normalizeQuery(query)

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000)
  }, [])

  useEffect(() => {
    loadSession().then((s) => {
      if (s?.pages.length) setSession(s)
      else setPersisting(true)
    })
  }, [])

  useEffect(() => {
    if (!persisting) return
    const t = setTimeout(() => saveSession(state.title, pages, state.sources), 800)
    return () => clearTimeout(t)
  }, [persisting, pages, state.title, state.sources])

  // Show the pages an edit touched. Annotation edits leave the view where it is.
  const layoutKey = pages.map((p) => `${p.id}:${p.rotation}`).join()
  useEffect(() => setScrollRequest((n) => n + 1), [layoutKey])

  useEffect(() => {
    document.title = pages.length ? `${state.title || 'Unbenannt'} – Vorschau` : 'Vorschau'
  }, [pages.length, state.title])

  useEffect(() => {
    setActiveHit(null)
    if (!q) {
      setHits({ query: '', pages: new Map(), done: true })
      return
    }
    let live = true
    const t = setTimeout(async () => {
      const found = new Map<string, number>()
      for (const [i, page] of pages.entries()) {
        let n = 0
        try {
          n = countMatches(await pageStrings(state.sources[page.sourceId], page.index), q)
        } catch (e) {
          console.error(e)
        }
        if (!live) return
        if (n) found.set(page.id, n)
        if (i % 25 === 24) setHits({ query: q, pages: new Map(found), done: false })
      }
      setHits({ query: q, pages: found, done: true })
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, pages, state.sources])

  const hitOrder = useMemo(
    () => pages.flatMap((p) => Array.from({ length: hits.pages.get(p.id) ?? 0 }, (_, n) => ({ pageId: p.id, n }))),
    [pages, hits],
  )
  const activeIndex = activeHit ? hitOrder.findIndex((h) => h.pageId === activeHit.pageId && h.n === activeHit.n) : -1

  const jump = (dir: 1 | -1) => {
    if (hitOrder.length === 0) return
    let i = activeIndex
    if (i < 0) {
      // Start from the page being read rather than the top of the document.
      const from = Math.max(0, pages.findIndex((p) => p.id === state.current))
      const pos = new Map(pages.map((p, k) => [p.id, k]))
      i = hitOrder.findIndex((h) => pos.get(h.pageId)! >= from)
      if (i < 0) i = 0
      if (dir < 0) i = (i - 1 + hitOrder.length) % hitOrder.length
    } else {
      i = (i + dir + hitOrder.length) % hitOrder.length
    }
    setActiveHit({ ...hitOrder[i], nonce: Date.now() })
  }

  // Reveal the first hit as soon as one is known, like a browser's find bar.
  useEffect(() => {
    if (!activeHit && hits.query === q && hitOrder.length) jump(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitOrder])

  const lastSelectedIndex = () => {
    const last = pages.findLastIndex((p) => selection.has(p.id))
    return last < 0 ? pages.length : last + 1
  }

  const importFiles = async (files: File[], at: number) => {
    if (files.length === 0) return
    let cancelled = false
    const cancel = () => (cancelled = true)
    const sources = []
    for (const [i, file] of files.entries()) {
      if (cancelled) break
      setTask({ label: `„${file.name}“ wird geladen`, progress: files.length > 1 ? i / files.length : null, cancel })
      try {
        sources.push(await importFile(file))
      } catch (e) {
        console.error(e)
        toast(e instanceof ImportError ? e.message : `„${file.name}“ konnte nicht importiert werden.`)
      }
    }
    setTask(null)
    if (cancelled) return
    setSession(null)
    setPersisting(true)
    dispatch({ type: 'import', sources, at })
  }

  const openFiles = (at = lastSelectedIndex()) => {
    insertAt.current = at
    fileInput.current!.click()
  }

  const insertBlank = (at = lastSelectedIndex()) => {
    const ref = pages[at - 1] ?? pages[at]
    const size = ref ? state.sources[ref.sourceId].pages[ref.index] : A4
    setSession(null)
    setPersisting(true)
    dispatch({ type: 'import', sources: [blankSource(ref ? rotatedSize(size, ref.rotation) : A4)], at })
  }

  const exportPdf = async (list: Page[], suffix = '') => {
    if (list.length === 0) return
    const title = state.title.trim() || 'Unbenannt'
    let cancelled = false
    setTask({ label: 'PDF wird erstellt', progress: 0, cancel: () => (cancelled = true) })
    try {
      const { buildPdf } = await import('./pdf/export')
      const bytes = await buildPdf(list, state.sources, title, (done, total) => {
        if (cancelled) throw new DOMException('Abgebrochen', 'AbortError')
        setTask((t) => t && { ...t, progress: done / total })
      })
      download(bytes, `${title}${suffix}.pdf`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.error(e)
        toast('Das PDF konnte nicht erstellt werden.')
      }
    } finally {
      setTask(null)
    }
  }

  const print = async () => {
    if (pages.length === 0) return
    setTask({ label: 'Druck wird vorbereitet', progress: null })
    try {
      const { buildPdf } = await import('./pdf/export')
      const bytes = await buildPdf(pages, state.sources, state.title || 'Unbenannt')
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const frame = document.createElement('iframe')
      frame.className = 'print-frame'
      frame.src = url
      frame.onload = () => {
        try {
          frame.contentWindow!.focus()
          frame.contentWindow!.print()
        } catch {
          open(url, '_blank')
        }
        setTimeout(() => {
          frame.remove()
          URL.revokeObjectURL(url)
        }, 60_000)
      }
      document.body.append(frame)
    } catch (e) {
      console.error(e)
      toast('Der Druck konnte nicht vorbereitet werden.')
    } finally {
      setTask(null)
    }
  }

  const zoomBy = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > scale + 0.001) : ZOOM_STEPS.findLast((s) => s < scale - 0.001)
    setZoom(next ?? (dir > 0 ? ZOOM_STEPS.at(-1)! : ZOOM_STEPS[0]))
  }

  const select = useCallback((id: string, mode: 'single' | 'toggle' | 'range') => {
    dispatch({ type: 'select', id, mode })
    setScrollRequest((n) => n + 1)
  }, [])

  const onScrolledTo = useCallback((id: string) => dispatch({ type: 'scrolledTo', id }), [])

  const restore = () => {
    if (!session) return
    dispatch({ type: 'restore', title: session.title, pages: session.pages, sources: session.sources })
    setSession(null)
    setPersisting(true)
  }

  const discard = () => {
    setSession(null)
    setPersisting(true)
    clearSession()
  }

  const selectedAnnotation = state.markup ? findAnnotation(pages, state.markup) : undefined
  const selectedKind = !selectedAnnotation
    ? null
    : selectedAnnotation.type === 'highlight'
      ? 'highlight'
      : selectedAnnotation.type === 'text'
        ? 'text'
        : 'shape'

  const updateSelected = (fn: (a: Annotation) => Annotation) => {
    if (!state.markup || !selectedAnnotation) return
    const next = fn(selectedAnnotation)
    if (next !== selectedAnnotation) dispatch({ type: 'updateAnnotation', pageId: state.markup.pageId, annotation: next })
  }

  const changeStyle = (patch: Partial<MarkupStyle>) => {
    setStyle((s) => ({ ...s, ...patch }))
    updateSelected((a) => {
      if (patch.color && a.type !== 'highlight') return { ...a, color: patch.color }
      if (patch.width && 'width' in a && a.type !== 'ink') return { ...a, width: patch.width }
      if (patch.size && a.type === 'text') return { ...a, size: patch.size }
      return a
    })
  }

  const changeHighlightColor = (color: string) => {
    setHighlightColor(color)
    updateSelected((a) => (a.type === 'highlight' ? { ...a, color } : a))
  }

  const chooseTool = (t: Tool) => {
    setTool(t)
    if (t !== 'select') dispatch({ type: 'selectAnnotation', target: null })
  }

  // Closing the markup bar returns to plain text selection.
  useEffect(() => {
    if (!markupOpen) setTool('select')
  }, [markupOpen])

  const markup: Markup = {
    tool,
    style,
    highlightColor,
    selected: state.markup,
    signature,
    onSelect: (target) => {
      if (target || state.markup) dispatch({ type: 'selectAnnotation', target })
    },
    onAdd: (pageId, annotation) => {
      // Like Preview: after placing a shape you are back to editing it; drawing and highlighting continue.
      const keep = tool === 'ink' || tool === 'highlight'
      dispatch({ type: 'annotate', pageId, annotation, select: !keep })
      if (!keep) setTool('select')
    },
    onUpdate: (pageId, annotation) => dispatch({ type: 'updateAnnotation', pageId, annotation }),
    onRemove: (pageId, id) => dispatch({ type: 'removeAnnotation', pageId, id }),
  }

  const has = selection.size > 0
  const count = selection.size
  const pageWord = count === 1 ? 'Seite' : `${count} Seiten`

  const pageMenu = (): MenuItem[] => [
    { label: 'Nach links drehen', shortcut: `${MOD}L`, disabled: !has, run: () => dispatch({ type: 'rotate', delta: -90 }) },
    { label: 'Nach rechts drehen', shortcut: `${MOD}R`, disabled: !has, run: () => dispatch({ type: 'rotate', delta: 90 }) },
    { label: 'Duplizieren', shortcut: `${MOD}D`, disabled: !has, run: () => dispatch({ type: 'duplicate' }) },
    'separator',
    { label: 'Dateien danach einfügen …', run: () => openFiles() },
    { label: 'Leere Seite danach einfügen', run: () => insertBlank() },
    'separator',
    { label: `${pageWord} als PDF sichern …`, disabled: !has, run: () => exportPdf(selectedPages, count === 1 ? ` – Seite ${pages.indexOf(selectedPages[0]) + 1}` : ' – Auswahl') },
    'separator',
    { label: `${pageWord} löschen`, shortcut: '⌫', disabled: !has, danger: true, run: () => dispatch({ type: 'remove' }) },
  ]

  const onThumbContextMenu = (e: MouseEvent, id: string) => {
    e.preventDefault()
    if (!selection.has(id)) dispatch({ type: 'select', id, mode: 'single' })
    setMenu({ x: e.clientX, y: e.clientY, kind: 'page' })
  }

  const documentMenu = (): MenuItem[] => [
    { label: 'Als PDF sichern …', shortcut: `${MOD}S`, disabled: !pages.length, run: () => exportPdf(pages) },
    { label: `Auswahl sichern (${count}) …`, disabled: !has || count === pages.length, run: () => exportPdf(selectedPages, ' – Auswahl') },
    { label: 'Drucken …', shortcut: `${MOD}P`, disabled: !pages.length, run: print },
    'separator',
    { label: 'Dateien einfügen …', shortcut: `${MOD}O`, run: () => openFiles() },
    { label: 'Leere Seite einfügen', run: () => insertBlank() },
    'separator',
    { label: 'Dokument schließen', disabled: !pages.length, run: () => { dispatch({ type: 'selectAll' }); dispatch({ type: 'remove' }) } },
  ]

  // Global shortcuts. Re-bound every render so handlers see current state.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest?.('input, textarea, [contenteditable]') || menu) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const run = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      if (mod && e.shiftKey && key === 'a') return run(() => setMarkupOpen((o) => !o))
      if (e.key === 'Escape' && state.markup) return run(() => dispatch({ type: 'selectAnnotation', target: null }))
      if (e.key === 'Escape' && tool !== 'select') return run(() => setTool('select'))
      if (!mod && (e.key === 'Backspace' || e.key === 'Delete') && state.markup) {
        const target = state.markup
        return run(() => dispatch({ type: 'removeAnnotation', pageId: target.pageId, id: target.id }))
      }
      if (mod && key === 'f') return run(() => searchInput.current?.select())
      if (mod && key === 'g') return run(() => jump(e.shiftKey ? -1 : 1))
      if (mod && key === 'z') return run(() => dispatch({ type: e.shiftKey ? 'redo' : 'undo' }))
      if (mod && key === 'y') return run(() => dispatch({ type: 'redo' }))
      if (mod && key === 'o') return run(() => openFiles())
      if (mod && e.altKey && key === 's') return run(() => setSidebarOpen((o) => !o))
      if (mod && key === 's') return run(() => exportPdf(pages))
      if (mod && key === 'p') return run(print)
      if (mod && key === 'a') return run(() => dispatch({ type: 'selectAll' }))
      if (mod && key === 'd') return run(() => dispatch({ type: 'duplicate' }))
      if (mod && key === 'r') return run(() => dispatch({ type: 'rotate', delta: 90 }))
      if (mod && key === 'l') return run(() => dispatch({ type: 'rotate', delta: -90 }))
      if (mod && (key === '+' || key === '=')) return run(() => zoomBy(1))
      if (mod && key === '-') return run(() => zoomBy(-1))
      if (mod && key === '0') return run(() => setZoom(1))
      if (!mod && (e.key === 'Backspace' || e.key === 'Delete') && has) return run(() => dispatch({ type: 'remove' }))
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const onSidebarKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      dispatch({ type: 'step', delta: e.key === 'Home' ? -Infinity : Infinity, extend: e.shiftKey })
      setScrollRequest((n) => n + 1)
    } else if (step && e.altKey) {
      e.preventDefault()
      dispatch({ type: 'nudge', delta: step })
    } else if (step) {
      e.preventDefault()
      dispatch({ type: 'step', delta: step, extend: e.shiftKey })
      setScrollRequest((n) => n + 1)
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const el = document.querySelector(`[data-id="${state.current}"]`)?.getBoundingClientRect()
      if (el) setMenu({ x: el.right - 20, y: el.top + 20, kind: 'page' })
    }
  }

  // Files dropped anywhere outside the sidebar are appended.
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes(PAGES_MIME)
  const dropHandlers = {
    onDragOver: (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
    },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      setDropping(false)
      importFiles([...e.dataTransfer.files], pages.length)
    },
  }

  useEffect(() => {
    // Stops the browser from navigating to a file dropped on an inactive area.
    const block = (e: globalThis.DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault()
    addEventListener('dragover', block)
    addEventListener('drop', block)
    return () => {
      removeEventListener('dragover', block)
      removeEventListener('drop', block)
    }
  }, [])

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    const move = (ev: PointerEvent) => setSidebarWidth(Math.min(420, Math.max(140, startW + ev.clientX - startX)))
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      document.body.classList.remove('is-resizing')
    }
    document.body.classList.add('is-resizing')
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  useEffect(() => localStorage.setItem('sidebarWidth', String(sidebarWidth)), [sidebarWidth])

  const empty = pages.length === 0
  const canUndo = state.history.past.length > 0
  const canRedo = state.history.future.length > 0
  const currentIndex = pages.findIndex((p) => p.id === state.current)

  return (
    <div className="app">
      <div className="chrome">
      <header className="toolbar">
        <ToolButton icon="sidebar" label="Seitenleiste ein-/ausblenden" pressed={sidebarOpen && !empty} disabled={empty} onClick={() => setSidebarOpen((o) => !o)} />
        <div className="title">
          {empty ? (
            <span className="title-app">Vorschau</span>
          ) : (
            <>
              <input
                className="title-input"
                value={state.title}
                placeholder="Unbenannt"
                aria-label="Dokumentname"
                size={Math.max(8, state.title.length)}
                onChange={(e) => dispatch({ type: 'title', title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span className="title-meta">
                {count > 1 ? `${count} von ${pages.length} Seiten ausgewählt` : `Seite ${currentIndex + 1} von ${pages.length}`}
              </span>
            </>
          )}
        </div>
        {task ? (
          <div className="task" role="status">
            <span className="task-label">{task.label}</span>
            <span className="task-bar">
              <span style={task.progress === null ? undefined : { width: `${task.progress * 100}%` }} className={task.progress === null ? 'is-indeterminate' : ''} />
            </span>
            {task.cancel ? <button className="task-cancel" onClick={task.cancel}>Abbrechen</button> : null}
          </div>
        ) : null}
        <div className="toolbar-group">
          <ToolButton icon="zoomOut" label={`Verkleinern (${MOD}−)`} disabled={empty} onClick={() => zoomBy(-1)} />
          <button className="zoom-label" disabled={empty} onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} title={zoom === 'fit' ? 'Originalgröße' : 'An Fensterbreite anpassen'}>
            {Math.round(scale * 100)} %
          </button>
          <ToolButton icon="zoomIn" label={`Vergrößern (${MOD}+)`} disabled={empty} onClick={() => zoomBy(1)} />
        </div>
        <div className="toolbar-group">
          <ToolButton icon="rotateLeft" label={`Nach links drehen (${MOD}L)`} disabled={!has} onClick={() => dispatch({ type: 'rotate', delta: -90 })} />
          <ToolButton icon="rotateRight" label={`Nach rechts drehen (${MOD}R)`} disabled={!has} onClick={() => dispatch({ type: 'rotate', delta: 90 })} />
        </div>
        <div className="toolbar-group">
          <ToolButton icon="markup" label="Markierungen ein-/ausblenden (⇧⌘A)" pressed={markupOpen} disabled={empty} onClick={() => setMarkupOpen((o) => !o)} />
        </div>
        <div className="toolbar-group">
          <ToolButton icon="undo" label={`Widerrufen (${MOD}Z)`} disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} />
          <ToolButton icon="redo" label={`Wiederholen (⇧${MOD}Z)`} disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })} />
        </div>
        <div className="toolbar-group">
          <ToolButton icon="trash" label="Ausgewählte Seiten löschen (⌫)" disabled={!has} onClick={() => dispatch({ type: 'remove' })} />
          <ToolButton icon="plus" label={`Dateien einfügen (${MOD}O)`} onClick={() => openFiles()} />
        </div>
        {empty ? null : (
          <div className={`search${q ? ' is-active' : ''}`}>
            <Icon name="search" width={14} height={14} />
            <input
              ref={searchInput}
              type="search"
              placeholder="Suchen"
              aria-label={`Im Dokument suchen (${MOD}F)`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  jump(e.shiftKey ? -1 : 1)
                } else if (e.key === 'Escape') {
                  setQuery('')
                  e.currentTarget.blur()
                }
              }}
            />
            {q ? (
              <span className="search-count" aria-live="polite">
                {hitOrder.length === 0
                  ? hits.done && hits.query === q ? 'Keine Treffer' : '…'
                  : `${activeIndex + 1 || '–'} / ${hitOrder.length}${hits.done ? '' : '+'}`}
              </span>
            ) : null}
          </div>
        )}
        <button className="button is-primary export-button" disabled={empty} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.right - 250, y: r.bottom + 6, kind: 'document' })
        }} aria-haspopup="menu">
          <Icon name="share" />
          Sichern
          <Icon name="chevron" width={14} height={14} />
        </button>
      </header>
      {markupOpen && !empty ? (
        <MarkupBar
          tool={tool}
          style={style}
          highlightColor={highlightColor}
          selectedKind={selectedKind}
          signatures={signatures}
          signature={signature}
          onTool={chooseTool}
          onStyle={changeStyle}
          onHighlightColor={changeHighlightColor}
          onSignature={(s) => {
            setSignature(s)
            chooseTool('signature')
          }}
          onNewSignature={() => setSignatureDialog(true)}
          onDeleteSignature={(id) => {
            setSignatures((all) => all.filter((s) => s.id !== id))
            if (signature?.id === id) {
              setSignature(null)
              if (tool === 'signature') setTool('select')
            }
          }}
        />
      ) : null}
      </div>

      <main className={`workspace${dropping ? ' is-dropping' : ''}`} {...dropHandlers}>
        {empty ? (
          <EmptyState session={session} onOpen={() => openFiles(0)} onBlank={() => insertBlank(0)} onRestore={restore} onDiscard={discard} />
        ) : (
          <>
            {sidebarOpen ? (
              <aside className="sidebar" style={{ width: sidebarWidth }}>
                <Sidebar
                  pages={pages}
                  sources={state.sources}
                  selection={selection}
                  current={state.current}
                  width={sidebarWidth}
                  onSelect={select}
                  onMove={(gap) => dispatch({ type: 'move', gap })}
                  onDropFiles={importFiles}
                  onContextMenu={onThumbContextMenu}
                  onKeyDown={onSidebarKey}
                  hits={q ? hits.pages : null}
                />
                <div className="sidebar-resize" onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Seitenleistenbreite" />
              </aside>
            ) : null}
            <Viewer
              pages={pages}
              sources={state.sources}
              zoom={zoom}
              current={state.current}
              scrollRequest={scrollRequest}
              onScrolledTo={onScrolledTo}
              onScale={setScale}
              query={hits.query === q ? q : ''}
              activeHit={activeHit}
              markup={markup}
            />
          </>
        )}
        {dropping ? <div className="drop-hint">{empty ? 'Loslassen zum Öffnen' : 'Loslassen, um am Ende anzuhängen'}</div> : null}
      </main>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          importFiles([...e.target.files!], insertAt.current ?? pages.length)
          e.target.value = ''
        }}
      />

      {signatureDialog ? (
        <SignatureDialog
          onClose={() => setSignatureDialog(false)}
          onSave={(s) => {
            setSignatures((all) => [...all, s])
            setSignature(s)
            setSignatureDialog(false)
            chooseTool('signature')
          }}
        />
      ) : null}

      {menu ? <Menu x={menu.x} y={menu.y} items={menu.kind === 'page' ? pageMenu() : documentMenu()} onClose={() => setMenu(null)} /> : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            <button aria-label="Schließen" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <Icon name="close" width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolButton({ icon, label, pressed, disabled, onClick }: { icon: IconName; label: string; pressed?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="tool" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
