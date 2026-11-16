### Added
- **Client-seitiger Notiz-PDF-Export (`@media print` / `window.print()`):** (`src/App.tsx`, `src/components/EditorToolbar.tsx`, `src/components/FileSidebar.tsx`, `src/utils/readingMode.ts`, `src/styles.css`, `src/locales/en.json`, `src/locales/de.json`, `src/printExportAndBatch.test.ts`):
  - Neuer `exportNoteAsPdf`-Workflow über Toolbar-, Topbar- und Dateibaum-Kontextmenü (**„Als PDF exportieren…“**): wechselt temporär in den Reading-Mode, setzt `document.title` auf den Notiznamen (`<NoteName>.pdf`), ruft `window.print()` auf und stellt Modus sowie Titel nach `afterprint` wieder her.
  - Dedizierter `@media print`-Stylesheet mit heller Druck-Palette, Ausblendung von App-Chrome und `.properties-panel` (YAML), `break-inside: avoid` auf Tabellen/Callouts/Diagrammen/Embeds, Ersatz von `![[doc.pdf]]`-Iframes durch eine Anhang-Karte (`.print-pdf-attachment-callout`) sowie Unterstützung für manuelle Seitenumbrüche via `<!-- pagebreak -->` (`preprocessPrintPageBreaks`).
- **Multi-Select Batch-`.zip`-Download:** (`server/index.ts`, `src/api.ts`, `src/components/FileSidebar.tsx`, `src/locales/en.json`, `src/locales/de.json`, `server/uploadDownload.test.ts`):
  - Neuer Endpunkt `POST /api/vault/download-batch` verpackt mehrere ausgewählte Dateien und Ordner rekursiv in ein `.zip`-Archiv (mit Path-Traversal-Prüfung, Dotfile-Filter und Kindpfad-Deduplizierung); bei `selectedPaths.size > 1` bietet das Kontextmenü **„Auswahl herunterladen (.zip) ({{count}})“** über `api.downloadBatch()`.

### Changed
- **Harmonisierte Codeblock-Schriftgröße (`src/styles.css`):** Fenced-Codeblöcke im Live-Preview und Reading-Mode skalieren nun proportional zu `--km-font-size-editor` mit `calc(var(--km-font-size-editor, 16px) * 0.875)` (`14px` bei `16px` Editor-Schrift) und `line-height: 1.5`.
- **Mobiles Neue-Notiz-Verhalten & Smart-Cursor unter `# Überschrift` (`shared/markdownUtils.ts`, `src/utils/editorCursorUtils.ts`, `src/components/LivePreviewEditor.tsx`, `src/App.tsx`, `src/printExportAndBatch.test.ts`):**
  - `parseMarkdownWithFrontmatter()` entfernt die einzelne Frontmatter-Trenn-Leerzeile, sodass neue Notizen direkt auf Zeile 1 mit `# <Titel>\n\n` ohne vorangestellte Leerzeile beginnen.
  - Neu erstellte Notizen öffnen auf Mobilgeräten direkt im Bearbeitungsmodus (`'live'`) mit fokussiertem Cursor im Body unterhalb der Überschrift (`focusAtEnd()`); der **Bearbeiten**-Button in `<MobileBottomNav />` nutzt `focusBelowHeading()` (`computeBodyCursorAfterHeading()`), um den Cursor unterhalb einer H1-Überschrift zu platzieren.

### Fixed
