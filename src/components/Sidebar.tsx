import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { rotatedSize } from '../model/pages'
import type { Page, Sources } from '../model/types'
import { thumbnailUrl } from '../pdf/pdfjs'
import { AnnotationLayer } from './AnnotationLayer'

export const PAGES_MIME = 'application/x-vorschau-pages'

interface Props {
  pages: Page[]
  sources: Sources
  selection: ReadonlySet<string>
  current: string | null
  width: number
  onSelect: (id: string, mode: 'single' | 'toggle' | 'range') => void
  onMove: (gap: number) => void
  onDropFiles: (files: File[], gap: number) => void
  onContextMenu: (e: MouseEvent, id: string) => void
  onKeyDown: (e: KeyboardEvent) => void
  /** Search hits per page id, or null when not searching. */
  hits: ReadonlyMap<string, number> | null
}

export function Sidebar({ pages, sources, selection, current, width, onSelect, onMove, onDropFiles, onContextMenu, onKeyDown, hits }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const [gap, setGap] = useState<number | null>(null)
  const thumbWidth = width - 56

  useEffect(() => {
    if (!current) return
    list.current?.querySelector<HTMLElement>(`[data-id="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const gapAt = (clientY: number) => {
    const items = [...list.current!.querySelectorAll<HTMLElement>('.thumb')]
    const i = items.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return clientY < r.top + r.height / 2
    })
    return i < 0 ? items.length : i
  }

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(PAGES_MIME) || e.dataTransfer.types.includes('Files')

  const onDragOver = (e: DragEvent) => {
    if (!accepts(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(PAGES_MIME) ? 'move' : 'copy'
    setGap(gapAt(e.clientY))
    autoScroll(list.current!, e.clientY)
  }

  const onDrop = (e: DragEvent) => {
    if (!accepts(e)) return
    e.preventDefault()
    e.stopPropagation()
    const at = gapAt(e.clientY)
    setGap(null)
    if (e.dataTransfer.types.includes(PAGES_MIME)) onMove(at)
    else onDropFiles([...e.dataTransfer.files], at)
  }

  return (
    <div
      ref={list}
      className="sidebar-list"
      role="listbox"
      aria-label="Seiten"
      aria-multiselectable="true"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!list.current!.contains(e.relatedTarget as Node)) setGap(null)
      }}
      onDrop={onDrop}
    >
      {pages.map((page, i) => (
        <Thumb
          key={page.id}
          page={page}
          sources={sources}
          number={i + 1}
          width={thumbWidth}
          selected={selection.has(page.id)}
          current={page.id === current}
          hits={hits?.get(page.id) ?? (hits ? 0 : null)}
          gapBefore={gap === i}
          gapAfter={gap === pages.length && i === pages.length - 1}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          onDragEnd={() => setGap(null)}
          root={list}
        />
      ))}
    </div>
  )
}

function autoScroll(el: HTMLElement, y: number) {
  const r = el.getBoundingClientRect()
  const edge = 48
  if (y < r.top + edge) el.scrollTop -= 12
  else if (y > r.bottom - edge) el.scrollTop += 12
}

interface ThumbProps {
  page: Page
  sources: Sources
  number: number
  width: number
  selected: boolean
  current: boolean
  hits: number | null
  gapBefore: boolean
  gapAfter: boolean
  onSelect: Props['onSelect']
  onContextMenu: Props['onContextMenu']
  onDragEnd: () => void
  root: React.RefObject<HTMLDivElement | null>
}

function Thumb({ page, sources, number, width, selected, current, hits, gapBefore, gapAfter, onSelect, onContextMenu, onDragEnd, root }: ThumbProps) {
  const el = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const source = sources[page.sourceId]
  const size = rotatedSize(source.pages[page.index], page.rotation)
  // Few distinct render widths, so resizing the sidebar mostly reuses cached thumbnails.
  const renderWidth = Math.ceil(width / 80) * 80
  const boxW = size.width >= size.height ? width : (width * size.width) / size.height
  const boxH = (boxW * size.height) / size.width

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      root: root.current,
      rootMargin: '400px 0px',
    })
    io.observe(el.current!)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let live = true
    thumbnailUrl(source, page.index, page.rotation, renderWidth)
      .then((u) => live && setUrl(u))
      .catch((e) => console.error('Miniatur fehlgeschlagen', e))
    return () => {
      live = false
    }
  }, [visible, source, page.index, page.rotation, renderWidth])

  return (
    <div
      ref={el}
      data-id={page.id}
      className={`thumb${selected ? ' is-selected' : ''}${current ? ' is-current' : ''}${hits === 0 ? ' is-dimmed' : ''}${gapBefore ? ' gap-before' : ''}${gapAfter ? ' gap-after' : ''}`}
      role="option"
      aria-selected={selected}
      aria-label={`Seite ${number}`}
      draggable
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single'
        // A plain click on a selected page may start dragging the whole selection.
        if (mode === 'single' && selected) return
        onSelect(page.id, mode)
      }}
      onClick={(e) => {
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey && selected) onSelect(page.id, 'single')
      }}
      onContextMenu={(e) => onContextMenu(e, page.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData(PAGES_MIME, page.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={onDragEnd}
    >
      <div className="thumb-frame" style={{ width: boxW, height: boxH }}>
        {url ? <img src={url} alt="" draggable={false} /> : null}
        {page.annotations?.length ? (
          <AnnotationLayer annotations={page.annotations} size={source.pages[page.index]} rotation={page.rotation} scale={boxW / size.width} />
        ) : null}
        {hits ? <span className="thumb-hits" aria-label={`${hits} Treffer`}>{hits}</span> : null}
      </div>
      <span className="thumb-number">{number}</span>
    </div>
  )
}
