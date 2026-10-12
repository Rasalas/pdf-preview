import { useId, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { rotationTransform } from '../model/annotations'
import {
  click,
  fontSizeOf,
  isChecked,
  listOf,
  textOf,
  toStore,
  type CheckWidget,
  type ChoiceWidget,
  type Entered,
  type FieldValue,
  type FontFamily,
  type TextWidget,
  type Widget,
} from '../model/forms'
import type { Rotation } from '../model/types'
import type { PageForm } from '../pdf/forms'
import { FONT } from './AnnotationLayer'

interface Props {
  form: PageForm
  /** What pdf.js drew for widgets: read-only fields, buttons, and the states of checkboxes and radio buttons. */
  canvases: Map<string, HTMLCanvasElement[]>
  /** Keeps the radio groups of different pages apart; the browser would treat equal names as one group. */
  scope: string
  /** The user's rotation, on top of the page's own. */
  rotation: Rotation
  /** CSS pixels per point. */
  scale: number
  entered: Entered
  /** Fields only take input while no markup tool is in use. */
  active: boolean
  onChange: (name: string, value: FieldValue | null) => void
}

const FAMILIES: Record<FontFamily, string> = {
  sans: FONT,
  serif: "'Times New Roman', Times, serif",
  mono: "'Courier New', Courier, monospace",
}

const TYPED = new Set(['text', 'password'])
const CONTROLS = '.form-layer .form-widget:not(.is-readonly) :is(input, textarea, select)'

/**
 * HTML inputs over a page, laid out in the page's own unrotated space and turned with it,
 * like the markup layer, so they line up at every zoom level and rotation.
 */
export function FormLayer({ form, canvases, scope, rotation, scale, entered, active, onChange }: Props) {
  const turn = ((form.rotate + rotation) % 360) as Rotation
  const { raw } = form
  return (
    <div
      className="form-layer"
      inert={!active}
      style={{ width: raw.width * scale, height: raw.height * scale, transform: rotationTransform(raw, turn, scale) }}
    >
      {form.widgets.map((w) => (
        <Field
          key={w.id}
          w={w}
          canvases={canvases.get(w.id)}
          scope={scope}
          scale={scale}
          entered={entered}
          onChange={(value) => onChange(w.name, toStore(w, value))}
        />
      ))}
    </div>
  )
}

interface FieldProps {
  w: Widget
  canvases: HTMLCanvasElement[] | undefined
  scope: string
  scale: number
  entered: Entered
  onChange: (value: FieldValue) => void
}

function Field({ w, canvases, scope, scale, entered, onChange }: FieldProps) {
  const { rect } = w
  const checkable = w.type === 'checkbox' || w.type === 'radio'
  const on = checkable && isChecked(w, entered)
  // Without a drawn check mark in the checked state, fall back to a glyph.
  const bare = checkable && !canvases?.some((c) => c.dataset.canvasName === 'checked')
  return (
    <div
      className={`form-widget${canvases ? ' has-canvas' : ''}${bare ? ' is-bare' : ''}${w.readOnly ? ' is-readonly' : ''}`}
      data-type={w.type}
      data-state={checkable ? (on ? 'on' : 'off') : undefined}
      style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale, ...(bare ? { '--fs': `${Math.min(rect.w, rect.h) * scale}px` } : {}) } as CSSProperties}
      onPointerDown={forwardTap}
    >
      {canvases ? <Canvases list={canvases} /> : null}
      {control(w, { scope, scale, entered, onChange })}
    </div>
  )
}

function control(w: Widget, o: { scope: string; scale: number; entered: Entered; onChange: (v: FieldValue) => void }): ReactNode {
  switch (w.type) {
    case 'text':
      return <TextControl w={w} {...o} />
    case 'choice':
      return <ChoiceControl w={w} {...o} />
    case 'checkbox':
    case 'radio':
      return <CheckControl w={w} {...o} />
    case 'button':
      return null
  }
}

/** Puts the canvases pdf.js drew into the DOM. */
function Canvases({ list }: { list: HTMLCanvasElement[] }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    host.current!.replaceChildren(...list)
  }, [list])
  return <div className="form-canvases" ref={host} aria-hidden="true" />
}

type ControlProps<T extends Widget> = { w: T; scope: string; scale: number; entered: Entered; onChange: (v: FieldValue) => void }

/** Turns the content of a widget against the page, as its /MK /R entry asks. */
function Turned({ w, scale, children }: { w: Widget; scale: number; children: ReactNode }) {
  const { w: rw, h: rh } = w.rect
  const swap = w.turn % 180 !== 0
  const width = (swap ? rh : rw) * scale
  const height = (swap ? rw : rh) * scale
  return (
    <div
      className="form-turned"
      style={{ width, height, left: (rw * scale - width) / 2, top: (rh * scale - height) / 2, transform: w.turn ? `rotate(${-w.turn}deg)` : undefined }}
    >
      {children}
    </div>
  )
}

function look(w: TextWidget | ChoiceWidget, scale: number): CSSProperties {
  const { border } = w
  const line = border.width && border.color ? `${border.width * scale}px ${border.style === 'dashed' ? 'dashed' : 'solid'} ${border.color}` : 'none'
  const sides = border.style === 'underline' ? 'none' : line
  const style: Record<string, string | number | undefined> = {
    '--fs': `${fontSizeOf(w) * scale}px`,
    color: w.color,
    fontFamily: FAMILIES[w.font],
    backgroundColor: w.background ?? undefined,
    // Per side: React warns when a shorthand and a longhand of the same property alternate.
    borderTop: sides,
    borderRight: sides,
    borderLeft: sides,
    borderBottom: line,
    paddingInline: 2 * scale,
  }
  return style as CSSProperties
}

function TextControl({ w, scale, entered, onChange }: ControlProps<TextWidget>) {
  const value = textOf(w, entered)
  const common = {
    className: 'form-input',
    value,
    readOnly: w.readOnly,
    tabIndex: w.readOnly ? -1 : undefined,
    'aria-required': w.required || undefined,
    maxLength: w.maxLength || undefined,
    spellCheck: false,
    autoComplete: 'off',
    'aria-label': w.label,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onKeyDown: leaveField,
  }
  const style = { ...look(w, scale), textAlign: w.align }
  return (
    <Turned w={w} scale={scale}>
      {w.multiline ? (
        <textarea {...common} style={{ ...style, paddingBlock: 2 * scale }} />
      ) : (
        <input
          {...common}
          type={w.password ? 'password' : 'text'}
          enterKeyHint="next"
          style={w.comb ? { ...style, ...comb(w, scale) } : style}
        />
      )}
    </Turned>
  )
}

/** One character per cell: a monospaced face with the letter spacing of a cell. */
function comb(w: TextWidget, scale: number): CSSProperties {
  const cell = (w.rect.w * scale) / w.maxLength
  return { fontFamily: FAMILIES.mono, letterSpacing: `calc(${cell}px - 1ch)`, paddingInlineStart: `calc((${cell}px - 1ch) / 2)`, textAlign: 'start' }
}

function ChoiceControl({ w, scale, entered, onChange }: ControlProps<ChoiceWidget>) {
  const id = useId()
  const selected = listOf(w, entered)
  // Backspace or Delete clears a selection list.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && e.currentTarget instanceof HTMLSelectElement) {
      e.preventDefault()
      onChange(w.multiple ? [] : '')
    } else {
      leaveField(e)
    }
  }
  const common = { className: 'form-input', 'aria-label': w.label, 'aria-required': w.required || undefined, onKeyDown, style: look(w, scale) }
  const disabled = w.readOnly ? { disabled: true, tabIndex: -1 } : {}
  const label = (v: string) => w.options.find((o) => o.value === v)?.label ?? v
  if (w.editable) {
    return (
      <Turned w={w} scale={scale}>
        <input {...common} {...disabled} list={id} type="text" spellCheck={false} autoComplete="off" value={selected[0] ? label(selected[0]) : ''} onChange={(e) => onChange(exportValueOf(w, e.target.value))} />
        <datalist id={id}>
          {w.options.map((o) => (
            <option key={o.value} value={o.label} />
          ))}
        </datalist>
      </Turned>
    )
  }
  return (
    <Turned w={w} scale={scale}>
      {w.combo ? (
        <select {...common} {...disabled} value={selected[0] ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" />
          {w.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <select
          {...common}
          {...disabled}
          className="form-input is-list"
          multiple={w.multiple}
          size={Math.max(2, Math.floor((w.rect.h * scale) / Math.max(1, fontSizeOf(w) * scale * 1.3)))}
          value={w.multiple ? selected : (selected[0] ?? '')}
          onChange={(e) => onChange(w.multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}
        >
          {w.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Turned>
  )
}

/** Typed text of an editable dropdown back to the export value of the entry it names, if any. */
function exportValueOf(w: ChoiceWidget, text: string): string {
  return w.options.find((o) => o.label === text)?.value ?? text
}

function CheckControl({ w, scope, entered, onChange }: ControlProps<CheckWidget>) {
  return (
    <input
      className="form-check"
      type={w.type}
      name={w.type === 'radio' ? `${scope}:${w.name}` : undefined}
      checked={isChecked(w, entered)}
      disabled={w.readOnly}
      aria-required={w.required || undefined}
      aria-label={w.label}
      onChange={() => onChange(click(w, entered))}
      onKeyDown={leaveField}
    />
  )
}

/**
 * Return moves on to the next field and Escape leaves the field, so the page shortcuts work again.
 * Backspace on a field that is not typed into does nothing, instead of going back in some browsers.
 */
function leaveField(e: KeyboardEvent<HTMLElement>) {
  const target = e.currentTarget
  if (e.key === 'Escape') {
    target.blur()
  } else if (e.key === 'Backspace' && !(target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && TYPED.has(target.type)))) {
    e.preventDefault()
  } else if (e.key === 'Enter' && target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio') {
    e.preventDefault()
    const all = [...(target.closest('.viewer')?.querySelectorAll<HTMLElement>(CONTROLS) ?? [])]
    all[all.indexOf(target) + (e.shiftKey ? -1 : 1)]?.focus()
  }
}

/** Taps just beside a small field (see the touch rules in the style sheet) reach the field. */
function forwardTap(e: React.PointerEvent<HTMLElement>) {
  if (e.target !== e.currentTarget) return
  const control = e.currentTarget.querySelector<HTMLElement>('input, textarea, select')
  if (!control || control.matches('[tabindex="-1"]')) return
  e.preventDefault()
  control.focus()
  if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) control.click()
}
