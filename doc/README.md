# Zuber – Technische Dokumentation & LLM-Handbuch

Dieses Verzeichnis (`doc/`) enthält die vollständige technische Dokumentation von **Zuber** (ehemals „Knowmesh“ / „Basalt“). Die Dokumentation ist speziell darauf ausgelegt, dass ein **LLM (Large Language Model / Coding-Agent)** das Projekt sofort vollständig versteht, sicher erweitern und fehlerfrei warten kann, ohne erst den gesamten Quellcode durchsuchen zu müssen.

---

## Inhaltsverzeichnis der Dokumentation

1. **[README.md](./README.md)** *(diese Datei)*
   Projektüberblick, Verzeichnisstruktur, Tech-Stack, Start-/Build-/Test-Befehle und goldene Regeln (Invarianten).
2. **[ARCHITECTURE.md](./ARCHITECTURE.md)**
   Backend-Architektur, In-Memory-Vault-Index (`VaultService`), Link-/Bild-Auflösung, Chokidar-Dateisystem-Watcher, WebSocket-Batching, TLS/HTTPS & Single-User-Authentifizierung.
3. **[API_AND_TYPES.md](./API_AND_TYPES.md)**
   Vollständige Referenz aller REST-Endpunkte (`/api/...`), WebSocket-Nachrichten (`/ws`), geteilten TypeScript-Interfaces (`shared/types.ts`) und Markdown/YAML-Parser-Funktionen (`shared/markdownUtils.ts`).
4. **[FRONTEND_AND_EDITOR.md](./FRONTEND_AND_EDITOR.md)**
   React-Komponentenarchitektur, State-Fluss in `src/App.tsx`, CodeMirror 6 Live-Preview-Engine (`LivePreviewEditor.tsx`), visueller Frontmatter-Manager (`PropertiesEditor.tsx`) und Physik-Engine der Graph-Ansicht (`GraphView.tsx`).
5. **[LLM_DEVELOPER_GUIDE.md](./LLM_DEVELOPER_GUIDE.md)**
   Konkrete Schritt-für-Schritt-Anleitungen (Playbooks) für häufige Erweiterungen (neue Editor-Syntax, neue Property-Typen, neue API-Routen), Performance-Leitplanken und Checklisten.

---

## 1. Projektziel & Kernfunktionen

**Zuber** stellt einen lokalen Markdown-Vault (Verzeichnis mit Markdown-Dateien `.md` sowie Anhängen wie `.png`, `.jpg`, `.svg`, `.pdf`, `.xlsx` – kompatibel zur Wiki-Link- und YAML-Frontmatter-Syntax) über eine **TLS/HTTPS-verschlüsselte Web-Applikation und Progressive Web App (PWA)** im Browser bereit – optimiert für Desktop, Chromebooks und Smartphones.

### Hauptmerkmale
- **Progressive Web App (PWA) & Offline-App-Shell:**
  - Service Worker (`public/sw.js`) und Web-Manifest (`public/manifest.webmanifest`) ermöglichen Standalone-Installation und sofortigen Start selbst bei getrennter Netzwerkverbindung.
- **Zuber Markdown-Editor mit 3 Modi (`live`, `reading`, `source`):**
  - **Live-Preview (Standard):** CodeMirror 6 Editor, der Markdown-Syntax (`# Überschriften`, `**Fett**`, `==Highlight==`, `` `Code` ``, `- [ ] Aufgaben`, `[[Wiki-Links]]`, `[Links](pfad)`, `![[Einbettungen]]`, `![Bilder](pfad)`, `> [!callouts]`, `#tags` und `| Markdown | Tabellen |`) visuell rendert, sobald sich der Cursor außerhalb der betreffenden Zeile bzw. Tabelle befindet.
  - **Lese-Modus (`reading`):** Vollständig gerenderte HTML-Ansicht (GFM inkl. Tabellen, Callouts, Bildern, klickbaren Wiki-Links und Tags).
  - **Quellcode-Modus (`source`):** Direkte Bearbeitung des kompletten Roh-Markdown-Dokuments inklusive `---` YAML-Frontmatter-Block.
- **Interaktive Bildanpassung (Größenänderung per Maus & Ausrichtung):**
  - Bilder können im Editor markiert, an den Drag-Handles mit der Maus in der Größe skaliert und über eine Toolbar links, zentriert, rechts oder inline ausgerichtet werden.
  - Gespeichert wird standardkonform als `<img src="..." width="..." align="..." />` für maximale Kompatibilität mit Markdown und Webviewern.
- **Befehlspalette (`Ctrl+P` / `Cmd+P`):**
  - Globaler Schnellzugriff auf alle Befehle (Formatierung, Tabellen, Aufgaben, Codeblöcke, Ansichtsumschaltung, Themes, Sync) mit Tastaturnavigation und Shortcut-Anzeige.
- **Responsive Oberfläche & ein-/ausblendbare Seitenleisten:**
  - Linke und rechte Leiste können über Header-Buttons oder Shortcuts (`Ctrl+\` bzw. `Ctrl+Alt+\`) eingeklappt werden, ideal für kleine Bildschirme und Smartphones.
- **Visuelle Frontmatter-Verwaltung („Eigenschaften“):**
  - YAML-Frontmatter wird niemals als roher YAML-Code im Live-Preview- oder Lese-Modus angezeigt, sondern oberhalb des Editors durch `PropertiesEditor.tsx` als interaktives Formular (`text`, `list` / Tags-Chips, `date`, `checkbox`, `number`) verwaltet.
- **Hierarchischer Dateibaum, Volltextsuche & Tag-Explorer (`FileSidebar.tsx`):**
  - Komplette Ordner- und Dateiverwaltung (Erstellen, Umbenennen inkl. automatischer Aktualisierung von `[[Wiki-Links]]` im gesamten Vault, Löschen).
- **Interaktive Graph-Ansicht (`GraphView.tsx`) & Backlinks:**
  - Force-Directed Canvas-Graph (sowohl als **Globaler Graph**, im **Split-Screen** neben dem Editor als auch als **Lokaler Graph** in der rechten Seitenleiste).
  - Rechte Seitenleiste mit **Verlinkten Erwähnungen (Backlinks)**, **Unverlinkten Erwähnungen** und **Gliederung (H1–H6)**.
- **Asymmetrische 70/30 Recherche- & Referenzansicht (Research Split-View):**
  - Resizable Split-View (standardmäßig 70 % Haupteditor / 30 % Read-Only Referenzbereich, persistent in `localStorage`).
  - Unterstützt gerendertes Markdown (`.md`), interaktive Canvas-Diagramme (`.canvas`), Bilder (`.png`, `.jpg`, `.svg`, etc.), PDF-Dokumente (`.pdf`) und den interaktiven Wissensgraphen.
  - Intelligentes Klick-Routing: Reguläre Klicks auf Links, Notizen und Backlinks öffnen im Referenzbereich, während `Alt + Klick` gezielt im Haupteditor öffnet.
  - Responsiver Spalten- (Desktop) bzw. Zeilensplit (Smartphones) und nahtlose Beibehaltung im Zen-Modus (`Alt+Z`) inklusive ziehbarem Trennbalken.
- **Grafischer Canvas-, Workflow- & Netzwerk-Editor (`.canvas`):**
  - Vollwertiger visueller Canvas-Editor basierend auf `@xyflow/react`, 100 % abwärtskompatibel zur offiziellen Obsidian JSON Canvas Spec 1.0.
  - Erweiterte Formen für Workflows und Netzwerkdiagramme (`rectangle`, `rounded`, `circle`, `diamond`, `parallelogram`, `hexagon`, `cylinder`, `cloud`, `server`, `router`, `workstation`) mit Graceful Degradation in Obsidian.
  - Nahtlose Vault-Integration: Notiz-Einbettungen mit Live-Vorschau, Wiki-Links (`[[...]]`) in Shapes/Kanten mit Schnellvervollständigung, Tag-Zählung, bidirektionale Graph- und Backlink-Aktualisierung sowie automatische Referenzanpassung beim Verschieben/Umbenennen.
  - Interaktive Einbettung von Canvas-Dateien in Markdown-Dokumenten via `![[Workflow.canvas]]`.
- **Echtzeit-Synchronisation (Chokidar + WebSockets):**
  - Externe Dateiänderungen im Vault (z. B. durch Obsidian Desktop, Syncthing oder Git) werden vom Server erkannt, inkrementell indiziert und gebündelt (batched) per WebSocket an den Browser gepusht.

---

## 2. Verzeichnis- und Dateistruktur

```text
/home/ingo/Developement/Knowmesh/
├── .env                          # Laufzeit-Konfiguration (Port, Passwort, Vault-Pfad, TLS)
├── index.html                    # Vite HTML-Einstiegspunkt
├── package.json                  # Abhängigkeiten & NPM-Skripte
├── tsconfig.json                 # TypeScript-Konfiguration (ES2022, Bundler, React-JSX)
├── vite.config.ts                # Vite-Konfiguration (inkl. Dev-Proxy für /api und /ws auf https://localhost:3443)
├── certs/                        # Automatisch generierte Self-Signed TLS-Zertifikate (server.crt, server.key)
├── dist/                         # Gebautes Produktions-Frontend (wird von Express in Produktion ausgeliefert)
├── vault/                        # Standard-Vault-Verzeichnis (Markdown-Dateien, .canvas & Attachments)
├── doc/                          # Diese Dokumentation für LLMs & Entwickler
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── API_AND_TYPES.md
│   ├── FRONTEND_AND_EDITOR.md
│   └── LLM_DEVELOPER_GUIDE.md
├── shared/                       # Geteilter Code zwischen Backend (Node.js) und Frontend (Browser)
│   ├── types.ts                  # Zentrale TypeScript-Interfaces (NoteData, GraphData, FileTreeNode, ...)
│   ├── canvasTypes.ts            # JSON Canvas Spec 1.0 Typen + Zuber Workflow-/Netzwerk-Erweiterungen
│   └── markdownUtils.ts          # Frontmatter-YAML-Parser/Serializer, Link-/Canvas-/Tag-Extraktoren
├── server/                       # Node.js + Express + WebSocket Backend
│   ├── index.ts                  # Express-App, REST-Endpunkte, HTTPS-Server, WebSocket-Server
│   ├── auth.ts                   # Single-User Passwort-Prüfung & HMAC-SHA256 Session-Token-Signierung
│   ├── tls.ts                    # Laden eigener Zertifikate oder Auto-Generierung via openssl
│   ├── vaultService.ts           # In-Memory Vault-Index, Dateioperationen, Graph-Builder, Chokidar-Watcher
│   └── vaultService.test.ts      # Vitest Unit- & Integrationstests für Parser, Index, Graph & TLS
└── src/                          # React + TypeScript + CodeMirror 6 Frontend
    ├── main.tsx                  # React DOM Root
    ├── App.tsx                   # Haupt-State, Layout-Shell, WebSocket-Client, Auto-Save, Navigation
    ├── api.ts                    # Typisierter Fetch-Client für alle /api-Routen & Attachment-URLs
    ├── styles.css                # Komplettes Styling (Dark/Light Theme, CodeMirror, Tabellen, Graph, Canvas)
    └── components/
        ├── LoginModal.tsx        # Passwort-Login-Dialog mit HTTPS-Statusanzeige
        ├── FileSidebar.tsx       # Linke Seitenleiste: Dateibaum, Volltextsuche, Tag-Liste (React.memo)
        ├── PropertiesEditor.tsx  # Visueller Frontmatter-Editor ohne YAML-Code
        ├── LivePreviewEditor.tsx # CodeMirror 6 Live-Preview, Tabellen-Widget, Canvas-Embeds, Lese-/Quellcode-Modus
        ├── GraphView.tsx         # Interaktiver Force-Directed Canvas-Graph (React.memo)
        └── canvas/               # Vollwertiger grafischer .canvas-Editor (@xyflow/react)
            ├── CanvasEditor.tsx      # Haupt-Editor-Komponente mit React Flow, Undo/Redo & Auto-Save
            ├── CanvasToolbar.tsx     # Dock-Toolbar mit Node-Erstellung, Workflow-/Netzwerk-Drawer
            ├── CanvasInspector.tsx   # Schwebender Inspektor für Farben, Formen, Text & Kantenattribute
            ├── CanvasShapeNode.tsx   # SVG-Geometrie für 11 Formen, 4 Handles, Inline-Markdown & [[Wiki-Autovervollständigung
            ├── CanvasFileNode.tsx    # Notiz-Einbettungs-Node mit Live-Textvorschau und "Öffnen ↗"-Aktion
            ├── CanvasGroupNode.tsx   # Visuelle Gruppen-Container mit Beschriftung
            ├── CanvasLinkNode.tsx    # Externe Web-Link-Nodes mit Titel & Vorschau
            ├── CanvasEmbedWidget.tsx # Leichtgewichtiger interaktiver Embed-Widget für ![[...canvas]] in Notizen
            └── canvasMapper.ts       # Bidirektionale Konvertierung zwischen Obsidian JSON Canvas und React Flow
```

---

## 3. Wichtige Befehle (Build, Start, Test, Dev)

| Befehl | Beschreibung |
| :--- | :--- |
| `npm test` | Führt die Vitest-Testsuite (`server/vaultService.test.ts`) einmalig aus (`vitest run`). |
| `npm run build` | Prüft alle Typen (`tsc -b`) und baut das Produktions-Frontend nach `dist/` (`vite build`). |
| `npm start` | Startet den Produktionsserver (`NODE_ENV=production tsx server/index.ts`) auf `https://localhost:3443`. Liefert sowohl `/api`, `/ws` als auch die statischen Dateien aus `dist/` aus. |
| `npm run dev` | Startet Backend (`tsx watch server/index.ts` auf Port `3443`) und Vite-Dev-Server (`vite` auf Port `5173`) parallel mit Hot-Reload. |

> [!IMPORTANT]
> **Hinweis für LLMs nach Frontend-Änderungen:**
> Wenn der Server über `npm start` auf Port `3443` läuft, liefert Express das gebaute Bundle aus `dist/` aus. Nach jeder Änderung in `src/` oder `shared/` **muss** `npm run build` ausgeführt werden, damit die Änderungen in `dist/` landen!

---

## 4. Goldene Architektur-Invarianten (Unbedingt einhalten!)

1. **Keine synchronen Komplett-Scans des Dateisystems während HTTP-Requests!**
   - Ein realer Vault hat schnell **1.800+ Dateien** und mehrere hundert Megabyte an Bildern/PDFs.
   - `VaultService` (`server/vaultService.ts`) hält einen **In-Memory-Index** (`this.files`, `this.notes`, `this.lowerPathIndex`, `this.nameIndex`, `this.aliasIndex`, `this.treeCache`, `this.graphCache`).
   - Alle Lese-Operationen (`getFileTree`, `getNote`, `resolveWikiTarget`, `buildGraph`, `getBacklinks`, `searchVault`) müssen aus diesem In-Memory-Index bedient werden ($O(1)$ bzw. wenige Millisekunden) und dürfen niemals den Node.js Event-Loop durch tausende `fs.readFileSync`-Aufrufe blockieren (andernfalls stockt das Streaming von Bildern in `res.sendFile`!).
2. **Kein YAML-Code im Live-Preview- oder Lese-Modus!**
   - `parseMarkdownWithFrontmatter` trennt `rawContent` in `properties: FrontmatterProperty[]` und `body: string` (ohne `---` YAML-Block).
   - `LivePreviewEditor` erhält im Modus `'live'` und `'reading'` ausschließlich `body`. Das Frontmatter wird im UI ausschließlich über `PropertiesEditor` dargestellt und bearbeitet. Nur im Modus `'source'` wird `rawContent` im Editor angezeigt.
3. **Viewport-Windowing in CodeMirror 6 (`LivePreviewEditor.tsx`):**
   - `buildLivePreviewDecorations` darf nur den sichtbaren Bereich (`view.visibleRanges` ± 60 Zeilen Puffer) dekorieren, niemals blind alle Zeilen eines riesigen Dokuments bei jedem Tastendruck.
4. **Kühlende Physik-Simulation im `GraphView.tsx`:**
   - Der Canvas-Graph nutzt einen `alpha`-Abkühlfaktor (`alphaRef.current`). Sobald `alpha <= 0.008` fällt, stoppt die `requestAnimationFrame`-Schleife komplett (0 % CPU-Last im Ruhezustand) und wacht erst bei Benutzerinteraktion (`wakeUpRef.current()`) wieder auf.

---

## 5. Deployment mit Docker, GitHub Container Registry (GHCR) & Nginx Proxy Manager (NPM)

Zuber ist vollständig für den Betrieb als Docker-Container hinter einem Reverse Proxy wie dem **Nginx Proxy Manager (NPM)** gehärtet.

### 5.1 Docker Compose Schnellstart

Erstelle eine `docker-compose.yml` (bzw. nutze die im Repository enthaltene Datei):

```yaml
services:
  zuber:
    image: ghcr.io/wareskop/zuber:latest
    container_name: zuber
    restart: unless-stopped
    ports:
      - "3443:3443"
    environment:
      - NODE_ENV=production
      - PORT=3443
      - ENABLE_HTTPS=false        # TLS/Let's Encrypt wird von NPM übernommen
      - TRUST_PROXY=true          # Echte Client-IP für Rate-Limiting & X-Forwarded-Proto
      - FORCE_AUTH=true           # Deaktivieren des Passwortschutzes über Web-UI sperren
      - MAX_UPLOAD_MB=100         # Maximales Upload-Limit für Anhänge
      - PASSWORD=                 # Optionales Initialpasswort (Standard: zuber)
      # - ZUBER_PASSWORD=         # Fallback
      # - KNOWMESH_PASSWORD=      # Legacy-Fallback
      # - OBSIDIAN_WEB_PASSWORD=  # Legacy-Fallback
    volumes:
      - ./vault:/data/vault       # Markdown-Notizen und Anhänge
      - ./config:/data/config     # Server-Konfiguration & Session-Epoch
```

Starten des Containers:
```bash
docker compose up -d
```

### 5.2 Nginx Proxy Manager (NPM) Konfiguration

Lege im Nginx Proxy Manager einen neuen **Proxy Host** an:

- **Domain Names:** z. B. `zuber.deinedomain.de`
- **Scheme:** `http` (da `ENABLE_HTTPS=false` im Docker-Container)
- **Forward Hostname / IP:** `zuber` (bei gemeinsamem Docker-Netzwerk) oder IP des Docker-Hosts
- **Forward Port:** `3443`
- **Cache Assets:** Deaktiviert (oder nur für statische Assets; Service Worker regelt App-Shell-Caching)
- **Block Common Exploits:** **Aktiviert**
- **Websockets Support:** **Aktiviert** (Zwingend für `/ws` Live-Updates)
- **SSL-Tab:**
  - SSL Certificate: Neues Let's Encrypt Zertifikat anfordern
  - Force SSL: **Aktiviert**
  - HTTP/2 Support: **Aktiviert**
  - HSTS Enabled: **Aktiviert**

### 5.3 GitHub Container Registry & CI/CD

Das Image wird automatisiert über GitHub Actions bei jedem Push auf `main` gebaut:
- Registry: `ghcr.io/wareskop/zuber:latest`
- Repository: `https://github.com/WareSkop/Zuber.git`
- Lokaler Build & Push: `./scripts/publish-docker.sh`

