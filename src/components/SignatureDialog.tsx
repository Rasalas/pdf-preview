import { useEffect, useRef, useState } from 'react'
import { newId } from '../model/ids'
import { SIGNATURE_INK } from '../model/signatures'
import type { Point } from '../model/types'
import { nibPaths, type Signature } from './AnnotationLayer'
import { Icon } from './icons'

const INKS = [
  { color: SIGNATURE_INK, label: 'Schwarz' },
  { color: '#1e3a8a', label: 'Dunkelblau' },
  { color: '#2b5fd9', label: 'Königsblau' },
]

interface Props {
  onSave: (s: Signature) => void
  onClose: () => void
}

export function SignatureDialog({ onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pad = useRef<SVGSVGElement>(null)
  const [paths, setPaths] = useState<Point[][]>([])
  const [pressures, setPressures] = useState<number[][]>([])
  const [color, setColor] = useState(SIGNATURE_INK)
  const drawing = useRef(false)
  const last = useRef({ point: [0, 0] as Point, time: 0, pressure: 0.5 })

  // A stylus gives its pressure; otherwise speed stands in for it, like a fountain pen: slow is full, fast is thin.
  // Measured here, against time, so the signature looks the same at any size it is placed at.
  const pressureAt = (e: React.PointerEvent, point: Point, first: boolean) => {
    if (e.pointerType === 'pen' && e.pressure > 0) return e.pressure
    if (first) return 0.5
    const { point: [x, y], time, pressure } = last.current
    const speed = Math.hypot(point[0] - x, point[1] - y) / Math.max(1, e.timeStamp - time)
    return pressure * 0.7 + (0.25 + 0.7 * Math.exp(-speed / 1.2)) * 0.3
  }

  useEffect(() => {
    dialog.current!.showModal()
  }, [])

  const pointAt = (e: { clientX: number; clientY: number }): Point => {
    const r = pad.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const save = () => {
    const points = paths.flat()
    const minX = Math.min(...points.map((p) => p[0]))
    const minY = Math.min(...points.map((p) => p[1]))
    const w = Math.max(...points.map((p) => p[0])) - minX
    const h = Math.max(...points.map((p) => p[1])) - minY
    onSave({ id: newId(), w: Math.max(w, 1), h: Math.max(h, 1), paths: paths.map((path) => path.map(([x, y]): Point => [x - minX, y - minY])), pressures, color })
  }

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} aria-labelledby="signature-title">
      <h2 id="signature-title">Neue Unterschrift</h2>
      <p>Unterschreibe mit Maus, Trackpad, Stift oder Finger auf der Linie.</p>
      <svg
        ref={pad}
        className="signature-pad"
        onPointerDown={(e) => {
          drawing.current = true
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // Not fatal: strokes leaving the pad just end early.
          }
          const pt = pointAt(e)
          const pressure = pressureAt(e, pt, true)
          last.current = { point: pt, time: e.timeStamp, pressure }
          setPaths((p) => [...p, [pt]])
          setPressures((p) => [...p, [pressure]])
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const pt = pointAt(e)
          const pressure = pressureAt(e, pt, false)
          last.current = { point: pt, time: e.timeStamp, pressure }
          setPaths((p) => [...p.slice(0, -1), [...p.at(-1)!, pt]])
          setPressures((p) => [...p.slice(0, -1), [...p.at(-1)!, pressure]])
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      >
        <line className="signature-baseline" x1="4%" x2="96%" y1="75%" y2="75%" />
        <path d={nibPaths(paths, 2.2, pressures)} fill={color} />
      </svg>
      <div className="signature-inks" role="radiogroup" aria-label="Tintenfarbe">
        {INKS.map((ink) => (
          <button
            key={ink.color}
            className={`swatch${color === ink.color ? ' is-active' : ''}`}
            style={{ background: ink.color }}
            role="radio"
            aria-checked={color === ink.color}
            aria-label={ink.label}
            title={ink.label}
            onClick={() => setColor(ink.color)}
          />
        ))}
        <span>Tintenfarbe, später beim Platzieren änderbar</span>
      </div>
      <div className="dialog-actions">
        <button
          className="button is-quiet"
          onClick={() => {
            setPaths([])
            setPressures([])
          }}
          disabled={!paths.length}
        >
          <Icon name="erase" width={15} />
          Löschen
        </button>
        <span />
        <button className="button" onClick={() => dialog.current!.close()}>
          <Icon name="close" width={15} />
          Abbrechen
        </button>
        <button className="button is-primary" disabled={!paths.length} onClick={save}>
          <Icon name="check" width={15} />
          Sichern
        </button>
      </div>
    </dialog>
  )
}
