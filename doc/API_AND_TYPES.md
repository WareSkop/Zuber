# API Endpoints, WebSocket Protocol & Shared Types (`doc/API_AND_TYPES.md`)

Dieses Dokument beschreibt sämtliche REST-Endpunkte ([`server/index.ts`](../server/index.ts)), das WebSocket-Protokoll, die gemeinsamen TypeScript-Datenstrukturen ([`shared/types.ts`](../shared/types.ts)) sowie die Markdown-/Frontmatter-Hilfsfunktionen ([`shared/markdownUtils.ts`](../shared/markdownUtils.ts)).

---

## 1. Gemeinsame Datentypen ([`shared/types.ts`](../shared/types.ts))

### 1.1 Verzeichnisbaum (`FileNode`)

```ts
export type FileNodeType = 'file' | 'folder';
export type AttachmentKind = 'markdown' | 'image' | 'pdf' | 'audio' | 'video' | 'other';

export interface FileNode {
  name: string;               // Dateiname mit Endung (z.B. "Notiz.md" oder "image.png")
  path: string;               // Relativer Pfad zum Vault-Root mit "/" (z.B. "Projekte/Notiz.md")
  type: FileNodeType;         // 'file' | 'folder'
  extension?: string;         // Dateiendung ohne Punkt in Kleinbuchstaben (z.B. "md", "png")
  attachmentKind?: AttachmentKind;
  size?: number;              // Dateigröße in Bytes
  mtime?: number;             // Letzte Änderung (Unix Timestamp in ms)
  children?: FileNode[];      // Nur bei type === 'folder' (Ordner zuerst, dann alphabetisch)
}
```

### 1.2 Visuelles Frontmatter (`FrontmatterProperty`)

Frontmatter wird zwischen Backend und Frontend sowohl als typisierte Liste (`properties`) als auch als rohes Schlüssel-Wert-Objekt (`frontmatter`) übertragen. Im UI wird **ausschließlich** `properties` über den [`PropertiesEditor`](../src/components/PropertiesEditor.tsx) gerendert (kein YAML-Quellcode im Editor).

```ts
export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'tags';

export interface FrontmatterProperty {
  key: string;                // YAML-Schlüssel (z.B. "tags", "aliases", "status", "created")
  type: PropertyType;         // Bestimmt das Eingabe-Widget in PropertiesEditor.tsx
  value: string | number | boolean | string[] | null;
}
```

**Automatische Typ-Erkennung beim Parsen ([`inferPropertyType`](../shared/markdownUtils.ts)):**
- Schlüssel `tags` oder `tag` $\rightarrow$ `'tags'` (Wert wird immer zu `string[]` normalisiert)
- Schlüssel `aliases` oder `alias` $\rightarrow$ `'list'` (Wert wird immer zu `string[]` normalisiert)
- `Array.isArray(val)` $\rightarrow$ `'list'`
- `typeof val === 'boolean'` $\rightarrow$ `'checkbox'`
- `typeof val === 'number'` $\rightarrow$ `'number'`
- String im Format `YYYY-MM-DD` (oder mit Zeitstempel) $\rightarrow$ `'date'`
- Alles andere $\rightarrow$ `'text'`

### 1.3 Notiz-Nutzdaten (`NotePayload` & `NoteSaveRequest`)

```ts
export interface BacklinkItem {
  sourcePath: string;         // Pfad der verlinkenden Notiz
  sourceTitle: string;        // Anzeigename der verlinkenden Notiz
  lineExcerpt: string;        // Textzeile (max. 180 Zeichen), in der der Link vorkommt
}

export interface NoteHeading {
  level: number;              // 1 bis 6 (# bis ######)
  text: string;               // Überschriftentext
  line: number;               // 1-basierte Zeilennummer innerhalb von `body`
}

export interface NotePayload {
  path: string;               // Relativer Vault-Pfad (z.B. "Projekte/Idee.md")
  name: string;               // Dateiname ohne ".md" (z.B. "Idee")
  body: string;               // Markdown-Inhalt OHNE YAML-Frontmatter
  rawContent: string;         // Kompletter Dateiinhalt INKL. "---\n...\n---"
  properties: FrontmatterProperty[];
  frontmatter: Record<string, unknown>;
  outgoingLinks: string[];    // Extrahierte Ziele aus [[Wiki]] und [MD](links)
  backlinks: BacklinkItem[];  // Eingehende Referenzen von anderen Notizen
  tags: string[];             // Kombinierte Tags aus Frontmatter + Inline-#tags (ohne #)
  headings: NoteHeading[];    // Überschriften für Gliederung / Outline
  mtime: number;              // Zeitstempel der Datei
}

export interface NoteSaveRequest {
  path: string;
  body: string;               // Markdown-Text ohne Frontmatter
  properties: FrontmatterProperty[]; // Wird mit serializeNote() vor dem Schreiben zu YAML zusammengefügt
  baseMtime?: number;         // Server-mtime vor der lokalen Bearbeitung (zur Konflikterkennung)
  forceOverwrite?: boolean;   // Erzwingt das Überschreiben trotz Konflikt
}

export interface ConflictErrorResponse {
  error: 'Conflict';
  serverNote: NotePayload;    // Aktueller Stand der Notiz auf dem Server
}

export interface SyncManifestEntry {
  path: string;               // Relativer Vault-Pfad
  type: 'markdown' | 'attachment';
  mtime: number;              // Änderungszeitstempel in ms
  size: number;               // Dateigröße in Bytes
}

export interface SecuritySettingsResponse {
  authEnabled: boolean;
}

export interface UpdateSecurityRequest {
  currentPassword?: string;
  authEnabled: boolean;
  newPassword?: string;
}

export interface VaultProfile {
  id: string;
  name: string;
  serverUrl: string;
  token?: string;
}
```

### 1.4 Graph-Daten (`GraphData`)

```ts
export interface GraphNode {
  id: string;                 // Relativer Pfad (z.B. "Projekte/Idee.md") oder "unresolved:Ziel"
  label: string;              // Anzeigename ohne ".md"
  path: string;               // Relativer Pfad (leer bei "unresolved:*")
  exists: boolean;            // true = existierende .md Datei, false = noch nicht erstellte Zielnotiz
  tags: string[];             // Tags der Notiz (für Filter & Farbgebung)
  degree: number;             // Anzahl verbundener Kanten (skaliert den Knotenradius)
  folder: string;             // Übergeordneter Ordnername oder "(Root)"
}

export interface GraphEdge {
  source: string;             // GraphNode.id der Quellnotiz
  target: string;             // GraphNode.id der Zielnotiz
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

---

## 2. REST-API Endpunkte ([`server/index.ts`](../server/index.ts))

Alle `/api/*`-Endpunkte (außer `/api/auth/*`) sind durch [`authMiddleware`](../server/auth.ts) geschützt (Header `Authorization: Bearer <token>` oder Cookie `knowmesh_session` / `basalt_session`). Ist `authEnabled === false`, werden alle Anfragen automatisch autorisiert.

### 2.1 Authentifizierung & Sicherheit

| Methode | Pfad | Beschreibung | Request Body / Query | Response (`200 OK`) |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/status` | Prüft, ob ein gültiges Token vorliegt oder ob der Passwortschutz deaktiviert ist. | — | `{ authenticated: boolean, authRequired: boolean, https: boolean, vaultPath: string }` |
| `POST` | `/api/auth/login` | Prüft das Passwort zeitkonstant gegen `server-config.json` und gibt Token zurück. | `{ password: string }` | `{ authenticated: true, token: string }` (oder `401`) |
| `POST` | `/api/auth/logout` | Löscht das Sitzungs-Cookie. | — | `{ authenticated: false }` |
| `GET` | `/api/settings/security` | Liefert den aktuellen Status des Passwortschutzes. | — | `{ authEnabled: boolean }` |
| `POST` | `/api/settings/security` | Ändert Passwort oder schaltet Auth ein/aus (prüft altes Passwort). | `{ currentPassword?: string, authEnabled: boolean, newPassword?: string }` | `{ ok: true, authEnabled: boolean, token?: string }` |

### 2.2 Vault-Baum, Sync & Notizen

| Methode | Pfad | Beschreibung | Request Body / Query | Response (`200 OK`) |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/vault/sync-manifest` | Liefert blitzschnell $O(N)$ alle Dateien im Vault mit Typ, mtime und Größe für PWA-Delta-Sync. | — | `SyncManifestEntry[]` |
| `POST` | `/api/vault/notes-batch` | Lädt mehrere Notizen gebündelt aus dem In-Memory-Index herunter. | Body: `{ paths: string[] }` | `{ notes: NoteData[] }` |
| `GET` | `/api/vault/tree` | Liefert den gecachten Verzeichnisbaum und alle Dateieinträge. | — | `{ tree: FileTreeNode[], files: Array<{path, name, basename, extension}>, vaultPath: string }` |
| `GET` | `/api/vault/note` | Liest eine Markdown-Notiz inkl. Backlinks. | Query: `?path=Ordner/Notiz.md` | `NoteData` (oder `404`) |
| `POST` | `/api/vault/note` | Speichert eine Notiz mit optionaler Konflikterkennung (`baseMtime`). Bei Konflikt -> HTTP `409 Conflict`. | Body: `NoteSaveRequest` | `NoteData` (oder `409` mit `{ error: 'Conflict', serverNote }`) |
| `POST` | `/api/vault/folder` | Erstellt einen neuen Ordner (inkl. Zwischenordnern). | Body: `{ path: string }` | `{ ok: true, path: string }` |
| `POST` | `/api/vault/rename` | Benennt eine Datei/Ordner um und passt `[[Links]]` vault-weit an. | Body: `{ oldPath: string, newPath: string }` | `{ ok: true, newPath: string }` |
| `DELETE` | `/api/vault/entry` | Löscht eine Datei oder einen Ordner rekursiv. | Query: `?path=Ordner/Datei.md` | `{ ok: true }` |

### 2.3 Graph, Backlinks, Suche & Link-Auflösung

| Methode | Pfad | Beschreibung | Query-Parameter | Response (`200 OK`) |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/vault/graph` | Liefert die gecachten Knoten und Kanten für die Graph-Ansicht ($O(1)$ bei Cache-Hit). | — | `GraphData` |
| `GET` | `/api/vault/backlinks` | Berechnet alle eingehenden Links auf die angegebene Notiz. | `?path=Ordner/Notiz.md` | `{ backlinks: BacklinkItem[] }` |
| `GET` | `/api/vault/search` | Volltext-, Dateinamen-, Alias- und `#tag`-Suche über den In-Memory-Index. | `?q=Suchbegriff` | `{ results: SearchResultItem[] }` (max. 60 Treffer) |
| `GET` | `/api/vault/resolve` | Löst ein Wiki-Link- oder Markdown-Link-Ziel in einen existierenden Vault-Pfad oder einen Vorschlagspfad für neue Notizen auf. | `?target=Linkziel&from=Quell/Notiz.md` | `{ exists: boolean, path: string, kind: AttachmentKind }` |

### 2.4 Anhänge (Bilder, PDFs, Audio, Video, sonstige Dateien)

| Methode | Pfad | Beschreibung | Parameter / Body | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/vault/attachment` | Streamt eine Datei aus dem Vault. Unterstützt direkte Pfade, URL-kodierte Pfade (`%20`), ordnerrelative Pfade (wenn `from` angegeben ist) und Obsidian-Kurznamen (`![[bild.png]]`). | Query: `?path=...&from=Quell/Notiz.md` | Binärer Datei-Stream (`res.sendFile`) mit `Cache-Control: private, max-age=3600` und `ETag` |
| `POST` | `/api/vault/upload` | Lädt eine neue Binärdatei per `multipart/form-data` (Feldname `file`) in den angegebenen Zielordner hoch (bei Namenskonflikt wird `name-<timestamp>.ext` erzeugt). Erkennt Dateitypen auch bei Clipboard-Blobs ohne Dateiendung automatisch und liefert den fertigen Obsidian-WikiEmbed-Tag (`![[attachments/...]]`) zurück. | Query: `?folder=attachments`<br>Form-Data: `file` | `UploadResponse` (`{ ok: boolean, path: string, name: string, originalName: string, size: number, wikiEmbed: string }`) |

---

## 3. WebSocket-Protokoll (`/ws`)

Der WebSocket-Server (`ws` Paket) teilt sich denselben HTTPS-Port wie Express und validiert beim `upgrade`-Handshake das Cookie `obsidian_web_session` über [`verifyRequestAuth`](../server/auth.ts).

### Nachrichten vom Server an den Client

1. **Verbindungsbestätigung (direkt nach Connect):**
   ```json
   {
     "type": "connected",
     "timestamp": 1760645000000
   }
   ```
2. **Gebündelte Dateisystem-Änderung (`vault:changed`):**
   Wenn Chokidar Änderungen erkennt, bündelt [`VaultService`](../server/vaultService.ts) diese über ein 200ms-Zeitfenster zu einer einzigen Nachricht:
   ```json
   {
     "type": "vault:changed",
     "events": ["change", "add"],
     "paths": ["Projekte/Notiz.md", "attachments/skizze.png"],
     "timestamp": 1760645001200
   }
   ```
   **Reaktion im Frontend ([`src/App.tsx`](../src/App.tsx)):**
   - Der Verzeichnisbaum (`loadVaultOverview(true)`) wird neu geladen.
   - Falls der Graph geöffnet ist, wird `refreshGraph()` aufgerufen.
   - Falls `activeNote.path` in `msg.paths` enthalten ist **und** seit dem letzten eigenen Speichern (`lastLocalSaveRef`) mehr als `1500ms` vergangen sind **und** keine ungespeicherten lokalen Änderungen (`dirty`) vorliegen, wird die geöffnete Notiz automatisch neu geladen.

---

## 4. Markdown- & Frontmatter-Hilfsfunktionen ([`shared/markdownUtils.ts`](../shared/markdownUtils.ts))

Dieses Modul wird sowohl vom Node.js-Backend als auch vom React-Frontend importiert und darf daher **keine Node-spezifischen Module** (`fs`, `path`) verwenden.

| Funktion | Signatur | Beschreibung |
| :--- | :--- | :--- |
| `parseNoteContent` | `(rawContent: string) => ParsedNoteContent` | Trennt optionales YAML-Frontmatter (`---\n...\n---`) vom Markdown-Body, konvertiert die YAML-Einträge in `FrontmatterProperty[]` und extrahiert Links, Tags und Überschriften. |
| `serializeNote` | `(body: string, properties: FrontmatterProperty[]) => string` | Erzeugt aus der visuellen `FrontmatterProperty[]`-Liste wieder sauberes YAML (`js-yaml`) und fügt es mit dem `body` zusammen. Wenn `properties` leer ist, wird kein `---`-Block geschrieben. |
| `extractAllLinks` | `(markdownBody: string) => string[]` | Extrahiert alle internen Verweise aus `[[Wiki-Links]]`, `![[Embeds]]`, `[Markdown-Links](pfad)` und `![Markdown-Bildern](pfad)`. Ignoriert Codeblöcke sowie externe URLs (`http://`, `https://`, `mailto:`, `data:`). Wendet `decodeURIComponent` auf URL-kodierte Pfade (`%20`) an. |
| `parseWikiTarget` | `(rawInner: string) => { target, subpath, alias }` | Zerlegt das Innere eines Wiki-Links wie `Ordner/Notiz#Abschnitt\|Anzeigename` in `{ target: "Ordner/Notiz", subpath: "Abschnitt", alias: "Anzeigename" }`. |
| `extractInlineTags` | `(markdownBody: string) => string[]` | Extrahiert alle `#tags` (inkl. verschachtelter Tags wie `#projekt/aktiv`) außerhalb von Fenced-Codeblöcken und Inline-Code. |
| `extractHeadings` | `(markdownBody: string) => NoteHeading[]` | Extrahiert alle ATX-Überschriften (`#` bis `######`) außerhalb von Codeblöcken samt 1-basierter Zeilennummer. |
| `getAttachmentKind` | `(filePath: string) => AttachmentKind` | Ordnet eine Datei anhand ihrer Endung in `'markdown'`, `'image'`, `'pdf'`, `'audio'`, `'video'` oder `'other'` ein. |
