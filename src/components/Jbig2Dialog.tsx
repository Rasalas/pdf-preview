import { useEffect, useRef } from 'react'
import { Icon } from './icons'

/** Before saving without JBIG2 a scan whose characters may have been swapped when it was made. */
export function Jbig2Dialog({ onAnswer }: { onAnswer: (save: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)

  useEffect(() => {
    dialog.current!.showModal()
  }, [])

  return (
    <dialog ref={dialog} className="dialog jbig2" onClose={() => onAnswer(saving.current)} aria-labelledby="jbig2-title">
      <h2 id="jbig2-title">Scan vor dem Sichern prüfen</h2>
      <p className="jbig2-warning">
        Dieser Scan wurde mit Mustererkennung komprimiert. Dabei können schon beim Scannen Zeichen vertauscht worden sein, etwa <b>6</b> und <b>8</b>.
      </p>
      <p>Die Umwandlung übernimmt den Scan genau so. Vergleiche wichtige Zahlen mit dem Papier, bevor du das Original wegwirfst.</p>
      <div className="dialog-actions">
        <span />
        <button type="button" className="button" onClick={() => dialog.current!.close()}>
          <Icon name="close" width={15} />
          Abbrechen
        </button>
        <button
          type="button"
          className="button is-primary"
          autoFocus
          onClick={() => {
            saving.current = true
            dialog.current!.close()
          }}
        >
          <Icon name="save" width={15} />
          Sichern
        </button>
      </div>
    </dialog>
  )
}
