import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  LINE_HEIGHT,
  TEXT_ASCENT,
  arrowHead,
  bounds,
  lineEnd,
  resize,
  rotationTransform,
  toPageSpace,
  translate,
  viewMatrix,
} from '../model/annotations'
import { visibleRect } from '../model/crop'
import type { FieldValues } from '../model/forms'
import { newId } from '../model/ids'
import { nibOutline } from '../model/nib'
import { SIGNATURE_INK, type Signature } from '../model/signatures'
import type { Annotation, PageSize, Point, Rect, Rotation, Sources } from '../model/types'
import { pageEntries } from '../pdf/forms'
import { thumbnailUrl } from '../pdf/pdfjs'

export type Tool = 'select' | 'highlight' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'ink' | 'nib' | 'text' | 'signature'

export interface MarkupStyle {
  color: string
  width: number
  size: number
}

export type { Signature } from '../model/signatures'

export interface Interaction {
  tool: Tool
  style: MarkupStyle
  highlightColor: string
  selectedId: string | null
  signature: Signature | null
  onSelect: (id: string | null) => void
  onAdd: (a: Annotation) => void
  onUpdate: (a: Annotation) => void
  onRemove: (id: string) => void
}

interface Props {
  annotations: Annotation[]
  size: PageSize
  rotation: Rotation
  /** CSS pixels per point. */
  scale: number
  interaction?: Interaction
}

/** What pages laid onto other pages are drawn from. */
export const PlacedPages = createContext<{ sources: Sources; fields: FieldValues }>({ sources: {}, fields: {} })

export const FONT = 'Helvetica, Arial, sans-serif'
const SIGNATURE_WIDTH = 160

let measureCtx: CanvasRenderingContext2D | null = null
export function measureText(text: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = `${size}px ${FONT}`
  return measureCtx.measureText(text).width
}

// Strokes and drags in progress; a second finger on the page cancels them (see Viewer).
const inProgress = new Set<() => void>()
export const cancelStrokes = () => inProgress.forEach((cancel) => cancel())

type Drag = { kind: 'move' | 'resize' | 'p1' | 'p2'; start: Point; original: Annotation; box: Rect }

export function AnnotationLayer({ annotations, size, rotation, scale, interaction }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [preview, setPreview] = useState<Annotation | null>(null)
  const [editing, setEditing] = useState<{ annotation: Annotation & { type: 'text' }; isNew: boolean } | null>(null)
  const tool = interaction?.tool ?? 'select'
  const drawing = interaction && tool !== 'select' && tool !== 'highlight'

  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = root.current!.getBoundingClientRect()
    return toPageSpace([(e.clientX - r.left) / scale, (e.clientY - r.top) / scale], size, rotation)
  }

  // Pointer moves are tracked on window so drags keep working outside the page. Only the pointer
  // that started counts, so a second finger cannot draw into the stroke.
  const track = (start: ReactPointerEvent, onMove: (p: Point, e: PointerEvent) => void, onEnd: (p: Point) => void, onCancel: () => void) => {
    const id = start.pointerId
    const move = (e: PointerEvent) => e.pointerId === id && onMove(pointAt(e), e)
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      stop()
      if (e.type === 'pointercancel') onCancel()
      else onEnd(pointAt(e))
    }
    const cancel = () => {
      stop()
      onCancel()
    }
    const stop = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      inProgress.delete(cancel)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    inProgress.add(cancel)
  }

  const startDrawing = (e: ReactPointerEvent) => {
    if (!interaction || !drawing || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const { style } = interaction
    const start = pointAt(e)
    const id = newId()

    if (tool === 'text') {
      if (editing) return
      const annotation = { id, type: 'text', color: style.color, size: style.size, x: start[0], y: start[1] - style.size * 0.6, text: '' } as const
      setEditing({ annotation, isNew: true })
      return
    }
    if (tool === 'signature') {
      const sig = interaction.signature
      if (!sig) return
      const k = SIGNATURE_WIDTH / sig.w
      const [ox, oy] = [start[0] - (sig.w * k) / 2, start[1] - (sig.h * k) / 2]
      if (sig.image) {
        interaction.onAdd({ id, type: 'image', src: sig.image, x: ox, y: oy, w: sig.w * k, h: sig.h * k })
        return
      }
      interaction.onAdd({
        id,
        type: 'ink',
        color: sig.color ?? SIGNATURE_INK,
        width: Math.max(1, style.width * 0.75),
        paths: sig.paths.map((path) => path.map(([x, y]): Point => [ox + x * k, oy + y * k])),
        nib: true,
        ...(sig.pressures ? { pressures: sig.pressures } : {}),
      })
      return
    }

    // Only a stylus reports real pressure; the fountain pen goes by speed otherwise.
    const pressureOf = (ev: { pointerType: string; pressure: number }) => (ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0)
    const pressure = pressureOf(e)
    const shape = (p: Point): Annotation => {
      switch (tool) {
        case 'rect':
        case 'ellipse':
          return { id, type: tool, color: style.color, width: style.width, ...normalize(start, p) }
        case 'line':
        case 'arrow':
          return { id, type: 'line', arrow: tool === 'arrow', color: style.color, width: style.width, p1: start, p2: p }
        case 'nib':
          return { id, type: 'ink', nib: true, color: style.color, width: style.width, paths: [[start]], ...(pressure ? { pressures: [[pressure]] } : {}) }
        default:
          return { id, type: 'ink', color: style.color, width: style.width, paths: [[start]] }
      }
    }
    let current = shape(start)
    setDraft(current)
    track(
      e,
      (p, ev) => {
        if (current.type === 'ink') {
          const path = current.paths[0]
          const last = path.at(-1)!
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) * scale < 1.5) return
          current = { ...current, paths: [[...path, p]] }
          if (current.pressures) current.pressures = [[...current.pressures[0], pressureOf(ev) || current.pressures[0].at(-1)!]]
        } else {
          current = shape(p)
        }
        setDraft(current)
      },
      () => {
        setDraft(null)
        interaction.onAdd(withMinimumSize(current))
      },
      () => setDraft(null),
    )
  }

  const startDrag = (e: ReactPointerEvent, a: Annotation, kind: Drag['kind']) => {
    if (!interaction || tool !== 'select' || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    interaction.onSelect(a.id)
    const drag: Drag = { kind, start: pointAt(e), original: a, box: bounds(a, measureText) }
    let result: Annotation = a
    track(
      e,
      (p) => {
        result = dragResult(drag, p)
        setPreview(result)
      },
      () => {
        setPreview(null)
        if (result !== a) interaction.onUpdate(result)
      },
      () => setPreview(null),
    )
  }

  const commitText = (text: string) => {
    if (!editing || !interaction) return
    const trimmed = text.replace(/\s+$/, '')
    const annotation = { ...editing.annotation, text: trimmed }
    setEditing(null)
    if (editing.isNew) {
      if (trimmed) interaction.onAdd(annotation)
    } else if (!trimmed) {
      interaction.onRemove(annotation.id)
    } else if (trimmed !== editing.annotation.text) {
      interaction.onUpdate(annotation)
    }
  }

  const shown = annotations.map((a) => (preview?.id === a.id ? preview : a)).filter((a) => a.id !== editing?.annotation.id)
  if (draft) shown.push(draft)
  const selected = interaction?.selectedId ? shown.find((a) => a.id === interaction.selectedId) : undefined
  const hitWidth = 10 / scale

  return (
    <div
      ref={root}
      className={`ann-layer${drawing ? ' is-drawing' : ''}${tool === 'text' ? ' is-text' : ''}`}
      style={{ width: size.width * scale, height: size.height * scale, transform: rotationTransform(size, rotation, scale) }}
      onPointerDown={startDrawing}
    >
      <svg viewBox={`0 0 ${size.width} ${size.height}`} width="100%" height="100%" aria-hidden="true">
        {shown.map((a) => (
          <g
            key={a.id}
            data-ann={a.id}
            className={interaction && tool === 'select' ? 'ann is-interactive' : 'ann'}
            onPointerDown={(e) => startDrag(e, a, 'move')}
            onDoubleClick={() => a.type === 'text' && interaction && setEditing({ annotation: a, isNew: false })}
          >
            <Shape a={a} />
            {interaction ? <HitArea a={a} hitWidth={hitWidth} /> : null}
          </g>
        ))}
        {selected && !draft ? <Handles a={selected} scale={scale} onDrag={startDrag} /> : null}
      </svg>
      {editing ? <TextEditor annotation={editing.annotation} scale={scale} onDone={commitText} /> : null}
    </div>
  )
}

function Shape({ a }: { a: Annotation }) {
  switch (a.type) {
    case 'highlight':
      return (
        <g className="ann-highlight" fill={a.color}>
          {a.rects.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} />
          ))}
        </g>
      )
    case 'rect':
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="none" stroke={a.color} strokeWidth={a.width} />
    case 'ellipse':
      return <ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} fill="none" stroke={a.color} strokeWidth={a.width} />
    case 'line': {
      const end = a.arrow ? lineEnd(a.p1, a.p2, a.width) : a.p2
      return (
        <g>
          <line x1={a.p1[0]} y1={a.p1[1]} x2={end[0]} y2={end[1]} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
          {a.arrow ? <polygon points={arrowHead(a.p1, a.p2, a.width).join(' ')} fill={a.color} /> : null}
        </g>
      )
    }
    case 'ink':
      if (a.nib) return <path d={nibPath(a)} fill={a.color} />
      return <path d={inkPath(a.paths)} fill="none" stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
    case 'text':
      return (
        <text fill={a.color} fontSize={a.size} fontFamily={FONT} xmlSpace="preserve" style={{ whiteSpace: 'pre' }}>
          {a.text.split('\n').map((line, i) => (
            <tspan key={i} x={a.x} y={a.y + a.size * (TEXT_ASCENT + i * LINE_HEIGHT)}>
              {line}
            </tspan>
          ))}
        </text>
      )
    case 'page':
      return <PlacedPage a={a} />
    case 'image':
      return <image href={a.src} x={a.x} y={a.y} width={a.w} height={a.h} preserveAspectRatio="none" />
  }
}

function PlacedPage({ a }: { a: Annotation & { type: 'page' } }) {
  const { sources, fields } = useContext(PlacedPages)
  const { page } = a
  const source = sources[page.sourceId]
  const entered = fields[page.sourceId]
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!source || source.kind === 'blank') return
    let live = true
    const size = source.pages[page.index]
    pageEntries(source, page.index, entered)
      .catch(() => null)
      .then((entries) => thumbnailUrl(source, page.index, 0, Math.min(1600, Math.round(size.width * 2)), entries))
      .then((u) => live && setUrl(u))
      .catch((e) => console.error('Aufgelegte Seite fehlgeschlagen', e))
    return () => {
      live = false
    }
  }, [source, page.index, entered])
  if (!source) return null
  const size = source.pages[page.index]
  const view = visibleRect(size, page)
  return (
    <svg className="ann-placed" x={a.x} y={a.y} width={a.w} height={a.h} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="none">
      <g transform={`matrix(${viewMatrix(size, page.rotation).join(' ')})`}>
        {url ? <image href={url} width={size.width} height={size.height} preserveAspectRatio="none" /> : null}
        {page.annotations?.map((n) => <Shape key={n.id} a={n} />)}
      </g>
    </svg>
  )
}

/** Invisible, wider copies of thin shapes so they are easy to click. */
function HitArea({ a, hitWidth }: { a: Annotation; hitWidth: number }) {
  const common = { fill: 'none', stroke: 'transparent', pointerEvents: 'stroke' as const }
  switch (a.type) {
    case 'rect':
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} {...common} strokeWidth={a.width + hitWidth} />
    case 'ellipse':
      return <ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} {...common} strokeWidth={a.width + hitWidth} />
    case 'line':
      return <line x1={a.p1[0]} y1={a.p1[1]} x2={a.p2[0]} y2={a.p2[1]} {...common} strokeWidth={a.width + hitWidth} />
    case 'ink':
      return <path d={inkPath(a.paths)} {...common} strokeWidth={a.width + hitWidth} strokeLinecap="round" />
    case 'text':
    case 'page':
    case 'image': {
      const b = bounds(a, measureText)
      return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" pointerEvents="fill" />
    }
    case 'highlight':
      return null
  }
}

function Handles({ a, scale, onDrag }: { a: Annotation; scale: number; onDrag: (e: ReactPointerEvent, a: Annotation, kind: Drag['kind']) => void }) {
  const b = bounds(a, measureText)
  const pad = 4 / scale
  const handle = 9 / scale
  const dot = (p: Point, kind: Drag['kind']) => (
    <rect
      className={`ann-handle${kind === 'resize' ? ' is-resize' : ''}`}
      x={p[0] - handle / 2}
      y={p[1] - handle / 2}
      width={handle}
      height={handle}
      rx={kind === 'resize' ? 1.5 / scale : handle / 2}
      strokeWidth={1.5 / scale}
      onPointerDown={(e) => onDrag(e, a, kind)}
    />
  )
  return (
    <g className="ann-selection">
      {a.type === 'line' ? null : (
        <rect x={b.x - pad} y={b.y - pad} width={b.w + 2 * pad} height={b.h + 2 * pad} fill="none" strokeWidth={1 / scale} strokeDasharray={`${4 / scale} ${3 / scale}`} />
      )}
      {a.type === 'line' ? (
        <>
          {dot(a.p1, 'p1')}
          {dot(a.p2, 'p2')}
        </>
      ) : a.type === 'highlight' ? null : (
        dot([b.x + b.w + pad, b.y + b.h + pad], 'resize')
      )}
    </g>
  )
}

function TextEditor({ annotation: a, scale, onDone }: { annotation: Annotation & { type: 'text' }; scale: number; onDone: (text: string) => void }) {
  const [text, setText] = useState(a.text)
  const el = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    el.current!.focus()
    el.current!.select()
  }, [])
  const lines = text.split('\n')
  const width = Math.max(a.size * 4, ...lines.map((l) => measureText(l, a.size))) + a.size
  return (
    <textarea
      ref={el}
      className="ann-text-editor"
      value={text}
      spellCheck={false}
      style={{
        left: a.x * scale,
        top: a.y * scale,
        width: width * scale,
        height: lines.length * a.size * LINE_HEIGHT * scale,
        fontSize: a.size * scale,
        lineHeight: LINE_HEIGHT,
        color: a.color,
        fontFamily: FONT,
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function dragResult(drag: Drag, p: Point): Annotation {
  const dx = p[0] - drag.start[0]
  const dy = p[1] - drag.start[1]
  const a = drag.original
  if (drag.kind === 'move') return translate(a, dx, dy)
  if (a.type === 'line' && drag.kind !== 'resize') {
    return drag.kind === 'p1' ? { ...a, p1: p } : { ...a, p2: p }
  }
  const { box } = drag
  let w = Math.max(4, box.w + dx)
  let h = Math.max(4, box.h + dy)
  // Text, signatures, pictures and laid-on pages keep their proportions.
  if (a.type === 'text' || a.type === 'ink' || a.type === 'page' || a.type === 'image') {
    const k = Math.max(w / Math.max(box.w, 1), h / Math.max(box.h, 1))
    w = box.w * k
    h = box.h * k
  }
  return resize(a, box, { x: box.x, y: box.y, w, h })
}

function normalize(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}

/** A click without dragging still creates a usefully sized shape. */
function withMinimumSize(a: Annotation): Annotation {
  if ((a.type === 'rect' || a.type === 'ellipse') && a.w < 4 && a.h < 4) return { ...a, w: 120, h: 80 }
  if (a.type === 'line' && Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]) < 4) {
    return { ...a, p2: [a.p1[0] + 100, a.p1[1]] }
  }
  return a
}

function nibPath(a: Annotation & { type: 'ink' }): string {
  return nibPaths(a.paths, a.width, a.pressures)
}

/** SVG path data of fountain-pen strokes, to be filled. */
export function nibPaths(paths: Point[][], width: number, pressures?: number[][]): string {
  return paths
    .map((path, i) => nibOutline(path, width, pressures?.[i]))
    .filter((o) => o.length)
    .map((o) => `M${o.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`)
    .join('')
}

export function inkPath(paths: Point[][]): string {
  return paths
    .filter((p) => p.length)
    .map((p) => {
      const points = p.length === 1 ? [p[0], p[0]] : p
      return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}`
    })
    .join('')
}
