import { useEffect, useRef } from 'react'
import { deployment, links, version } from '../config'
import { isDesktop } from '../desktop'
import { BrandIcon, Icon } from './icons'

// Desktop webviews do not open new windows; hand links to the system browser instead.
const external = (e: React.MouseEvent<HTMLAnchorElement>) => {
  if (!isDesktop) return
  e.preventDefault()
  void import('../desktop').then((d) => d.openExternal(e.currentTarget.href))
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => dialog.current!.showModal(), [])

  return (
    <dialog ref={dialog} className="dialog about" onClose={onClose} aria-labelledby="about-title">
      <button className="about-close" aria-label="Schließen" onClick={() => dialog.current!.close()}>
        <Icon name="close" width={16} height={16} />
      </button>
      <img src="./icon.svg" alt="" width="48" height="48" />
      <h2 id="about-title">Vorschau</h2>
      <p className="about-lead">PDFs kombinieren, sortieren und markieren, direkt im Browser. Version {version}.</p>

      <h3>Datenschutz</h3>
      <p>
        Deine Dateien verlassen dieses Gerät nicht: Öffnen, Bearbeiten und Sichern passieren vollständig im Browser.
        Es gibt keine Cookies, kein Tracking und keine Konten. Das zuletzt bearbeitete Dokument und gezeichnete
        Unterschriften werden nur lokal in diesem Browser gespeichert.
      </p>
      {deployment.host ? (
        <p>
          Beim Laden der Seite verarbeitet der Betreiber des Hostings ({deployment.host}) technisch notwendige Daten
          wie die IP-Adresse.
        </p>
      ) : null}
      {deployment.privacyUrl || deployment.imprintUrl ? (
        <p className="about-legal">
          {deployment.privacyUrl ? <a href={deployment.privacyUrl} target="_blank" rel="noreferrer" onClick={external}>Datenschutzerklärung</a> : null}
          {deployment.imprintUrl ? <a href={deployment.imprintUrl} target="_blank" rel="noreferrer" onClick={external}>Impressum</a> : null}
        </p>
      ) : null}

      <h3>Projekt</h3>
      <div className="about-links">
        <a href={links.source} target="_blank" rel="noreferrer" onClick={external}>
          <BrandIcon name="github" mono />
          <strong>Quellcode auf GitHub</strong>
          <span>Open Source unter MIT-Lizenz</span>
        </a>
        <a href={links.issues} target="_blank" rel="noreferrer" onClick={external}>
          <Icon name="info" width={20} />
          <strong>Fehler melden</strong>
          <span>Ideen und Probleme als Issue</span>
        </a>
      </div>

      {deployment.funding ? (
        <>
          <h3>Unterstützen</h3>
          <div className="about-links">
            <a href={links.coffee} target="_blank" rel="noreferrer" onClick={external}>
              <BrandIcon name="coffee" />
              <strong>Buy Me a Coffee</strong>
              <span>Einmaliger Beitrag</span>
            </a>
            <a href={links.sponsors} target="_blank" rel="noreferrer" onClick={external}>
              <BrandIcon name="sponsors" />
              <strong>GitHub Sponsors</strong>
              <span>Regelmäßige Unterstützung</span>
            </a>
          </div>
        </>
      ) : null}
    </dialog>
  )
}
