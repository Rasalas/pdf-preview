import type { Session } from '../persist'

interface Props {
  session: Session | null
  onOpen: () => void
  onBlank: () => void
  onRestore: () => void
  onDiscard: () => void
  onAbout: () => void
}

export function EmptyState({ session, onOpen, onBlank, onRestore, onDiscard, onAbout }: Props) {
  return (
    <div className="empty">
      <div className="empty-sheets" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h1>PDFs und Bilder hierher ziehen</h1>
      <p>Kombinieren, umsortieren, drehen und als neues PDF sichern. Deine Dateien bleiben in diesem Browser und werden nirgends hochgeladen.</p>
      <div className="empty-actions">
        <button className="button is-primary" onClick={onOpen}>Dateien auswählen …</button>
        <button className="button" onClick={onBlank}>Leeres Dokument</button>
      </div>
      {session ? (
        <div className="restore">
          <div>
            <strong>{session.title || 'Unbenannt'}</strong>
            <span>
              {session.pages.length} {session.pages.length === 1 ? 'Seite' : 'Seiten'} · zuletzt bearbeitet{' '}
              {new Date(session.savedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <button className="button is-primary" onClick={onRestore}>Wiederherstellen</button>
          <button className="button is-quiet" onClick={onDiscard}>Verwerfen</button>
        </div>
      ) : null}
      <footer className="empty-footer">
        <button onClick={onAbout}>Über und Datenschutz</button>
      </footer>
    </div>
  )
}
