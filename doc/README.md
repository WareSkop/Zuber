# Basalt – Technische Dokumentation & LLM-Handbuch

Dieses Verzeichnis (`doc/`) enthält die vollständige technische Dokumentation von **Basalt** (ehemals „Obsidian Web Vault“). Die Dokumentation ist speziell darauf ausgelegt, dass ein **LLM (Large Language Model / Coding-Agent)** das Projekt sofort vollständig versteht, sicher erweitern und fehlerfrei warten kann, ohne erst den gesamten Quellcode durchsuchen zu müssen.

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

**Basalt** stellt einen lokalen Obsidian-kompatiblen Vault (Verzeichnis mit Markdown-Dateien `.md` sowie Anhängen wie `.png`, `.jpg`, `.svg`, `.pdf`, `.xlsx`) über eine **TLS/HTTPS-verschlüsselte Web-Applikation und Progressive Web App (PWA)** im Browser bereit – optimiert für Desktop, Chromebooks und Smartphones.

### Hauptmerkmale
- **Progressive Web App (PWA) & Offline-App-Shell:**
  - Service Worker (`public/sw.js`) und Web-Manifest (`public/manifest.webmanifest`) ermöglichen Standalone-Installation und sofortigen Start selbst bei getrennter Netzwerkverbindung.
- **Obsidian-artiger Editor mit 3 Modi (`live`, `reading`, `source`):**
  - **Live-Preview (Standard):** CodeMirror 6 Editor, der Markdown-Syntax (`# Überschriften`, `**Fett**`, `==Highlight==`, `` `Code` ``, `- [ ] Aufgaben`, `[[Wiki-Links]]`, `[Links](pfad)`, `![[Einbettungen]]`, `![Bilder](pfad)`, `> [!callouts]`, `#tags` und `| Markdown | Tabellen |`) visuell rendert, sobald sich der Cursor außerhalb der betreffenden Zeile bzw. Tabelle befindet.
  - **Lese-Modus (`reading`):** Vollständig gerenderte HTML-Ansicht (GFM inkl. Tabellen, Callouts, Bildern, klickbaren Wiki-Links und Tags).
  - **Quellcode-Modus (`source`):** Direkte Bearbeitung des kompletten Roh-Markdown-Dokuments inklusive `---` YAML-Frontmatter-Block.
- **Interaktive Bildanpassung (Größenänderung per Maus & Ausrichtung):**
  - Bilder können im Editor markiert, an den Drag-Handles mit der Maus in der Größe skaliert und über eine Toolbar links, zentriert, rechts oder inline ausgerichtet werden.
  - Gespeichert wird standardkonform als `<img src="..." width="..." align="..." />` für maximale Kompatibilität mit Markdown und Webviewern.
- **Obsidian-Befehlspalette (`Ctrl+P` / `Cmd+P`):**
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
- **Echtzeit-Synchronisation (Chokidar + WebSockets):**
  - Externe Dateiänderungen im Vault (z. B. durch Obsidian Desktop, Syncthing oder Git) werden vom Server erkannt, inkrementell indiziert und gebündelt (batched) per WebSocket an den Browser gepusht.

---

## 2. Verzeichnis- und Dateistruktur

```text
/home/ingo/Downloads/MarkdownEdit/
├── .env                          # Laufzeit-Konfiguration (Port, Passwort, Vault-Pfad, TLS)
├── index.html                    # Vite HTML-Einstiegspunkt
├── package.json                  # Abhängigkeiten & NPM-Skripte
├── tsconfig.json                 # TypeScript-Konfiguration (ES2022, Bundler, React-JSX)
├── vite.config.ts                # Vite-Konfiguration (inkl. Dev-Proxy für /api und /ws auf https://localhost:3443)
├── certs/                        # Automatisch generierte Self-Signed TLS-Zertifikate (server.crt, server.key)
├── dist/                         # Gebautes Produktions-Frontend (wird von Express in Produktion ausgeliefert)
├── vault/                        # Standard-Vault-Verzeichnis (Markdown-Dateien & Attachments)
├── doc/                          # Diese Dokumentation für LLMs & Entwickler
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── API_AND_TYPES.md
│   ├── FRONTEND_AND_EDITOR.md
│   └── LLM_DEVELOPER_GUIDE.md
├── shared/                       # Geteilter Code zwischen Backend (Node.js) und Frontend (Browser)
│   ├── types.ts                  # Zentrale TypeScript-Interfaces (NoteData, GraphData, FileTreeNode, ...)
│   └── markdownUtils.ts          # Frontmatter-YAML-Parser/Serializer, Link-/Embed-/Tag-/Heading-Extraktoren
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
    ├── styles.css                # Komplettes Styling (Dark/Light Theme, CodeMirror, Tabellen, Graph)
    └── components/
        ├── LoginModal.tsx        # Passwort-Login-Dialog mit HTTPS-Statusanzeige
        ├── FileSidebar.tsx       # Linke Seitenleiste: Dateibaum, Volltextsuche, Tag-Liste (React.memo)
        ├── PropertiesEditor.tsx  # Visueller Frontmatter-Editor ohne YAML-Code
        ├── LivePreviewEditor.tsx # CodeMirror 6 Live-Preview, Tabellen-Widget, Lese- & Quellcode-Modus
        └── GraphView.tsx         # Interaktiver Force-Directed Canvas-Graph (React.memo)
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
