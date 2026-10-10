<img src="assets/icon.svg" width="64" height="64" alt="">

# pdf-preview

Eine Nachbildung der macOS-App Vorschau als statische Website. PDFs und Bilder werden komplett im Browser verarbeitet und nirgends hochgeladen.

## Funktionen

- PDFs und Bilder (PNG, JPEG, WebP, GIF, AVIF, …) per Drag & Drop oder Dateidialog öffnen
- Dateien gezielt zwischen zwei Seiten einfügen: in die Seitenleiste ziehen, die Einfügemarke zeigt die Position
- Seiten umsortieren per Drag & Drop oder mit ⌥↑/⌥↓, Mehrfachauswahl mit ⌘ und ⇧
- Seiten drehen, duplizieren, löschen, leere Seiten einfügen
- Widerrufen und Wiederholen für alle Änderungen, ein Import zählt als ein Schritt
- Als PDF sichern, wahlweise nur die Auswahl; Drucken
- PDF-Seiten werden unverändert übernommen, Text bleibt durchsuchbar und Vektoren bleiben scharf
- Das Arbeitsdokument wird lokal gespeichert (IndexedDB) und lässt sich nach einem Neuladen wiederherstellen

## Tastenkürzel

| Kürzel | Aktion |
| --- | --- |
| ⌘O | Dateien einfügen |
| ⌘S | Als PDF sichern |
| ⌘P | Drucken |
| ⌘Z / ⇧⌘Z | Widerrufen / Wiederholen |
| ⌘R / ⌘L | Nach rechts / links drehen |
| ⌘D | Duplizieren |
| ⌫ | Auswahl löschen |
| ⌘A | Alle Seiten auswählen |
| ↑ ↓, ⇧↑ ⇧↓ | Seite wählen, Auswahl erweitern (in der Seitenleiste) |
| ⌥↑ ⌥↓ | Auswahl verschieben (in der Seitenleiste) |
| ⌘+ / ⌘− / ⌘0 | Zoom |
| ⌥⌘S | Seitenleiste ein-/ausblenden |

## Entwicklung

```sh
npm install
npm run dev     # Entwicklungsserver
npm test        # Tests
npm run build   # statische Seite in dist/
```

`dist/` kann auf jedem statischen Hosting liegen, auch in einem Unterverzeichnis.

## Bekannte Grenzen

- Verschlüsselte PDFs werden beim Import abgelehnt (pdf-lib kann sie nicht schreiben).
- Noch nicht umgesetzt: Textsuche und Textauswahl, Anmerkungen, Unterschrift, Formulare.
