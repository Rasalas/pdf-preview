import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { mergeLineRects, toPageSpace } from '../model/annotations'
import { newId } from '../model/ids'
import { rotatedSize } from '../model/pages'
import type { Annotation, Page, Point, Rect, Sources } from '../model/types'
import { AnnotationLayer, type Interaction, type MarkupStyle, type Signature, type Tool } from './AnnotationLayer'
import { renderPage, renderTextLayer } from '../pdf/pdfjs'
import { matchRanges } from '../pdf/text'

export type Zoom = 'fit' | number

/** The search hit to reveal; `nonce` changes on every jump so the same hit can be revealed again. */
export interface ActiveHit {
  pageId: string
  n: number
  nonce: number
}

const PX_PER_PT = 96 / 72

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
  /** Space around pages; small on phones so pages use the width. */
  padding?: number
  /** In fit mode, size every page to the width instead of the widest page (phones). */
  fitEach?: boolean
}

export interface Markup {
  tool: Tool
  style: MarkupStyle
  highlightColor: string
  selected: { pageId: string; id: string } | null
  signature: Signature | null
  onSelect: (target: { pageId: string; id: string } | null) => void
  onAdd: (pageId: string, a: Annotation) => void
  onUpdate: (pageId: string, a: Annotation) => void
  onRemove: (pageId: string, id: string) => void
}

export function Viewer({ pages, sources, zoom, current, scrollRequest, onScrolledTo, onScale, query, activeHit, markup, padding = 24, fitEach = false }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<string, HTMLDivElement>())
  const [width, setWidth] = useState(0)
  const ignoreScrollUntil = useRef(0)
  const anchor = useRef<{ id: string; ratio: number } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const widest = Math.max(1, ...pages.map((p) => rotatedSize(sources[p.sourceId].pages[p.index], p.rotation).width))
  // Like Preview, fitting never enlarges beyond actual size.
  const scale = zoom === 'fit' ? Math.max(0.1, Math.min(1, (width - 2 * padding) / (widest * PX_PER_PT))) : zoom
  // With per-page fitting, zoom steps should start from the page being read.
  const currentPage = pages.find((p) => p.id === current)
  const reported =
    fitEach && zoom === 'fit' && currentPage
      ? Math.max(0.1, (width - 2 * padding) / (rotatedSize(sources[currentPage.sourceId].pages[currentPage.index], currentPage.rotation).width * PX_PER_PT))
      : scale
  useEffect(() => onScale(reported), [reported, onScale])

  // Keep the page under the reading line in place while zooming or resizing.
  useLayoutEffect(() => {
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

  // Choosing the highlighter with text already selected highlights it right away.
  useEffect(() => {
    if (markup.tool === 'highlight') highlightSelection(pages, sources, elements.current, markup)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markup.tool])

  const onMouseUp = () => {
    if (markup.tool === 'highlight') highlightSelection(pages, sources, elements.current, markup)
  }

  return (
    <div
      className={`viewer tool-${markup.tool}`}
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
          const size = rotatedSize(sources[page.sourceId].pages[page.index], page.rotation)
          // A single wide page (e.g. a photo) would otherwise shrink every A4 page on a phone.
          const pageScale = fitEach && zoom === 'fit' ? Math.max(0.1, (width - 2 * padding) / (size.width * PX_PER_PT)) : scale
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
  interaction: Interaction
  ref: (el: HTMLDivElement | null) => void
}

function ViewerPage({ page, sources, number, width, height, root, query, activeHit, scale, interaction, ref }: PageProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [rendered, setRendered] = useState(false)
  const textBox = useRef<HTMLDivElement>(null)
  const [spans, setSpans] = useState<HTMLElement[]>([])
  const revealed = useRef(0)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root: root.current,
      rootMargin: '150% 0px',
    })
    io.observe(box.current!)
    return () => io.disconnect()
  }, [root])

  const source = sources[page.sourceId]
  useEffect(() => {
    const c = canvas.current!
    if (!near) {
      // Release the bitmap; full-size canvases for hundreds of pages would exhaust memory.
      c.width = c.height = 0
      textBox.current!.replaceChildren()
      setRendered(false)
      setSpans([])
      return
    }
    const ctrl = new AbortController()
    // Debounced so that zooming with repeated key presses renders once.
    const t = setTimeout(() => {
      renderPage(c, source, page.index, page.rotation, width, ctrl.signal)
        .then(() => !ctrl.signal.aborted && setRendered(true))
        .catch((e) => console.error('Seite konnte nicht gezeichnet werden', e))
      if (source.kind === 'pdf') {
        renderTextLayer(textBox.current!, source, page.index, page.rotation, width, ctrl.signal)
          .then((s) => !ctrl.signal.aborted && setSpans(s))
          .catch((e) => console.error('Textebene fehlgeschlagen', e))
      }
    }, rendered ? 120 : 0)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, source, page.index, page.rotation, width])

  useEffect(() => {
    let n = 0
    let active: HTMLElement | null = null
    for (const span of spans) {
      const text = span.textContent ?? ''
      const ranges = matchRanges(text, query)
      if (ranges.length === 0 && !span.childElementCount) continue
      span.replaceChildren()
      let at = 0
      for (const [start, end] of ranges) {
        const mark = document.createElement('mark')
        mark.className = 'hit'
        mark.textContent = text.slice(start, end)
        if (activeHit?.n === n) {
          mark.classList.add('is-active')
          active = mark
        }
        n++
        span.append(text.slice(at, start), mark)
        at = end
      }
      span.append(text.slice(at))
    }
    if (active && activeHit && revealed.current !== activeHit.nonce) {
      revealed.current = activeHit.nonce
      active.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }, [spans, query, activeHit])

  return (
    <div
      ref={(el) => {
        box.current = el
        ref(el)
      }}
      className={`viewer-page${rendered ? '' : ' is-loading'}`}
      style={{ width, height }}
      aria-label={`Seite ${number}`}
    >
      <canvas ref={canvas} />
      <div ref={textBox} className="text-box" />
      <AnnotationLayer
        annotations={page.annotations ?? []}
        size={source.pages[page.index]}
        rotation={page.rotation}
        scale={scale}
        interaction={interaction}
      />
    </div>
  )
}

/** Turns the current text selection into one highlight per touched page. */
function highlightSelection(pages: Page[], sources: Sources, elements: Map<string, HTMLDivElement>, markup: Markup) {
  const selection = getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  const clientRects = [...selection.getRangeAt(0).getClientRects()]
  for (const page of pages) {
    const el = elements.get(page.id)
    if (!el) continue
    const box = el.getBoundingClientRect()
    const size = sources[page.sourceId].pages[page.index]
    // Pages may be scaled individually, so derive the scale from this page's box.
    const scale = box.width / rotatedSize(size, page.rotation).width
    const rects: Rect[] = []
    for (const c of clientRects) {
      const cx = c.left + c.width / 2
      const cy = c.top + c.height / 2
      // Element boxes in the range (like the text layer's end marker) are not text.
      if (cx < box.left || cx > box.right || cy < box.top || cy > box.bottom || c.height > box.height * 0.15) continue
      const a = toPageSpace([(c.left - box.left) / scale, (c.top - box.top) / scale], size, page.rotation)
      const b = toPageSpace([(c.right - box.left) / scale, (c.bottom - box.top) / scale], size, page.rotation)
      rects.push(rectOf(a, b))
    }
    const merged = mergeLineRects(rects)
    if (merged.length) markup.onAdd(page.id, { id: newId(), type: 'highlight', color: markup.highlightColor, rects: merged })
  }
  selection.removeAllRanges()
}

function rectOf(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}
