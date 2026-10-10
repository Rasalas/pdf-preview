import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { rotatedSize } from '../model/pages'
import type { Page, Sources } from '../model/types'
import { renderPage } from '../pdf/pdfjs'

export type Zoom = 'fit' | number

const PX_PER_PT = 96 / 72
const GAP = 16
const PADDING = 24

interface Props {
  pages: Page[]
  sources: Sources
  zoom: Zoom
  current: string | null
  selection: ReadonlySet<string>
  /** Incremented to scroll `current` into view. */
  scrollRequest: number
  onScrolledTo: (id: string) => void
  onScale: (scale: number) => void
}

export function Viewer({ pages, sources, zoom, current, selection, scrollRequest, onScrolledTo, onScale }: Props) {
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
  const scale = zoom === 'fit' ? Math.max(0.1, Math.min(1, (width - 2 * PADDING) / (widest * PX_PER_PT))) : zoom
  useEffect(() => onScale(scale), [scale, onScale])

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
    scroller.current!.scrollTop = el.offsetTop - PADDING
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest])

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

  return (
    <div className="viewer" ref={scroller} onScroll={onScroll} tabIndex={-1}>
      <div className="viewer-pages" style={{ padding: PADDING, gap: GAP }}>
        {pages.map((page, i) => {
          const size = rotatedSize(sources[page.sourceId].pages[page.index], page.rotation)
          return (
            <ViewerPage
              key={page.id}
              page={page}
              sources={sources}
              number={i + 1}
              width={Math.round(size.width * scale * PX_PER_PT)}
              height={Math.round(size.height * scale * PX_PER_PT)}
              selected={selection.has(page.id) && selection.size > 1}
              root={scroller}
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
  selected: boolean
  root: React.RefObject<HTMLDivElement | null>
  ref: (el: HTMLDivElement | null) => void
}

function ViewerPage({ page, sources, number, width, height, selected, root, ref }: PageProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [rendered, setRendered] = useState(false)

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
      setRendered(false)
      return
    }
    const ctrl = new AbortController()
    // Debounced so that zooming with repeated key presses renders once.
    const t = setTimeout(() => {
      renderPage(c, source, page.index, page.rotation, width, ctrl.signal)
        .then(() => !ctrl.signal.aborted && setRendered(true))
        .catch((e) => console.error('Seite konnte nicht gezeichnet werden', e))
    }, rendered ? 120 : 0)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, source, page.index, page.rotation, width])

  return (
    <div
      ref={(el) => {
        box.current = el
        ref(el)
      }}
      className={`viewer-page${selected ? ' is-selected' : ''}${rendered ? '' : ' is-loading'}`}
      style={{ width, height }}
      aria-label={`Seite ${number}`}
    >
      <canvas ref={canvas} />
    </div>
  )
}
