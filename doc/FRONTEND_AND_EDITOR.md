# Frontend & CodeMirror 6 Live-Preview Architecture (`doc/FRONTEND_AND_EDITOR.md`)

Dieses Dokument beschreibt den Aufbau des React-Frontends (`src/`) und insbesondere die Funktionsweise des an Obsidian angelehnten **CodeMirror 6 Live-Preview Editors** ([`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx)).

---

## 1. Komponenten-Überblick & Datenfluss

```mermaid
flowchart TD
    App["App.tsx (Zentraler Vault- & Editor-State)"]
    Login["LoginModal.tsx"]
    Sidebar["FileSidebar.tsx (Dateibaum, Suche, Tags)"]
    Props["PropertiesEditor.tsx (Visuelles Frontmatter)"]
    Editor["LivePreviewEditor.tsx (CodeMirror 6 + Lese-Ansicht)"]
    Graph["GraphView.tsx (2D Force-Directed Canvas)"]

    App --> Login
    App --> Sidebar
    App --> Props
    App --> Editor
    App --> Graph
```

### 1.1 Zentraler State in [`src/App.tsx`](../src/App.tsx)

`App.tsx` hält den gesamten Anwendungszustand zusammen:

- **Authentifizierung:** `authChecked`, `authenticated`, `authRequired`
- **Vault-Übersicht:**
  - `vaultName`: Name des Wurzelverzeichnisses
  - `tree`: Hierarchischer `FileNode[]`-Baum für die linke Seitenleiste
  - `allNotes`: Flache Liste aller Markdown-Notizen (`Array<{ path, name, folder }>`) für schnelles `[[`-Autovervollständigen und den Schnellöffner (`Ctrl/Cmd + O`)
  - `tags`: Alle im Vault vorkommenden `#tags` mit Häufigkeitszähler
- **Aktive Notiz & Tabs:**
  - `openTabs`: Liste der geöffneten Notizpfade (`string[]`), persistiert in `localStorage` (`obsidian_web_open_tabs`)
  - `activeNote`: Aktuell geladenes `NotePayload`-Objekt
  - `editorBody`: Aktueller Markdown-Text (ohne Frontmatter) im Editor
  - `editorProps`: Aktuelle `FrontmatterProperty[]`-Liste im visuellen Eigenschaften-Panel
  - `dirty`: `boolean` – gibt an, ob ungespeicherte Änderungen vorliegen
  - `saving`: `boolean` – gibt an, ob gerade ein Speicher-Request läuft
- **Ansichtsmodi:**
  - `editorMode`: `'live'` (Obsidian Live-Preview) | `'source'` (Reiner Markdown-Quelltext) | `'reading'` (Komplett gerenderte HTML-Leseansicht)
  - `centerView`: `'editor'` (Standard) | `'graph'` (Vollbild-Graph im Hauptbereich)
  - `rightTab`: `'graph'` (Lokaler Nachbarschafts-Graph in der rechten Seitenleiste) | `'backlinks'` (Eingehende & ausgehende Verweise) | `'outline'` (Gliederung nach Überschriften)

### 1.2 Auto-Save & Schutz vor Race-Conditions

1. **Debounced Auto-Save (700 ms):**
   Jede Änderung am Markdown-Text (`handleBodyChange`) oder an den Eigenschaften (`handlePropertiesChange`) setzt `dirty = true` und startet einen `700ms`-Timer (`saveTimerRef`). Nach Ablauf ruft `persistNote(path, body, props)` `api.saveNote()` auf.
2. **Sofortiges Speichern vor Notizwechsel:**
   Wenn der Benutzer in [`openNote(targetPath)`](../src/App.tsx) zu einer anderen Notiz wechselt, während `dirty === true` ist, wird ein ausstehender Timer abgebrochen und die aktuelle Notiz **vor** dem Laden der neuen Notiz gespeichert.
3. **Unterdrückung von Echo-Reloads (`lastLocalSaveRef`):**
   Wenn `persistNote` speichert, wird `lastLocalSaveRef.current = Date.now()` gesetzt. Trifft innerhalb von `1500ms` danach eine WebSocket-Nachricht `vault:changed` für dieselbe Datei ein, wird das erneute Laden übersprungen, damit der Cursor im Editor nicht springt.

---

## 2. Der CodeMirror 6 Live-Preview Editor ([`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx))

Der Editor bildet das Herzstück der Applikation und implementiert Obsidians **Live-Preview-Konzept**:
- Solange sich der **Cursor (oder die Textauswahl) außerhalb** eines Markdown-Elements befindet, werden Steuerzeichen (`#`, `**`, `*`, `~~`, `[[...]]`, `![[...]]`, `![...](...)`, Tabellen-Pipes `|`) ausgeblendet (`Decoration.replace({})`) oder durch interaktive Widgets ersetzt.
- Sobald der **Cursor in die Zeile bzw. den Bereich** des Elements bewegt wird, klappt das Element automatisch in seinen rohen Markdown-Quelltext auf, sodass es direkt bearbeitet werden kann.

### 2.1 Performance: Viewport-Windowing

Bei sehr langen Notizen wäre das Erzeugen von tausenden DOM-Widgets im gesamten Dokument zu langsam. Deshalb berechnet [`buildLivePreviewDecorations(view)`](../src/components/LivePreviewEditor.tsx) Dekorationen nur für die aktuell sichtbaren Bereiche (`view.visibleRanges`) mit einem Sicherheitspuffer von **$\pm 1500$ Zeichen**:

```ts
const vpFrom = Math.max(0, view.viewport.from - 1500);
const vpTo = Math.min(docLength, view.viewport.to + 1500);
```

### 2.2 Übersicht aller Live-Preview-Dekorationen & Widgets

| Markdown-Element | Cursor außerhalb | Cursor innerhalb | Implementierung in `LivePreviewEditor.tsx` |
| :--- | :--- | :--- | :--- |
| **Überschriften** (`# H1` .. `###### H6`) | `### ` wird ausgeblendet, Zeile erhält `.cm-lp-h1` .. `.cm-lp-h6` | `### ` wird mit `.cm-lp-formatting` gedimmt eingeblendet | Zeilen-Scan + `selectionTouchesLine` |
| **Blockquotes** (`> Zitat`) | Zeile erhält `.cm-lp-blockquote` (linker Akzentbalken) | Bleibt `.cm-lp-blockquote` | Zeilen-Scan |
| **Horizontale Linie** (`---`, `***`) | Ersetzt durch `<hr class="cm-lp-hr" />` (`HrWidget`) | Rohes `---` sichtbar | Zeilen-Scan + `selectionTouchesLine` |
| **Aufgabenlisten** (`- [ ] `, `- [x] `) | `- [ ]` wird durch interaktives `<input type="checkbox">` (`CheckboxWidget`) ersetzt. Klick schaltet `[ ]` $\leftrightarrow$ `[x]` direkt im Dokument um! | `- [ ]` als Text sichtbar | Zeilen-Scan + `CheckboxWidget` |
| **Aufzählungslisten** (`- `, `* `, `+ `) | `-` wird durch einen gestylten Listenpunkt `•` (`BulletWidget`) ersetzt | `-` als Text sichtbar | Zeilen-Scan + `BulletWidget` |
| **Codeblöcke** (` ```lang ... ``` `) | Alle Zeilen erhalten `.cm-lp-codeblock-line` (dunkler Hintergrund, Monospace) | Öffnende/schließende ` ``` `-Zeilen sind außerhalb gedimmt | Mehrzeilen-Zustandsautomat (`inCodeFence`) |
| **Markdown-Tabellen** (`\| A \| B \|`) | Erste Zeile wird durch gerendertes HTML-`<table>` (`TableWidget`) ersetzt; Folgezeilen der Tabelle werden per `.cm-lp-table-collapsed-line` ausgeblendet. Klick auf die Tabelle setzt den Cursor hinein zum Bearbeiten. | Kompletter Markdown-Tabellenquelltext sichtbar (`.cm-lp-table-source-line`) | Mehrzeilen-Tabellen-Detektor (`isTableRow`, `isTableSeparator`) + `TableWidget` |
| **Obsidian-Embeds** (`![[bild.png\|400]]`, `![[doc.pdf]]`) | Ersetzt durch `EmbedWidget` (`<img>` mit Lazy-Loading, `<audio>`, `<video>`, PDF-Karte oder Notiz-Einbettung) | Roher Code `![[...]]` sichtbar | Regex `WIKI_REGEX` + `selectionTouches` |
| **Wiki-Links** (`[[Ziel\|Alias]]`) | Ersetzt durch klickbares `WikiLinkWidget` (`<span class="cm-lp-wikilink">`). Klick öffnet die Zielnotiz! | Roher Code `[[Ziel\|Alias]]` sichtbar | Regex `WIKI_REGEX` + `WikiLinkWidget` |
| **Markdown-Bilder** (`![alt](pfad.png)`) | Ersetzt durch `EmbedWidget` (übergibt auch `currentNotePath` für relative Pfade wie `attachments/img.png` und `decodeURIComponent` für `%20`) | Roher Code `![alt](pfad.png)` sichtbar | Regex `MD_LINK_REGEX` (`isEmbed === true`) |
| **Markdown-Links** (`[Text](Ziel.md)` oder `[Web](https://...)`) | Ersetzt durch `WikiLinkWidget` (interne Links öffnen die Notiz/Datei; externe Links öffnen im neuen Browser-Tab mit `↗`) | Roher Code `[Text](...)` sichtbar | Regex `MD_LINK_REGEX` (`isEmbed === false`) |
| **Fettdruck** (`**Text**`) | `**` wird ausgeblendet, Text erhält `.cm-lp-bold` | `**` sichtbar | Regex `BOLD_REGEX` |
| **Kursiv** (`*Text*`) | `*` wird ausgeblendet, Text erhält `.cm-lp-italic` | `*` sichtbar | Regex `ITALIC_REGEX` |
| **Durchgestrichen** (`~~Text~~`) | `~~` wird ausgeblendet, Text erhält `.cm-lp-strike` | `~~` sichtbar | Regex `STRIKE_REGEX` |
| **Highlight** (`==Text==`) | `==` wird ausgeblendet, Text erhält `.cm-lp-highlight` (gelbe Markierung) | `==` sichtbar | Regex `HIGHLIGHT_REGEX` |
| **Inline-Code** (`` `code` ``) | Backticks ausgeblendet, Text erhält `.cm-lp-inline-code` | Backticks sichtbar | Regex `INLINE_CODE_REGEX` |
| **Tags** (`#tag/subtag`) | Ersetzt durch klickbares `TagPillWidget` (`#tag/subtag`). Klick filtert nach diesem Tag! | Roher Text `#tag/subtag` sichtbar | Regex `TAG_REGEX` |

> [!WARNING]
> **Wichtige CodeMirror-6-Einschränkung bei mehrzeiligen Dekorationen:**
> Ein `ViewPlugin` darf in CodeMirror 6 **niemals** `Decoration.replace(...)` über Zeilenumbrüche (`\n`) hinweg verwenden (führt sofort zum Fehler `RangeError: Decorations that replace line breaks may not be specified via plugins`).
> Deshalb rendert unser Tabellen-Detektor das `TableWidget` als `Decoration.widget({ widget: new TableWidget(tableLines) })` am Anfang der ersten Tabellenzeile und kollabiert die einzelnen Tabellenzeilen zeilenweise mit `Decoration.line({ class: 'cm-lp-table-collapsed-line' })` (`font-size: 0; line-height: 0; height: 0; overflow: hidden`).

### 2.3 Wiki-Link (`[[`) und Tag (`#`) Autovervollständigung

Die Funktion [`wikiLinkCompletion`](../src/components/LivePreviewEditor.tsx) ist bei `@codemirror/autocomplete` registriert:
- Tippt der Benutzer `[[` gefolgt von beliebigen Zeichen, durchsucht die Funktion `allNotesRef.current` nach passenden Notiznamen und Pfaden (bis zu 30 Vorschläge) und vervollständigt beim Bestätigen automatisch zu `[[Notizname]]`.
- Tippt der Benutzer `#` nach einem Leerzeichen oder am Zeilenanfang, schlägt die Funktion existierende Tags aus `allTagsRef.current` vor.

### 2.4 Drag & Drop, Zwischenablage-Upload und Bild-Einfügen-Button

Der `EditorView.domEventHandlers`-Hook fängt `drop`- und `paste`-Events ab; zusätzlich steht in der Topbar der Button **Bild einfügen** zur Verfügung:
- Sowohl Clipboard-Items (`event.clipboardData.items`), Clipboard-Dateien (`event.clipboardData.files`), Drag & Drop-Dateien (`event.dataTransfer.files`) als auch die Dateiauswahl per Button unterstützen Einzel- und Mehrfach-Uploads.
- Bei Blobs aus der Zwischenablage ohne Dateiendung wird der MIME-Typ analysiert (`image/png`, `image/jpeg` etc.), sodass auf dem Server stets eine gültige Dateiendung vergeben wird.
- Die Datei wird nach `/api/vault/upload?folder=attachments` hochgeladen und an der aktuellen Cursorposition bzw. am Ende der Notiz automatisch als fertiger Obsidian-Tag `![[attachments/dateiname.png]]` eingefügt.
- Die CodeMirror-Dekoration (`EmbedWidget`) erkennt die Bild-Syntax sofort und rendert die Grafik direkt im Live-Preview-Modus.

### 2.5 Interaktive Bildanpassung (Größenänderung per Maus & Ausrichtung via HTML-Attribute)

Für maximale Kompatibilität mit Obsidian, GitHub Flavored Markdown und Standard-Webviewern speichert Basalt Bildgrößen und -ausrichtungen nicht über proprietäre Syntax, sondern über Standard-HTML-Attribute:
`<img src="attachments/beispiel.png" alt="Bildbeschreibung" width="450" align="center" />`

- **Interaktiver Auswahl-Rahmen:** Ein Klick auf ein gerendertes Bild im Live-Preview-Modus selektiert das Bild (`selected = true`) und blendet eine schwebende Schnellzugriffs-Toolbar sowie Größenanfasser (Drag-Handles) ein.
- **Größenänderung mit der Maus (Drag Handle):**
  - An den unteren Ecken (Südost `se-resize` und Südwest `sw-resize`) befinden sich Drag-Handles.
  - Beim Ziehen mit gedrückter Maustaste wird die Bildbreite in Echtzeit skaliert und als numerische Pixelanzeige im Badge visualisiert (unter Wahrung der Aspekt-Ratio).
  - Beim Loslassen der Maustaste wird das Markdown-Dokument atomar aktualisiert (oder von Wiki-Embed `![[...]]` in `<img ... width="..." />` überführt).
- **Ausrichtungs-Toolbar (`align`):**
  - **Links:** `align="left"` (Fließtext rechts um das Bild)
  - **Zentriert:** `align="center"` (zentrierter Block)
  - **Rechts:** `align="right"` (Fließtext links um das Bild)
  - **Inline:** entfernt das `align`-Attribut
  - **Größe zurücksetzen:** Setzt die Breite auf Originalgröße zurück.
- **Unterstützung im Lese-Modus (`reading`):**
  - Auch in `preprocessObsidianMarkdown` und `marked` werden `<img ... width="..." align="...">` Tags vollständig mit passendem CSS-Styling (Float bzw. zentrierte Blockdarstellung) gerendert.

### 2.6 Lese-Ansicht (`mode === 'reading'`)

Im Lese-Modus wird anstelle von CodeMirror `marked` (mit aktiviertem GitHub Flavored Markdown `gfm: true` für Tabellen, Aufgabenlisten und Durchstreichungen) nach einer Vorverarbeitung durch [`preprocessObsidianMarkdown`](../src/components/LivePreviewEditor.tsx) gerendert. Klicks auf interne Links und Tags werden per Event-Delegation (`data-wiki-target`, `data-tag`) abgefangen.

---

## 3. Visueller Eigenschaften-Editor ([`src/components/PropertiesEditor.tsx`](../src/components/PropertiesEditor.tsx))

Wie vom Benutzer gewünscht, wird YAML-Frontmatter niemals als roher YAML-Quelltext im Editor angezeigt. Stattdessen sitzt oberhalb des Editors das einklappbare Panel **"Eigenschaften"**:

- Jede Eigenschaft besteht aus:
  1. **Typ-Umschalter Button** (Icon links: `Aa` Text, `#` Zahl, `☑` Checkbox, `📅` Datum, `≡` Liste, `🏷` Tags) – Klick wechselt zyklisch den `PropertyType` und konvertiert den Wert passend.
  2. **Schlüssel-Eingabefeld** (`key`).
  3. **Typspezifisches Wert-Eingabefeld:**
     - `'text'` $\rightarrow$ `<input type="text">`
     - `'number'` $\rightarrow$ `<input type="number">`
     - `'checkbox'` $\rightarrow$ `<input type="checkbox">`
     - `'date'` $\rightarrow$ `<input type="date">`
     - `'list'` / `'tags'` $\rightarrow$ Chip-/Pill-Liste mit `×`-Button zum Entfernen einzelner Einträge und `Enter`/`Komma`-Eingabe zum Hinzufügen neuer Werte.
  4. **Löschen-Button (`×`)** zum Entfernen der Eigenschaft.
- Über **"+ Eigenschaft hinzufügen"** oder die Schnell-Buttons (`+ tags`, `+ aliases`, `+ status`) können neue Frontmatter-Felder angelegt werden.

---

## 4. Interaktive Graph-Ansicht ([`src/components/GraphView.tsx`](../src/components/GraphView.tsx))

Die Graph-Ansicht nutzt ein performantes HTML5 `<canvas>` mit screen-space Rendering und eigener $O(N)$ Kräftesimulation, optimiert für große Vaults mit 1.800+ Notizen:

- **Semantischer Zoom & Screen-Space Rendering (kein globales `ctx.scale`):**
  - Der Zoom-Faktor `scale` (`0.08` bis `6.0`) skaliert primär den räumlichen Abstand zwischen den Knoten (`(node.x - viewCenterX) * scale + canvasWidth / 2 + panX`), wodurch Knoten beim Hineinzoomen auseinanderdriften.
  - **Logarithmischer Knoten-Radius:**
    `baseRadius = 2.8 + Math.log(1 + degree) * 1.6;`
    `drawRadius = Math.min(14, Math.max(2.0, baseRadius * Math.pow(scale, 0.35) * nodeSizeMultiplier));`
    Knoten bleiben auf allen Zoomstufen elegante, scharfe Datenpunkte statt riesiger Bälle.
  - **Dezente Standardfarben & Hover-Spotlight:**
    - Normale Notizen: Dezent grau/slate (`#9ca3af`)
    - Aktive Notiz: Goldener Theme-Akzent (`#d4af37`) mit sanftem Scheinring
    - Nicht-erstellte Notizen (`type === 'unresolved'`): Gedimmtes Grau (Opacity 0.45)
    - Kanten (Links): Sehr fein (`lineWidth: 0.8`) mit reduzierter Deckkraft
    - **Spotlight:** Beim Hovern oder Antippen werden der Zielknoten, alle direkten Nachbarn und die Verbindungskanten voll hervorgehoben (`opacity: 1.0`), während der restliche Graph sanft auf `opacity: 0.15` gedimmt wird.
- **Intelligente Anti-Kollisions-Labels (Level-of-Detail):**
  - Feste Bildschirm-Schriftgröße: `11.5px` (skaliert nicht künstlich auf 40px hoch).
  - Zoom-Schwelle `textFadeThreshold` (Standard `0.55`): Im Weitwinkel werden reguläre Labels ausgeblendet; nur spotlightete Knoten und zentrale Hubs (`degree >= 12`) bleiben sichtbar.
  - **2D-Bounding-Box-Kollisionsprüfung:** Knoten werden vor dem Rendern nach Wichtigkeit sortiert (Spotlight $\rightarrow$ Aktive Notiz $\rightarrow$ `degree` absteigend). Überlappende Labels werden automatisch übersprungen – der Graph bleibt garantiert lesbar und aufgeräumt.
- **Obsidian-artige Cluster-Physik & Vogel-Spirale:**
  - **Initiales Layout:** Gleichmäßige Vogel-Spirale (Golden-Angle Sunflower-Verteilung $\approx 137.5^\circ$) um das Zentrum.
  - **Spatial Hashing für Coulomb-Abstoßung:** Der Raum wird in ein Grid (Zellgröße `180px`) unterteilt. Jeder Knoten berechnet die Abstoßung nur gegen seine 9 Nachbarzellen $\rightarrow$ Skalierung in $O(N)$ statt $O(N^2)$ für flüssige 60 FPS auch bei 1.800+ Notizen.
  - **Degree-gewichtete Federkräfte:** Blatt-Knoten (`degree === 1`) werden nah an ihren Themen-Hub gezogen (`targetDist = linkDist * 0.55`), während Kanten zwischen zwei großen Hubs (`degree > 5`) mehr Abstand halten (`targetDist = linkDist * 1.8`), um klare, sternförmige Cluster zu bilden.
- **Einklappbares Einstellungs-Panel (`basalt_graph_settings` in `localStorage`):**
  - **Filter:** Volltext- und Prefix-Filter (`path:Ordner`, `#tag`), Toggles für Orphans (verwaiste Knoten), Tags und ungelöste Links.
  - **Farb-Gruppen:** Benutzerdefinierte Farb-Regeln (`{ id, query, color }`) nach Pfad, Tag oder Titel mit Farbwähler.
  - **Anzeige & Kräfte:** Schieberegler für Knotengröße, Textschwelle, Zentripetalkraft, Abstoßung und Link-Abstand.
- **Touch-Steuerung (Smartphones & Touchscreens):**
  - `touch-action: none` auf dem Canvas.
  - 1-Finger-Pan & Knoten-Drag.
  - 1-Finger-Tap: Selektiert Knoten, aktiviert Spotlight und zeigt schwebende Schnellzugriffs-Pille („Notiz öffnen ↗“).
  - 2-Finger-Pinch-to-Zoom: Stufenloser Zoom um den Mittelpunkt zwischen beiden Fingern.

---

## 5. Einstellungs-Modal & Theme-System ([`src/components/SettingsModal.tsx`](../src/components/SettingsModal.tsx))

Basalt bietet ein umfassendes Einstellungsfenster (über das Zahnrad in der Top-Toolbar und im Ribbon erreichbar):

- **Menü 1: „Darstellung & Themes“:**
  - Steuert über `data-theme` auf `document.documentElement` alle Farben im Editor, in Sidebars, Tabellen und im Canvas-Graphen.
  - Das Theme wird persistent in `localStorage` unter `basalt_theme` gesichert.
  - **Die 5 Themes:**
    1. `basalt`: Dunkles Basalt (#0d1117/#161c24), Kristall-Gold (`#d4af37`) & Facetten-Türkis (`#29b6c8`).
    2. `dark-cold`: Mitternachtsblau (#0f172a/#1e293b) & Eisblau-Akzent (`#38bdf8`).
    3. `dark-warm`: Espresso-Anthrazit (#1c1917/#292524) & Bernstein-Akzent (`#f59e0b`).
    4. `light-cold`: Eisweiß (#f8fafc/#f1f5f9) & Kobaltblau-Akzent (`#2563eb`).
    5. `light-warm`: Elfenbein-Papier (#fdfbf7/#f5f0e6) & Bronze-Akzent (`#b45309`).
- **Menü 2: „Sicherheit & Passwort“:**
  - Schaltet den Passwortschutz per Toggle-Switch ein/aus und ändert das Server-Passwort über `POST /api/settings/security`.
- **Menü 3: „Vault-Verbindungen (Server-Profile)“:**
  - Verwaltet Server-Profile (`VaultProfile[]`), wechselt Server und bietet den Button „Verbindung prüfen“ (inkl. Direktlink zum Bestätigen von Self-Signed TLS-Zertifikaten).
- **Menü 4: „Synchronisation & Offline-Speicher“:**
  - Zeigt Live-Statistiken (lokal gecachte Notizen, gecachte Anhänge, geschätzter Speicherplatz) und erlaubt die Auswahl von Ordnern für den vollständigen Offline-Download von Bildern/PDFs.

---

## 6. Offline-First Sync & Konfliktlösung ([`src/sync/`](../src/sync/) & [`src/components/ConflictModal.tsx`](../src/components/ConflictModal.tsx))

- **IndexedDB (`src/sync/localDb.ts`):**
  - Getrennte Datenbank pro Server-Profil (`basalt_cache_<profileId>`).
  - Stores: `meta` (Baum, Tags, Graph), `notes` (alle `.md`-Notizen vollständig lokal), `attachments` (gecachte Binär-Blobs) und `outbox` (Offline-Änderungen).
- **SyncEngine (`src/sync/syncEngine.ts`):**
  - Online: Flusht die `outbox`, vergleicht `GET /api/vault/sync-manifest`, lädt Deltas per `POST /api/vault/notes-batch` und aktualisiert ausgewählte Offline-Anhänge im Hintergrund.
  - Offline: Bedient alle Lese- und Schreibvorgänge nahtlos aus der IndexedDB (Optimistic UI).
- **Konflikt-Modal (`src/components/ConflictModal.tsx`):**
  - Erkennt bei Reconnect HTTP `409 Conflict` (abweichende `baseMtime`) und zeigt Side-by-Side-Vergleich von lokalem Text und Server-Stand.
  - Drei Lösungsstrategien: „Lokale Version behalten (Server überschreiben)“, „Server-Version behalten (Lokal verwerfen)“ oder „Beide behalten (Konflikt-Kopie mit Zeitstempel anlegen)“.
  - Bietet Checkbox für Batch-Anwendung auf alle verbleibenden Konflikte.

---

## 7. Obsidian-Befehlspalette (`Ctrl+P` / `Cmd+P`) & Shortcuts ([`src/components/CommandPalette.tsx`](../src/components/CommandPalette.tsx))

Basalt implementiert eine vollwertige, an Obsidian angelehnte **Befehlspalette**, die global per Tastenkombination `Ctrl+P` (oder `Cmd+P` auf macOS) sowie über den Button **„Befehle“** (`Terminal`-Icon) in der Top-Toolbar aufgerufen werden kann:

- **Eigenschaften & Bedienung:**
  - **Fuzzy-/Volltextsuche:** Durchsucht Titel, Beschreibungen, Kategorien und Synonyme (z. B. „fett“, „table“, „theme“, „sync“).
  - **Tastaturnavigation:** Pfeiltasten `↑` / `↓` zur Navigation, `Enter` zum Ausführen, `Escape` zum Schließen. Automatische vertikale Nachführung (`scrollIntoView`) des fokussierten Eintrags.
  - **Kategorie-Badges & Shortcuts:** Zeigt visuell Kategorien (`Editor`, `Ansicht`, `Einfügen`, `Theme`, `Vault`, `System`) und die jeweils zugeordneten Tastaturkürzel (`<kbd>`).
- **Imperatives Editor-Interface (`LivePreviewEditorRef`):**
  Über `forwardRef` stellt der Editor Methoden bereit, die aus der Befehlspalette aufgerufen werden können:
  - `applyFormat('bold' | 'italic' | 'strike' | 'highlight' | 'inlineCode')`
  - `insertTable(rows, cols)`
  - `insertCodeBlock(language)`
  - `insertTask()`
  - `insertWikiLink()`
  - `insertHeading(level)`
  - `insertQuote()`
  - `insertHorizontalRule()`
  - `focus()`

### Wichtigste Shortcuts im Überblick

| Shortcut | Aktion |
| :--- | :--- |
| `Ctrl+P` / `Cmd+P` | Befehlspalette öffnen |
| `Ctrl+O` / `Cmd+O` | Schnellöffner (Dateien suchen & öffnen) |
| `Ctrl+S` / `Cmd+S` | Manuell speichern (Auto-Save ist zusätzlich aktiv) |
| `Ctrl+N` / `Cmd+N` | Neue Notiz erstellen |
| `Ctrl+,` / `Cmd+,` | Einstellungen öffnen |
| `Ctrl+B` / `Cmd+B` | Text fett formatieren (`**Text**`) |
| `Ctrl+I` / `Cmd+I` | Text kursiv formatieren (`*Text*`) |
| `Ctrl+Shift+X` | Text durchstreichen (`~~Text~~`) |
| `Alt+H` | Text gelb markieren (`==Text==`) |
| `Ctrl+E` | Inline-Code (`` `Code` ``) |
| `Ctrl+Shift+C` | Codeblock einfügen (```` ``` ````) |
| `Ctrl+Shift+L` | Aufgabenliste einfügen (`- [ ]`) |
| `Alt+Shift+T` | Markdown-Tabelle einfügen |
| `Ctrl+K` | Wiki-Link einfügen (`[[...]]`) |
| `Alt+Z` | Ablenkungsfreien Zen-Modus aktivieren / beenden |
| `Ctrl+\` | Linke Dateibaum-Leiste ein-/ausblenden |
| `Ctrl+Alt+\` | Rechte Leiste (Graph/Backlinks/Outline) ein-/ausblenden |

---

## 8. Responsive Seitenleisten-Steuerung, Touch-Wischgesten & Android-Keyboard-Fix

Auf mobilen Touchscreens und schmalen Bildschirmen (< 768px, z. B. Smartphones, Chromebooks mit geteiltem Display):
- **100% Editor-Vollbild ohne störende Leisten:** Auf Bildschirmen `< 768px` ist die linke Ribbon-Iconleiste im Standard-Zustand ausgeblendet (`display: none`). Der Editor nimmt die volle Bildschirmbreite ($100\,\%$, $0\,\text{px}$ bis zum rechten Bildschirmrand) ein.
- **Integrierter Mobile-Drawer (`.left-drawer-panel`):** Wird die linke Seitenleiste geöffnet (per Touch-Wischgeste oder Menü-Icon), slidet der Drawer gemeinsam als Einheit aus Ribbon-Iconleiste ($46\,\text{px}$) und Dateibaum/Suche ein.
- **Android Virtual Keyboard & Viewport-Locking (`interactive-widget=resizes-content` & `visualViewport`):**
  - Im `index.html` Meta-Viewport ist `interactive-widget=resizes-content, maximum-scale=1.0, user-scalable=no` gesetzt, damit Android Chrome den Layout-Viewport auf den sichtbaren Bereich über der Bildschirmtastatur beschränkt.
  - Ein dynamischer `window.visualViewport`-Listener in `App.tsx` synchronisiert `--vvh` in Pixeln bei jedem Tastatur-Aufklappen oder Scroll-Event.
  - `html, body { position: fixed; width: 100%; height: 100%; overflow: hidden; }` und `.obsidian-app-shell { height: var(--vvh, 100dvh); overflow: hidden; }` verhindern, dass Android das Gesamtfeld nach oben verschiebt. Die Topbar und Sticky-Editor-Toolbar bleiben somit absolut ortsfest sichtbar am oberen Displayrand verankert, während ausschließlich `.editor-pane.scroller` vertikal scrollt.
- **Touch-Wischgesten (Swipe Left-to-Right & Right-to-Left):**
  - **Öffnen:** Ein Wisch vom linken Displayrand (`touchStartX <= 35px`) oder ein deutlicher horizontaler Swipe (`deltaX > 65px` bei `Math.abs(deltaX) > Math.abs(deltaY) * 1.5`) öffnet den Drawer.
  - **Schließen:** Bei geöffneter Leiste schließt eine Wischgeste nach links (`deltaX < -55px` bei `Math.abs(deltaX) > Math.abs(deltaY) * 1.3`), ein Tipp auf das Backdrop oder die Auswahl einer Notiz die Leiste sofort wieder.
  - **Scroll-Schutz:** Vertikales Scrollen im Dokument (`Math.abs(deltaY) > Math.abs(deltaX)`) wird erkannt und löst die Wischgesten niemals versehentlich aus.
- **Desktop-Verhalten (>= 768px):**
  - Kein Backdrop oder Unschärfe-Filter (kein Blur). Die Seitenleisten reihen sich nahtlos in das CSS-Grid der App-Shell ein.
  - Das Anklicken einer Notiz im Dateibaum wechselt sofort zur gewählten Notiz und lässt die Leiste geöffnet.
- **Berührungsfreundliche Tippflächen (Touch-Targets):**
  - Auf Geräten mit Touch-Eingabe (`@media (pointer: coarse)`) besitzen interaktive Buttons und Icons eine garantierte Mindest-Tippfläche von $40 \times 40\,\text{px}$.

---

## 9. Sticky Formatierungsleiste & Portal-Dropdowns ([`src/components/EditorToolbar.tsx`](../src/components/EditorToolbar.tsx))

Direkt oberhalb des scrollenden Editor-Bereichs steht eine feste **Sticky-Formatierungsleiste** bereit:
- **Sticky-Positionierung:** Die Toolbar befindet sich außerhalb des vertikal scrollenden Text-Containers (`.editor-pane.scroller`), sodass sie beim Scrollen durch lange Notizen immer fest am oberen Rand sichtbar bleibt.
- **React Portal Dropdowns (`createPortal`):**
  - Alle Dropdown-Popovers (`H ⌄`, `Tabelle ⌄`, `Callout ⌄`, `Bild ⌄`) werden via React Portal direkt in `document.body` mit `position: fixed` und `z-index: 1000` gerendert. Dadurch wird verhindert, dass horizontales Scrollen der Toolbar (`overflow-x: auto`) die Menüs am unteren Rand abschneidet.
  - **CodeMirror-Fokus-Erhaltung:** Sämtliche Buttons und Menü-Einträge nutzen `onMouseDown={(e) => e.preventDefault()}`, wodurch CodeMirror seine Textmarkierung / Cursor-Position beim Klicken nicht verliert.
- **Überschriften-Menü:** Schnellauswahl zwischen `Normaler Text (Absatz)` (Level 0, entfernt bestehende `# `-Präfixe) sowie `H1` bis `H6`.
- **Textformatierung:** `Fett`, `Kursiv`, `Durchgestrichen`, `Highlight`, `Inline-Code`.
- **Listen & Einrückung:** Aufzählung (`- `), Nummeriert (`1. `), Aufgaben (`- [ ] `), Einrücken/Ausrücken.
- **Links & Autocomplete:** Wiki-Links (`[[ ]]`) und Tags (`#`) mit automatischem Start des Autocomplete-Popups.
- **Interaktiver Tabellen-Generator:** Voreinstellungen (`2×2`, `3×3`, `4×4`), manuelle Spalten-/Zeilenangabe sowie zeilen-/spaltenweise Erweiterung bei aktiver Tabelle.
- **Obsidian Callouts:** Standardisierte Callout-Blöcke (`[!NOTE]`, `[!INFO]`, `[!TIP]`, `[!WARNING]`, `[!DANGER]`, `[!QUESTION]`) mit farbigen Badges und lokalisierten Titeln.
- **Foto- & Kamera-Upload:** Direkte Wahl zwischen Dateiauswahl / Galerie und Live-Kameraaufnahme.

---

## 10. Zen-Modus (`Alt+Z`) & Notiz-Dokumenten-Layout

- **Zen-Modus (`Alt+Z`):**
  - Aktivierbar per Shortcut `Alt+Z`, über den Topbar-Button „Zen“ oder über die Befehlspalette.
  - Beendbar per `Alt+Z`, `Escape` oder über den dezenten Schwebeknopf oben rechts (`.zen-mode-exit-btn`).
  - Blendet sämtliche Bedienelemente (Ribbon, Seitenleisten, Header, Statusleiste, Eigenschaften und Formatierungsleiste) komplett aus.
  - **Zentrierung:** Das übergeordnete Workspace-Layout schaltet auf ein einspaltiges Flex-Layout mit `align-items: center` und `grid-column: 1 / -1` um, sodass der Textblock exakt horizontal im Browserfenster zentriert ist (max. $820\,\text{px}$) und nicht an den rechten Rand gedrückt wird.
- **Dokumenten-Layout & Überschriften:**
  - Die separate statische H1-Titelzeile oberhalb des Editors wurde entfernt. Markdown-Dokumente mit Überschriften wie `# Mein Titel` werden nun ohne Dopplung direkt im CodeMirror-Editor angezeigt und bearbeitet.
  - Das Frontmatter-Eigenschaften-Panel (`PropertiesEditor`) ist beim Öffnen der App sowie beim Wechseln von Notizen **standardmäßig eingeklappt** (`collapsed: true`) und zeigt nur die schmale Kopfzeile `> Eigenschaften [Anzahl]`.




