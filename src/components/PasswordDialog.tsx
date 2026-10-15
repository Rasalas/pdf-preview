import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

interface Props {
  name: string
  wrong: boolean
  /** Called once with the password, or null when the user skips the file. */
  onAnswer: (password: string | null) => void
}

export function PasswordDialog({ name, wrong, onAnswer }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [password, setPassword] = useState('')
  // After submitting, the dialog stays up until the app replaces or removes it.
  const [busy, setBusy] = useState(false)
  const answered = useRef(false)

  useEffect(() => {
    dialog.current!.showModal()
  }, [])

  const answer = (value: string | null) => {
    if (answered.current) return
    answered.current = true
    setBusy(value !== null)
    onAnswer(value)
  }

  return (
    <dialog ref={dialog} className="dialog password" onClose={() => answer(null)} onCancel={(e) => {
        if (busy) e.preventDefault()
      }} aria-labelledby="password-title">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (password) answer(password)
        }}
      >
        <h2 id="password-title">Passwort eingeben</h2>
        <p>„{name}“ ist passwortgeschützt. Gib das Passwort ein, um die Datei zu öffnen.</p>
        <input
          type="password"
          name="pdf-password"
          aria-label="Passwort"
          aria-invalid={wrong}
          aria-describedby={wrong ? 'password-error' : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          disabled={busy}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {wrong ? (
          <p id="password-error" className="password-error" role="alert">
            Das Passwort stimmt nicht. Versuch es noch einmal.
          </p>
        ) : null}
        <div className="dialog-actions">
          <span />
          <button type="button" className="button" disabled={busy} onClick={() => dialog.current!.close()}>
            <Icon name="close" width={15} />
            Überspringen
          </button>
          <button type="submit" className="button is-primary" disabled={!password || busy}>
            <Icon name="unlock" width={15} />
            Öffnen
          </button>
        </div>
      </form>
    </dialog>
  )
}
