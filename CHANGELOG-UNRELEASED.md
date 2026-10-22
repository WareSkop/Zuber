### Added
- Erweitertes Editor Drag & Drop in `LivePreviewEditor.tsx`:
  - Exakte Drop-Positionsberechnung über `view.posAtCoords`.
  - Reines Client-Side-Auslesen für Textdateien (`.txt`, `.md`, `.csv`, `.json`, `.log`, `.yaml`, `.xml` etc.) mit direkter Texteinfügung (bei Mehrfachauswahl getrennt durch `\n\n`) ohne Anhang-Upload.
  - Automatischer Upload und Wiki-Embed-Einfügung für Bilder (`.png`, `.jpg`, `.gif` etc.) und Binärdateien (`.pdf`, `.zip`, `.docx`).
  - Unterstützung für das Ziehen von markiertem Text (`text/plain`).
- Löschen-Button mit Papierkorb-Icon in der schwebenden Bild-Toolbar zur direkten Entfernung von Bild-Embeds aus der Notiz (ohne die Vault-Datei auf der Festplatte zu löschen).
- Interaktiver Inline-PDF-Viewer für `![[dokument.pdf]]` (sowie mit optionaler Höhenangabe `![[dokument.pdf|700]]`) in Live-Preview und Lese-Ansicht mit Header-Leiste, „In neuem Tab öffnen“-Button und eingebettetem PDF-Iframe (`#toolbar=1&view=FitH`).
- Backend-Unterstützung für das direkte Ausliefern von PDF-Anhängen mit `Content-Type: application/pdf` und `Content-Disposition: inline`.
- Interaktive Mermaid-Codeblöcke (` ```mermaid `):
  - Standardmäßige SVG-Diagramm-Vorschau mit integrierter Syntaxfehler-Behandlung.
  - Header-Segment-Toggle `[ Diagram | Code ]` (`[ Diagramm | Code ]`) zum Umschalten zwischen interaktiver Vorschau und Live-Editing in CodeMirror 6 sowie im Lese-Modus.
- Interaktive HTML-Codeblöcke (` ```html `):
  - Standardmäßige isolierte Iframe-Vorschau (`sandbox="allow-scripts"`) mit dynamischer Höhenanpassung.
  - Header-Segment-Toggle `[ Preview | Code ]` (`[ Vorschau | Code ]`) zum Umschalten zwischen Vorschau und Quelltext.
- Dateibaum Multi-Select mit Strg/Cmd+Klick (Toggle), Umschalt+Klick (Bereichsauswahl) und visueller Zeilenmarkierung (`.is-selected`).
- Internes Drag & Drop für einzelne und mehrfach ausgewählte Notizen/Ordner inklusive Drop-Ziel-Highlighting und 500ms Auto-Expand für geschlossene Ordner.
- Externes Drag & Drop (Datei-Upload aus dem Datei-Explorer des Betriebssystems) direkt auf Ordner oder in den Dateibaum mit automatischer Indizierung.
- Tastaturbedienbarer „Verschieben nach…“-Dialog (`MoveToModal.tsx`) mit Such-/Filterfeld, Pfeiltasten-Navigation und Schutz vor zirkulären Ordner-Verschiebungen.
- Vollständiges automatisches Link-Refactoring beim Verschieben/Umbenennen für Wiki-Links (inkl. Erhalt von `#Headings` und `|Aliasen`), Wiki-Embeds (`![[...]]` inkl. Bildgrößen wie `|400`), Standard-Markdown-Links/Bilder und HTML `<img src="..." />`-Tags.
- Vollständiges Link-Refactoring innerhalb von `.canvas`-Dateien (`type: "file"`-Knoten, Text-/Shape-Knoten und Kantenbeschriftungen `edges[].label`).
- Neuer Backend-Batch-Move-Endpunkt `POST /api/vault/move-batch` mit konsolidiertem WebSocket-Event (`vault:changed`).

### Changed
- Fehleranfällige Zwischenspeicher-Funktion „Cut / Ausschneiden“ aus dem Dateibaum-Kontextmenü entfernt und durch den modalen Verschiebe-Workflow ersetzt.
- Dynamisches Kontextmenü bei Mehrfachauswahl („X Elemente verschieben nach…“, „X Elemente löschen“).

### Fixed
- Strikte Pfad-basierte Zeilenmarkierung im Dateibaum (`node.path` statt `name`), um gleichzeitiges Markieren gleichnamiger Dateien in verschiedenen Ordnern auszuschließen.
- Saubere Cache-Bereinigung in IndexedDB (`notes`, `attachments`, `meta.tree`, `meta.allNotes`, `meta.files`) beim Verschieben/Umbenennen (`moveOrRenameNodeInTree`), wodurch keine Geister-Einträge im alten Ordner zurückbleiben.
