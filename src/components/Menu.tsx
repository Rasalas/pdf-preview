import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem = { label: string; shortcut?: string; disabled?: boolean; danger?: boolean; run: () => void } | 'separator'

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /** Open upwards from y, for menus anchored at the bottom of the screen. */
  above?: boolean
}

export function Menu({ x, y, items, onClose, above = false }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const r = el.current!.getBoundingClientRect()
    const top = above ? y - r.height : y
    setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(top, innerHeight - r.height - 8)) })
    el.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y, above])

  useEffect(() => {
    const down = (e: PointerEvent) => !el.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = [...el.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
    addEventListener('pointerdown', down, true)
    addEventListener('keydown', key, true)
    addEventListener('blur', onClose)
    return () => {
      removeEventListener('pointerdown', down, true)
      removeEventListener('keydown', key, true)
      removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={el} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-separator" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? 'is-danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.run()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
          </button>
        ),
      )}
    </div>
  )
}
