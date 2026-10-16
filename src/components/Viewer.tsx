import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { mergeLineRects, toPageSpace } from '../model/annotations'
import { cropRect, displayedSize, visibleRect } from '../model/crop'
import { newId } from '../model/ids'
import { rotatedSize } from '../model/pages'
import type { Annotation, Page, Point, Rect, Sources } from '../model/types'
import type { Entered, FieldValue } from '../model/forms'
import { AnnotationLayer, cancelStrokes, type Interaction, type MarkupStyle, type Signature, type Tool } from './AnnotationLayer'
import { CropBar, CropOverlay } from './Crop'
import { FormLayer } from './FormLayer'
import { pageForm, type PageForm } from '../pdf/forms'
import type { OcrPage, OcrResults } from '../model/ocr'
import { renderOcrLayer } from '../ocr/layer'
import { renderPage, renderTextLayer } from '../pdf/pdfjs'
import { matchPieces } from '../pdf/text'
import { PAGES_MIME } from './Sidebar'

export type Zoom = 'fit' | number

/** The search hit to reveal; `nonce` changes on every jump so the same hit can be revealed again. */
export interface ActiveHit {
  pageId: string
  n: number
  nonce: number
}

const PX_PER_PT = 96 / 72
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
/** Room kept for the crop bar below the page being cropped, in CSS pixels. */
const CROP_BAR = 72

interface Props {
  pages: Page[]
  sources: Sources
  zoom: Zoom
  current: string | null
  /** Incremented to scroll `current` into view. */
  scrollRequest: number
  onScrolledTo: (id: string) => void
  onScale: (scale: number) => void
  query: string
  activeHit: ActiveHit | null
  markup: Markup
  forms: Forms
  /** Text read from scans; it takes the place of a page's own text. */
  ocr: OcrResults
  /** Space around pages; small on phones so pages use the width. */
  padding?: number
  /** In fit mode, size every page to the width instead of the widest page (phones). */
  fitEach?: boolean
  crop?: CropRequest | null
  /** Applies the crop to the page being cropped, and to all `ids` if `all`; null removes it. */
  onCrop?: (crop: Rect | null, all: boolean) => void
  onCancelCrop?: () => void
  /** Pinching with two fingers while drawing sets the zoom. */
  onZoom?: (zoom: number) => void
  /** A page dragged from the sidebar was dropped on page `target` at `at` (target's own space). */
  onPlace?: (target: string, at: Point, dragged: string, copy: boolean) => void
}

/** The page being cropped. It is shown whole, with the current crop selected, until the crop is applied or cancelled. */
export interface CropRequest {
  pageId: string
  /** The pages (this one included) a crop can apply to together. */
  ids: string[]
}

export interface Forms {
  /** Entered values by source id, then field name. */
  values: Record<string, Record<string, FieldValue>>
  /** A null value goes back to what the PDF stores. */
  onChange: (sourceId: string, name: string, value: FieldValue | null) => void
}

export interface Markup {
  tool: Tool
  /** Changes on every tap on the highlighter. */
  highlightRequest: number
  style: MarkupStyle
  highlightColor: string
  selected: { pageId: string; id: string } | null
  signature: Signature | null
  onSelect: (target: { pageId: string; id: string } | null) => void
  onAdd: (pageId: string, a: Annotation) => void
  onUpdate: (pageId: string, a: Annotation) => void
  onRemove: (pageId: string, id: string) => void
}

export function Viewer({ pages, sources, zoom, current, scrollRequest, onScrolledTo, onScale, query, activeHit, markup, forms, ocr, padding = 24, fitEach = false, crop = null, onCrop, onCancelCrop, onPlace, onZoom }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLDivElement>())
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  // Tied to the request, so a new crop never starts from the last one's rectangle.
  const [edit, setEdit] = useState<{ request: CropRequest; draft: Rect } | null>(null)
  const cropPage = crop && pages.find((p) => p.id === crop.pageId)
  const draft = !cropPage ? null : edit?.request === crop ? edit.draft : cropRect(sources[cropPage.sourceId].pages[cropPage.index], cropPage.crop)
  const ignoreScrollUntil = useRef(0)
  const anchor = useRef<{ id: string; ratio: number } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setHeight(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const widest = Math.max(1, ...pages.map((p) => displayedSize(sources[p.sourceId].pages[p.index], p).width))
  // Like Preview, fitting never enlarges beyond actual size.
  const scale = zoom === 'fit' ? Math.max(0.1, Math.min(1, (width - 2 * padding) / (widest * PX_PER_PT))) : zoom
  // With per-page fitting, zoom steps should start from the page being read.
  const currentPage = pages.find((p) => p.id === current)
  const reported =
    fitEach && zoom === 'fit' && currentPage
      ? Math.max(0.1, (width - 2 * padding) / (displayedSize(sources[currentPage.sourceId].pages[currentPage.index], currentPage).width * PX_PER_PT))
      : scale
  useEffect(() => onScale(reported), [reported, onScale])

  // While pinching, the content under the fingers stays under them; otherwise the page under the reading line stays put.
  const pinchScroll = useRef<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const pinch = pinchScroll.current
    if (pinch) {
      pinchScroll.current = null
      ignoreScrollUntil.current = performance.now() + 100
      scroller.current!.scrollLeft = pinch.left
      scroller.current!.scrollTop = pinch.top
      return
    }
    const a = anchor.current
    const el = a && elements.current.get(a.id)
    if (!el) return
    ignoreScrollUntil.current = performance.now() + 100
    scroller.current!.scrollTop = el.offsetTop + a.ratio * el.offsetHeight - scroller.current!.clientHeight * 0.3
  }, [scale])

  useLayoutEffect(() => {
    const el = current && elements.current.get(current)
    if (!el || !scrollRequest) return
    ignoreScrollUntil.current = performance.now() + 100
    scroller.current!.scrollTop = el.offsetTop - padding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest])

  // Bring the page into view; the page itself centres the hit once its text layer exists.
  useLayoutEffect(() => {
    const el = activeHit && elements.current.get(activeHit.pageId)
    if (!el) return
    const box = scroller.current!
    if (el.offsetTop + el.offsetHeight < box.scrollTop || el.offsetTop > box.scrollTop + box.clientHeight) {
      box.scrollTop = el.offsetTop - padding
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHit?.nonce])

  const drawingTool = markup.tool !== 'select' && markup.tool !== 'highlight'
  const live = useRef({ scale: reported, onZoom })
  live.current = { scale: reported, onZoom }

  // Fingers while a drawing tool is on: one draws, two pan and zoom. Once a stylus has drawn,
  // one finger pans as well, so a hand resting on the screen does not draw.
  useEffect(() => {
    if (!drawingTool) return
    const el = scroller.current!
    const touches = new Map<number, Point>()
    let drawing = false
    let stylus = false
    let gesture: { mid: Point; spread: number; left: number; top: number; scale: number } | null = null
    let frame = 0
    const begin = () => {
      const points = [...touches.values()]
      gesture = { mid: midpoint(points), spread: spread(points), left: el.scrollLeft, top: el.scrollTop, scale: live.current.scale }
    }
    const apply = () => {
      if (!gesture) return
      const points = [...touches.values()]
      const mid = midpoint(points)
      const r = el.getBoundingClientRect()
      const pinch = points.length > 1 && gesture.spread > 0
      const scale = pinch ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (gesture.scale * spread(points)) / gesture.spread)) : gesture.scale
      const k = scale / gesture.scale
      const left = (gesture.left + gesture.mid[0] - r.left) * k - (mid[0] - r.left)
      const top = (gesture.top + gesture.mid[1] - r.top) * k - (mid[1] - r.top)
      if (Math.abs(scale - live.current.scale) > 0.001) {
        pinchScroll.current = { left, top }
        live.current.onZoom?.(scale)
      } else {
        el.scrollLeft = left
        el.scrollTop = top
      }
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'pen') stylus = true
      if (e.pointerType !== 'touch') return
      touches.set(e.pointerId, [e.clientX, e.clientY])
      const onPage = (e.target as Element).closest('.ann-layer.is-drawing')
      if (touches.size === 1 && onPage && !stylus) {
        drawing = true
        return
      }
      if (drawing) cancelStrokes()
      drawing = false
      e.stopPropagation()
      begin()
    }
    const move = (e: PointerEvent) => {
      if (!gesture || !touches.has(e.pointerId)) return
      touches.set(e.pointerId, [e.clientX, e.clientY])
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }
    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return
      if (touches.size === 0) {
        gesture = null
        drawing = false
      } else if (gesture) {
        // Fewer fingers: carry on from where they are.
        begin()
      }
    }
    el.addEventListener('pointerdown', down, true)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointerdown', down, true)
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
    }
  }, [drawingTool])

  const frame = useRef(0)
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const box = scroller.current!
      const line = box.scrollTop + box.clientHeight * 0.3
      let hit: Page | undefined
      let hitEl: HTMLDivElement | undefined
      for (const p of pages) {
        const el = elements.current.get(p.id)
        if (!el) continue
        if (el.offsetTop > line && hit) break
        hit = p
        hitEl = el
      }
      if (!hit || !hitEl) return
      anchor.current = { id: hit.id, ratio: (line - hitEl.offsetTop) / hitEl.offsetHeight }
      if (performance.now() > ignoreScrollUntil.current) onScrolledTo(hit.id)
    })
  }, [pages, onScrolledTo])

  // Tapping the highlighter with text already selected highlights it right away.
  useEffect(() => {
    if (markup.tool === 'highlight') highlightSelection(pages, sources, elements.current, markup, crop?.pageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markup.tool, markup.highlightRequest])

  const onMouseUp = () => {
    if (markup.tool === 'highlight') highlightSelection(pages, sources, elements.current, markup, crop?.pageId)
  }

  return (
    <div
      className={`viewer tool-${markup.tool}${drawingTool ? ' is-drawing-tool' : ''}`}
      ref={scroller}
      onScroll={onScroll}
      onMouseUp={onMouseUp}
      onPointerDown={(e) => {
        if (!(e.target as Element).closest('[data-ann], .ann-handle, .ann-text-editor')) markup.onSelect(null)
      }}
      tabIndex={-1}
    >
      <div className="viewer-pages" style={{ padding, gap: Math.min(16, padding) }}>
        {pages.map((page, i) => {
          const cropEdit = draft && crop?.pageId === page.id ? { draft, onChange: (rect: Rect) => setEdit({ request: crop, draft: rect }) } : null
          const size = displayedSize(sources[page.sourceId].pages[page.index], cropEdit ? { rotation: page.rotation } : page)
          // A single wide page (e.g. a photo) would otherwise shrink every A4 page on a phone.
          let pageScale = fitEach && zoom === 'fit' ? Math.max(0.1, (width - 2 * padding) / (size.width * PX_PER_PT)) : scale
          // The page being cropped is shown whole, and as large as fits, so all its handles are in reach.
          if (cropEdit && zoom === 'fit') {
            const room = Math.min((width - 2 * padding) / size.width, (height - 2 * padding - CROP_BAR) / size.height)
            pageScale = Math.min(pageScale, Math.max(0.1, room / PX_PER_PT))
          }
          return (
            <ViewerPage
              key={page.id}
              page={page}
              sources={sources}
              number={i + 1}
              width={Math.round(size.width * pageScale * PX_PER_PT)}
              height={Math.round(size.height * pageScale * PX_PER_PT)}
              root={scroller}
              query={query}
              activeHit={activeHit?.pageId === page.id ? activeHit : null}
              scale={pageScale * PX_PER_PT}
              entered={forms.values[page.sourceId]}
              ocr={ocr[page.sourceId]?.[page.index]}
              onField={(name, value) => forms.onChange(page.sourceId, name, value)}
              cropEdit={cropEdit}
              onPlace={onPlace}
              interaction={{
                tool: markup.tool,
                style: markup.style,
                highlightColor: markup.highlightColor,
                selectedId: markup.selected?.pageId === page.id ? markup.selected.id : null,
                signature: markup.signature,
                onSelect: (id) => markup.onSelect(id ? { pageId: page.id, id } : null),
                onAdd: (a) => markup.onAdd(page.id, a),
                onUpdate: (a) => markup.onUpdate(page.id, a),
                onRemove: (id) => markup.onRemove(page.id, id),
              }}
              ref={(el) => {
                if (el) elements.current.set(page.id, el)
                else elements.current.delete(page.id)
              }}
            />
          )
        })}
        {crop && cropPage && draft ? (
          <div className="crop-dock" style={{ width, margin: `0 ${-padding}px` }}>
            <CropBar
              key={crop.pageId}
              count={crop.ids.length}
              hasCrop={!!cropPage.crop}
              onApply={(all) => onCrop?.(draft, all)}
              onReset={(all) => onCrop?.(null, all)}
              onCancel={() => onCancelCrop?.()}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface PageProps {
  page: Page
  sources: Sources
  number: number
  width: number
  height: number
  root: React.RefObject<HTMLDivElement | null>
  query: string
  activeHit: ActiveHit | null
  scale: number
  entered: Entered
  ocr: OcrPage | undefined
  onField: (name: string, value: FieldValue | null) => void
  interaction: Interaction
  /** Set while the page is being cropped: it is laid out whole and its content is inert. */
  cropEdit: { draft: Rect; onChange: (draft: Rect) => void } | null
  onPlace?: Props['onPlace']
  ref: (el: HTMLDivElement | null) => void
}

const NO_CANVASES = new Map<string, HTMLCanvasElement[]>()

function ViewerPage({ page, sources, number, width, height, root, query, activeHit, scale, entered, ocr, onField, interaction, cropEdit, onPlace, ref }: PageProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [rendered, setRendered] = useState(false)
  const textBox = useRef<HTMLDivElement>(null)
  // Text items that read as one string for searching: one per pdf.js span, one per line of recognised words.
  const [spans, setSpans] = useState<HTMLElement[][]>([])
  const [form, setForm] = useState<PageForm | null>(null)
  const [canvases, setCanvases] = useState(NO_CANVASES)
  const revealed = useRef(0)
  const contentBox = useRef<HTMLDivElement>(null)
  const [dropTarget, setDropTarget] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root: root.current,
      rootMargin: '150% 0px',
    })
    io.observe(box.current!)
    return () => io.disconnect()
  }, [root])

  const source = sources[page.sourceId]
  const hasOcr = !!ocr
  // Every layer is laid out for the whole page; the crop only moves and clips that box.
  const sourceSize = source.pages[page.index]
  const whole = rotatedSize(sourceSize, page.rotation)
  const visible = visibleRect(sourceSize, cropEdit ? { rotation: page.rotation } : page)
  const fullWidth = Math.round(whole.width * scale)
  const [left, top] = [-Math.round(visible.x * scale), -Math.round(visible.y * scale)]
  // Never smaller than the window it is seen through, so rounding leaves no gap at the far edges.
  const content = { left, top, width: Math.max(fullWidth, width - left), height: Math.max(Math.round(whole.height * scale), height - top) }

  useEffect(() => {
    const c = canvas.current!
    if (!near) {
      // Release the bitmap; full-size canvases for hundreds of pages would exhaust memory.
      c.width = c.height = 0
      textBox.current!.replaceChildren()
      setRendered(false)
      setSpans([])
      setForm(null)
      setCanvases(NO_CANVASES)
      return
    }
    const ctrl = new AbortController()
    // Debounced so that zooming with repeated key presses renders once.
    const t = setTimeout(() => {
      // Pages with fields are drawn without them; the form layer provides those.
      const fields = source.kind === 'pdf' ? pageForm(source, page.index).catch(() => null) : Promise.resolve(null)
      fields
        .then((f) => {
          if (!ctrl.signal.aborted) setForm(f?.interactive ? f : null)
          return renderPage(c, source, page.index, page.rotation, fullWidth, ctrl.signal, f?.interactive ? { onCanvases: setCanvases } : undefined)
        })
        .then(() => !ctrl.signal.aborted && setRendered(true))
        .catch((e) => console.error('Seite konnte nicht gezeichnet werden', e))
      if (source.kind === 'pdf' && !hasOcr) {
        renderTextLayer(textBox.current!, source, page.index, page.rotation, fullWidth, ctrl.signal)
          .then((s) => !ctrl.signal.aborted && setSpans(s.map((span) => [span])))
          .catch((e) => console.error('Textebene fehlgeschlagen', e))
      }
    }, rendered ? 120 : 0)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, source, page.index, page.rotation, fullWidth, hasOcr])

  // Recognised text is placed from the page's own data, so it needs no render task.
  useEffect(() => {
    if (near && ocr) setSpans(renderOcrLayer(textBox.current!, ocr, source.pages[page.index], page.rotation, fullWidth))
  }, [near, ocr, source, page.index, page.rotation, fullWidth])

  useEffect(() => {
    let n = 0
    let active: HTMLElement | null = null
    for (const unit of spans) {
      const texts = unit.map((span) => span.textContent ?? '')
      const matches = matchPieces(texts, query)
      if (matches.length === 0 && !unit.some((span) => span.childElementCount)) continue
      for (const [item, span] of unit.entries()) {
        const text = texts[item]
        span.replaceChildren()
        let at = 0
        // A hit across several words marks a part of each of them.
        const own = matches.flatMap((pieces, k) => pieces.filter((p) => p.item === item).map((p) => ({ ...p, hit: n + k })))
        for (const { start, end, hit } of own) {
          const mark = document.createElement('mark')
          mark.className = 'hit'
          mark.textContent = text.slice(start, end)
          if (activeHit?.n === hit) {
            mark.classList.add('is-active')
            active ??= mark
          }
          span.append(text.slice(at, start), mark)
          at = end
        }
        span.append(text.slice(at))
      }
      n += matches.length
    }
    if (active && activeHit && revealed.current !== activeHit.nonce) {
      revealed.current = activeHit.nonce
      // Text outside the crop is hidden; the viewer has brought the page into view already.
      if (!page.crop || isWithin(active, box.current!)) active.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }, [spans, query, activeHit])

  const acceptsPages = (e: React.DragEvent) => !!onPlace && !cropEdit && e.dataTransfer.types.includes(PAGES_MIME)

  return (
    <div
      ref={(el) => {
        box.current = el
        ref(el)
      }}
      className={`viewer-page${rendered ? '' : ' is-loading'}${page.crop && !cropEdit ? ' is-cropped' : ''}${dropTarget ? ' is-drop-target' : ''}`}
      style={{ width, height }}
      aria-label={`Seite ${number}`}
      onDragOver={(e) => {
        if (!acceptsPages(e)) return
        e.preventDefault()
        e.stopPropagation()
        // ⌥ (Alt) lays a copy on the page, like copying in the Finder.
        e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
        setDropTarget(true)
      }}
      onDragLeave={(e) => {
        if (!box.current!.contains(e.relatedTarget as Node)) setDropTarget(false)
      }}
      onDrop={(e) => {
        if (!acceptsPages(e)) return
        e.preventDefault()
        e.stopPropagation()
        setDropTarget(false)
        const r = contentBox.current!.getBoundingClientRect()
        const at = toPageSpace([(e.clientX - r.left) / scale, (e.clientY - r.top) / scale], sourceSize, page.rotation)
        onPlace!(page.id, at, e.dataTransfer.getData(PAGES_MIME), e.altKey)
      }}
    >
      <div ref={contentBox} className="page-content" style={content} inert={!!cropEdit}>
        <canvas ref={canvas} />
        <div ref={textBox} className="text-box" />
        {form && rendered ? (
          <FormLayer
            form={form}
            canvases={canvases}
            scope={page.id}
            rotation={page.rotation}
            scale={scale}
            entered={entered}
            active={interaction.tool === 'select'}
            crop={page.crop}
            onChange={onField}
          />
        ) : null}
        <AnnotationLayer
          annotations={page.annotations ?? []}
          size={source.pages[page.index]}
          rotation={page.rotation}
          scale={scale}
          interaction={interaction}
        />
      </div>
      {cropEdit ? <CropOverlay size={sourceSize} rotation={page.rotation} scale={scale} draft={cropEdit.draft} onChange={cropEdit.onChange} /> : null}
    </div>
  )
}

/** Turns the current text selection into one highlight per touched page, except the page being cropped. */
function highlightSelection(pages: Page[], sources: Sources, elements: Map<string, HTMLDivElement>, markup: Markup, skip?: string) {
  const selection = getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  const clientRects = [...selection.getRangeAt(0).getClientRects()]
  for (const page of pages) {
    const el = elements.get(page.id)
    if (!el || page.id === skip) continue
    // The box shows the visible part; the content inside spans the whole page, which the rects are measured on.
    const box = el.getBoundingClientRect()
    const whole = el.querySelector('.page-content')!.getBoundingClientRect()
    const size = sources[page.sourceId].pages[page.index]
    // Pages may be scaled individually, so derive the scale from this page's box.
    const scale = whole.width / rotatedSize(size, page.rotation).width
    const rects: Rect[] = []
    for (const c of clientRects) {
      const cx = c.left + c.width / 2
      const cy = c.top + c.height / 2
      // Element boxes in the range (like the text layer's end marker) are not text.
      if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom || c.height > whole.height * 0.15) continue
      const a = toPageSpace([(c.left - whole.left) / scale, (c.top - whole.top) / scale], size, page.rotation)
      const b = toPageSpace([(c.right - whole.left) / scale, (c.bottom - whole.top) / scale], size, page.rotation)
      rects.push(rectOf(a, b))
    }
    const merged = mergeLineRects(rects)
    if (merged.length) markup.onAdd(page.id, { id: newId(), type: 'highlight', color: markup.highlightColor, rects: merged })
  }
  selection.removeAllRanges()
}

const midpoint = (points: Point[]): Point => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
]

const spread = (points: Point[]) => (points.length < 2 ? 0 : Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]))

function isWithin(el: Element, box: Element): boolean {
  const r = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2]
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
}

function rectOf(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}
