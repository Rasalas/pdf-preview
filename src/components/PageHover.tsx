import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Page } from '../model/types'
import { gapNear } from './hover'
import { Icon, type IconName } from './icons'

/** What the pointer is on: a page, or the gap with this index. */
export type Spot = { page: string } | { gap: number }

export interface PageActions {
  /** Shortcut prefix of the platform, like ⌘. */
  mod: string
  /** The spot whose menu is open. It stays shown, whatever the pointer does. */
  pinned: Spot | null
  onRotate: (id: string, delta: -90 | 90) => void
  onRemove: (id: string) => void
  onMore: (id: string, anchor: DOMRect) => void
  onGap: (at: number, anchor: DOMRect) => void
  onAdd: () => void
}

interface Props {
  /** The scrolling list the overlays are positioned in. */
  root: RefObject<HTMLDivElement | null>
  pages: Page[]
  actions: PageActions
  /** Nothing shows while pages or files are being dragged. */
  suspended: boolean
}

/** Space beside a thumbnail on either side, wide enough for the page actions. */
export const MARGIN = 34

/** How long the pointer rests in a gap before its "+" shows, so passing by does not flicker. */
const REST = 150

/** Page actions over the thumbnail the pointer is on, and a "+" in the gap it rests in. */
export function PageHover({ root, pages, actions, suspended }: Props) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const { pinned } = actions
  const pin = pinned && ('page' in pinned ? pinned.page : pinned.gap)
  const shown = pinned ?? spot

  useEffect(() => setSpot(null), [suspended, pin])

  useEffect(() => {
    const el = root.current
    if (!el || suspended || pin !== null) return
    let timer = 0
    let waiting: number | null = null
    const set = (next: Spot | null) => {
      clearTimeout(timer)
      waiting = null
      setSpot((s) => (same(s, next) ? s : next))
    }
    const handle = (target: HTMLElement, y: number) => {
      if (target.closest('.hover-ui')) return
      const next = spotAt(el, pagesRef.current, target, y)
      if (!next || 'page' in next) return set(next)
      // The page's actions go at once, the gap's "+" only when the pointer rests.
      setSpot((s) => (s && 'gap' in s && s.gap === next.gap ? s : null))
      if (waiting === next.gap) return
      clearTimeout(timer)
      waiting = next.gap
      timer = window.setTimeout(() => setSpot(next), REST)
    }
    let last: { x: number; y: number } | null = null
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      last = { x: e.clientX, y: e.clientY }
      handle(e.target as HTMLElement, e.clientY)
    }
    // Scrolling moves other pages under a pointer that stands still.
    const scrolled = () => {
      const target = last && document.elementFromPoint(last.x, last.y)
      if (last && target && el.contains(target)) handle(target as HTMLElement, last.y)
    }
    const leave = () => {
      last = null
      set(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('scroll', scrolled, { passive: true })
    return () => {
      clearTimeout(timer)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('scroll', scrolled)
    }
  }, [root, suspended, pin])

  // Follows the page when rotation or resizing moves it.
  useLayoutEffect(() => {
    const next = shown && root.current ? anchorOf(root.current, shown) : null
    setAt((a) => (a?.x === next?.x && a?.y === next?.y ? a : next))
  })

  if (!shown || !at) return null

  const keepFocus = (e: React.MouseEvent) => {
    e.preventDefault()
    root.current?.querySelector<HTMLElement>('[role=listbox]')?.focus({ preventScroll: true })
  }

  if ('gap' in shown) {
    return (
      <>
        <div className="gap-hover" style={{ top: at.y }} />
        <button
          key={shown.gap}
          className="hover-ui gap-add"
          style={{ left: at.x, top: at.y }}
          title="Hier einfügen"
          aria-label="Hier einfügen"
          aria-haspopup="menu"
          onMouseDown={keepFocus}
          onClick={(e) => actions.onGap(shown.gap, e.currentTarget.getBoundingClientRect())}
        >
          <Icon name="plus" width={11} strokeWidth={2.75} />
        </button>
      </>
    )
  }

  const id = shown.page
  return (
    <div key={id} className="hover-ui thumb-actions" role="group" aria-label="Seitenaktionen" style={{ left: at.x, top: at.y }} onMouseDown={keepFocus}>
      <ActionButton icon="rotateLeft" label={`Nach links drehen (${actions.mod}L)`} onClick={() => actions.onRotate(id, -90)} />
      <ActionButton icon="rotateRight" label={`Nach rechts drehen (${actions.mod}R)`} onClick={() => actions.onRotate(id, 90)} />
      <ActionButton icon="more" label="Mehr" menu onClick={(e) => actions.onMore(id, e.currentTarget.getBoundingClientRect())} />
      <ActionButton icon="trash" danger label="Seite löschen (⌫)" onClick={() => actions.onRemove(id)} />
    </div>
  )
}

interface ActionButtonProps {
  icon: IconName
  label: string
  danger?: boolean
  menu?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}

function ActionButton({ icon, label, danger, menu, onClick }: ActionButtonProps) {
  return (
    <button className={danger ? 'is-danger' : undefined} title={label} aria-label={label} aria-haspopup={menu ? 'menu' : undefined} onClick={onClick}>
      <Icon name={icon} width={15} />
    </button>
  )
}

const same = (a: Spot | null, b: Spot | null) =>
  a === b || (!!a && !!b && ('page' in a ? 'page' in b && a.page === b.page : 'gap' in b && a.gap === b.gap))

/** The page or gap under the pointer, or null when it is on something else. */
function spotAt(root: HTMLElement, pages: Page[], target: HTMLElement, y: number): Spot | null {
  if (target.closest('.add-tile')) return null
  const thumb = target.closest<HTMLElement>('.thumb')
  if (!thumb) {
    // The list's padding above the first page.
    const first = root.querySelector('.thumb')
    return first && y < first.getBoundingClientRect().top ? { gap: 0 } : null
  }
  const id = thumb.dataset.id!
  const frame = thumb.querySelector('.thumb-frame')!.getBoundingClientRect()
  // Level with the frame counts as the page, so the pointer can cross the margin to the actions.
  const gap = gapNear(pages.findIndex((p) => p.id === id), frame, y)
  return gap === null ? { page: id } : { gap }
}

/** Where an overlay for the spot sits, in the coordinates of the scrolled list. */
function anchorOf(root: HTMLElement, spot: Spot): { x: number; y: number } | null {
  const box = root.getBoundingClientRect()
  const place = (x: number, y: number) => ({ x: Math.round(x - box.left + root.scrollLeft), y: Math.round(y - box.top + root.scrollTop) })
  if ('page' in spot) {
    const frame = root.querySelector(`[data-id="${spot.page}"] .thumb-frame`)?.getBoundingClientRect()
    const list = root.querySelector('.page-list')?.getBoundingClientRect()
    // In the right margin, off the page, so clicking a page never hits an action.
    // Top edge and margin stay put when a rotation reshapes the frame, so repeated clicks hit.
    return frame && list ? place(list.right - 2, frame.top) : null
  }
  const thumbs = root.querySelectorAll('.thumb')
  const list = root.querySelector('.page-list')?.getBoundingClientRect()
  if (!list || thumbs.length === 0) return null
  // The line sits on the edge between two thumbs, or below the last one.
  const y = spot.gap < thumbs.length ? thumbs[spot.gap].getBoundingClientRect().top : thumbs[thumbs.length - 1].getBoundingClientRect().bottom
  return place(list.left + list.width / 2, y)
}
