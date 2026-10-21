### Added
- Codeblock syntax highlighting, hidden backticks in preview, language badge and copy-to-clipboard button.
- **Web Share Target API für Bilder, PDFs und Markdown-Dateien in `Inbox/` (`manifest.webmanifest`, `public/sw.js`, `src/sync/shareTargetService.ts` & `src/App.tsx`):**
  - Ermöglicht das direkte Teilen von Notizen, Bildern (`image/*`), PDFs (`application/pdf`) und Markdown-Dateien (`.md`, `text/markdown`, `text/plain`) aus dem nativen Android-/Browser-Share-Sheet in Knowmesh.
  - Der Service Worker fängt `POST /share-target` ab, serialisiert Dateidaten in die IndexedDB-Queue `knowmesh_shared_incoming` und leitet per HTTP 303 Redirect weiter.
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
    - `docker-compose.yml` und `.env.example` auf Container `zuber`, Image `codeberg.org/waring/zuber:latest` und `PASSWORD=` aktualisiert.
    - Build- und Publish-Skripte (`scripts/publish-codeberg.sh` und `.forgejo/workflows/docker-publish.yml`) auf Image `codeberg.org/waring/zuber` angepasst.
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
