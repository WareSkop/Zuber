### Added
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
