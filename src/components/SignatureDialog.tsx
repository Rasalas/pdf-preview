import { useEffect, useRef, useState } from 'react'
import { newId } from '../model/ids'
import type { Point } from '../model/types'
import { inkPath, type Signature } from './AnnotationLayer'

interface Props {
  onSave: (s: Signature) => void
  onClose: () => void
}

export function SignatureDialog({ onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pad = useRef<SVGSVGElement>(null)
  const [paths, setPaths] = useState<Point[][]>([])
  const drawing = useRef(false)

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
    onSave({ id: newId(), w: Math.max(w, 1), h: Math.max(h, 1), paths: paths.map((path) => path.map(([x, y]): Point => [x - minX, y - minY])) })
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
          setPaths((p) => [...p, [pointAt(e)]])
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const pt = pointAt(e)
          setPaths((p) => [...p.slice(0, -1), [...p.at(-1)!, pt]])
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      >
        <line className="signature-baseline" x1="4%" x2="96%" y1="75%" y2="75%" />
        <path d={inkPath(paths)} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="dialog-actions">
        <button className="button is-quiet" onClick={() => setPaths([])} disabled={!paths.length}>
          Löschen
        </button>
        <span />
        <button className="button" onClick={() => dialog.current!.close()}>
          Abbrechen
        </button>
        <button className="button is-primary" disabled={!paths.length} onClick={save}>
          Sichern
        </button>
      </div>
    </dialog>
  )
}
