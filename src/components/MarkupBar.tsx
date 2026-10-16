import { useState } from 'react'
import { nibPaths, type MarkupStyle, type Signature, type Tool } from './AnnotationLayer'
import { Icon, type IconName } from './icons'

export const COLORS = ['#e5383b', '#f28c28', '#f5c400', '#2fa84f', '#2b7de9', '#8a4fd8', '#1d1d1b']
export const HIGHLIGHT_COLORS = ['#ffd400', '#7ee36a', '#7cc7ff', '#ff8fc7', '#c9a8ff']
const WIDTHS = [1, 2, 4]
const SIZES = [10, 12, 14, 18, 24, 36]

const TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'select', icon: 'cursor', label: 'Auswählen (Text und Markierungen)' },
  { tool: 'highlight', icon: 'marker', label: 'Text hervorheben' },
  { tool: 'ink', icon: 'pen', label: 'Zeichnen' },
  { tool: 'nib', icon: 'nib', label: 'Füller (dünn bei schnellen Strichen, mit Stift nach Druck)' },
  { tool: 'rect', icon: 'square', label: 'Rechteck' },
  { tool: 'ellipse', icon: 'circle', label: 'Oval' },
  { tool: 'line', icon: 'line', label: 'Linie' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil' },
  { tool: 'text', icon: 'text', label: 'Text' },
]

interface Props {
  tool: Tool
  style: MarkupStyle
  highlightColor: string
  /** Kind of the selected annotation, so the bar shows the settings that apply to it. */
  selectedKind: 'highlight' | 'text' | 'shape' | null
  signatures: Signature[]
  signature: Signature | null
  onTool: (tool: Tool) => void
  onStyle: (patch: Partial<MarkupStyle>) => void
  onHighlightColor: (color: string) => void
  onSignature: (s: Signature) => void
  onNewSignature: () => void
  onImportSignatures: () => void
  onExportSignatures: () => void
  onDeleteSignature: (id: string) => void
  /** Touch layout: two rows at the bottom of the screen with a done button. */
  compact?: boolean
  onDone?: () => void
}

export function MarkupBar(p: Props) {
  const [signatureMenu, setSignatureMenu] = useState(false)
  const highlightMode = p.selectedKind === 'highlight' || (p.selectedKind === null && p.tool === 'highlight')
  const textMode = p.selectedKind === 'text' || (p.selectedKind === null && p.tool === 'text')

  return (
    <div className={`markup-bar${p.compact ? ' is-compact' : ''}`} role="toolbar" aria-label="Markierungswerkzeuge">
      <div className="toolbar-group markup-tools">
        {TOOLS.map((t) => (
          <button key={t.tool} className="tool" title={t.label} aria-label={t.label} aria-pressed={p.tool === t.tool} onClick={() => p.onTool(t.tool)}>
            <Icon name={t.icon} />
          </button>
        ))}
        <div className="signature-picker">
          <button
            className="tool"
            title="Unterschrift"
            aria-label="Unterschrift"
            aria-pressed={p.tool === 'signature'}
            aria-haspopup="menu"
            onClick={() => setSignatureMenu((o) => !o)}
          >
            <Icon name="signature" />
          </button>
          {signatureMenu ? (
            <div className="signature-menu" role="menu" onMouseLeave={() => setSignatureMenu(false)}>
              {p.signatures.map((s) => (
                <div key={s.id} className="signature-item">
                  <button
                    role="menuitem"
                    aria-label="Diese Unterschrift platzieren"
                    onClick={() => {
                      p.onSignature(s)
                      setSignatureMenu(false)
                    }}
                  >
                    <svg viewBox={`-4 -4 ${s.w + 8} ${s.h + 8}`} height="44">
                      {s.image ? (
                        <image href={s.image} width={s.w} height={s.h} />
                      ) : (
                        <path d={nibPaths(s.paths, Math.max(s.w, s.h) / 100, s.pressures)} fill={s.color ?? 'currentColor'} />
                      )}
                    </svg>
                  </button>
                  <button className="signature-delete" aria-label="Unterschrift löschen" onClick={() => p.onDeleteSignature(s.id)}>
                    <Icon name="close" width={12} height={12} />
                  </button>
                </div>
              ))}
              <button
                className="signature-new"
                role="menuitem"
                onClick={() => {
                  setSignatureMenu(false)
                  p.onNewSignature()
                }}
              >
                Neue Unterschrift …
              </button>
              <div className="signature-transfer">
                <button
                  role="menuitem"
                  title="Unterschriften-Datei (JSON) oder Bild einer Unterschrift (PNG, JPEG)"
                  onClick={() => {
                    setSignatureMenu(false)
                    p.onImportSignatures()
                  }}
                >
                  <Icon name="import" width={14} />
                  Importieren …
                </button>
                <button
                  role="menuitem"
                  disabled={!p.signatures.length}
                  title="Als Datei sichern, etwa für einen anderen Browser oder ein anderes Gerät"
                  onClick={() => {
                    setSignatureMenu(false)
                    p.onExportSignatures()
                  }}
                >
                  <Icon name="export" width={14} />
                  Exportieren …
                </button>
              </div>
              <p className="signature-note">Unterschriften werden nur in diesem Browser gespeichert. Mit „Exportieren“ nimmst du sie in einen anderen mit.</p>
            </div>
          ) : null}
        </div>
      </div>

      {p.compact ? null : <div className="markup-sep" />}

      <div className="markup-style">
      <div className="swatches" role="radiogroup" aria-label="Farbe">
        {(highlightMode ? HIGHLIGHT_COLORS : COLORS).map((c) => {
          const active = highlightMode ? p.highlightColor === c : p.style.color === c
          return (
            <button
              key={c}
              className={`swatch${active ? ' is-active' : ''}`}
              style={{ background: c }}
              role="radio"
              aria-checked={active}
              aria-label={`Farbe ${c}`}
              onClick={() => (highlightMode ? p.onHighlightColor(c) : p.onStyle({ color: c }))}
            />
          )
        })}
      </div>

      {highlightMode ? null : (
        <>
          <div className="markup-sep" />
          {textMode ? (
            <label className="size-select">
              <span>Größe</span>
              <select value={p.style.size} onChange={(e) => p.onStyle({ size: Number(e.target.value) })}>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s} pt
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="widths" role="radiogroup" aria-label="Linienstärke">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  className={`width${p.style.width === w ? ' is-active' : ''}`}
                  role="radio"
                  aria-checked={p.style.width === w}
                  aria-label={`Linienstärke ${w} pt`}
                  onClick={() => p.onStyle({ width: w })}
                >
                  <span style={{ height: w + 1 }} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {p.compact ? (
        <button className="button is-primary markup-done" onClick={p.onDone}>
          <Icon name="check" width={15} />
          Fertig
        </button>
      ) : (
        <span className="markup-hint">{hint(p.tool, p.signature)}</span>
      )}
      </div>
    </div>
  )
}

function hint(tool: Tool, signature: Signature | null): string {
  switch (tool) {
    case 'select':
      return 'Markierung anklicken zum Bearbeiten, Doppelklick auf Text zum Ändern'
    case 'highlight':
      return 'Text auswählen, um ihn hervorzuheben'
    case 'ink':
      return 'Auf der Seite zeichnen'
    case 'nib':
      return 'Schreiben wie mit Füller: langsam dick, schnell dünn'
    case 'text':
      return 'Auf die Seite klicken und schreiben'
    case 'signature':
      return signature ? 'Auf die Seite klicken, um die Unterschrift zu platzieren' : ''
    default:
      return 'Auf der Seite ziehen'
  }
}
