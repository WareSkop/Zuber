### Added
- Integrierter Server-Logger (`server/logger.ts`) mit 1000-Elemente-Ringbuffer, automatischer Datei-Rotation (`knowmesh.log` < 5MB) und `/api/logs`-REST-Endpunkten (`GET`, `POST /level`, `DELETE`).
- Strukturierter Client-Logger (`src/utils/logger.ts`) mit 1000-Elemente-Ringbuffer, `sessionStorage`-Spiegelung und automatischen Listenern für unbehandelte Fehler und Rejections.
- Neuer Reiter „Protokolle & Diagnose“ in den Einstellungen (`SettingsModal.tsx`) mit chronologischer Kombiansicht, Quellenfilter (`Alle`, `Client`, `Server`), Schnellsuche, Log-Level-Umschaltung und „Für Antigravity kopieren“-Button mit Umgebungsinformationen.

### Changed
- `NoteSaveRequest` und `syncEngine.saveNote` unterstützen nun den Parameter `explicitClear`, um gewolltes Leeren einer Notiz von flüchtigen Initialzuständen zu unterscheiden.

### Fixed
- Falsche 409-Versionskonflikte bei identischem Inhalt (z. B. durch 1-Sekunden-Zeitstempel-Drift oder Dateisystem-Rundung) werden serverseitig und clientseitig unterdrückt; stattdessen wird 200 OK zurückgegeben.
- Schutz vor Datenverlust durch leere lokale Notizpuffer im `ConflictModal`: Ein leerer lokaler Notiztext überschreibt bei Ladeverzögerungen oder Notizwechseln nicht mehr den Serverbestand, sondern übernimmt automatisch die Serverversion.
- Echo-Unterdrückung (`recentSelfWritesRef`): Eigene Speicherungen und Uploads blockieren WebSocket-`vault:changed`-Echos für 3000 ms, um störende Neulade-Schleifen zu verhindern.
- Atomare Sequenzierung beim Einfügen von Bildern (`LivePreviewEditor.tsx` & `App.tsx`): Pausiert Auto-Saves während des Uploads, um Kollisionen zwischen Bild-Upload und Notizspeicherung auszuschließen.
- Konfliktwarteschlange in `syncEngine.ts` wird nun nach Notizpfad dedupliziert (`addOrUpdateConflict`).
