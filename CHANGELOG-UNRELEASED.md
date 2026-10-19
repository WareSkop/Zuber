### Added
- Integrierter Server-Logger (`server/logger.ts`) mit 1000-Elemente-Ringbuffer, automatischer Datei-Rotation (`knowmesh.log` < 5MB) und `/api/logs`-REST-Endpunkten (`GET`, `POST /level`, `DELETE`).
- Strukturierter Client-Logger (`src/utils/logger.ts`) mit 1000-Elemente-Ringbuffer, `sessionStorage`-Spiegelung und automatischen Listenern für unbehandelte Fehler und Rejections.
- Neuer Reiter „Protokolle & Diagnose“ in den Einstellungen (`SettingsModal.tsx`) mit chronologischer Kombiansicht, Quellenfilter (`Alle`, `Client`, `Server`), Schnellsuche, Log-Level-Umschaltung und „Für Antigravity kopieren“-Button mit Umgebungsinformationen.
- Externer-Link-Button `[ ]( )` in der Editor-Toolbar (`EditorToolbar.tsx`) mit Popover-Formular (Linktext & URL), automatischer Vorbelegung markierter Texte und Tastaturnavigation.
- Automatisches Verlinken beim Einfügen von URLs (Paste-Handler in `LivePreviewEditor.tsx`): Wandelt eingefügte Web-URLs bei markiertem Text in `[markierter Text](url)` oder `[url](url)` um, mit Ausnahmen für Code-Blöcke und Inline-Code.
- Klickbare externe Links in Live-Preview (`ExternalLinkWidget`) und Lesemodus (`Reading Mode`): Öffnet `http://`, `https://` und `mailto:`-Links direkt im neuen Tab (`target="_blank"`, `rel="noopener noreferrer"`).
- Einrastende Favoriten- und Zuletzt-verwendet-Panels (`FileSidebar.tsx`) oberhalb des Dateibaums mit unabhängiger Scrollbegrenzung (max. 10 sichtbare Elemente ohne Scrollen) und Latching-Toggle-Buttons (⭐ & 🕒).
- Kontextmenü-Aktionen für Favoriten (`Zu Favoriten hinzufügen` / `Aus Favoriten entfernen` ⭐) für Dateien und Ordner mit automatischer Pfadaktualisierung bei Umbenennung oder Löschung (`src/utils/vaultNavigation.ts`).
- Frei ziehbare Seitenleisten (Resizable Sidebars): Interaktive Maus-Ziehgriffe (`.sidebar-resizer-left`, `.sidebar-resizer-right`) auf Desktops mit automatischer Breitenbegrenzung und persistenter Speicherung in `localStorage` (`knowmesh_sidebar_widths`).
- Dediziertes Workflow- & Mindmap-Icon (`WorkflowCanvasIcon`) für `.canvas`-Dateien im Dateibaum, Header, Kontextmenü, der Befehlspalette und Embeds.

### Changed
- `NoteSaveRequest` und `syncEngine.saveNote` unterstützen nun den Parameter `explicitClear`, um gewolltes Leeren einer Notiz von flüchtigen Initialzuständen zu unterscheiden.
- Icon-Only-Navigation in der linken Leiste (`Dateien`, `Suche`, `Tags`) sowie im Topbar-Modus-Umschalter (`Live-Preview`, `Lesen`, `Quellcode`, `Zen`) mit responsiven `title`- und `aria-label`-Tooltips.
- Entfernung des redundanten „Vault in sync“-Statusbadges in der linken unteren Bildschirmecke (Verbindungs- und Sync-Status verbleiben in der oberen Leiste).

### Fixed
- Falsche 409-Versionskonflikte bei identischem Inhalt (z. B. durch 1-Sekunden-Zeitstempel-Drift oder Dateisystem-Rundung) werden serverseitig und clientseitig unterdrückt; stattdessen wird 200 OK zurückgegeben.
- Schutz vor Datenverlust durch leere lokale Notizpuffer im `ConflictModal`: Ein leerer lokaler Notiztext überschreibt bei Ladeverzögerungen oder Notizwechseln nicht mehr den Serverbestand, sondern übernimmt automatisch die Serverversion.
- Echo-Unterdrückung (`recentSelfWritesRef`): Eigene Speicherungen und Uploads blockieren WebSocket-`vault:changed`-Echos für 3000 ms, um störende Neulade-Schleifen zu verhindern.
- Atomare Sequenzierung beim Einfügen von Bildern (`LivePreviewEditor.tsx` & `App.tsx`): Pausiert Auto-Saves während des Uploads, um Kollisionen zwischen Bild-Upload und Notizspeicherung auszuschließen.
- Konfliktwarteschlange in `syncEngine.ts` wird nun nach Notizpfad dedupliziert (`addOrUpdateConflict`).
- Einrückung geschachtelter Aufgabenlisten (Todos) im Live-Preview-Modus: Behält führende Einrückungsstufen (`- [ ]`, `  - [ ]`, `    - [ ]` etc.) visuell proportional bei und toggelt Checkboxen an exakter Textposition.
- Entfernung doppelter Aufzählungspunkte vor Checkboxen im Lesemodus (`Reading Mode`): Unterdrückt Standard-Bullet-Points vor Aufgabenlisten und formatiert Checkboxen sauber linksbündig ausgerichtet.


