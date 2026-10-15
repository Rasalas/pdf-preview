import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { type MarkupStyle, type Signature, type Tool } from './components/AnnotationLayer'
import { AboutDialog } from './components/AboutDialog'
import { BottomBar } from './components/BottomBar'
import { EmptyState } from './components/EmptyState'
import { MarkupBar } from './components/MarkupBar'
import { PasswordDialog } from './components/PasswordDialog'
import { SignatureDialog } from './components/SignatureDialog'
import { Icon, type IconName } from './components/icons'
import { Menu, type MenuItem } from './components/Menu'
import type { PageActions } from './components/PageHover'
import { PAGES_MIME, Sidebar } from './components/Sidebar'
import { Viewer, type ActiveHit, type CropRequest, type Markup, type Zoom } from './components/Viewer'
import { displayedSize } from './model/crop'
import type { Page, Rect } from './model/types'
import { isScan } from './ocr/scans'
import { useRecognition } from './ocr/useRecognition'
import type { CompressStats } from './pdf/compress'
import { A4, ACCEPT, ImportError, blankSource, importFile } from './pdf/import'
import { countMatches, normalizeQuery, pageStrings } from './pdf/text'
import { clearSession, loadSession, saveSession, type Session } from './persist'
import { isDesktop } from './desktop'
import { COMPACT, useMedia } from './useMedia'
import { findAnnotation, initialState, pagesOf, reducer, type Action } from './state'
import type { Annotation } from './model/types'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4]
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent)
const MOD = isMac ? '⌘' : 'Strg+'

interface Task {
  label: string
  progress: number | null
  cancel?: () => void
}

interface Toast {
  id: number
  text: string
  note?: boolean
  action?: { label: string; run: () => void }
}

interface PasswordRequest {
  id: number
  name: string
  wrong: boolean
  answer: (password: string | null) => void
}

type MenuState = { x: number; y: number } & (
  /** `from` is the page whose hover actions opened it, `on` the page of a context menu. */
  | { kind: 'page'; from?: string; on?: string }
  | { kind: 'gap'; at: number }
  | { kind: 'save' | 'document' | 'more' }
)

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const pages = pagesOf(state)
  const selection = useMemo(() => new Set(state.selection), [state.selection])
  const selectedPages = pages.filter((p) => selection.has(p.id))
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  const [zoom, setZoom] = useState<Zoom>('fit')
  const [scale, setScale] = useState(1)
  const [scrollRequest, setScrollRequest] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(() => innerWidth > 720)
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('sidebarWidth')) || 200)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const compact = useMedia(COMPACT)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [cropping, setCropping] = useState<CropRequest | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
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
  // Bumped on every tap on the highlighter, so it also applies when already active (touch has no mouseup after selecting).
  const [highlightRequest, setHighlightRequest] = useState(0)
  const [signatures, setSignatures] = useState<Signature[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('signatures') ?? '[]')
    } catch {
      return []
    }
  })
  const [signature, setSignature] = useState<Signature | null>(null)
  const [signatureDialog, setSignatureDialog] = useState(false)
  const [about, setAbout] = useState(false)
  useEffect(() => localStorage.setItem('signatures', JSON.stringify(signatures)), [signatures])

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ query: string; pages: Map<string, number>; scans: string[]; done: boolean }>({ query: '', pages: new Map(), scans: [], done: true })
  const [activeHit, setActiveHit] = useState<ActiveHit | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const q = normalizeQuery(query)

  const toast = useCallback((text: string, note = false, action?: Toast['action']) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, note, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000)
  }, [])

  // An offer to start something has served its purpose once something runs.
  useEffect(() => {
    if (task) setToasts((all) => all.filter((t) => !t.action))
  }, [task])

  const recognise = useRecognition({ sources: state.sources, ocr: state.ocr, dispatch, setTask, toast })
  const recogniseRef = useRef(recognise)
  recogniseRef.current = recognise

  useEffect(() => {
    loadSession().then((s) => {
      if (s?.pages.length) setSession(s)
      else setPersisting(true)
    })
  }, [])

  useEffect(() => {
    if (!persisting) return
    const t = setTimeout(() => saveSession(state.title, pages, state.sources, state.fields, state.ocr), 800)
    return () => clearTimeout(t)
  }, [persisting, pages, state.title, state.sources, state.fields, state.ocr])

  // Show the pages an edit touched. Annotation edits leave the view where it is.
  const layoutKey = pages.map((p) => `${p.id}:${p.rotation}:${p.crop ? Object.values(p.crop) : ''}`).join()
  useEffect(() => setScrollRequest((n) => n + 1), [layoutKey])

  useEffect(() => {
    document.title = pages.length ? `${state.title || 'Unbenannt'} – Vorschau` : 'Vorschau'
  }, [pages.length, state.title])

  useEffect(() => setActiveHit(null), [q, pages, state.sources])

  // Also runs when text is recognised, without taking the user off the hit they are on.
  useEffect(() => {
    if (!q) {
      setHits({ query: '', pages: new Map(), scans: [], done: true })
      return
    }
    let live = true
    const t = setTimeout(async () => {
      const found = new Map<string, number>()
      const scans: string[] = []
      for (const [i, page] of pages.entries()) {
        let n = 0
        try {
          const source = state.sources[page.sourceId]
          const read = state.ocr[page.sourceId]?.[page.index]
          const items = await pageStrings(source, page.index, read)
          n = countMatches(items, q)
          if (isScan(source, !!read, items)) scans.push(page.id)
        } catch (e) {
          console.error(e)
        }
        if (!live) return
        if (n) found.set(page.id, n)
        if (i % 25 === 24) setHits({ query: q, pages: new Map(found), scans: [...scans], done: false })
      }
      setHits({ query: q, pages: found, scans, done: true })
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, pages, state.sources, state.ocr])

  // Once per search, say that scans without text were left out.
  const scansNoted = useRef(false)
  useEffect(() => {
    if (!q) scansNoted.current = false
    if (!hits.done || hits.query !== q || hits.scans.length === 0 || scansNoted.current) return
    scansNoted.current = true
    const n = hits.scans.length
    const scanPages = pagesRef.current.filter((p) => hits.scans.includes(p.id))
    toast(
      `${n === 1 ? 'Eine Seite ist ein Scan ohne Text und wird' : `${n} Seiten sind Scans ohne Text und werden`} bei der Suche übergangen.`,
      true,
      { label: 'Text erkennen', run: () => recogniseRef.current(scanPages) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, q])

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

  // Imports run one after another, so files dropped in quick succession keep their order.
  const importQueue = useRef(Promise.resolve())
  const queued = useRef(0)
  const importFiles = (files: File[], at: number) => {
    if (files.length === 0) return
    // Anchored to a page rather than an index, which an import still ahead in the queue would shift.
    const before = pagesRef.current[at]?.id ?? null
    queued.current += files.length
    importQueue.current = importQueue.current.then(() => runImport(files, before)).catch(console.error)
  }

  const runImport = async (files: File[], before: string | null) => {
    let cancelled = false
    const cancel = () => (cancelled = true)
    const sources = []
    let processed = 0
    for (const [i, file] of files.entries()) {
      if (cancelled) break
      const more = queued.current - 1
      setTask({
        label: `„${file.name}“ wird geladen${more > 0 ? ` (noch ${more})` : ''}`,
        progress: files.length > 1 ? i / files.length : null,
        cancel,
      })
      try {
        const added = await importFile(file, {
          askPassword: ({ name, wrong }) => new Promise((answer) => setPasswordRequest({ id: Math.random(), name, wrong, answer })),
          notify: (text) => toast(text, true),
        })
        sources.push(...added)
      } catch (e) {
        console.error(e)
        toast(e instanceof ImportError ? e.message : `„${file.name}“ konnte nicht importiert werden.`)
      } finally {
        setPasswordRequest(null)
        queued.current--
        processed++
      }
    }
    // Files skipped by cancelling no longer count as waiting.
    queued.current -= files.length - processed
    setTask(null)
    if (cancelled) return
    setSession(null)
    setPersisting(true)
    dispatch({ type: 'import', sources, before })
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
    dispatch({ type: 'import', sources: [blankSource(ref ? displayedSize(size, ref) : A4)], before: pages[at]?.id ?? null })
  }

  const exportPdf = async (list: Page[], suffix = '', compress = false) => {
    if (list.length === 0) return
    const title = state.title.trim() || 'Unbenannt'
    let cancelled = false
    let stats: CompressStats | undefined
    setTask({ label: compress ? 'Kleineres PDF wird erstellt' : 'PDF wird erstellt', progress: 0, cancel: () => (cancelled = true) })
    try {
      const { buildPdf, savingsMessage } = await import('./pdf/export')
      const bytes = await buildPdf(
        list,
        state.sources,
        title,
        (done, total) => {
          if (cancelled) throw new DOMException('Abgebrochen', 'AbortError')
          setTask((t) => t && { ...t, progress: done / total })
        },
        { fields: state.fields, ocr: state.ocr, compress, onCompressed: (s) => (stats = s) },
      )
      await download(bytes, `${title}${suffix}.pdf`)
      if (stats) toast(savingsMessage(bytes.length, stats), true)
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
    // Safari prints PDFs in hidden frames unreliably; it gets the PDF in a new tab instead.
    // The tab must be opened before any await, or the popup blocker steps in.
    const tab = isSafari && !isDesktop ? open('', '_blank') : null
    setTask({ label: 'Druck wird vorbereitet', progress: null })
    try {
      const { buildPdf } = await import('./pdf/export')
      const bytes = await buildPdf(pages, state.sources, state.title || 'Unbenannt', undefined, { fields: state.fields, ocr: state.ocr })
      if (isDesktop) {
        const { openInSystemViewer } = await import('./desktop')
        await openInSystemViewer(bytes, `${state.title || 'Unbenannt'}.pdf`)
        return
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      if (tab) {
        tab.location.href = url
        return
      }
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
      tab?.close()
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
    dispatch({ type: 'restore', title: session.title, pages: session.pages, sources: session.sources, fields: session.fields, ocr: session.ocr })
    setSession(null)
    setPersisting(true)
  }

  const discard = () => {
    setSession(null)
    setPersisting(true)
    clearSession()
  }

  const beginCrop = (pageId: string, ids: string[]) => {
    dispatch({ type: 'scrolledTo', id: pageId })
    setCropping({ pageId, ids })
    setScrollRequest((n) => n + 1)
  }

  const endCrop = () => {
    if (cropping) dispatch({ type: 'scrolledTo', id: cropping.pageId })
    setCropping(null)
    setScrollRequest((n) => n + 1)
  }

  const applyCrop = (crop: Rect | null, all: boolean) => {
    if (cropping) dispatch({ type: 'crop', pageId: cropping.pageId, crop, also: all ? cropping.ids : [] })
    endCrop()
  }

  // The page the menu was opened on, or else the one being read; the other selected pages can share the crop.
  const startCrop = (on?: string) => {
    const id = [on, state.current].find((p) => p && selection.has(p)) ?? state.selection[0]
    if (id) beginCrop(id, state.selection)
  }

  useEffect(() => {
    if (cropping && !pages.some((p) => p.id === cropping.pageId)) setCropping(null)
  }, [cropping, pages])

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
    if (t === 'highlight') setHighlightRequest((n) => n + 1)
    if (t !== 'select') dispatch({ type: 'selectAnnotation', target: null })
  }

  // Closing the markup bar returns to plain text selection.
  useEffect(() => {
    if (!markupOpen) setTool('select')
  }, [markupOpen])

  const markup: Markup = {
    tool,
    highlightRequest,
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
    { label: 'Nach links drehen', icon: 'rotateLeft', shortcut: `${MOD}L`, disabled: !has, run: () => dispatch({ type: 'rotate', delta: -90 }) },
    { label: 'Nach rechts drehen', icon: 'rotateRight', shortcut: `${MOD}R`, disabled: !has, run: () => dispatch({ type: 'rotate', delta: 90 }) },
    { label: 'Duplizieren', icon: 'duplicate', shortcut: `${MOD}D`, disabled: !has, run: () => dispatch({ type: 'duplicate' }) },
    { label: 'Text erkennen …', icon: 'scanText', disabled: !has || !!task, run: () => recognise(selectedPages) },
    { label: 'Beschneiden …', icon: 'crop', shortcut: `${MOD}K`, disabled: !has, run: () => startCrop(menu?.kind === 'page' ? (menu.from ?? menu.on) : undefined) },
    'separator',
    { label: 'Dateien danach einfügen …', icon: 'file', run: () => openFiles() },
    { label: 'Leere Seite danach einfügen', icon: 'blank', run: () => insertBlank() },
    'separator',
    { label: `${pageWord} als PDF sichern …`, icon: 'export', disabled: !has, run: () => exportPdf(selectedPages, count === 1 ? ` – Seite ${pages.indexOf(selectedPages[0]) + 1}` : ' – Auswahl') },
    'separator',
    { label: `${pageWord} löschen`, icon: 'trash', shortcut: '⌫', disabled: !has, danger: true, run: () => dispatch({ type: 'remove' }) },
  ]

  const onThumbContextMenu = (e: MouseEvent, id: string) => {
    e.preventDefault()
    if (!selection.has(id)) dispatch({ type: 'select', id, mode: 'single' })
    setMenu({ x: e.clientX, y: e.clientY, kind: 'page', on: id })
  }

  const gapMenu = (at: number): MenuItem[] => [
    { label: 'Dateien hier einfügen …', icon: 'file', run: () => openFiles(at) },
    { label: 'Leere Seite hier einfügen', icon: 'blank', run: () => insertBlank(at) },
  ]

  // Buttons on a page act on that page alone: after an import every new page is selected,
  // and rotating one page must not turn all of them. "Mehr" works on the selection like the context menu.
  const onHoveredPage = (id: string, action: Action) => {
    dispatch({ type: 'select', id, mode: 'single' })
    dispatch(action)
  }

  const below = (r: DOMRect) => ({ x: r.left, y: r.bottom + 6 })
  // Right-aligned under a toolbar button; menus are 250px wide.
  const openMenuBelow = (e: MouseEvent<HTMLButtonElement>, kind: 'save' | 'document') => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ x: r.right - 250, y: r.bottom + 6, kind })
  }

  const pageActions: PageActions = {
    mod: MOD,
    pinned: menu?.kind === 'gap' ? { gap: menu.at } : menu?.kind === 'page' && menu.from ? { page: menu.from } : null,
    onRotate: (id, delta) => onHoveredPage(id, { type: 'rotate', delta }),
    onRemove: (id) => onHoveredPage(id, { type: 'remove' }),
    onMore: (id, anchor) => {
      if (!selection.has(id)) dispatch({ type: 'select', id, mode: 'single' })
      // Beside the button, so the menu does not cover the actions below it.
      setMenu({ x: anchor.right + 6, y: anchor.top, kind: 'page', from: id })
    },
    onGap: (at, anchor) => setMenu({ ...below(anchor), kind: 'gap', at }),
    onAdd: () => openFiles(pages.length),
  }

  const closeDocument = () => {
    dispatch({ type: 'selectAll' })
    dispatch({ type: 'remove' })
  }

  const saveMenu = (): MenuItem[] => [
    { label: 'Als PDF sichern …', icon: 'save', shortcut: `${MOD}S`, disabled: !pages.length, run: () => exportPdf(pages) },
    { label: `Auswahl sichern (${count}) …`, icon: 'export', disabled: !has || count === pages.length, run: () => exportPdf(selectedPages, ' – Auswahl') },
    'separator',
    { label: 'Kleiner sichern …', icon: 'shrink', disabled: !pages.length, run: () => exportPdf(pages, ' – klein', true) },
  ]

  const documentMenu = (): MenuItem[] => [
    { label: 'Dateien einfügen …', icon: 'file', shortcut: `${MOD}O`, run: () => openFiles() },
    { label: 'Leere Seite einfügen', icon: 'blank', run: () => insertBlank() },
    'separator',
    { label: 'Text erkennen …', icon: 'scanText', disabled: !pages.length || !!task, run: () => recognise(pages) },
    'separator',
    { label: 'Dokument schließen', icon: 'closeDocument', disabled: !pages.length, run: closeDocument },
    'separator',
    { label: 'Über Vorschau und Datenschutz …', icon: 'info', run: () => setAbout(true) },
  ]

  /**
   * Touch layout outside selection mode: the selection is not visible there, so page actions
   * apply to the page on screen. Otherwise "Delete" right after an import would remove every imported page.
   */
  const onVisiblePage = (action: Action) => {
    if (!state.current) return
    dispatch({ type: 'select', id: state.current, mode: 'single' })
    dispatch(action)
  }

  /** Less frequent actions behind "Mehr" in the touch layout. */
  const moreMenu = (): MenuItem[] => [
    { label: 'Wiederholen', icon: 'redo', disabled: !canRedo, run: () => dispatch({ type: 'redo' }) },
    { label: 'Nach links drehen', icon: 'rotateLeft', disabled: !state.current, run: () => onVisiblePage({ type: 'rotate', delta: -90 }) },
    { label: 'Duplizieren', icon: 'duplicate', disabled: !state.current, run: () => onVisiblePage({ type: 'duplicate' }) },
    { label: 'Text erkennen …', icon: 'scanText', disabled: !state.current || !!task, run: () => recognise(pages.filter((p) => p.id === state.current)) },
    { label: 'Beschneiden …', icon: 'crop', disabled: !state.current, run: () => state.current && beginCrop(state.current, [state.current]) },
    { label: 'Leere Seite danach einfügen', icon: 'blank', run: () => insertBlank(currentIndex + 1) },
    'separator',
    { label: 'Vergrößern', icon: 'zoomIn', run: () => zoomBy(1) },
    { label: 'Verkleinern', icon: 'zoomOut', run: () => zoomBy(-1) },
    { label: 'An Breite anpassen', icon: 'fitWidth', disabled: zoom === 'fit', run: () => setZoom('fit') },
    'separator',
    { label: 'Drucken …', icon: 'print', run: print },
    { label: 'Dokument schließen', icon: 'closeDocument', run: closeDocument },
    'separator',
    { label: 'Über und Datenschutz', icon: 'info', run: () => setAbout(true) },
  ]

  // Global shortcuts. Re-bound every render so handlers see current state.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      const mod = e.metaKey || e.ctrlKey
      // In a form field only the document-wide shortcuts apply, so Backspace or ⌘A edit the field.
      const fieldShortcut = t.closest?.('.form-layer') && mod && ['s', 'p', 'o', 'f'].includes(e.key.toLowerCase())
      if ((t.closest?.('input, textarea, select, [contenteditable]') && !fieldShortcut) || menu) return
      const key = e.key.toLowerCase()
      const run = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      // While cropping, Return and Escape belong to the crop bar and page shortcuts must not change the pages.
      if (cropping && !(mod && ['+', '=', '-', '0'].includes(key))) return
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
      if (mod && key === 'k') return run(() => has && startCrop())
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

  // Desktop app: files from "Open with" or a double-click in the file manager.
  const importRef = useRef(importFiles)
  importRef.current = importFiles
  useEffect(() => {
    if (!isDesktop) return
    let unlisten: (() => void) | undefined
    let live = true
    void import('./desktop').then(async (desktop) => {
      const take = async () => {
        const files = await desktop.takeOpenedFiles()
        if (live && files.length) importRef.current(files, pagesRef.current.length)
      }
      unlisten = await desktop.onFilesOpened(take)
      await take()
    })
    return () => {
      live = false
      unlisten?.()
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

  // The page overview covers the document on phones, so it starts closed there.
  useEffect(() => setSidebarOpen(!compact), [compact])
  useEffect(() => {
    if (!sidebarOpen) setSelecting(false)
  }, [sidebarOpen])

  const empty = pages.length === 0
  const canUndo = state.history.past.length > 0
  const canRedo = state.history.future.length > 0
  const currentIndex = pages.findIndex((p) => p.id === state.current)

  const searchField = (
    <div className={`search${q ? ' is-active' : ''}`}>
      <Icon name="search" width={15} />
      <input
        ref={searchInput}
        type="search"
        enterKeyHint="search"
        placeholder="Suchen"
        aria-label={`Im Dokument suchen (${MOD}F)`}
        value={query}
        autoFocus={compact}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            jump(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            setQuery('')
            setSearchOpen(false)
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
      {q && hits.done && hits.query === q && hits.scans.length && !task ? (
        <button
          className="search-scan"
          title={`${hits.scans.length === 1 ? 'Eine Seite ist ein Scan' : `${hits.scans.length} Seiten sind Scans`} ohne Text – Text erkennen …`}
          aria-label="Text auf Scans ohne Text erkennen"
          onClick={() => recognise(pages.filter((p) => hits.scans.includes(p.id)))}
        >
          <Icon name="scanText" width={15} />
        </button>
      ) : null}
    </div>
  )

  const taskStatus = task ? (
    <div className="task" role="status">
      <span className="task-label">{task.label}</span>
      <span className="task-bar">
        <span style={task.progress === null ? undefined : { width: `${task.progress * 100}%` }} className={task.progress === null ? 'is-indeterminate' : ''} />
      </span>
      {task.cancel ? <button className="task-cancel" onClick={task.cancel}>Abbrechen</button> : null}
    </div>
  ) : null

  const markupBar = (
    <MarkupBar
      compact={compact}
      onDone={() => setMarkupOpen(false)}
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
  )

  return (
    <div className="app">
      <div className="chrome">
      <header className={`toolbar${compact ? ' is-compact' : ''}`}>
        {compact && searchOpen && !empty ? (
          <>
            {searchField}
            <ToolButton icon="up" label="Vorheriger Treffer" disabled={!hitOrder.length} onClick={() => jump(-1)} />
            <ToolButton icon="down" label="Nächster Treffer" disabled={!hitOrder.length} onClick={() => jump(1)} />
            <button className="button is-quiet search-cancel" onClick={() => { setQuery(''); setSearchOpen(false) }}>
              <Icon name="check" width={15} />
              Fertig
            </button>
          </>
        ) : (
          <>
            <ToolButton
              icon={compact ? 'pages' : 'sidebar'}
              label={compact ? 'Seitenübersicht' : 'Seitenleiste ein-/ausblenden'}
              pressed={sidebarOpen && !empty}
              disabled={empty}
              onClick={() => setSidebarOpen((o) => !o)}
            />
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
                    {count > 1 && (!compact || selecting) ? `${count} von ${pages.length} Seiten ausgewählt` : `Seite ${currentIndex + 1} von ${pages.length}`}
                  </span>
                </>
              )}
            </div>
            {!compact && task ? taskStatus : null}
            {compact ? null : (
              <>
                <div className="toolbar-group">
                  <ToolButton icon="zoomOut" label={`Verkleinern (${MOD}−)`} disabled={empty} onClick={() => zoomBy(-1)} />
                  <button className="zoom-label" disabled={empty} onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} title={zoom === 'fit' ? 'Originalgröße' : 'An Fensterbreite anpassen'}>
                    {Math.round(scale * 100)} %
                  </button>
                  <ToolButton icon="zoomIn" label={`Vergrößern (${MOD}+)`} disabled={empty} onClick={() => zoomBy(1)} />
                </div>
              </>
            )}
            {compact && !empty ? <ToolButton icon="search" label="Im Dokument suchen" onClick={() => setSearchOpen(true)} /> : null}
            <div className="toolbar-group">
              <ToolButton icon="markup" label={compact ? 'Markieren' : 'Markierungen ein-/ausblenden (⇧⌘A)'} pressed={markupOpen} disabled={empty} onClick={() => setMarkupOpen((o) => !o)} />
            </div>
            {compact ? null : (
              <>
                <div className="toolbar-group">
                  <ToolButton icon="undo" label={`Widerrufen (${MOD}Z)`} disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} />
                  <ToolButton icon="redo" label={`Wiederholen (⇧${MOD}Z)`} disabled={!canRedo} onClick={() => dispatch({ type: 'redo' })} />
                </div>
                {empty ? null : searchField}
              </>
            )}
            {compact ? null : (
              <>
                <ToolButton icon="print" label={`Drucken (${MOD}P)`} disabled={empty} onClick={print} />
                <ToolButton icon="more" label="Mehr" onClick={(e) => openMenuBelow(e, 'document')} />
              </>
            )}
            <button className="button is-primary export-button" disabled={empty} onClick={(e) => openMenuBelow(e, 'save')} aria-haspopup="menu">
              <Icon name="save" />
              Sichern
              {compact ? null : <Icon name="chevron" width={14} />}
            </button>
          </>
        )}
      </header>
      {compact && task ? taskStatus : null}
      {markupOpen && !empty && !compact ? markupBar : null}
      </div>

      <main className={`workspace${dropping ? ' is-dropping' : ''}`} {...dropHandlers}>
        {empty ? (
          <EmptyState session={session} onOpen={() => openFiles(0)} onBlank={() => insertBlank(0)} onRestore={restore} onDiscard={discard} onAbout={() => setAbout(true)} />
        ) : (
          <>
            {sidebarOpen && compact ? (
              <aside className="pages-panel" aria-label="Seitenübersicht">
                <div className="pages-panel-head">
                  <strong>{selecting && count ? `${count} ausgewählt` : `${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'}`}</strong>
                  <button
                    className="button is-quiet"
                    onClick={() => {
                      // Like in Photos: selecting starts from nothing, so a tap never unselects by surprise.
                      if (!selecting) dispatch({ type: 'selectNone' })
                      setSelecting(!selecting)
                    }}
                  >
                    {selecting ? 'Fertig' : 'Auswählen'}
                  </button>
                </div>
                <Sidebar
                  pages={pages}
                  sources={state.sources}
                  fields={state.fields}
                  selection={selection}
                  current={state.current}
                  width={186}
                  onSelect={select}
                  onMove={(gap) => dispatch({ type: 'move', gap })}
                  onDropFiles={importFiles}
                  onContextMenu={onThumbContextMenu}
                  onKeyDown={onSidebarKey}
                  hits={q ? hits.pages : null}
                  grid
                  onTap={(id) => {
                    if (selecting) {
                      dispatch({ type: 'select', id, mode: 'toggle' })
                      return
                    }
                    select(id, 'single')
                    setSidebarOpen(false)
                  }}
                />
              </aside>
            ) : sidebarOpen ? (
              <aside className="sidebar" style={{ width: sidebarWidth }}>
                <Sidebar
                  pages={pages}
                  sources={state.sources}
                  fields={state.fields}
                  selection={selection}
                  current={state.current}
                  width={sidebarWidth}
                  onSelect={select}
                  onMove={(gap) => dispatch({ type: 'move', gap })}
                  onDropFiles={importFiles}
                  onContextMenu={onThumbContextMenu}
                  onKeyDown={onSidebarKey}
                  hits={q ? hits.pages : null}
                  actions={pageActions}
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
              forms={{ values: state.fields, onChange: (sourceId, name, value) => dispatch({ type: 'field', sourceId, name, value }) }}
              ocr={state.ocr}
              padding={compact ? 8 : 24}
              fitEach={compact}
              crop={cropping}
              onCrop={applyCrop}
              onCancelCrop={endCrop}
            />
          </>
        )}
        {dropping ? <div className="drop-hint">{empty ? 'Loslassen zum Öffnen' : 'Loslassen, um am Ende anzuhängen'}</div> : null}
      </main>

      {compact && !empty ? (
        markupOpen ? (
          markupBar
        ) : sidebarOpen && selecting ? (
          <BottomBar
            label="Ausgewählte Seiten"
            actions={[
              { icon: 'up', label: 'Nach vorn', disabled: !has, run: () => dispatch({ type: 'nudge', delta: -1 }) },
              { icon: 'down', label: 'Nach hinten', disabled: !has, run: () => dispatch({ type: 'nudge', delta: 1 }) },
              { icon: 'rotateRight', label: 'Drehen', disabled: !has, run: () => dispatch({ type: 'rotate', delta: 90 }) },
              { icon: 'duplicate', label: 'Duplizieren', disabled: !has, run: () => dispatch({ type: 'duplicate' }) },
              { icon: 'trash', label: 'Löschen', disabled: !has, danger: true, run: () => dispatch({ type: 'remove' }) },
            ]}
          />
        ) : (
          <BottomBar
            label="Seitenaktionen"
            actions={[
              { icon: 'undo', label: 'Widerrufen', disabled: !canUndo, run: () => dispatch({ type: 'undo' }) },
              { icon: 'plus', label: 'Einfügen', run: () => openFiles() },
              { icon: 'rotateRight', label: 'Drehen', disabled: !state.current, run: () => onVisiblePage({ type: 'rotate', delta: 90 }) },
              { icon: 'trash', label: 'Löschen', disabled: !state.current, danger: true, run: () => onVisiblePage({ type: 'remove' }) },
              {
                icon: 'more',
                label: 'Mehr',
                run: (e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({ x: r.right - 250, y: r.top - 8, kind: 'more' })
                },
              },
            ]}
          />
        )
      ) : null}

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

      {about ? <AboutDialog onClose={() => setAbout(false)} /> : null}

      {passwordRequest ? (
        <PasswordDialog key={passwordRequest.id} name={passwordRequest.name} wrong={passwordRequest.wrong} onAnswer={passwordRequest.answer} />
      ) : null}

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

      {menu ? <Menu x={menu.x} y={menu.y} items={menu.kind === 'page' ? pageMenu() : menu.kind === 'more' ? moreMenu() : menu.kind === 'gap' ? gapMenu(menu.at) : menu.kind === 'save' ? saveMenu() : documentMenu()}
          above={menu.kind === 'more'} onClose={() => setMenu(null)} /> : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.note ? ' is-note' : ''}`}>
            <span>{t.text}</span>
            {t.action ? (
              <button
                className="toast-action"
                onClick={() => {
                  setToasts((all) => all.filter((x) => x.id !== t.id))
                  t.action!.run()
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button aria-label="Schließen" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <Icon name="close" width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToolButton({ icon, label, pressed, disabled, onClick }: { icon: IconName; label: string; pressed?: boolean; disabled?: boolean; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button className="tool" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

async function download(bytes: Uint8Array, name: string) {
  if (isDesktop) {
    const { saveWithDialog } = await import('./desktop')
    await saveWithDialog(bytes, name)
    return
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
