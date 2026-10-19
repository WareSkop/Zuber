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
- Git-Versionsverlauf & Visueller Diff-Viewer (`VersionHistoryModal.tsx`): Obsidian-ähnliche Dateiwiederherstellung für `.md`- und `.canvas`-Dateien direkt aus dem Dateibaum-Kontextmenü oder via Befehlspalette (`Strg+P`). Mit chronologischer Commit-Liste (`git log --follow` mit automatischer Umbenennungsverfolgung), interaktiver Diff-Ansicht (Diff zu Aktuell, Diff zum Vorgänger, Volltext-Modus), Zeilennummern-Gutter, `+X / -Y`-Statistik-Badge sowie atomarer Ein-Klick-Wiederherstellung inklusive Auto-Commit und Echo-Prävention.
- Automatisches Mitbewegen von Kind-Elementen beim Verschieben von Gruppen im Canvas (`CanvasEditor.tsx` & `canvasMapper.ts`): Erkennt alle Notiz-, Formen- und Link-Knoten innerhalb des Gruppen-Rahmens und verschiebt diese synchron mit der Gruppe.
- Canvas-Mehrfachauswahl & Marquee-Rechteck (`SelectionMode.Partial` & `BoxSelect`-Toolbar-Schaltfläche): Ermöglicht das gleichzeitige Auswählen mehrerer Knoten per Rahmenziehen (Touch/Maus) oder mit gedrückter `Shift`-Taste sowie synchrones Verschieben, Duplizieren und Löschen.
- Konfigurierbares Canvas-Gitter & Einrasten (`Snap-to-Grid`): Popover-Menü in der Canvas-Toolbar mit konfigurierbaren Rastergrößen (`10px`, `15px`, `20px`, `25px`) und Hintergrund-Varianten (`Punkte`, `Linien`, `Aus`), persistent gespeichert in `localStorage` (`knowmesh_canvas_grid`).
- Vertikale und horizontale Zentrierung von Text & Markdown in Formen (`CanvasShapeNode.tsx` & `.canvas-shape-content`).
- Kontextsensitive Canvas-Verbindungs-Handles: Im Desktop-Modus standardmäßig ausgeblendet und bei Hover/Selektion sichtbar; im Touch-Modus auf vergrößerte 18px-Hit-Areas bei Selektion optimiert.
- Deterministische Canvas-Kantenpfeile: Exakte `markerEnd`-Pfeilspitzen am Zielknoten ohne Invertierung oder doppelte Pfeile.
- Kontext-Inspektor am Mauszeiger bei Rechtsklick (`CanvasEditor.tsx` & `CanvasInspector.tsx`): Öffnet die Attribut- und Werkzeugleiste (`CanvasInspector`) per Rechtsklick auf Knoten (`onNodeContextMenu`) oder Kanten (`onEdgeContextMenu`) unmittelbar an der Mauszeiger-Position mit automatischem Viewport-Clamping und Schließen bei Pane-Click, Canvas-Panning oder Escape.
- Zentriertes Formen-Auswahl-Popover (`CanvasInspector.tsx` & `src/styles.css`): Das Formauswahl-Menü (`.canvas-shape-picker-popover`) ist direkt über der Inspektionsleiste zentriert und bietet ein 380px breites, 3-spaltiges Gitter (`repeat(3, minmax(110px, 1fr))`), in dem alle Formbezeichnungen ohne Textumbruch oder Verzerrung Platz finden, inklusive dynamischem Flip nach unten bei Bildschirmkopfnähe.


### Changed
- `NoteSaveRequest` und `syncEngine.saveNote` unterstützen nun den Parameter `explicitClear`, um gewolltes Leeren einer Notiz von flüchtigen Initialzuständen zu unterscheiden.
- Icon-Only-Navigation in der linken Leiste (`Dateien`, `Suche`, `Tags`) sowie im Topbar-Modus-Umschalter (`Live-Preview`, `Lesen`, `Quellcode`, `Zen`) mit responsiven `title`- und `aria-label`-Tooltips.
- Entfernung des redundanten „Vault in sync“-Statusbadges in der linken unteren Bildschirmecke (Verbindungs- und Sync-Status verbleiben in der oberen Leiste).


### Removed
- Überflüssiger Stift-Button (`Edit3`) auf Canvas-Formknoten (`CanvasShapeNode.tsx`): Verhindert visuelle Kollisionen mit Verbindungs-Handles; Text- und Notizbearbeitung erfolgt konsistent per Doppelklick.

### Fixed
- Falsche 409-Versionskonflikte bei identischem Inhalt (z. B. durch 1-Sekunden-Zeitstempel-Drift oder Dateisystem-Rundung) werden serverseitig und clientseitig unterdrückt; stattdessen wird 200 OK zurückgegeben.
- Schutz vor Datenverlust durch leere lokale Notizpuffer im `ConflictModal`: Ein leerer lokaler Notiztext überschreibt bei Ladeverzögerungen oder Notizwechseln nicht mehr den Serverbestand, sondern übernimmt automatisch die Serverversion.
- Echo-Unterdrückung (`recentSelfWritesRef`): Eigene Speicherungen und Uploads blockieren WebSocket-`vault:changed`-Echos für 3000 ms, um störende Neulade-Schleifen zu verhindern.
- Atomare Sequenzierung beim Einfügen von Bildern (`LivePreviewEditor.tsx` & `App.tsx`): Pausiert Auto-Saves während des Uploads, um Kollisionen zwischen Bild-Upload und Notizspeicherung auszuschließen.
- Konfliktwarteschlange in `syncEngine.ts` wird nun nach Notizpfad dedupliziert (`addOrUpdateConflict`).
- Einrückung geschachtelter Aufgabenlisten (Todos) im Live-Preview-Modus: Behält führende Einrückungsstufen (`- [ ]`, `  - [ ]`, `    - [ ]` etc.) visuell proportional bei und toggelt Checkboxen an exakter Textposition.
- Entfernung doppelter Aufzählungspunkte vor Checkboxen im Lesemodus (`Reading Mode`): Unterdrückt Standard-Bullet-Points vor Aufgabenlisten und formatiert Checkboxen sauber linksbündig ausgerichtet.
- Vergrößerung der Canvas-Knoten-Resize-Hitareas (`.react-flow__resize-control.handle` auf 14px×14px mit `z-index: 25`, Kanten-Linien mit 14px Greifzone bei `z-index: 20`) für zuverlässiges Skalieren unter Linux/KDE/Chromium; Verbindungspunkte (`.canvas-node-handle`) auf `z-index: 30` angehoben.
- Responsives Layout der oberen Canvas-Toolbar (`.canvas-toolbar`): Begrenzung auf Container-Breite (`max-width: calc(100% - 24px) !important`), automatisches Umbrechen (`flex-wrap: wrap !important`) und dynamisches Boundary-Clamping für Dropdown-Menüs (`CanvasToolbar.tsx`).
- Vollständige Theme-Adaption der Graph-Ansicht (`GraphView.tsx` & `src/styles.css`): Entfernung harter Dunkelfarben in Toolbar, Tabs, Popover, Steuerelementen, Legende und dynamische Farbanpassung des HTML5-Canvas via `MutationObserver` und `getComputedStyle(document.documentElement)`.
- Vollständige Theme-Adaption des schwebenden Canvas-Inspektors (`CanvasInspector.tsx`), der React Flow Controls und MiniMap (`CanvasEditor.tsx` & `src/styles.css`) auf CSS-Theme-Variablen.
- Umbruch der inneren Canvas-Toolbar-Gruppen (`.canvas-toolbar-group`) auf schmalen mobilen Bildschirmen (~360px), um das Herausschieben und Abschneiden von Schaltflächen (`+ Text`, `Workflow`, `Netzwerk`) zu verhindern.
- Schwebender Canvas-Inspektor (`CanvasInspector.tsx`): Sichere horizontale Zentrierung (`left: 12px; right: 12px; margin: 0 auto; max-width: calc(100% - 24px) !important; flex-wrap: wrap !important`) und dynamisches Popover-Boundary-Clamping gegen Randüberlauf.
- Kollisionsschutz für React Flow Controls: Hebt die Zoom-Steuerung bei aktiver Element-Selektion (`.has-selection`) sowie auf Mobilgeräten (`< 768px`) auf `bottom: 76px !important;` an und blendet die MiniMap auf Touchscreens `< 768px` aus.
- Kompakte Topbar-Badges (< 600px): Ersetzt den Speichertext durch ein kompaktes Icon (`✓`) und blendet die Textbeschriftung des Canvas-Indikators aus, um Textabschneidungen im Header zu verhindern.


