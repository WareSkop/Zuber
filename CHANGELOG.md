# Changelog

All notable changes to Zuber will be documented in this file.

## [0.2.3] - 2026-10-21
### Added
- Codeblock syntax highlighting, hidden backticks in preview, language badge and copy-to-clipboard button.
- **Web Share Target API für Bilder, PDFs und Markdown-Dateien in `Inbox/` (`manifest.webmanifest`, `public/sw.js`, `src/sync/shareTargetService.ts` & `src/App.tsx`):**
  - Ermöglicht das direkte Teilen von Notizen, Bildern (`image/*`), PDFs (`application/pdf`) und Markdown-Dateien (`.md`, `text/markdown`, `text/plain`) aus dem nativen Android-/Browser-Share-Sheet in Zuber.
  - Der Service Worker fängt `POST /share-target` ab, serialisiert Dateidaten in die IndexedDB-Queue `zuber_shared_incoming` und leitet per HTTP 303 Redirect weiter.
  - Beim App-Start oder Fokus werden die geteilten Inhalte automatisiert verarbeitet: Markdown-Dateien werden direkt als Notiz in `Inbox/` angelegt, Bilder und PDFs werden in `attachments/` abgelegt und in eine zugehörige Notiz in `Inbox/` eingebettet. Die neu erzeugte Notiz wird sofort als aktiver Tab geöffnet.
- **Type-to-Edit für ausgewählte Canvas-Knoten (`CanvasEditor.tsx` & `CanvasShapeNode.tsx`):** Beim Tippen eines druckbaren Zeichens auf einem einzeln ausgewählten Form- oder Text-Knoten wird sofort der Inline-Editor geöffnet, der Cursor ans Textende gesetzt und das getippte Zeichen angehängt. Shortcuts wie `Ctrl+Z`, `Space` (Pan) und `Delete` bleiben uneingeschränkt funktionsfähig.

### Changed
- **Trennung von :dev- und :latest-Builds in GitHub Actions (`.github/workflows/docker-publish.yml`, `AGENT.md` & `README.md`):** Branch-Pushes bauen und taggen ausschließlich das Test-Image `ghcr.io/wareskop/zuber:dev` und überschreiben `:latest` nicht mehr. Die Produktions-Tags (`:latest`, `:<version>`) werden strikt nur bei semantischen Release-Tags (`v*.*.*`) erzeugt.
- Migrated container registry and CI/CD pipelines from Codeberg to GitHub (ghcr.io).
- **Vollständiges Rebranding von „Knowmesh“ zu „Zuber“ & Vereinheitlichung der Umgebungsvariablen:**
  - **Identität & PWA:** Aktualisierung aller Anwendungsnamen, Titel, Web-Manifest-Metadaten (`public/manifest.webmanifest`), `package.json`, Standard-Themes (`zuber`), Lokalisierungsdateien (`de.json`, `en.json`) sowie UI-Komponenten (`App.tsx`, `FileSidebar.tsx`, `SettingsModal.tsx`, `LoginModal.tsx`, `ErrorBoundary.tsx`).
  - **Passwort-Umgebungsvariable:** Vereinheitlicht auf `PASSWORD=` mit transparenter Abwärtskompatibilität zu `ZUBER_PASSWORD`, `KNOWMESH_PASSWORD`, `OBSIDIAN_WEB_PASSWORD` und Fallback-Passwort `'zuber'`.
  - **Speicher- und Session-Migration:**
    - Session-Cookie aktualisiert auf `zuber_session` mit nahtloser Erkennung bestehender `knowmesh_session`-, `basalt_session`- und `obsidian_vault_session`-Cookies.
    - IndexedDB-Datenbank migriert auf `zuber_cache_<profileId>` mit automatischer Datenübernahme aus bestehenden `knowmesh_cache_<profileId>`-Instanzen beim ersten Start.
    - `localStorage`-Keys migriert von `knowmesh_*` auf `zuber_*` (inkl. `zuber_token`, `zuber_vault_profiles`, `zuber_theme`, `zuber_language`, `zuber_font_settings`, `zuber_open_tabs`, `zuber_startup_config`, etc.).
  - **Docker & Workflows:**
    - `docker-compose.yml` und `.env.example` auf Container `zuber`, Image `ghcr.io/wareskop/zuber:latest` und `PASSWORD=` aktualisiert.
    - Build- und Publish-Skripte (`scripts/publish-docker.sh` und `.github/workflows/docker-publish.yml`) auf Image `ghcr.io/wareskop/zuber` angepasst.
  - **Dokumentation:** Vollständige Aktualisierung von `doc/README.md`, `doc/ARCHITECTURE.md`, `doc/API_AND_TYPES.md`, `doc/FRONTEND_AND_EDITOR.md` und `doc/LLM_DEVELOPER_GUIDE.md`.

### Fixed
- Fixed code block header border alignment to eliminate left-side step offset.
- **Canvas Autocomplete & Pfadauflösung (`src/components/LivePreviewEditor.tsx`, `server/vaultService.ts`, `shared/markdownUtils.ts` & `src/api.ts`):**
  - Autocomplete-Vorschläge behalten für `.canvas`-Dateien die Endung `.canvas` bei (z. B. `![[Diagramm.canvas]]` bzw. `[[Diagramm.canvas]]`), während `.md`-Dateien die Endung weiterhin sauber entfernen.
  - Wikilink-Auflösung (`resolveWikiTarget` / `resolveWikiTargetWithKind`) löst Wikilinks ohne Endung (z. B. `![[Diagramm]]`) automatisch auf `Diagramm.canvas` mit `kind: 'canvas'` auf, wenn keine `Diagramm.md` existiert. Bei Namensgleichheit behält `.md` wie spezifiziert Vorrang.
- **CodeMirror 6 Autocomplete-Tooltip Theme-Styling (`src/styles.css`):** Vollständige Anpassung der Autocomplete-Dropdowns an alle 5 Hell- und Dunkel-Themes von Zuber mittels CSS-Variablen (`--bg-secondary`, `--text-primary`, `--accent-primary`), inklusive deutlicher Hervorhebung für Treffer (`.cm-completionMatchedText`) und Tastaturnavigation.
- **Canvas-Embed Optimierung (`src/components/canvas/CanvasEmbedWidget.tsx` & `src/styles.css`):** Entfernung der störenden MiniMap aus eingebetteten Canvas-Widgets im Markdown-Editor, automatisches zentriertes `fitView` mit 25% Padding und zentrierte Widget-Ausrichtung im Dokumentenfluss.
- **Web Share Target Duplikat-Schutz (`src/App.tsx`, `src/sync/shareTargetService.ts` & `src/sync/syncEngine.ts`):** Verhindert das mehrfache Anlegen (Doppel-/Dreifachnotizen) beim Empfang geteilter Inhalte auf Android und Desktop durch einen atomaren In-Memory-Verarbeitungs-Lock (`isProcessingSharesRef` / `isProcessingSharesGlobal`), sofortiges Löschen der Einträge aus der IndexedDB-Queue noch vor Beginn der Datei-I/O, synchrone Bereinigung der URL-Parameter, Signatur-Deduplizierung sowie eine 5-Sekunden-Schutzprüfung gegen identische Notiztitel und Inhalte mit deterministischer Benennung (`${item.timestamp}_...`).
- **Pfeilrichtung bei automatischer Knotenerstellung im Canvas (`CanvasEditor.tsx`):** Der Ursprungsknoten ist beim Droppen auf die freie Canvas-Fläche nun strikt als `source` und der neu erzeugte Knoten als `target` definiert, sodass die Pfeilspitze (`markerEnd`) immer verlässlich auf den neuen Knoten zeigt – selbst wenn der Drag an einem als Target typisierten Handle des Ursprungsknotens gestartet wurde.
- Dynamisches Andocken an die nächstgelegene Kante bei Auto-Erstellung von Knoten im Canvas (`CanvasEditor.tsx` via `onConnectEnd`): Berechnet den Richtungsvektor zwischen dem Ursprungsknoten und dem neu erstellten Knoten und weist der Verbindungslinie dynamisch die dem Ursprung zugewandte Seite (`top`, `bottom`, `left` oder `right`) als `targetHandle` zu, um störende Linienüberlappungen zu verhindern.

## [0.2.2] - 2026-10-19
### Added
- Neues Knowmesh-Anwendungs-Icon (`knowmesh_icon.png` & `knowmesh_icon.svg`): Vollständige Integration des neuen App-Icons in `index.html`, PWA-Manifest (`manifest.webmanifest`), Service Worker Shell-Cache, Login-Bildschirm (`LoginModal.tsx`), Desktop-Navigationsleiste (`knowmesh-ribbon`), Einstellungen-Über-Bereich (`SettingsModal.tsx`) und Error-Boundary-Fallback (`ErrorBoundary.tsx`).
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
- Automatisches Erstellen von Rechteck-Knoten beim Loslassen einer Verbindungslinie auf leerer Canvas-Fläche (`CanvasEditor.tsx` via `onConnectEnd`): Zieht man eine Verbindung von einem beliebigen Handle ins Leere (`.react-flow__pane`), wird an den Maus-/Touch-Koordinaten sofort ein neuer Rechteck-Textknoten (`type: 'canvasShape'`, `shape: 'rectangle'`) erstellt, ausgewählt und mit einer Kante inklusive Ziel-Pfeilspitze verbunden.
- Kanten-Wiederverbindung (Edge Reconnection) mit selektierten Ziehpunkten (`CanvasEditor.tsx` & `src/styles.css`): Über React Flows `edgesReconnectable` und `reconnectEdge` können ausgewählte Verbindungslinien an ihren Enden auf neue Ziel- oder Startknoten umgehängt werden. Reconnection-Handles (`.react-flow__edgeupdater`, 7px Radius, Gold-Akzent) erscheinen ausschließlich bei selektierten Kanten (`.react-flow__edge:not(.selected) .react-flow__edgeupdater { display: none !important; }`).
- Kontrastreiche Kanten-Selektionshervorhebung (`src/styles.css`): Selektierte Verbindungslinien heben sich mit einer 3,5px starken Goldlinie (`stroke: var(--accent-color, #d4af37)`), dezentem Glow (`drop-shadow`) und goldener Pfeilspitze visuell eindeutig von nicht ausgewählten Linien ab.

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
- Invertierte Canvas-Kantenpfeil-Richtung (`CanvasEditor.tsx`, `CanvasShapeNode.tsx` & `canvasMapper.ts`): Behebt das Problem, dass Verbindungslinien von Quellknoten A zu Zielknoten B in Richtung von A zeigten. Die DOM-Reihenfolge der Knoten-Handles in `CanvasShapeNode.tsx` stellt nun sicher, dass Ziehvorgänge stets als `source` initiiert werden; `onConnect` korrigiert etwaige Reversals deterministisch und setzt die Pfeilspitze (`MarkerType.ArrowClosed`) ausschließlich auf `markerEnd`.

## [0.2.1] - 2026-10-18
### Fixed
- Upload & Download path traversal check: Resolved false-positive rejections of valid files and notes containing double dots or ellipses in their names (e.g. note titles ending with `..`) by validating individual path segments instead of full string substring matching.

## [0.2.0] - 2026-10-18
### Added
- Graphical Canvas, Workflow & Network Diagram Editor (`.canvas`):
  - 100% Obsidian JSON Canvas 1.0 specification compatible with graceful degradation for extended shapes.
  - Interactive diagramming powered by `@xyflow/react` with smooth zooming, panning, mini-map, background grid options (dots, lines, off), and touch/pinch support.
  - Extended shapes: `rectangle`, `rounded`, `circle`, `diamond`, `parallelogram`, `hexagon`, `cylinder`, `cloud`, `server`, `router`, `workstation`.
  - Rich custom nodes: Markdown shape nodes with inline `[[Wiki-Link]]` and `#tag` navigation, embedded note/image preview nodes (`type: "file"`), group container nodes (`type: "group"`), and external URL link cards (`type: "link"`).
  - Floating dock toolbar with shape drawers (Workflow & Network), quick note embedding picker, undo/redo history stack (Ctrl+Z / Ctrl+Y), fit-view, and grid snapping.
  - Contextual floating inspector for selecting shapes, 6 Obsidian color presets, connection routing (straight, smooth bezier, step/orthogonal), arrow heads, labels, and deletion.
  - Full backend indexing in `VaultService`: `.canvas` files appear in the file tree with `attachmentKind: 'canvas'` and `<Layout />` icon, integrate into the global knowledge graph with outgoing edges, backlink discovery, and sync manifest.
  - Embedded canvas preview (`![[Workflow.canvas]]` or `![Canvas](Workflow.canvas)`) directly rendered inside Markdown notes in both Live-Preview and Reading views with one-click editor opening.
  - Offline-first caching and outbox mutation persistence in IndexedDB (`localDb.ts`) and `SyncEngine`.
- File & folder upload and download in file tree context menu:
  - Multi-file and recursive directory upload (`webkitdirectory`) with directory structure preservation and strict path traversal validation (`POST /api/vault/upload-entries`).
  - Single file download (attachment) and streaming folder/vault ZIP archive generation (`GET /api/vault/download`) using `archiver` with automatic dotfile and configuration folder (`.git`, `.obsidian`) exclusion.
  - Offline fallback generating browser Blobs from local IndexedDB cache for single `.md` and `.canvas` note downloads.
  - Interactive file tree context menu entries: "Dateien hochladen…", "Ordner hochladen…", "Datei herunterladen", "Ordner herunterladen (.zip)", and "Gesamten Vault herunterladen (.zip)".
  - Added visual upload status feedback in the sidebar (`.sidebar-upload-status-toast`).
- Containerized Git versioning & automated HTTPS remote backup:
  - Added Git integration running directly inside the Knowmesh server container (`/data/vault`).
  - Added Git settings in UI (`SettingsModal.tsx`) with author identity (name, email), repo status (modified/untracked counts, last commit), manual commit, and remote backup configuration (Codeberg, GitHub, GitLab via HTTPS).
  - Added secure credential handling: credentials in remote URLs and tokens are masked across logs, error messages, and frontend status responses.
  - Added auto-commit triggers on note change/leave and upon ending web sessions (debounced WebSocket disconnect).
  - Added automated pre-push commits and remote connection testing (`git ls-remote`).
- Smartphone & mobile optimizations:
  - Added dual font size matrix (Desktop vs. Mobile & UI vs. Editor) with 4 reactive sliders in SettingsModal under "Editor & Files", persisted in `localStorage` (`knowmesh_font_settings`) and applied via CSS variables `--km-font-size-ui` and `--km-font-size-editor`.
  - Added full-screen sidebars on mobile (`100vw`, `inset: 0`, `z-index: 500`, `background: var(--bg-primary)`) with close buttons and smooth `slideInLeft` / `slideInRight` animations.
  - Added touch swipe gestures on mobile (`< 768px`) with strict vertical scroll protection (`absY >= absX` suppression, `1.4` dominance ratio, and `50px` threshold) to close the left sidebar on swipe-left, close the right sidebar on swipe-right, and open the left sidebar from the edge.

### Changed
- Minimal editor horizontal padding on smartphones (`< 768px`): zero horizontal padding on outer scroll containers, 8px on `.cm-content`, `.reading-view-container`, and `.properties-panel`, while keeping desktop (`>= 768px`) centered at `max-width: 820px; margin: 0 auto;`.
- Enhanced Docker publication script to automatically tag and push both `:latest` and `:v<version>` packages to Codeberg Container Registry.

### Fixed
- Fixed Canvas Context Inspector layout & popover orientation:
  - Transformed bottom floating node & edge context inspector into a horizontal pill bar (`bottom: 20px; left: 50%; transform: translateX(-50%); border-radius: 9999px;`).
  - Configured Shape picker, Color swatches, and Wiki-link popover menus to open upwards (`bottom: calc(100% + 10px)`), eliminating viewport clipping at the screen bottom.
  - Added global click-outside listener to cleanly dismiss open inspector popovers.
- Fixed `.canvas` editor display and interaction issues:
  - Repaired 0-height React Flow container chain (`.canvas-workspace-pane`, `.canvas-editor-wrapper`, `.canvas-reactflow-container`) so background grid and controls render properly across the entire workspace.
  - Rebuilt floating toolbar as a clean horizontal bar with flex-row buttons, divider, and dropdown menus (`Workflow ⌄`, `Netzwerk ⌄`, `Notiz einbetten ⌄`).
  - Fixed state-echo loop between `App.tsx` and `CanvasEditor.tsx` where saving state would overwrite and reset newly added nodes.
  - Fixed node spawn coordinates using robust viewport and container bounding box calculations to ensure new shapes appear centered on the screen.
  - Added `@xyflow/react/dist/style.css` imports to both `CanvasEditor.tsx` and `CanvasEmbedWidget.tsx`.
- Fixed `.canvas` file wipe on note leave or reopening:
  - Resolved missing `rawContent` property in `POST /api/vault/note` route destructuring in `server/index.ts`, preventing server fallback to `{}` when saving canvas files.
  - Added defensive `body: newJson` alongside `rawContent: newJson` in `src/App.tsx` canvas save scheduler.
  - Added immediate `flushSave` on unmount and note switch in `CanvasEditor.tsx` to flush debounced canvas edits before the editor unmounts.
  - Connected `CanvasShapeNode` text editing and `CanvasGroupNode` label editing to `CanvasContext` (`onUpdateNodeData`) to trigger auto-save and push to undo/redo history.
- Fixed Canvas Context Inspector buttons overflowing toolbox container:
  - Updated `.canvas-floating-inspector` border-radius to a modern 12px dock with `box-sizing: border-box`, `padding: 6px 14px`, and `height: 44px`, preventing button corners and hover outlines from sticking out beyond circular pill caps.
  - Refined `.inspector-tool-btn` with `border-radius: 8px` and dedicated `.icon-only` styling (`32px x 32px`, `padding: 0`).
  - Ensured Node and Edge inspectors are strictly mutually exclusive so both rows cannot render simultaneously.
- Fixed Wiki-Links inside Canvas objects not being clickable or visibly styled as links:
  - Rendered `[[Wiki-Links]]` as `<a href="#" class="cm-wikilink-widget canvas-wikilink nodrag" ...>` and added `handleDisplayMouseDown` to stop propagation on mouse down, preventing React Flow node dragging from intercepting link clicks.
  - Connected `onOpenNote` in `App.tsx` directly to `handleNavigateWikiLink(targetPath)` for instant local resolution, alias handling, and auto-creation of missing linked notes.
  - Styled `.canvas-wikilink` in `styles.css` with gold accent color, underline, pointer cursor, and hover background highlights.
  - Enabled Wiki-Link and anchor click navigation in embedded Markdown previews inside `CanvasFileNode`.
- Fixed new devices (e.g., Chromebook) showing an empty offline Vault after login and failing to sync newly created notes to the server because `SyncEngine` remained in `offline` state after authentication.
- Fixed offline mode file & folder creation where creating a second note or folder could collide with default names, get delayed by pending auto-save timers or network timeouts, or fail to reconcile into the local IndexedDB file tree.

## [0.1.0] - 2026-10-17
### Added
- Initial release of Knowmesh (formerly Obsidian Web Vault / Basalt).
- Offline-first PWA architecture with IndexedDB caching and robust outbox synchronization.
- Multi-server profile management and server-side password security settings.
- Responsive touch support, mobile swipe-to-open drawer, and Live-Preview Markdown editor.
- Internationalization (i18n) supporting English (default) and German in the appearance settings.
- Configurable startup behavior under "Editor & Files" (Last note, Daily note, or Specific note).
- File tree context menu supporting Copy, Move, Paste, Rename, and Delete actions.
- Docker setup and Codeberg CI/CD container registry integration.
