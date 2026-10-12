import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { dragCrop, sourceRect, viewRect, type CropHandle } from '../model/crop'
import { rotatedSize } from '../model/pages'
import type { PageSize, Rect, Rotation } from '../model/types'

type Edge = Exclude<CropHandle, 'move'>

/** `fx` and `fy` place a handle on the rectangle: 0 is left or top, 1 right or bottom. */
const HANDLES: { id: Edge; fx: number; fy: number; label: string }[] = [
  { id: 'n', fx: 0.5, fy: 0, label: 'Oberer Rand' },
  { id: 's', fx: 0.5, fy: 1, label: 'Unterer Rand' },
  { id: 'w', fx: 0, fy: 0.5, label: 'Linker Rand' },
  { id: 'e', fx: 1, fy: 0.5, label: 'Rechter Rand' },
  { id: 'nw', fx: 0, fy: 0, label: 'Ecke oben links' },
  { id: 'ne', fx: 1, fy: 0, label: 'Ecke oben rechts' },
  { id: 'sw', fx: 0, fy: 1, label: 'Ecke unten links' },
  { id: 'se', fx: 1, fy: 1, label: 'Ecke unten rechts' },
]

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

interface OverlayProps {
  /** The page's own size, as in its source. */
  size: PageSize
  rotation: Rotation
  /** CSS pixels per point. */
  scale: number
  /** The crop in page space, so that it survives a rotation while editing. */
  draft: Rect
  onChange: (draft: Rect) => void
}

/** Dims what the crop leaves out and offers handles to move and resize it. Covers the whole page. */
export function CropOverlay({ size, rotation, scale, draft, onChange }: OverlayProps) {
  const bounds = rotatedSize(size, rotation)
  const view = viewRect(draft, size, rotation)
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: Rect } | null>(null)
  const change = (r: Rect) => onChange(sourceRect(r, size, rotation))

  const down = (handle: CropHandle) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Without capture the drag still works while the pointer stays over the handle.
    }
    drag.current = { handle, x: e.clientX, y: e.clientY, start: view }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (d) change(dragCrop(d.start, d.handle, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale, bounds))
  }
  const end = () => {
    drag.current = null
  }
  const key = (handle: Edge) => (e: KeyboardEvent) => {
    const arrow = ARROWS[e.key]
    if (!arrow || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    change(dragCrop(view, handle, arrow[0] * step, arrow[1] * step, bounds))
  }
  const pointer = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  return (
    <div className="crop-overlay" role="group" aria-label="Beschnittbereich">
      <div className="crop-dim">
        <div
          className="crop-rect"
          style={{ left: view.x * scale, top: view.y * scale, width: view.w * scale, height: view.h * scale }}
          onPointerDown={down('move')}
          {...pointer}
        />
      </div>
      {HANDLES.map(({ id, fx, fy, label }) => (
        <button
          key={id}
          type="button"
          className={`crop-handle is-${id}`}
          aria-label={label}
          aria-description="Mit den Pfeiltasten verschieben, mit Umschalt in größeren Schritten"
          style={handleStyle((view.x + fx * view.w) * scale, (view.y + fy * view.h) * scale, fx, fy)}
          onPointerDown={down(id)}
          onKeyDown={key(id)}
          {...pointer}
        />
      ))}
    </div>
  )
}

/** On touch screens the handles move inwards (--crop-inset), so their large touch areas stay inside the page. */
function handleStyle(x: number, y: number, fx: number, fy: number): CSSProperties {
  const inward = (f: number) => (f === 0 ? 1 : f === 1 ? -1 : 0)
  return { left: `calc(${x}px + ${inward(fx)} * var(--crop-inset))`, top: `calc(${y}px + ${inward(fy)} * var(--crop-inset))` }
}

interface BarProps {
  /** The pages the crop can apply to, this one included. */
  count: number
  /** The page already has a crop. */
  hasCrop: boolean
  onApply: (all: boolean) => void
  onReset: (all: boolean) => void
  onCancel: () => void
}

/** Apply, cancel and reset for the crop in progress. Return applies, Escape cancels. */
export function CropBar({ count, hasCrop, onApply, onReset, onCancel }: BarProps) {
  const [all, setAll] = useState(false)
  const everyone = count > 1 && all

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.defaultPrevented || e.isComposing || (target.closest('input, textarea, select') && !target.closest('.crop-bar'))) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter' && !target.closest('button:not(.crop-handle)')) {
        e.preventDefault()
        onApply(everyone)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  return (
    <div className="crop-bar" role="toolbar" aria-label="Beschneiden">
      {count > 1 ? (
        <label className="crop-all">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Auf alle {count} ausgewählten Seiten anwenden
        </label>
      ) : null}
      <div className="crop-actions">
        {hasCrop ? (
          <button className="button is-quiet" onClick={() => onReset(everyone)}>
            Zurücksetzen
          </button>
        ) : null}
        <button className="button" onClick={onCancel}>
          Abbrechen
        </button>
        <button className="button is-primary" onClick={() => onApply(everyone)}>
          Beschneiden
        </button>
      </div>
    </div>
  )
}
