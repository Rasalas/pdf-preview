import { Icon, type IconName } from './icons'

export interface BarAction {
  icon: IconName
  label: string
  disabled?: boolean
  danger?: boolean
  run: (e: React.MouseEvent<HTMLButtonElement>) => void
}

/** Labelled actions within thumb reach on narrow screens. */
export function BottomBar({ actions, label }: { actions: BarAction[]; label: string }) {
  return (
    <nav className="bottom-bar" aria-label={label}>
      {actions.map((a) => (
        <button key={a.label} className={a.danger ? 'is-danger' : undefined} disabled={a.disabled} onClick={a.run}>
          <Icon name={a.icon} width={22} />
          <span>{a.label}</span>
        </button>
      ))}
    </nav>
  )
}
