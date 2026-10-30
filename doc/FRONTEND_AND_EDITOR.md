# Frontend & CodeMirror 6 Live-Preview Architecture (`doc/FRONTEND_AND_EDITOR.md`)

Dieses Dokument beschreibt den Aufbau des React-Frontends (`src/`) und insbesondere die Funktionsweise des **CodeMirror 6 Live-Preview Editors** ([`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx)).

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
  - `openTabs`: Liste der geöffneten Notizpfade (`string[]`), persistiert in `localStorage` (`zuber_open_tabs`, Fallback `knowmesh_open_tabs`)
  - `activeNote`: Aktuell geladenes `NotePayload`-Objekt
  - `editorBody`: Aktueller Markdown-Text (ohne Frontmatter) im Editor
  - `editorProps`: Aktuelle `FrontmatterProperty[]`-Liste im visuellen Eigenschaften-Panel
  - `dirty`: `boolean` – gibt an, ob ungespeicherte Änderungen vorliegen
  - `saving`: `boolean` – gibt an, ob gerade ein Speicher-Request läuft
- **Ansichtsmodi:**
  - `editorMode`: `'live'` (Zuber Live-Preview) | `'source'` (Reiner Markdown-Quelltext) | `'reading'` (Komplett gerenderte HTML-Leseansicht)
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

Der Editor bildet das Herzstück der Applikation und implementiert ein modernes **Live-Preview-Konzept**:
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
| **Codeblöcke** (` ```lang ... ``` `) | Fences (```` ``` ````) werden ausgeblendet (`.cm-lp-codeblock-fence-hidden`), oben rechts wird ein Header-Widget (`CodeBlockHeaderWidget`) mit dezentem Sprach-Badge und Kopier-Button gerendert; Inhaltszeilen erhalten `.cm-lp-codeblock-content-line` mit vollem Syntax-Highlighting und abgerundetem Boden (`.cm-lp-codeblock-bottom-radius`). | Fences werden sichtbar mit `.cm-lp-formatting` (gedimmte Backticks) angezeigt, damit Sprache und Code frei editiert werden können. | Pre-Scan aller Blöcke + Zeilen-Dekorationen & `CodeBlockHeaderWidget` |
| **Markdown-Tabellen** (`\| A \| B \|`) | Erste Zeile wird durch gerendertes HTML-`<table>` (`TableWidget`) ersetzt; Folgezeilen der Tabelle werden per `.cm-lp-table-collapsed-line` ausgeblendet. Klick auf die Tabelle setzt den Cursor hinein zum Bearbeiten. | Kompletter Markdown-Tabellenquelltext sichtbar (`.cm-lp-table-source-line`) | Mehrzeilen-Tabellen-Detektor (`isTableRow`, `isTableSeparator`) + `TableWidget` |
| **Interaktive Mermaid-Codeblöcke** (```` ```mermaid ````) | Standardmäßig wird das SVG-Diagramm gerendert; Fences und Quelltextzeilen werden zeilenweise kollabiert (`.cm-lp-codeblock-collapsed-line`). Der Header bietet einen `[ Diagram \| Code ]`-Toggle. | Beim Umschalten auf `Code` wird der CodeMirror-Quelltext mit Syntax-Highlighting voll editierbar; beim Umschalten auf `Diagram` wird das Diagramm atomar neu gerendert. | `InteractiveCodeBlockWidget` + `blockModesField` + `mermaid.render` mit Syntaxfehler-Boundary |
| **Interaktive HTML-Codeblöcke** (```` ```html ````) | Standardmäßig wird eine isolierte Sandboxed-Iframe-Vorschau (`sandbox="allow-scripts"`) angezeigt; Fences und Quelltextzeilen sind kollabiert. Header mit `[ Preview \| Code ]`-Toggle. | Beim Umschalten auf `Code` wird der HTML-Code editierbar; beim Umschalten auf `Preview` wird die Vorschau aktualisiert. | `InteractiveCodeBlockWidget` + `blockModesField` + iframe `srcdoc` mit dynamischer Höhenanpassung |
| **PDF-Einbettungen** (`![[dokument.pdf]]`, `![[dokument.pdf\|700]]`) | Ersetzt durch `EmbedWidget` als interaktiver `.cm-lp-pdf-embed`-Container mit Header (Dateiname + „In neuem Tab öffnen“-Button `↗`) und eingebettetem PDF-Iframe (`#toolbar=1&view=FitH`). Optionale Höhenangabe in Pixeln (Standard: `550px`). | Roher Code `![[...]]` sichtbar | Regex `WIKI_REGEX` / `MD_LINK_REGEX` + `EmbedWidget` |
| **Wiki-Embeds** (`![[bild.png\|400]]`) | Ersetzt durch `EmbedWidget` (`<img>` mit Lazy-Loading, `<audio>`, `<video>` oder Notiz-Einbettung) | Roher Code `![[...]]` sichtbar | Regex `WIKI_REGEX` + `selectionTouches` |
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

### 2.2.1 Codeblock-Architektur (Syntax-Highlighting, Header-Widget, Interaktives Mermaid & HTML & Lese-Modus)

Fenced Codeblöcke (```` ```language ... ``` ````) werden in Zuber auf zwei Ebenen für optimale Lesbarkeit und Produktivität optimiert:

1. **Standard-Codeblöcke (TypeScript, Python, Bash etc.):**
   - **CodeMirror 6 Live-Preview (`LivePreviewEditor.tsx`):**
     - Öffnende Zeile (` ```lang `): Erhält `Decoration.line({ class: 'cm-lp-codeblock-fence-hidden' })` und ein `CodeBlockHeaderWidget` am Zeilenanfang (`side: -1`). Das Widget rendert die Sprache (z. B. `PYTHON`, `SQL`) als dezentes Badge und bietet einen Kopier-Button mit Zwischenablagen-Feedback (`✓ Kopiert`).
     - Inhaltszeilen: Erhalten `Decoration.line({ class: 'cm-lp-codeblock-content-line' })` mit seitlichen Rändern und Monospace-Font.
     - Schließende Zeile (` ``` `): Erhält `Decoration.line({ class: 'cm-lp-codeblock-fence-hidden cm-lp-codeblock-bottom-radius' })` und bildet einen abgerundeten Abschluss des Code-Containers.
     - **Cursor innerhalb des Blocks:** Fences werden mit `.cm-lp-formatting` sichtbar geschaltet, sodass Sprache und Code nahtlos editiert werden können.
     - **Syntax-Highlighting:** CodeMirror 6 bindet `@codemirror/language-data` (143 Lezer-Parser) über `markdown({ codeLanguages: languages })` ein. Über `syntaxHighlighting(codeHighlighter)` werden Standard-Token (`.cm-keyword`, `.cm-string`, `.cm-number`, etc.) semantisch annotiert und themenspezifisch gestylt.
   - **Lese-Modus (`mode === 'reading'`):**
     - In `marked.use({ renderer: { code } })` wird `highlight.js` eingebunden (`hljs.highlight` / `hljs.highlightAuto`).
     - Jeder Codeblock wird in einen `<div class="codeblock-container">` mit `<div class="codeblock-header">` (Sprach-Badge + Kopier-Button) und `<pre><code class="hljs">` gerendert.

2. **Interaktive Mermaid- & HTML-Codeblöcke (` ```mermaid ` & ` ```html `):**
   - **Standard-Vorschau:** Mermaid-Diagramme werden clientseitig über die `mermaid`-Bibliothek gerendert; HTML-Blöcke werden in einem isolierten `iframe` (`sandbox="allow-scripts"`) mit dynamischer Höhenanpassung dargestellt.
   - **Header-Segment-Toggle:**
     - Für Mermaid: `[ Diagram | Code ]` (`[ Diagramm | Code ]`)
     - Für HTML: `[ Preview | Code ]` (`[ Vorschau | Code ]`)
   - **Live-Editing:**
     - Über das CodeMirror 6 `StateField` `blockModesField` wird der Ansichtsmodus atomar verwaltet.
     - Im Modus `Code` werden die Inhaltszeilen im Editor eingeblendet und können mit voller Tastatur- und Cursor-Unterstützung live editiert werden.
     - Im Modus `Diagram` / `Preview` werden die Quelltextzeilen per `.cm-lp-codeblock-collapsed-line` unsichtbar geschaltet und das SVG-Diagramm bzw. der Iframe wird mit den aktualisierten Code-Inhalten gerendert.
   - **Robuste Fehlerbehandlung:** Bei Syntaxfehlern im Mermaid-Code fängt ein `try/catch`-Block den Fehler ab und visualisiert eine formatierte Fehlermeldung (`.cm-lp-mermaid-error`), ohne den CodeMirror-Editor oder React zu unterbrechen.
   - **Lese-Ansicht:** Dieselben Umschalter (`[ Diagram | Code ]` bzw. `[ Preview | Code ]`) stehen auch in der Lese-Ansicht (`mode === 'reading'`) zur Verfügung.

### 2.3 Wiki-Link (`[[`) und Tag (`#`) Autovervollständigung

Die Funktion [`wikiLinkCompletion`](../src/components/LivePreviewEditor.tsx) ist bei `@codemirror/autocomplete` registriert:
- Tippt der Benutzer `[[` gefolgt von beliebigen Zeichen, durchsucht die Funktion `allNotesRef.current` nach passenden Notiznamen und Pfaden (bis zu 30 Vorschläge) und vervollständigt beim Bestätigen automatisch zu `[[Notizname]]`.
- Tippt der Benutzer `#` nach einem Leerzeichen oder am Zeilenanfang, schlägt die Funktion existierende Tags aus `allTagsRef.current` vor.

### 2.4 Erweitertes Editor Drag & Drop, Zwischenablage-Upload und Bild-Einfügen

Der `EditorView.domEventHandlers`-Hook fängt `dragover`-, `drop`- und `paste`-Events im Editor ab:
1. **Exakte Drop-Position:**
   Beim Fallenlassen wird die Dokumentposition über `view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head` exakt ermittelt.
2. **Fall A – Bilddateien (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`):**
   Werden nach `attachments/` hochgeladen und an `dropPos` als `![[attachments/dateiname.png]]` eingefügt.
3. **Fall B – Textdateien (`.txt`, `.md`, `.csv`, `.json`, `.log`, `.yaml`, `.xml` etc.):**
   Werden **nicht** als Anhang hochgeladen, sondern direkt clientseitig über `await file.text()` ausgelesen und an `dropPos` als Textinhalt eingefügt (bei mehreren Textdateien getrennt durch `\n\n`).
4. **Fall C – Sonstige Binärdateien (`.pdf`, `.zip`, `.docx` etc.):**
   Werden nach `attachments/` hochgeladen und an `dropPos` als `![[attachments/dateiname.pdf]]` eingefügt.
5. **Fall D – Reiner Text:**
   Wird markierter Text aus externen Fenstern oder innerhalb des Editors gezogen, wird der Text sauber an `dropPos` eingefügt.
6. **Toolbar-Button:**
   Zusätzlich steht in der Formatierungs-Toolbar (`EditorToolbar`) der Button **Bild einfügen** (Dateiauswahl oder Kamera-Foto) zur Verfügung.

### 2.5 Interaktive Bildanpassung (Größenänderung per Maus, Ausrichtung & Löschen-Button)

Für maximale Kompatibilität mit Standard-Markdown-Readern, GitHub Flavored Markdown und Webviewern speichert Zuber Bildgrößen und -ausrichtungen nicht über proprietäre Syntax, sondern über Standard-HTML-Attribute:
`<img src="attachments/beispiel.png" alt="Bildbeschreibung" width="450" align="center" />`

- **Interaktiver Auswahl-Rahmen:** Ein Klick auf ein gerendertes Bild im Live-Preview-Modus selektiert das Bild (`selected = true`) und blendet eine schwebende Schnellzugriffs-Toolbar sowie Größenanfasser (Drag-Handles) ein.
- **Größenänderung mit der Maus (Drag Handle):**
  - An den unteren Ecken (Südost `se-resize` und Südwest `sw-resize`) befinden sich Drag-Handles.
  - Beim Ziehen mit gedrückter Maustaste wird die Bildbreite in Echtzeit skaliert und als numerische Pixelanzeige im Badge visualisiert (unter Wahrung der Aspekt-Ratio).
  - Beim Loslassen der Maustaste wird das Markdown-Dokument atomar aktualisiert.
- **Ausrichtungs-Toolbar (`align`):**
  - **Links:** `align="left"` (Fließtext rechts um das Bild)
  - **Zentriert:** `align="center"` (zentrierter Block)
  - **Rechts:** `align="right"` (Fließtext links um das Bild)
  - **Inline:** entfernt das `align`-Attribut
  - **Größe zurücksetzen:** Setzt die Breite auf Originalgröße zurück.
- **Löschen-Button (Papierkorb):**
  - Am rechten Rand der schwebenden Bild-Toolbar befindet sich ein Löschen-Button mit Papierkorb-Icon (rote Hervorhebung bei Hover).
  - Ein Klick entfernt den gesamten Bild-Tag (`![[...]]`, `![...](...)` oder `<img ... />` inkl. nachfolgendem Zeilenumbruch) atomar per CodeMirror-Transaktion aus der Notiz. Die Datei im Vault-Anhangsordner bleibt unberührt.
- **Unterstützung im Lese-Modus (`reading`):**
  - Auch in `preprocessObsidianMarkdown` und `marked` werden `<img ... width="..." align="...">` Tags vollständig mit passendem CSS-Styling (Float bzw. zentrierte Blockdarstellung) gerendert.

### 2.6 Inline-PDF-Viewer (`![[dokument.pdf]]`) & Lese-Ansicht (`mode === 'reading'`)

1. **Inline-PDF-Viewer:**
   - Eingebettete PDF-Dateien (`![[dokument.pdf]]` oder `![Titel](dokument.pdf)`) werden im Live-Preview und im Lese-Modus als strukturierter `.cm-lp-pdf-embed`-Container gerendert.
   - Der Container enthält eine Kopfzeile mit Dateinamen und einem externen Link-Button (`↗`), der die PDF-Datei in einem neuen Browser-Tab öffnet.
   - Ein eingebetteter Iframe lädt die Datei über `/api/vault/attachment?path=...#toolbar=1&view=FitH` mit nativer PDF-Viewer-Steuerung.
   - **Optionale Höhenangabe:** Über `![[dokument.pdf|700]]` kann die Höhe in Pixeln konfiguriert werden (Standardhöhe: `550px`).
   - Das Backend liefert PDF-Dateien über `GET /api/vault/attachment` mit `Content-Type: application/pdf` und `Content-Disposition: inline` aus.
2. **Lese-Ansicht:**
   - Im Lese-Modus wird anstelle von CodeMirror `marked` (mit aktiviertem GitHub Flavored Markdown `gfm: true` für Tabellen, Aufgabenlisten und Durchstreichungen) nach einer Vorverarbeitung durch [`preprocessObsidianMarkdown`](../src/components/LivePreviewEditor.tsx) gerendert.
   - Klicks auf interne Links, Tags, Kopier-Buttons und interaktive Mermaid-/HTML-Umschalter werden per Event-Delegation abgefangen.
   - `DOMPurify.sanitize` schützt den Ausgabestrom unter Erhalt von interaktiven SVGs, Buttons und isolierten Preview-Iframes.

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
- **Einklappbares Einstellungs-Panel (`zuber_graph_settings` in `localStorage`):**
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

Zuber bietet ein umfassendes Einstellungsfenster (über das Zahnrad in der Top-Toolbar und im Ribbon erreichbar):

- **Menü 1: „Darstellung & Themes“:**
  - Steuert über `data-theme` auf `document.documentElement` alle Farben im Editor, in Sidebars, Tabellen und im Canvas-Graphen.
  - Das Theme wird persistent in `localStorage` unter `zuber_theme` gesichert.
  - **Die 5 Themes:**
    1. `zuber`: Dunkles Zuber (#0d1117/#161c24), Kristall-Gold (`#d4af37`) & Facetten-Türkis (`#29b6c8`).
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
  - Getrennte Datenbank pro Server-Profil (`zuber_cache_<profileId>`).
  - Stores: `meta` (Baum, Tags, Graph), `notes` (alle `.md`-Notizen vollständig lokal), `attachments` (gecachte Binär-Blobs) und `outbox` (Offline-Änderungen).
- **SyncEngine (`src/sync/syncEngine.ts`):**
  - Online: Flusht die `outbox`, vergleicht `GET /api/vault/sync-manifest`, lädt Deltas per `POST /api/vault/notes-batch` und aktualisiert ausgewählte Offline-Anhänge im Hintergrund.
  - Offline: Bedient alle Lese- und Schreibvorgänge nahtlos aus der IndexedDB (Optimistic UI).
- **Konflikt-Modal (`src/components/ConflictModal.tsx`):**
  - Erkennt bei Reconnect HTTP `409 Conflict` (abweichende `baseMtime`) und zeigt Side-by-Side-Vergleich von lokalem Text und Server-Stand.
  - Drei Lösungsstrategien: „Lokale Version behalten (Server überschreiben)“, „Server-Version behalten (Lokal verwerfen)“ oder „Beide behalten (Konflikt-Kopie mit Zeitstempel anlegen)“.
  - Bietet Checkbox für Batch-Anwendung auf alle verbleibenden Konflikte.

---

## 7. Befehlspalette (`Ctrl+P` / `Cmd+P`) & Shortcuts ([`src/components/CommandPalette.tsx`](../src/components/CommandPalette.tsx))

Zuber implementiert eine vollwertige **Befehlspalette**, die global per Tastenkombination `Ctrl+P` (oder `Cmd+P` auf macOS) sowie `Ctrl+O` aufgerufen werden kann:

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
  - `html, body { position: fixed; width: 100%; height: 100%; overflow: hidden; }` und `.knowmesh-app-shell { height: var(--vvh, 100dvh); overflow: hidden; }` verhindern, dass Android das Gesamtfeld nach oben verschiebt. Die Topbar und Sticky-Editor-Toolbar bleiben somit absolut ortsfest sichtbar am oberen Displayrand verankert, während ausschließlich `.editor-pane.scroller` vertikal scrollt.
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
- **Links & Autocomplete:** Wiki-Links (`[[ ]]`) mit Autocomplete, externer Link-Button (`[ ]( )`) mit Popover-Dialog für Link-Text und URL sowie Tags (`#`).
- **Interaktiver Tabellen-Generator:** Voreinstellungen (`2×2`, `3×3`, `4×4`), manuelle Spalten-/Zeilenangabe sowie zeilen-/spaltenweise Erweiterung bei aktiver Tabelle.
- **Callouts:** Standardisierte Callout-Blöcke (`[!NOTE]`, `[!INFO]`, `[!TIP]`, `[!WARNING]`, `[!DANGER]`, `[!QUESTION]`) mit farbigen Badges und lokalisierten Titeln.
- **Foto- & Kamera-Upload:** Direkte Wahl zwischen Dateiauswahl / Galerie und Live-Kameraaufnahme.
- **Präfix-Einfügung & Cursor-Positionierung:**
  - Beim Einfügen oder Wechseln von Überschriften (`H1`–`H6` oder Level 0), Aufzählungen (`- `), nummerierten Listen (`1. `), Aufgaben (`- [ ] `) oder Zitaten (`> `) berechnet der Editor die relative Cursorposition im Text und positioniert den Cursor via explizitem `selection`-Dispatch direkt rechts hinter dem Präfix und Leerzeichen (z. B. `# |` oder `- [ ] |`).
  - Im Live-Preview-Modus bleibt die bearbeitete Zeile dadurch aktiv aufgeklappt (`selectionTouchesLine === true`), und der Nutzer kann unmittelbar weiterschreiben.

---

## 10. Zen-Modus (`Alt+Z`) & Notiz-Dokumenten-Layout

- **Zen-Modus (`Alt+Z`):**
  - Aktivierbar per Shortcut `Alt+Z`, über den Topbar-Button „Zen“ oder über die Befehlspalette.
  - Beendbar per `Alt+Z`, `Escape` oder über den dezenten Schwebeknopf oben rechts (`.zen-mode-exit-btn`).
  - Blendet sämtliche Bedienelemente (Ribbon, Seitenleisten, Header, Statusleiste, Eigenschaften und Formatierungsleiste) komplett aus.
  - **Scrollbar am rechten Fensterrand & Full-Width Mausrad-Support:** Der äußere Scroll-Container (`.editor-pane`, `.cm-scroller`) erstreckt sich über die vollen $100\,\%$ der Browserfensterbreite (`max-width: none`). Die vertikale Scrollleiste verläuft dadurch sauber ganz rechts am Bildschirmrand und das Dokument lässt sich mit dem Mausrad auch über den leeren Randbereichen scrollen.
  - **Inhalts-Zentrierung:** Ausschließlich der eigentliche Textbereich (`.cm-content`, `.reading-view-container`) wird innerhalb des 100%-Containers auf maximal $820\,\text{px}$ mit `margin: 0 auto` horizontal in der Bildschirmmitte zentriert.
- **Dokumenten-Layout & Überschriften:**
  - Die separate statische H1-Titelzeile oberhalb des Editors wurde entfernt. Markdown-Dokumente mit Überschriften wie `# Mein Titel` werden nun ohne Dopplung direkt im CodeMirror-Editor angezeigt und bearbeitet.
  - Das Frontmatter-Eigenschaften-Panel (`PropertiesEditor`) ist beim Öffnen der App sowie beim Wechseln von Notizen **standardmäßig eingeklappt** (`collapsed: true`) und zeigt nur die schmale Kopfzeile `> Eigenschaften [Anzahl]`.

---

## 11. Verschlankte Benutzeroberfläche (Header- & Ribbon-Bereinigung)

Zur Beseitigung redundanter Bedienelemente und Schaffung maximalen Freiraums für den Notizinhalt:
- **Linke Ribbon-Leiste:** Beginnt direkt mit dem Button „Neue Notiz“ (`+`-Datei-Icon), gefolgt von Editor-Ansicht, Graph-Ansicht und Split-View. Der frühere doppelte Sidebar-Toggle-Button am Kopf des Ribbons wurde entfernt, da die Leiste primär über den linken Button der Haupt-Toolbar gesteuert wird.
- **Obere Haupt-Toolbar (Links):** Der frühere Branding-Block (`Zuber`-Logo, Text, `vault`-Badge und Trennstrich) wurde vollständig entfernt. Unmittelbar neben dem linken Sidebar-Toggle-Button folgt nahtlos der Breadcrumb-Pfad der geöffneten Notiz inklusive des Speicherstatus-Badges.
- **Obere Haupt-Toolbar (Rechts):**
  - Entfernung redundanter Buttons: „Bild einfügen“ (befindet sich in der `EditorToolbar`), „Graph-Ansicht“ (befindet sich im Ribbon) und „>_ Befehle“ (wird über den Shortcut `Ctrl+P` / `Cmd+P` bedient).
  - Die verbleibende Menüleiste rechts enthält sauber strukturiert:
    1. **Modus-Umschalter:** `Live-Preview` | `Lesen` | `Quellcode`
    2. **Zen-Button:** Umschalten in den Vollbild-Zen-Modus (`Alt+Z`)
    3. **Sync-Status:** `● Synchronisiert` (mit Dropdown für Server-Details)
    4. **Einstellungen:** Zahnrad (`⚙`) für Themes, Profile und Sicherheit
    5. **Rechte Seitenleiste:** Toggle-Button für Backlinks, Gliederung und lokalen Graphen

---

## 12. Mehrsprachigkeit & Internationalisierung (i18n)

Zuber verfügt über eine schlanke, performante Internationalisierung direkt im Client-Bundle:
- **Standardsprache (Default & Fallback):** **Englisch (`en`)**, sofern in `localStorage` (`zuber_language`) noch keine andere Sprache hinterlegt ist.
- **Unterstützte Sprachen:**
  - `en` – English (Default)
  - `de` – Deutsch
- **Architektur (`src/i18n/`, `src/locales/en.json`, `src/locales/de.json`):**
  - Implementiert als typisierter React-Context `I18nProvider` mit dem Hook `useTranslation()`.
  - Unterstützt verschachtelte Dot-Notation (`t('sidebar.newNote')`) sowie dynamische Platzhalter (`t('dialogs.deleteNotePrompt', { name })`).
  - Fällt bei unbekannten Schlüsseln automatisch auf das englische Original zurück.
- **Konfiguration:**
  - Der Sprachwähler ist oben im Einstellungs-Tab **„Appearance & Themes“** (`SettingsModal.tsx`) platziert.
  - Ein Sprachwechsel schaltet die gesamte Benutzeroberfläche reaktiv ohne Seiten-Reload um und persistiert die Wahl dauerhaft in `localStorage`.

---

## 13. Einstellungs-Rubrik „Editor & Files“ & Konfigurierbares Startverhalten

In `SettingsModal.tsx` existiert der dedizierte Bereich **„Editor & Files“** mit konfigurierbarem Startverhalten:
- **Konfiguration (`src/startupConfig.ts`, `localStorage: zuber_startup_config`):**
  ```ts
  export type StartupBehavior = 'last' | 'daily' | 'specific';
  export interface StartupConfig {
    behavior: StartupBehavior; // Standard: 'last'
    specificNotePath?: string; // Relativer Pfad für 'specific'
    dailyFolder?: string;      // Zielordner für 'daily' (z.B. "Tägliche Notizen")
  }
  ```
- **Optionen:**
  1. **Letzte geöffnete Notiz (`last` – Standard):** Speichert bei jedem Notizwechsel den relativen Pfad in `zuber_last_active_note` und stellt exakt diese Notiz beim nächsten Start wieder her.
  2. **Heutige Tagesnotiz (`daily`):** Prüft, ob `YYYY-MM-DD.md` (z. B. `2026-10-17.md`) im konfigurierten Ordner existiert. Falls nicht, wird die Datei mit Standard-Header (`# YYYY-MM-DD`) und Tagesdatum automatisch erstellt und geöffnet.
  3. **Bestimmte Notiz immer öffnen (`specific`):** Bietet ein Dropdown-Auswahlfeld aller Markdown-Dateien im Vault, um z. B. eine Startseite oder ein Dashboard als feste Startnotiz zu definieren.

---

## 14. Dateibaum: Multi-Select, Drag & Drop, „Verschieben nach…“-Dialog & Kontextmenü (`FileSidebar.tsx`)

Für maximale Effizienz bei der Dateiorganisation bietet der Dateibaum umfassende Interaktionsmöglichkeiten:
- **Eindeutige Zeilenmarkierung über relative Pfade:**
  Der Abgleich aktiver und selektierter Einträge erfolgt strikt über `node.path` (`activePath === node.path`, `selectedPaths.has(node.path)`), um Fehlmarkierungen gleichnamiger Dateien in unterschiedlichen Verzeichnissen auszuschließen.
- **Vollwertige Mehrfachauswahl (Multi-Select):**
  - **Einfacher Klick:** Setzt die Auswahl auf genau dieses Element und öffnet die Datei bzw. klappt den Ordner um.
  - **`Ctrl` + Klick / `Cmd` + Klick:** Schaltet das angeklickte Element in `selectedPaths` ein/aus (Toggle), ohne die aktive Notiz im Editor umzuschalten.
  - **`Shift` + Klick:** Wählt alle sichtbaren Dateibaum-Einträge zwischen dem Anker-Element (`lastClickedPath`) und dem Ziel-Element aus (Bereichsauswahl).
  - **`Escape` oder Klick in den leeren Bereich:** Hebt die Mehrfachauswahl vollständig auf.
  - **Optisches Feedback:** Markierte Zeilen erhalten die CSS-Klasse `.tree-item.is-selected`.
- **Internes & Externes Drag & Drop:**
  - **Interner Drag:** Zieht einzelne oder alle per Multi-Select markierten Dateien/Ordner (`application/x-knowmesh-paths`). Zirkuläre Verschiebungen (Ordner in sich selbst oder eigene Unterordner) werden strikt verhindert.
  - **Externer Datei-Upload:** Ziehen von Dateien (`.md`, `.canvas`, Bildern, PDFs etc.) aus dem Betriebssystem lädt diese direkt in den markierten Zielordner oder ins Vault-Root hoch und klappt den Zielordner auf.
  - **Drop-Ziele & Auto-Expand:** Ordner werden beim Ziehen als Ziel hervorgehoben (`.tree-folder.is-drop-target`). Verweilt die Maus länger als 500 ms über einem geschlossenen Ordner, klappt dieser automatisch auf.
- **„Verschieben nach…“-Dialog (`MoveToModal.tsx`):**
  - Das frühere, fehleranfällige „Cut / Ausschneiden“ im Zwischenspeicher wurde vollständig entfernt.
  - Klick auf **„Move to…“ / „Verschieben nach…“** (bzw. bei Mehrfachauswahl „X Elemente verschieben nach…“) öffnet ein schnelles, tastaturbedienbares Modal mit Autofokus auf das Suchfeld.
  - Listet das Wurzelverzeichnis (`/ (Root)`) sowie alle gültigen Ordner auf. Navigation per Pfeiltasten `↑`/`↓` und Bestätigung per `Enter`.
- **Bereinigtes & dynamisches Kontextmenü:**
  - **Desktop:** Rechtsklick (`onContextMenu`) auf Datei- oder Ordner-Zeilen.
  - **Touch/Mobile:** Langer Druck (~500 ms Long-Press) sowie `⋮`-Aktionsbutton (`.tree-item-more-btn`).
  - **Mehrfachauswahl-Aktionen:** Bei mehr als 1 markiertem Element passt sich das Menü dynamisch an („X Elemente verschieben nach…“, „X Elemente löschen“).
  - **Einzeldatei-Aktionen:** „Inhalt kopieren“, „Verschieben nach…“, „In diesen Ordner einfügen“, „Umbenennen“, „Löschen“, „Herunterladen“ und „Versionsverlauf“.

---

## 15. Offline-Dateierstellung, Outbox-Sync & Responsives Einstellungs-Modal

### 15.1 Reaktiv aktualisierter Dateibaum via WebSocket
- Der WebSocket-Listener in [`src/App.tsx`](../src/App.tsx) lauscht auf alle File-Events (`vault:changed`, `add`, `unlink`, `addDir`, `unlinkDir`).
- Sobald ein solches Event empfangen wird, lädt `App.tsx` den Verzeichnisbaum (`loadVaultIndex()`) sofort und strukturell neu, wodurch neu erstellte oder extern veränderte Dateien umgehend in [`FileSidebar.tsx`](../src/components/FileSidebar.tsx) erscheinen, ohne dass ein manueller Refresh erforderlich ist.

### 15.2 Responsives Einstellungs-Modal auf mobilen Geräten (`SettingsModal.tsx`)
- **Overlay & Viewport-Anpassung:** Zentriertes Vollbild-Overlay (`.settings-modal-overlay`) mit Touch-Optimierung und Backdrop-Filter.
- **Mobile Ansicht (`@media (max-width: 768px)`):**
  - Tabs ordnen sich horizontal als scrollbare Navigationsleiste (`.settings-nav-items-wrapper`) oben an.
  - Das Modal nutzt die volle Viewport-Breite (`100vw`, `100vh`) ohne Abschneiden nach rechts.
  - Der Schließen-Button (×) ist im Header oben rechts immer fest sichtbar und bietet ein berührungsfreundliches Touch-Target (mindestens 44×44 px).

### 15.3 Offline-Erstellung von Dateien & Ordnern (IndexedDB & Outbox)

1. **Architektur auf API- & Data-Layer-Ebene (`src/api.ts` & `src/sync/syncEngine.ts`):**
   - Zuber verwendet das **OfflineSyncDelegate**-Pattern: `api.ts` delegiert Aufrufe von `saveNote`, `createFolder`, `renameEntry`, `copyEntry` und `deleteEntry` an die `SyncEngine`.
   - Bei bestehender Online-Verbindung versucht die App, Mutationen direkt über `rawApi` an den Server zu senden.
   - Ist das Gerät offline (`navigator.onLine === false`) oder schlägt die Server-Anfrage fehl (Netzwerkfehler, Server nicht erreichbar), schaltet die App nahtlos auf die lokale IndexedDB um:
     - **Ordner (`createFolder`):**
       - Der neue Ordnerpfad wird sofort in die bekannten Ordner (`meta.folders`) und in die Baum-Struktur (`meta.tree`) in IndexedDB eingefügt.
       - Es wird ein chronologischer Outbox-Eintrag generiert:
         ```ts
         {
           id: generateMutationId('folder', path),
           type: 'create_folder',
           path: path,
           timestamp: Date.now()
         }
         ```
       - `loadVaultIndex()` lädt den Baum direkt aus IndexedDB, sodass der neue Ordner in der `FileSidebar` sofort sichtbar und nutzbar ist.
     - **Dateien / Notizen (`saveNote` / `createNote`):**
       - Erstellt das vollständige `NoteData`-Objekt (`path`, `name`, `body`, `properties`, `frontmatter`, `links`, `embeds`, `tags`, `headings`) lokal im `notes`-Store.
       - Aktualisiert synchron `meta.tree`, `meta.allNotes` und `meta.files` in IndexedDB, wodurch die Notiz sofort im Vault-Index existiert, per `[[Wiki-Link]]` auflösbar ist und in der Schnellsuche gefunden wird.
       - Erstellt einen Outbox-Eintrag:
         ```ts
         {
           id: generateMutationId('save', path),
           type: 'save_note',
           path: path,
           body: updatedNote.body,
           properties: updatedNote.properties,
           baseMtime: 0,
           timestamp: Date.now()
         }
         ```
       - Die Notiz wird sofort als `activeNote` im Editor geöffnet, sodass ohne Unterbrechung weitergeschrieben werden kann.

2. **Chronologische Outbox-Abarbeitung bei Reconnect (`flushOutbox()`):**
   - Sobald die Verbindung wiederhergestellt ist (`online`-Event oder Polling-Check in `checkConnectionAndSync()`), arbeitet die `SyncEngine` alle Outbox-Einträge streng nach Zeitstempel (FIFO) ab:
     - Für `create_folder`: Sendet `POST /api/vault/folder` an den Server.
     - Für `save_note`: Liest den frischesten Stand aus `localDb.getNote(path)` und sendet `POST /api/vault/note` mit vollem Payload.
   - Erst nach erfolgreicher Server-Bestätigung (HTTP 200) wird der jeweilige Eintrag aus der `outbox` gelöscht.
   - Nach vollständigem Abarbeiten der Outbox erfolgt ein Delta-Manifest-Sync (`getSyncManifest()`) und das UI synchronisiert seinen Zustand.

---

## 16. Smartphone-Optimierung: Minimale Ränder, getrennte Schriftgrößen, Vollbild-Seitenleisten (100vw) & Wischgesten

### 16.1 Minimale Editor-Ränder auf Smartphones (`< 768px`)
- **Smartphone-Layout:** Bei Viewports unter 768px (`@media (max-width: 768px)`) werden alle überflüssigen horizontalen Abstände auf 0 gesetzt: `.editor-pane`, `.editor-scroll-container` und `.cm-scroller` besitzen `padding-left: 0; padding-right: 0;`.
- **Inhalts-Padding:** `.cm-content`, `.reading-view-content`, `.reading-view-container`, `.editor-inner-content` sowie `.properties-panel` und `.properties-wrapper` erhalten ein minimales, ergonomisches Rand-Padding von genau `8px` (`width: 100%; box-sizing: border-box;`).
- **Desktop-Layout (`>= 768px`):** Bleibt unverändert zentriert mit `max-width: 820px; margin: 0 auto;` und angenehmem Weißraum.

### 16.2 Getrennte Schriftgrößen-Regler (Desktop vs. Mobile & UI vs. Editor)
- **Persistierung:** Gespeichert unter `localStorage.getItem('zuber_font_settings')` als `FontSettings`-Objekt via [`src/fontSettings.ts`](../src/fontSettings.ts):
  ```ts
  interface FontSettings {
    desktop: { uiFontSize: number; editorFontSize: number };
    mobile: { uiFontSize: number; editorFontSize: number };
  }
  ```
- **Standardwerte:**
  - Desktop: UI 14px, Editor 16px
  - Mobile: UI 15px, Editor 16px
- **CSS-Variablen:** Werden dynamisch auf `:root` (`document.documentElement.style`) als `--km-font-size-ui` und `--km-font-size-editor` gesetzt.
- **Matrix-UI in den Einstellungen:** 4 Schieberegler im Einstellungs-Tab „Editor & Dateien“ mit Live-Werteanzeige und „Auf Standard zurücksetzen“-Button.

### 16.3 Vollbild-Seitenleisten auf Smartphones (100vw)
- Auf Mobilgeräten (`< 768px`) nehmen sowohl die linke Seitenleiste (`.left-drawer-panel`, `.left-sidebar`, `.file-sidebar`) als auch die rechte Seitenleiste (`.right-sidebar`) die volle Bildschirmbreite ein (`width: 100vw !important; max-width: 100vw !important; inset: 0 !important; z-index: 500 !important; background: var(--bg-primary) !important;`).
- Das dunkle Backdrop (`.mobile-drawer-backdrop`) wird bei 100vw automatisch ausgeblendet (`display: none !important;`).
- Jede Leiste verfügt über einen gut erreichbaren Schließen-Button (`close-sidebar-btn` / Schließen-Icon).
- Optimierte Einschub-Animationen (`slideInLeft` und `slideInRight`) mit `0.2s cubic-bezier(0.16, 1, 0.3, 1)`.

### 16.4 Wischgesten (Touch-Swipes) mit Scroll-Schutz
- **Links-Seitenleiste schließen:** Swipe nach links (`deltaX < -50`), wenn `leftSidebarOpen === true`.
- **Rechts-Seitenleiste schließen:** Swipe nach rechts (`deltaX > 50`), wenn `rightSidebarOpen === true`.
- **Links-Seitenleiste öffnen:** Swipe nach rechts von der linken Kante (`startX <= 35`) oder starker Swipe (`deltaX > 65`), wenn beide Seitenleisten geschlossen sind.
- **Vertikaler Scroll-Schutz:** Gesten werden ignoriert, wenn die vertikale Bewegung dominant oder gleichwertig ist (`Math.abs(deltaY) >= Math.abs(deltaX)` oder `Math.abs(deltaX) <= Math.abs(deltaY) * 1.4`). Normales Lesen und Scrollen durch die Notiz wird zu keinem Zeitpunkt versehentlich unterbrochen.

---

## 17. Grafischer Canvas-, Workflow- & Netzwerk-Editor (`.canvas` & `@xyflow/react`)

Zuber integriert einen vollwertigen, grafischen Unendliche-Leinwand-Editor für `.canvas`-Dateien im zentralen Arbeitsbereich, basierend auf `@xyflow/react`.

### 17.1 Komponenten-Architektur (`src/components/canvas/`)

```mermaid
flowchart TD
    App["App.tsx"] -->|"activeNote (.canvas)"| CE["CanvasEditor.tsx (@xyflow/react)"]
    CE --> Mapper["canvasMapper.ts (Obsidian JSON <-> React Flow)"]
    CE --> Toolbar["CanvasToolbar.tsx (Dock-Toolbar)"]
    CE --> Inspector["CanvasInspector.tsx (Schwebender Attribut-Inspektor)"]
    CE --> Context["CanvasContext.tsx (Navigation & Interaktion)"]
    CE --> NodeShape["CanvasShapeNode.tsx (11 SVG-Formen, Markdown, [[Wiki-Suggest)"]
    CE --> NodeFile["CanvasFileNode.tsx (Notiz-Vorschau mit 'Öffnen ↗')"]
    CE --> NodeGroup["CanvasGroupNode.tsx (Gruppencontainer)"]
    CE --> NodeLink["CanvasLinkNode.tsx (Weblink-Karten)"]
```

### 17.2 Bidirektionales Daten-Mapping (`canvasMapper.ts`)
- **JSON Canvas $\rightarrow$ React Flow:**
  - Konvertiert `JsonCanvasNode` in getypte React Flow Nodes (`shape`, `file`, `group`, `link`).
  - Rekonstruiert Obsidian-Farbpaletten (1 bis 6) oder Hex-Farbcodes via `resolveCanvasColor()`.
  - Stellt den gespeicherten Ansichtsausschnitt (`viewport: { x, y, zoom }`) wieder her.
- **React Flow $\rightarrow$ JSON Canvas:**
  - Extrahiert saubere, minimal getypte Knoten und Kanten ohne interne React Flow Transient-States.
  - Standardknoten (`rectangle` ohne Spezial-Shape) werden als reguläre Obsidian `text`- oder `file`-Nodes exportiert.
  - Erweiterte Zuber-Formen behalten `shape: CanvasShape` bei (Graceful Degradation: Obsidian Desktop rendert sie als rechteckige Textkarten und ignoriert `shape`).

### 17.3 Container-Hierarchie, State-Sync & Interaktion
- **Explizite Container-Höhe:** Vom übergeordneten Workspace (`.canvas-workspace-pane`) über `.canvas-editor-wrapper` bis zu `.canvas-reactflow-container` ist eine durchgängige Mindesthöhe von `450px` bzw. `height: 100%` festgelegt. Das `<ReactFlow>`-Element spannt so garantiert die gesamte Arbeitsfläche auf.
- **Schutz vor State-Loop / Echo-Resets:** `CanvasEditor` speichert vor jedem Aufruf von `onChange(jsonStr)` den String in `lastEmittedJsonRef.current`. Wenn `App.tsx` den State aktualisiert und `rawContent` zurückreicht, erkennt der `useEffect`, dass die Änderung intern ausgelöst wurde, und bricht den Reset der Knoten und Kanten sofort ab (`return;`).
- **Sichere Spawn-Positionierung:** Neue Knoten (`+ Text`, `Workflow`, `Netzwerk`) berechnen ihre Koordinaten aus dem aktuellen Viewport und der `getBoundingClientRect()` des Containers (`Math.round((-vp.x + width/2)/safeZoom - nodeW/2)`), wodurch sie exakt im sichtbaren Zentrum platziert und selektiert werden.
- **Horizontale Toolbar (`CanvasToolbar.tsx`):**
  - Aufgeräumte horizontale Leiste am oberen Rand (`flex-direction: row !important; gap: 6px;`).
  - Schneller Zugriff auf Text, Notiz einbetten (mit Live-Suche), Gruppe, `Workflow ⌄` (Prozessschritt, Start/Ende, Kreis, Raute, Parallelogramm, Hexagon, Zylinder) und `Netzwerk ⌄` (Server, Router, Cloud, Workstation, Storage).
  - Dropdown-Menüs schließen sofort nach Auswahl des gewünschten Knotens.
  - Eigene Gruppe für Undo / Redo, Fit-View und Gittermodus (`dots`, `lines`, `off`).
- **Debounced Auto-Save (600 ms):** Jede Modifikation an Position, Größe, Text, Form oder Kantenverbindung löst nach 600 ms ein atomares Speichern über `api.saveNote()` aus.
- **Undo / Redo:** Eigener Snapshot-basierter Verlaufsspeicher (Stack mit bis zu 50 Schritten), steuerbar über Tastenkürzel (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`) und Toolbar-Buttons.
- **Touch- & Gestenunterstützung:** Flüssiges Zwei-Finger-Pinching zum Zoomen und Schieben per Drag.

### 17.4 Custom Node Types & Features
1. **`CanvasShapeNode.tsx` (Workflow- & Netzwerk-Formen):**
   - 11 Vektorformen mit dynamischer SVG-Geometrie: `rectangle`, `rounded`, `circle`, `diamond`, `parallelogram`, `hexagon`, `cylinder`, `cloud`, `server`, `router`, `workstation`.
   - 4 multidirektionale Verbindungspunkte (Handles: `top`, `right`, `bottom`, `left`) zum intuitiven Ziehen von Verbindungen.
   - Doppelklick aktiviert den Inline-Markdown-Editor.
   - Schnelle Wiki-Link-Vervollständigung: Beim Tippen von `[[` öffnet sich eine Vorschlagsliste aller Vault-Notizen.
   - Integrierter `NodeResizer` zur freien Größenanpassung.
2. **`CanvasFileNode.tsx` (Vault-Notiz-Einbettung):**
   - Bindet beliebige Markdown-Notizen aus dem Vault direkt auf dem Canvas ein.
   - Zeigt eine scrollbare Textvorschau des Notiz-Bodys und eine „Öffnen ↗“-Aktion zum direkten Wechsel in die Notiz.
3. **`CanvasGroupNode.tsx` (Container):**
   - Halbdurchsichtige visuelle Umrandung zur Strukturierung logischer Komponenten und Funktionsblöcke.
4. **`CanvasLinkNode.tsx` (Externe Links):**
   - Stellt Weblinks mit Domain, Titel und Klick-Weiterleitung dar.

### 17.5 Schwebender Attribut- & Kanten-Inspektor (`CanvasInspector.tsx`)
- **Horizontale Pill-Bar:** Beim Selektieren eines Knotens oder einer Kante dockt am unteren Rand (`bottom: 20px; left: 50%; transform: translateX(-50%);`) ein schlanker, abgerundeter Inspektor-Balken (`border-radius: 9999px`) mit Glasmorphismus-Hintergrund an.
- **Nach oben öffnende Popovers (`bottom: calc(100% + 10px)`):** Formen-Raster (Shapes-Grid), Farbauswahl (Obsidian Canvas Colors) und Wiki-Link-Suche öffnen sich garantiert nach oben und werden durch Screen-Edges oder Canvas-Container niemals abgeschnitten.
- **Click-Outside-Handling:** Ein Dokument-weiter `mousedown`-Listener schließt geöffnete Popovers automatisch bei Klicks auf die Leinwand oder andere Elemente.
- **Kanten-Steuerung:** Ermöglicht das Beschriften von Kanten, Umschalten des Verbindungslinien-Stils (`bezier`, `straight`, `step`), Konfigurieren von Pfeilspitzen (`arrow`, `none` am Start/Ende) und Zuweisen von Kantenfarben.

### 17.6 Einbettung in Markdown-Dokumenten (`![[Workflow.canvas]]`)
- In `LivePreviewEditor.tsx` wird die Syntax `![[Dateiname.canvas]]` automatisch von `CanvasEmbedWidget.tsx` erfasst.
- Der Widget lädt die Canvas-Datei und rendert eine interaktive, zoombare und verschiebbare Mini-Leinwand direkt innerhalb des Markdown-Textes.
- Im Lese-Modus (`reading`) bereinigt DOMPurify das HTML unter Erhalt des `data-canvas-path`-Attributs.

---

## 18. Datei- und Ordnerverwaltung im Dateibaum (`FileSidebar.tsx`)

### 18.1 Multi-Datei- und rekursiver Ordner-Upload
- **Kontextmenü-Aktionen:**
  - **Ordner / Leerraum:** „Dateien hochladen…“ und „Ordner hochladen…“ (nutzt `webkitdirectory` zur Rekursion).
  - **Datei:** Uploads werden automatisch im übergeordneten Ordner der Datei platziert.
- **Strukturerhaltung:** Beim Upload ganzer Verzeichnisbäume wird die relative Pfadstruktur (`file.webkitRelativePath`) exakt beibehalten. Der Server legt fehlende Unterordner automatisch an.
- **Sicherheitsfilter:** Path-Traversal-Segmente (`..`, führende Slashes oder absolute Pfade) werden strikt validiert und abgelehnt.
- **Status-Feedback:** Kleine schwebende Toast-Benachrichtigung (`.sidebar-upload-status-toast`) signalisiert erfolgreiche Uploads (`{{count}} Datei(en) erfolgreich hochgeladen`).

### 18.2 Einzeldatei-Download & Ordner-ZIP-Streaming
- **Einzeldatei-Download:** Lädt beliebige Notizen, Canvases oder Anhänge über `/api/vault/download?path=...` mit `Content-Disposition: attachment` herunter. Im Offline-Modus greift für Markdown- und Canvas-Dateien ein Fallback auf `localDb` (Blob-Generierung im Browser).
- **Ordner- und Vault-Download (.zip):** Komprimiert Verzeichnisse oder den gesamten Vault on-the-fly (`archiver` / `ZipArchive`) mit `Content-Type: application/zip`. Versteckte Dateien und Konfigurationsordner (`.git`, `.obsidian`, dotfiles) werden automatisch herausgefiltert.

---

## 19. Integrierte Diagnose & Log-Viewer (`SettingsModal.tsx` & `clientLogger`)

### 19.1 Diagnose & Logs Tab in den Einstellungen
- **Zentraler Diagnose-Tab:** Erreichbar über das Zahnrad-Icon (`SettingsModal`) unter dem Tab `Protokolle & Diagnose` (`tabLogs`).
- **Log-Level Steuerung:** Dynamische Auswahl des Logging-Levels (`debug`, `info`, `warn`, `error`) synchron für Server und Client.
- **Kombinierte Ansicht:** Führt Client-Logs (`src/utils/logger.ts`) und Server-Logs (`/api/logs`) zeitlich chronologisch zusammen.
- **Filter- & Suchmöglichkeiten:**
  - Segmentierte Filter für Quellen: `Alle`, `Client`, `Server`.
  - Volltext-Echtzeitfilter über Kategorie, Nachrichtentext und Stacktrace/Details.
- **Ein-Klick-Export für Antigravity-Diagnose:**
  - Der Button „Für Antigravity kopieren“ (`logsCopy`) exportiert die gefilterten Logs in einem sauberen Markdown-Codeblock inklusive Browser-User-Agent, Betriebssystem, Viewport-Auflösung, Server-URL und aktuellem Zeitstempel direkt in die Zwischenablage.

### 19.2 Sequentielles Attachment-Paste & Upload-Lock
- Das Einfügen oder Hineinziehen von Bildern (`LivePreviewEditor.tsx`) setzt während des HTTP-Uploads ein synchrones Sperrflag (`isUploadingAttachmentRef = true`).
- Laufende oder geplante Auto-Saves werden für diesen Zeitraum pausiert und erst nach Abschluss des Uploads sowie Einfügen der Bild-Referenz (`![[attachments/...]]`) atomar ausgeführt, wodurch Konkurrenz-Konflikte (409) verhindert werden.

---

## 20. Erweiterte Editor-Funktionen & Formatierungs-Optimierungen

### 20.1 Verschachtelte Aufgabenlisten in Live-Preview (`CheckboxWidget`)
- Aufgaben (`- [ ]`, `* [ ]`, `+ [ ]`) mit führendem Whitespace (`  `, `    `, `\t`) werden über `indentSpaces` dynamisch formatiert.
- Der `CheckboxWidget` ersetzt das Präfix inklusive Einrückung und Listenzeichen und versieht die Checkbox mit einem berechneten linken Außenabstand (`marginLeft = calc(4px + indentSpaces * 0.65rem)`).
- Ein Klick auf die Checkbox wechselt atomar `[ ]` $\leftrightarrow$ `[x]` an der exakten Dokumentposition, ohne dass der Cursor in die Zeile springt oder die Einrückung verloren geht.

### 20.2 Bereinigte Aufgabenlisten im Lese-Modus (`mode === 'reading'`)
- Listenpunkte mit Checkboxen erhalten die CSS-Klasse `task-list-item` und werden via `list-style-type: none !important` und `:has(input[type="checkbox"])` bereinigt.
- Der störende Standard-Aufzählungspunkt (`•`) vor der Checkbox wird zuverlässig ausgeblendet, während die hierarchische Unterordnung eingerückter Aufgaben (`padding-left: 1.4rem`) exakt erhalten bleibt.

### 20.3 Externe Links (`[Text](https://...)`) & URL-Paste-Automatik
- **Toolbar-Button `[ ]( )`:** Öffnet ein Portal-Popover zur Eingabe von Link-Text (automatisch vorbefüllt mit markiertem Text) und Web-URL (`https://...`).
- **Automatisches URL-Paste:** Beim Einfügen einer HTTP/HTTPS-URL über `Ctrl+V` oder Rechtsklick wird:
  - bei markiertem Text der Text als Label übernommen: `[Markierter Text](URL)`.
  - ohne Markierung die URL als Markdown-Link formatiert: `[URL](URL)`.
  - in Fenced-Codeblöcken (` ``` `), Inline-Code (`` ` ``) oder innerhalb existierender `](...)`-Links die URL normal als Rohtext eingefügt (keine störende Fehleskalation).
- **Interaktive Klickbarkeit:** Externe Links rendern im Live-Preview (`ExternalLinkWidget`) und im Lesemodus als `<a href="..." target="_blank" rel="noopener noreferrer">` und öffnen bei Klick den Link direkt im neuen Browser-Tab.

---

## 21. UI-Refinements, Resizable Sidebars & Latching Favoriten-/Verlaufspanels (Phase 3)

### 21.1 Icon-Only Navigation & Tooltips
- **Linke Leiste (`FileSidebar.tsx`):** Die Reiter-Buttons für **Dateien** (`Folder`), **Suche** (`Search`) und **Tags** (`Hash`) werden ohne störenden Text als reine Icons dargestellt. Die Lokalisierung wird per `title`-Attribut und `aria-label` beim Hovern angezeigt.
- **Top-Toolbar (`App.tsx`):** Die Umschalter für **Live-Preview** (`Eye`), **Lesen** (`BookOpen`), **Quellcode** (`Code2`) sowie der **Zen-Modus** (`Maximize2`) sind als kompakte, icon-basierte Buttons formatiert.
- **Bereinigte Statusleiste:** Das redundante „Vault in sync“-Badge in der linken unteren Ecke wurde entfernt, da der Verbindungs- und Sync-Status bereits prominent in der oberen Leiste angezeigt wird.

### 21.2 Neues Mindmap-/Workflow-Canvas-Icon (`WorkflowCanvasIcon`)
- Das bisherige Raster-Icon (`Layout`) für `.canvas`-Dateien wurde durch ein dediziertes **Workflow- & Mindmap-Icon** (`WorkflowCanvasIcon.tsx`) ersetzt:
  - Eine Wurzelbox auf der linken Seite verzweigt über geschwungene S-Kurven-Konnektoren zu zwei Kind-Knoten auf der rechten Seite.
  - Das Icon ist in allen Dateibaum-Einträgen, Datei-Badges, Sidebar-Aktionen, Kontextmenüs und der Befehlspalette einheitlich integriert und unterscheidet sich klar von der globalen Graph-Ansicht.

### 21.3 Einrastende Favoriten- & Zuletzt-verwendet-Panels (`FileSidebar.tsx`)
- In der Menüleiste der linken Leiste (direkt neben dem Tags-Button) befinden sich zwei einrastende Toggle-Buttons:
  - **Favoriten (⭐):** Schaltet das Favoriten-Panel oberhalb des Dateibaums ein/aus (Zustand persistent in `localStorage` unter `zuber_show_favorites_panel`). Favoriten können im Kontextmenü jeder Datei und jedes Ordners per Rechtsklick hinzugefügt oder entfernt werden.
  - **Zuletzt verwendet (🕒):** Schaltet das Verlaufspanel der letzten 10 geöffneten Notizen/Canvases ein/aus (`zuber_show_recent_panel`).
- **Höhen- & Scroll-Regel:** Beide Panels zeigen bis zu 10 Elemente ohne Scrollbalken an; darüber hinaus begrenzt `max-height: calc(10 * 28px); overflow-y: auto;` die Liste, sodass der Haupt-Dateibaum darunter stets vollständig bedienbar bleibt.
- **Rename- & Delete-Synchronisation:** Beim Umbenennen oder Löschen von Dateien oder Ordnern werden Favoriten und Recent-Listen in `localStorage` automatisch angepasst bzw. bereinigt (`src/utils/vaultNavigation.ts`).

### 21.4 Frei ziehbare Seitenleisten (Resizable Sidebars)
- Die Breiten der linken und rechten Leiste können auf Desktop-Bildschirmen (`>= 768px`) interaktiv über Maus-Ziehgriffe angepasst werden:
  - `.sidebar-resizer-left`: Anker am rechten Rand der linken Leiste (Standard: `280px`, min: `180px`, max: `600px`).
  - `.sidebar-resizer-right`: Anker am linken Rand der rechten Leiste (Standard: `300px`, min: `200px`, max: `650px`).
- Die Abmessungen werden in CSS-Variablen `--left-sidebar-width` und `--right-sidebar-width` geschrieben und in `localStorage` (`zuber_sidebar_widths`) persistent gespeichert.

---

## 22. Canvas- & Theme-Optimierungen (Phase 4)

### 22.1 Responsive Canvas Top-Toolbar & Popover-Clamping (`CanvasToolbar.tsx` & `src/styles.css`)
- **Container-relative Breitenbegrenzung:** Die obere Canvas-Werkzeugleiste (`.canvas-toolbar`) orientiert sich nun über `max-width: calc(100% - 24px) !important;` exakt an der tatsächlichen inneren Breite des `.canvas-editor-wrapper` anstelle des Gesamtframes (`100vw`). Bei geöffneten Seitenleisten schneidet die Toolbar nicht mehr am rechten Bildschirmrand ab.
- **Automatisches Flex-Wrapping:** Mittels `flex-wrap: wrap !important; width: max-content; justify-content: center;` brechen Schaltflächen bei schmalen Viewports oder hohen Zoomstufen sauber in kompakte Reihen um.
- **Dynamisches Boundary-Clamping für Dropdowns:** Dropdown-Menüs (`Notiz einbetten`, `Workflow ⌄`, `Netzwerk ⌄`) ermitteln per `getBoundingClientRect()` ihre Position relativ zum Container (`.canvas-editor-wrapper`) und verschieben ihre X-Position dynamisch, sodass sie garantiert innerhalb des sichtbaren Arbeitsbereichs bleiben.

### 22.2 Vergrößerte Resize Hit-Areas (14px) für Linux KDE & Chromium (`src/styles.css`)
- **14px × 14px Eck- und Kanten-Handles:** `.react-flow__resize-control.handle` und `.canvas-resizer-handle` bieten eine vergrößerte Klick- und Greiffläche mit `z-index: 25`, wodurch Größenänderungen unter Linux/KDE/X11/Wayland und Chromium auch bei hochauflösenden Displays verlässlich greifen.
- **14px unsichtbare Hit-Lines an den Kanten:** `.react-flow__resize-control.line` und `.canvas-resizer-line` besitzen eine unsichtbare Greifzone von 14px (`top/bottom/left/right: -7px; background: transparent; z-index: 20;`), die das Greifen der Kanten erleichtert, ohne das optische Rahmendesign zu stören.
- **Priorisierte Verbindungs-Handles (`z-index: 30`):** Verbindungspunkte (`.canvas-node-handle`) sitzen mit `z-index: 30 !important` über den Resizer-Linien, sodass neue Verbindungslinien ohne versehentliches Auslösen eines Resizes gezogen werden können.

### 22.3 Umfassende Theme-Anpassung der Graph-Steuerung & Suche (`GraphView.tsx` & `src/styles.css`)
- **Dynamische Theme-Variablen:** Alle Steuerelemente der Graph-Ansicht (`.graph-toolbar-left`, `.graph-toolbar-right`, `.graph-controls-popover`, `.graph-control-row`, `.graph-group-row`, `.graph-legend`) nutzen semantische CSS-Variablen (`--bg-secondary`, `--bg-primary`, `--border-color`, `--text-primary`, `--accent-color`).
- **Aktive Farb-Synchronisation:** Die Legendenpunkte (`note-dot`, `active-dot`, `tag-dot`, `unresolved-dot`) und Touch-Aktionspillen reflektieren die aktiven Akzent- und Textfarben des eingestellten Themes.
- **Live-Reaktivität via `MutationObserver`:** `GraphView.tsx` überwacht `data-theme`- und `class`-Änderungen auf `document.documentElement`, liest aktualisierte Farbewerte aus `getComputedStyle(document.documentElement)` aus und rendert den Canvas im nächsten Frame automatisch in den neuen Theme-Farben.

### 22.4 Vollständige Theme-Integration für Canvas-Inspektor & Controls (`CanvasInspector.tsx`, `CanvasEditor.tsx`, `src/styles.css`)
- **Entfernung harter Hex-/Dark-Farbwerte:** Der schwebende Inspektor (`.canvas-floating-inspector`), seine Popover-Menüs (`.inspector-dropdown-menu`), Formengitter (`.inspector-grid-item`) und Kanten-Eingabefelder (`.inspector-edge-input`) nutzen einheitlich `var(--bg-secondary)`, `var(--bg-primary)` und `var(--border-color)` und passen sich Hell-, Dunkel- und Warm-Themes nahtlos an.
- **React Flow Controls & MiniMap:** `.canvas-rf-controls` und `.canvas-rf-minimap` sind vollständig in das Theme-System integriert; die MiniMap verwendet dynamische Masken- und Knotenfarben (`--border-subtle`, `--accent-color`, `--text-muted`).

### 22.5 Mobile Canvas & Header-Layout (`< 768px` und `< 600px`)
- **Umbruch der inneren Toolbar-Gruppen (`.canvas-toolbar-group`):** Neben der übergeordneten Toolbar brechen nun auch die inneren Button-Gruppen (`+ Text`, `Notiz einbetten`, `Gruppe`, `Workflow ⌄`, `Netzwerk ⌄`) mittels `flex-wrap: wrap !important; max-width: 100% !important;` sauber um. Dadurch wird verhindert, dass Buttons auf Smartphones (360px–412px Viewport) nach links oder rechts aus dem Bildschirm herausgeschoben werden.
- **Sichere horizontale Zentrierung:** Anstelle von `left: 50%; transform: translateX(-50%)` sind Toolbar und Inspektor mit `left: 12px; right: 12px; margin: 0 auto; width: fit-content; max-width: calc(100% - 24px) !important;` verankert, wodurch symmetrische Randüberläufe vermieden werden.
- **Viewport-Clamping für Popover-Menüs:** Dropdowns und Popovers (`CanvasToolbar.tsx` und `CanvasInspector.tsx`) berechnen ihre Ausrichtung via `requestAnimationFrame` dynamisch und klammern sich an die Ränder `[8px, window.innerWidth - 8px]` mit `max-width: calc(100vw - 24px) !important`.
- **Kollisionsvermeidung bei Zoom-Controls & MiniMap:**
  - Auf Touchscreens `< 768px` wird die MiniMap (`.react-flow__minimap`) ausgeblendet, da sie auf kleinen Bildschirmen zu viel Arbeitsfläche verdeckt.
  - Die Zoom- und Fit-View-Controls (`.canvas-rf-controls`) werden auf `< 768px` sowie bei aktiver Element-Selektion (`.has-selection .canvas-rf-controls`) auf `bottom: 76px !important;` angehoben, sodass sie nie mit dem schwebenden Attribut-Inspektor kollidieren.
- **Kompakte Topbar-Badges (< 600px):**
  - Auf schmalen Bildschirmen wird der Speichertext im Synchronisations-Badge ausgeblendet und durch ein kompaktes Status-Icon (`.sync-status-icon-mobile`, z. B. `✓`) ersetzt.
  - Die Textbeschriftung des Canvas-Modus-Indikators (`.canvas-mode-indicator span`) wird verborgen, sodass nur das 14px Workflow-Icon sichtbar bleibt und das Speicher-Badge nicht mehr abgeschnitten wird.

---

## 23. Git-Versionsverlauf, Visueller Diff-Viewer & Ein-Klick-Wiederherstellung (`VersionHistoryModal.tsx`, `gitService.ts`, `FileSidebar.tsx`, `src/styles.css`)

Zuber integriert eine vollständige, Obsidian-ähnliche Versionshistorie für alle `.md`-Notizen und `.canvas`-Whiteboards, die direkt auf der Git-Historie des Vaults aufsetzt.

### 23.1 Kontextmenü & Aufruf im Dateibaum (`FileSidebar.tsx`)
- **Kontextmenü-Integration:** Durch Rechtsklick (oder das `⋮`-Menü auf mobilen Endgeräten) auf eine beliebige Markdown-Datei oder ein Canvas-Board öffnet sich das Kontextmenü mit dem Menüpunkt **„Versionsverlauf“** (`sidebar.versionHistory`).
- **Befehlspalette (`Strg+P`):** Alternativ kann der Versionsverlauf für die aktuell geöffnete Notiz jederzeit über den Befehl **„Vault: Versionsverlauf für aktuelle Notiz öffnen“** aufgerufen werden.
- **Header-Badge:** Im Modal-Kopf wird der Dateiname als Code-Badge angezeigt, um zu jeder Zeit Orientierung über die betrachtete Datei zu bieten.

### 23.2 Backend Git-Abfrage mit `--follow` & Rename-Tracing (`server/gitService.ts`)
- **Git Rename-Tracking (`--follow`):** Das Backend ruft `git log --follow` auf. Dadurch werden alle Commits einer Datei lückenlos bis zur Erstellung nachverfolgt, selbst wenn die Datei im Laufe der Zeit in andere Ordner verschoben oder umbenannt wurde.
- **Fallback bei historischen Pfaden:** Bei `git show <commitHash>:<currentPath>` schlägt Git fehl, wenn die Datei im gewählten Commit noch einen älteren Namen trug. `GitService.getFileAtCommit()` fängt diesen Fehler automatisch ab, ermittelt den historischen Pfad der Datei in jenem Commit über `git log --follow --name-status` und ruft die Datei mit ihrem ursprünglichen Pfad erfolgreich ab.
- **Path-Traversal-Schutz:** Alle relativen Dateipfade werden über `sanitizeRelativePath()` validiert und dürfen den Vault-Wurzelordner niemals verlassen.

### 23.3 Interaktives Versions-Modal mit drei Ansichtsmodi (`VersionHistoryModal.tsx`)
- **Commit-Sidebar (Links):** Chronologische Liste aller bisherigen Commits für die Datei mit Commit-Nachricht, 7-stelligem Kurz-Hash-Badge, Autorenangabe, formatiertem Zeitstempel und einem grünen `Neueste`-Badge für den HEAD-Commit.
- **Diff- & Content-Pane (Rechts):**
  1. **Diff zur aktuellen Datei (`diff-current`, Standard):** Vergleicht die gewählte historische Version direkt mit dem aktuellen Arbeitsstand im Vault.
  2. **Diff zum vorherigen Commit (`diff-previous`):** Zeigt die Änderungen, die im ausgewählten Commit im Vergleich zu seinem unmittelbaren Vorgänger vorgenommen wurden.
  3. **Vollständiger Inhalt (`full`):** Zeigt den vollständigen Rohinhalt der Notiz oder des Canvas-Boards zum Zeitpunkt des ausgewählten Commits mit Zeilennummern.
- **Statistik-Badge:** Neben dem View-Switcher zeigt ein kompaktes Badge die Anzahl der hinzugefügten (`+X` in Grün) und entfernten (`-Y` in Rot) Zeilen an.

### 23.4 Performanter Zeilen-Diff-Algorithmus (`computeLineDiff`)
- **Reiner TypeScript-Diff:** Arbeitet vollständig im Frontend ohne externe Abhängigkeiten über einen optimierten LCS-Algorithmus (Longest Common Subsequence).
- **Präfix- & Suffix-Trimming:** Identische Zeilen am Anfang und Ende zweier Versionen werden vor dem Aufbau der LCS-Matrix herausgeschnitten. Dadurch wird die Matrix auf den tatsächlich veränderten Bereich beschränkt und berechnet selbst umfangreiche Dokumente in wenigen Millisekunden.
- **Linearer Fallback bei extremen Änderungen:** Überschreitet die theoretische Matrixgröße 600.000 Zellen, schützt ein linearer Block-Diff vor hohem Speicherverbrauch.
- **Zeilennummerngutter:** Zweispaltige Zeilennummern (Alte Zeile / Neue Zeile) plus `+` / `-` Marker im Stile von GitHub/GitLab.

### 23.5 Atomare Ein-Klick-Wiederherstellung & Echo-Prävention
- **Wiederherstellen-Schaltfläche (`Diese Version wiederherstellen`):** Öffnet einen auffälligen, roten Inline-Bestätigungsdialog mit Dateiname, Commit-Datum und Kurz-Hash zur Vermeidung von Fehlklicks.
- **Atomares Speichern via `VaultService`:** Das Backend speichert die Notiz über `vaultService.saveNote(cleanPath, { rawContent, forceOverwrite: true })`, sodass der In-Memory-Index, die Frontmatter-Caches und die Disk-Datei synchronisiert werden.
- **Automatischer Git-Commit:** Sofern Git aktiviert ist, wird automatisch ein neuer Commit mit der Nachricht `restore: <path> to <shortHash>` erstellt.
- **Frontend-Aktualisierung ohne Konflikte:**
  1. `recentSelfWritesRef` absorbiert nachfolgende Chokidar-Dateisystem-Events.
  2. Der IndexedDB-Cache (`syncEngine.getLocalDb().putNote`) wird sofort mit der wiederhergestellten Version aktualisiert.
  3. Ist die Datei aktuell im Editor geöffnet, wird `activeNote` sofort auf den wiederhergestellten Stand gesetzt und `saveState` auf `saved` gesetzt, ohne dass ein falscher 409-Konflikt ausgelöst wird.

---

## 24. Canvas-Interaktionsverbesserungen (`CanvasEditor.tsx`, `canvasMapper.ts`, `CanvasToolbar.tsx`, `CanvasShapeNode.tsx`, `src/styles.css`)

### 24.1 Gruppen-Verschiebung (Group Child Dragging)
- **Problem:** Beim Ziehen einer Gruppe (`type === 'group'`) wurde zuvor nur der Begrenzungsrahmen bewegt, während alle Notizen, Formen und Karten an ihrer alten Position verharrten.
- **Implementierung (`CanvasEditor.tsx` & `canvasMapper.ts`):**
  - `getChildNodesInGroup(groupNode, allNodes)`: Ermittelt alle Nicht-Gruppen-Knoten, deren Mittelpunkt `(x + width/2, y + height/2)` innerhalb der Bounding-Box der Gruppe liegt.
  - In `onNodeDragStart`: Bei Beginn des Drags einer Gruppe werden die IDs aller umschlossenen Kindknoten in `draggingChildNodeIdsRef` und die Startkoordinate der Gruppe in `dragStartGroupPosRef` festgehalten.
  - In `onNodeDrag`: Berechnet das Bewegungs-Delta `(dx, dy)` und verschiebt alle umschlossenen Kindknoten synchron um dieselbe Distanz.
  - In `onNodeDragStop`: Bereinigt die Tracking-Refs und persistiert den gemeinsamen Zustand im Undo/Redo-Stack sowie im automatischen Speichern.

### 24.2 Mehrfachauswahl & Marquee-Rechteck (Multi-Select & Box-Selection)
- **Konfiguration:**
  - `selectionMode={SelectionMode.Partial}`: Knoten werden bereits selektiert, sobald das Auswahlrechteck sie teilweise schneidet.
  - `selectionKeyCode="Shift"` & `multiSelectionKeyCode="Shift"`: Halten von `Shift` ermöglicht das Aufziehen eines Auswahlrahmens sowie das additive Selektieren per Klick.
  - `BoxSelect`-Schaltfläche in der Canvas-Toolbar: Aktiviert den Auswahl-Rechteck-Modus (`isSelectionToolActive`), sodass auch auf Touchscreens oder ohne Tastatur ein Marquee-Rahmen durch einfaches Ziehen aufgezogen werden kann (`selectionOnDrag={true}`).
- **Massenoperationen:**
  - **Verschieben:** React Flow bewegt alle selektierten Knoten gemeinsam.
  - **Löschen:** Klick auf den Löschen-Button im Inspektor oder `Entf`/`Backspace` löscht alle ausgewählten Knoten und deren anliegende Kanten in einer atomaren Operation.
  - **Duplizieren:** Dupliziert alle selektierten Knoten mit einem Versatz von `(+30px, +30px)` und selektiert sofort die neuen Duplikate.

### 24.3 Konfigurierbares Gitter & Einrasten (Snap-to-Grid & Grid Size)
- **Toolbar-Popover (`CanvasToolbar.tsx`):**
  - Schneller Einrast-Umschalter: `Einrasten aktiv (Snap)` / `Einrasten deaktiviert`.
  - Rastergrößen-Auswahl: Vier Pillen für `10px`, `15px` (Standard), `20px` und `25px`.
  - Hintergrundmuster: Umschaltbar zwischen `Punkte` (`dots`), `Linien` (`lines`) und `Aus` (`off`).
- **Persistenz:** Zustand wird in `localStorage` unter `zuber_canvas_grid` gespeichert und bleibt beim Notizwechsel und Neustart erhalten.
- **Bindung:** Wird direkt an `<ReactFlow snapToGrid={gridConfig.snapToGrid} snapGrid={[gridConfig.gridSize, gridConfig.gridSize]}>` und `<Background gap={gridConfig.gridSize} variant={...}>` übergeben.

### 24.4 Zentrierter Text & Markdown in Formen (`CanvasShapeNode.tsx`)
- Text- und Notiz-Inhalte in Formen besitzen die CSS-Klasse `.canvas-shape-content` mit `display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; height: 100%; width: 100%;`.
- Alle Paragraphen, Überschriften und Textareas innerhalb von Formen richten sich automatisch horizontal und vertikal mittig aus.

### 24.5 Kontextsensitive Verbindungs-Handles
- **Desktop (`@media (hover: hover) and (pointer: fine)`):** Verbindungspunkte (`.canvas-handle`, `.canvas-node-handle`, `.react-flow__handle`) sind im Ruhezustand transparent (`opacity: 0; pointer-events: none;`) und werden sanft eingeblendet (`opacity: 1; pointer-events: auto;`), sobald der Mauszeiger über den Knoten schwebt (`:hover`) oder der Knoten selektiert ist (`.selected`).
- **Touch-Geräte (`@media (pointer: coarse)`):** Handles bleiben unauffällig ausgeblendet, bis ein Knoten angetippt und damit selektiert wird. Bei Selektion erscheinen vergrößerte 18px × 18px Touch-Handles (`margin: -9px`) für präzises Verbinden mit dem Finger.

### 24.6 Zuverlässige Pfeilrichtung an Verbindungen
- **`onConnect` in `CanvasEditor.tsx`:** Beim Verbinden zweier Knoten wird `markerEnd` stets deterministisch an der Zielseite (`target`) mit `MarkerType.ArrowClosed` (16×16px) gesetzt, während `markerStart` `undefined` bleibt.
- **Bidirektionale Serialisierung (`canvasMapper.ts`):** `reactFlowToJsonCanvas` und `jsonCanvasToReactFlow` mappen `toEnd` und `fromEnd` ohne Richtungsvertauschung eins-zu-eins in das JSON-Canvas-Format.

### 24.7 Entfernung des Bearbeiten-Buttons auf Knoten (`CanvasShapeNode.tsx`)
- Der kleine Stift-Button am unteren Rand von Formknoten wurde entfernt, um visuelle Überlagerungen mit den unteren Verbindungs-Handles zu vermeiden.
- Die Inline-Bearbeitung von Notiz- und Kartentexten wird intuitiv und zuverlässig über Doppelklick (`onDoubleClick`) auf den Knoten aktiviert.

### 24.8 Zentriertes Formen-Popover & 3-Spalten-Gitter (`CanvasInspector.tsx` & `src/styles.css`)
- **Zentrierung:** Das Popover zur Formenauswahl (`.canvas-shape-picker-popover`) zentriert sich dank `position: static` auf `.inspector-popover-anchor` direkt über der gesamten Inspektions-Toolbar (`left: 50% !important; transform: translateX(-50%) !important`).
- **3-Spalten-Gitter:** Die Formauswahl verwendet ein 380px breites Gitter mit `grid-template-columns: repeat(3, minmax(110px, 1fr))`, sodass lange Begriffe wie `Parallelogramm` und `Abgerundet` ohne Textumbruch oder Stauchung dargestellt werden.
- **Dynamisches Clamping & Vertikales Flippen:** Erkennt die Nähe zum Bildschirmrand via `getBoundingClientRect()` und flippt bei wenig Platz nach oben automatisch nach unten (`top: calc(100% + 10px)`).

### 24.9 Kontext-Inspektor am Mauszeiger bei Rechtsklick (`CanvasEditor.tsx` & `CanvasInspector.tsx`)
- **Direktzugriff am Cursor:** Ein Rechtsklick auf einen Knoten (`onNodeContextMenu`) oder eine Kante (`onEdgeContextMenu`) selektiert das Element exklusiv und öffnet den schwebenden Inspektor direkt an der Mauszeiger-Position (`contextMenuPos`).
- **Viewport-Clamping (`position: fixed`):** Der Inspektor wird über `window.innerWidth - inspectorWidth - 16` und `window.innerHeight - inspectorHeight - 16` geklammert, sodass er niemals aus dem Bildschirm ragt.
- **Automatisches Schließen:** Das Kontextmenü schließt sich nahtlos beim Klick auf die Arbeitsfläche (`onPaneClick`, `onPaneContextMenu`), bei normaler Linksklick-Selektion (`onNodeClick`, `onEdgeClick`), beim Zoomen/Verschieben (`onMoveStart`) oder beim Drücken von `Escape`.
- **Standard-Modus:** Ohne Rechtsklick verbleibt die Toolbar wie gewohnt zentriert am unteren Bildschirmrand.

### 24.10 Kanten-Verbesserungen: Pfeilrichtung, Auto-Erstellung ins Leere & Wiederverbindung
- **Korrektur der Pfeilrichtung (`CanvasShapeNode.tsx`, `CanvasEditor.tsx` & `canvasMapper.ts`):**
  - **DOM-Stacking der Handles:** In `CanvasShapeNode.tsx` (sowie `CanvasFileNode` und `CanvasLinkNode`) werden `target`-Handles vor `source`-Handles im DOM gerendert. Dadurch liegt der `source`-Handle bei Hit-Tests oben, sodass das Ziehen einer Linie an jedem Verbindungspunkt deterministisch als `source` startet.
  - **Reversal-Schutz in `onConnect`:** Falls React Flow Quell- und Zielknoten vertauscht, korrigiert `CanvasEditor.tsx` die Orientierung anhand von `connectingRef.current`. Das Pfeilsymbol (`markerEnd: MarkerType.ArrowClosed`) wird garantiert am Zielknoten platziert, während `markerStart` `undefined` bleibt.
  - **JSON-Canvas-Mapping:** In `canvasMapper.ts` spiegelt `reactFlowToJsonCanvas` `edge.markerEnd` direkt auf `jsonEdge.toEnd = 'arrow'` und `edge.markerStart` auf `jsonEdge.fromEnd = 'arrow'`.
- **Auto-Knotenerstellung beim Ziehen ins Leere (`onConnectEnd`):**
  - Zieht der Nutzer eine Verbindungslinie aus einem Knoten-Handle heraus und lässt sie auf einer freien Canvas-Fläche (`.react-flow__pane`) los, wird an der Loslass-Position automatisch ein neuer Rechteck-Textknoten (`type: 'canvasShape'`, `shape: 'rectangle'`, 140×80px) erzeugt (`screenToFlowPosition`).
  - **Dynamisches Andocken an die nächste Seite (`targetHandle`):** Aus dem relativen Richtungsvektor zwischen dem Ursprungsknoten und der Loslass-Position (`dx = originX - dropPos.x`, `dy = originY - dropPos.y`) ermittelt das System automatisch die dem Ursprungsknoten zugewandte Seite des neuen Knotens:
    - Bei Bewegung nach rechts: `bestHandle = 'left'`
    - Bei Bewegung nach links: `bestHandle = 'right'`
    - Bei Bewegung nach unten: `bestHandle = 'top'`
    - Bei Bewegung nach oben: `bestHandle = 'bottom'`
  - Eine Verbindungslinie vom Ausgangsknoten zum neuen Knoten wird unmittelbar erstellt, wobei der Ziel-Handle exakt an die ermittelte Seite andockt und die Pfeilspitze zum neuen Knoten gerichtet ist.
  - Der neue Knoten wird automatisch ausgewählt und in den Verlauf (`pushHistory`) sowie den Auto-Save übernommen.
- **Markante Kanten-Selektion & Kanten-Wiederverbindung (`edgesReconnectable`):**
  - **Styling (`src/styles.css`):** Ausgewählte Kanten erhalten eine 3,5px starke Gold-Kontur (`stroke: var(--accent-color, #d4af37)`), einen weichen Glow-Filter (`drop-shadow(0 0 5px rgba(212, 175, 55, 0.65))`) und eine passende goldene Pfeilspitze (`marker path`).
  - **Reconnection-Handles (`.react-flow__edgeupdater`):** React Flow's Wiederverbindungspunkte (7px Radius mit Goldfüllung) werden ausschließlich für selektierte Kanten eingeblendet (`.react-flow__edge:not(.selected) .react-flow__edgeupdater { display: none !important; }`), sodass unselektierte Kanten sauber und aufgeräumt wirken.
  - **Reconnection-Handler (`onReconnect`, `reconnectEdge`):** Ausgewählte Verbindungslinien können per Drag & Drop an Start- oder Endpunkten auf andere Knoten umgehängt werden, wobei die Pfeilspitze am Ziel erhalten bleibt.

### 24.11 Deterministische Pfeilrichtung bei Canvas-Drop & Type-to-Edit für selektierte Knoten
- **Deterministische Pfeilrichtung beim Ablegen ins Leere (`onConnectEnd`):**
  - Unabhängig davon, ob der Drag an einem als `source` oder `target` klassifizierten Handle des Ursprungsknotens gestartet wurde, wird der Ursprungsknoten A (`originNodeId`) ausnahmslos als `source` und der neu erzeugte Knoten B (`newNodeId`) als `target` der Kante zugewiesen.
  - Dadurch zeigt die Pfeilspitze (`markerEnd: MarkerType.ArrowClosed`) stets 100% deterministisch von Knoten A nach Knoten B, mit `data.fromEnd = 'none'` und `data.toEnd = 'arrow'`.
- **Type-to-Edit für selektierte Canvas-Knoten (`CanvasEditor.tsx` & `CanvasShapeNode.tsx`):**
  - **Tastatur-Erkennung:** Wenn genau ein Form- oder Textknoten selektiert ist und der Benutzer ein beliebiges druckbares Zeichen tippt, schaltet der Knoten sofort ohne vorherigen Doppelklick in den Inline-Bearbeitungsmodus um.
  - **Text-Initialisierung & Fokus:** Das getippte Zeichen wird an den bestehenden Knotentext angehängt (bzw. beginnt den Text, falls leer), das `<textarea>` wird unmittelbar fokussiert und der Cursor ans Textende positioniert (`setSelectionRange(len, len)`).
  - **Eingabe-Schutz & Shortcuts:** Modifizierer-Tastenkombinationen (`Ctrl+Z`, `Ctrl+Y`), Panning via Leertaste (`Space`), das Löschen via `Delete`/`Backspace` sowie Eingaben in geöffneten Dialogen oder bestehenden Textfeldern sind durch strikte Guards vor Fehltriggerung geschützt.

---

## 25. Web Share Target API: Direkter Notizen- & Datei-Empfang in `Inbox/`

### 25.1 Manifest & Service Worker Integration
- **Web App Manifest (`public/manifest.webmanifest`):**
  - Registriert `share_target` mit `action: "/share-target"`, `method: "POST"` und `enctype: "multipart/form-data"`.
  - Akzeptiert Bildformate (`image/*`), PDFs (`application/pdf`, `.pdf`) sowie Markdown- und Textdateien (`text/markdown`, `text/plain`, `.md`).
- **Service Worker (`public/sw.js`):**
  - Fängt eingehende `POST /share-target`-Anfragen ab, extrahiert Titel, Text, URL und `shared_files` aus den `formData`.
  - Serialisiert die Nutzdaten in den browser-lokalen IndexedDB-Speicher `knowmesh_shared_incoming` (`{ id, title, text, url, files, timestamp }`).
  - Bestätigt den Empfang mit einem HTTP-303-Redirect auf `/?incoming_share=1`.

### 25.2 Automatisierte Ingest-Pipeline (`src/sync/shareTargetService.ts` & `src/App.tsx`)
- Beim App-Start oder Fokus (bei aktiver `?incoming_share=1`-Navigation oder bestehenden Einträgen in `knowmesh_shared_incoming`) wird der Ingest-Handler ausgeführt:
  1. Stellt sicher, dass das Zielverzeichnis `Inbox/` existiert (`api.createFolder('Inbox')`).
  2. **Fall A (Markdown/Text):** Liest den Dateiinhalt und speichert ihn direkt als Notiz in `Inbox/${sanitizedTitle}.md`.
  3. **Fall B (PDF):** Legt die PDF-Datei in `attachments/` ab und erzeugt eine Begleitnotiz in `Inbox/` mit `# Titel\n\n![[attachments/datei.pdf]]`.
  4. **Fall C (Bilder):** Speichert das Bild in `attachments/` und legt eine Notiz in `Inbox/` mit eingebetteter Vorschau an.
  5. **Fall D (Reiner Text / URL):** Speichert die Notiz mit formatiertem Markdown-Hyperlink `[Link](url)` und Notiztext.
  6. **Fokus & Bereinigung:** Die neu erstellte Notiz wird unmittelbar als aktiver Tab geöffnet (`openNoteByPath`), der Eintrag aus IndexedDB entfernt und die URL-Parameter via `window.history.replaceState({}, '', '/')` bereinigt.

### 25.3 Concurrency-Lock, Atomic Drain & 5-Sekunden-Duplikat-Schutz
- **In-Memory-Lock (`isProcessingSharesRef` in `App.tsx` & `isProcessingSharesGlobal` in `shareTargetService.ts`):** Verhindert parallele Ausführungen während App-Start, React-Re-Renders oder Lebenszyklus-Ereignissen.
- **Synchrones URL-Clearing (`cleanShareUrlQuery`):** Entfernt `?incoming_share=1` unmittelbar und synchron aus der Adressleiste vor dem ersten async-Tick, sodass nachfolgende Hooks und Event-Listener nicht re-triggern.
- **Atomic Drain vor Datei-I/O:** Gelesene Share-Payloads werden direkt aus der IndexedDB gelöscht, noch bevor `api.saveNote` oder Datei-Uploads starten. Nachfolgende oder überlappende Lesezugriffe finden stets eine leere Queue vor.
- **In-Memory-Deduplizierung & 5-Sekunden-Guard (`isRecentDuplicateNote`):** Schützt vor doppelten Android-Share-Intents. Wenn innerhalb von 5 Sekunden eine Notiz mit identischem Titel und Textinhalt empfangen wird, wird kein neues Dokument erstellt, sondern die zuvor erstellte Notiz wiederverwendet und geöffnet.
- **Deterministische Dateinamen:** Verwendet `item.timestamp` anstelle des fluktuierenden `Date.now()`.

---

## 26. „Send to Target Note“-Workflow (`sendtarget: true` mit Backlink & Zeitstempel-Header)

### 26.1 Kennzeichnung von Ziel-Notizen
- **Frontmatter-Flag:** Eine Notiz gilt als Sende-Ziel, wenn in ihren Frontmatter-Properties `sendtarget: true` gesetzt ist (Boolean `true` oder String `'true'`). Im `PropertiesEditor.tsx` wird `sendtarget` als Checkbox-Eigenschaft vorgeschlagen und verwaltet.
- **Schnell-Toggle im Dateibaum:** Ein Rechtsklick auf eine `.md`-Datei im Dateibaum (`FileSidebar.tsx`) bietet die Option *„Als Sende-Ziel festlegen 🎯“* bzw. *„Als Sende-Ziel entfernen 🎯“*. Die Änderung wird über `syncEngine.saveNote` persistiert und im lokalen IndexedDB-Store (`meta.tree`, `meta.files`, `meta.allNotes`) aktualisiert.
- **Visuelles Badge:** Neben Notizen mit aktivem `isSendTarget` wird im Dateibaum ein dezentes 🎯 Ziel-Icon gerendert.

### 26.2 Auslöser im Editor
- **Rechtsklick-Kontextmenü (`LivePreviewEditor.tsx`):** Wenn im Editor Text markiert ist (`!selection.empty`) und die rechte Maustaste gedrückt wird, erscheint ein kompaktes Kontextmenü mit der Option *„An Ziel-Notiz senden…“*.
- **Formatierungs-Toolbar (`EditorToolbar.tsx`):** Ein Button mit Ziel-Icon (Target), der bei Textselektion aktivierbar ist.
- **Befehlspalette (`CommandPalette.tsx`):** Neuer Befehl *„Markierten Text an Ziel-Notiz senden…“* (`id: 'editor-send-to-target'`).

### 26.3 Ziel-Auswahl-Modal (`SendToTargetModal.tsx`)
- Such- und Filterfeld mit automatischem Fokus beim Öffnen.
- Listet alle `.md`-Notizen im Vault auf, die `sendtarget: true` gesetzt haben (exklusive der aktuell geöffneten Notiz).
- Vollständige Tastatur-Bedienung (`Pfeil nach oben/unten`, `Enter` zur Bestätigung, `Escape` zum Schließen) sowie Mausklick.
- Aussagekräftiger Leer-Zustand, falls noch keine Ziel-Notizen definiert sind, mit Hinweistext zur Einrichtung via Dateibaum.

### 26.4 Atomare Workflow-Ausführung
1. **Ursprungsnotiz:** Der markierte Textblock wird an Ort und Stelle durch `→ Verschoben nach [[Ziel-Notiz]]` (DE) bzw. `→ Moved to [[Target Note]]` (EN) ersetzt.
2. **Ziel-Notiz:** An das Ende des Textkörpers (`body`) wird – getrennt durch zwei Zeilenumbrüche – ein Zeitstempel-Header mit Rückverweis und dem ausgeschnittenen Textblock angehängt:
   ```markdown
   ### YYYY-MM-DD HH:mm – Aus [[Ursprungsnotiz]]

   <Ausgeschnittener Textblock>
   ```
3. **Index & Backlinks:** Beide Notizen werden gespeichert (`syncEngine.saveNote`), Vault-Index und Backlinks sofort aktualisiert (wodurch die bidirektionale Verknüpfung im Graphen und in der Backlink-Seitenleiste unmittelbar sichtbar ist), und eine Toast-Benachrichtigung bestätigt den Erfolg.

---

## 27. Dateibaum-Sortierung & Daily-Note-System (Phase 4)

### 27.1 Dateibaum-Sortierung (`src/components/FileSidebar.tsx` & `src/utils/treeSort.ts`)
- **Vier flexible Sortier-Modi:**
  - `name-asc`: Name alphabetisch aufsteigend (A bis Z)
  - `name-desc`: Name alphabetisch absteigend (Z bis A)
  - `mtime-desc`: Änderungsdatum neueste zuerst (Neueste zuerst)
  - `mtime-asc`: Änderungsdatum älteste zuerst (Älteste zuerst)
- **Persistenz:** Gespeichert unter `localStorage` (`zuber_tree_sort` mit Fallback auf `knowmesh_tree_sort`).
- **UI-Steuerung:** Kompakter Sortier-Button (`ArrowUpDown`) in der Header-Aktionsleiste der Seitenleiste. Ein Klick öffnet ein Dropdown/Popover mit Indikator (✓) für den aktiven Modus.
- **Hierarchische Sortier-Logik (`sortTreeNodes`):**
  - Ordner verbleiben ausnahmslos an oberster Stelle und werden untereinander nach dem gewählten Kriterium sortiert.
  - Bei Datumssortierung (`mtime-desc` / `mtime-asc`) ermittelt `getNodeTimestamp` für Ordner rekursiv den Maximal-Zeitstempel aller enthaltenen Dateien.
  - Dateien werden nach `name` (via `localeCompare` mit natürlicher Zahlensortierung) bzw. `updatedAt` / `mtimeMs` sortiert.
  - Auch die Bereichsauswahl (Shift+Klick) via `getVisiblePaths` nutzt die sortierten Knoten für konsistentes Verhalten.

### 27.2 Daily Note System & 10-Zeichen-Präfix-Suche
- **Sidebar-Button & Command Palette:**
  - Kalender-Button (`Calendar`) direkt in der Sidebar-Aktionsleiste mit Tooltip `t('sidebar.openDailyNote')`.
  - Globaler Command-Palette-Befehl `open-daily-note` mit Shortcut `Alt+D`.
- **10-Zeichen-Präfix-Suche (`YYYY-MM-DD`):**
  - Ermittelt das lokale Tagesdatum im Format `YYYY-MM-DD` (10 Zeichen).
  - Sucht zuerst im konfigurierten `dailyFolder` nach Notizen mit `fileName.slice(0, 10) === todayPrefix` (z. B. `2026-10-22.md`, `2026-10-22 Daily Standup.md` oder `2026-10-22-meeting.md`).
  - Fallback-Suche über das gesamte Vault, falls im Zielordner keine passende Notiz existiert.
  - Existiert bereits eine Notiz, wird sie unmittelbar im Editor geöffnet.
- **Template-Engine & Auto-Erstellung:**
  - Existiert noch keine Tagesnotiz für das heutige Datum, wird eine neue Datei unter `${dailyFolder ? dailyFolder + '/' : ''}${todayPrefix}.md` angelegt.
  - Ist in den Einstellungen ein `templatePath` gewählt, wird der Inhalt des Templates geladen und die Platzhalter `{{date}}` (durch `YYYY-MM-DD`) und `{{time}}` (durch `HH:mm`) sowohl im Textkörper als auch in den Frontmatter-Eigenschaften ersetzt.
  - Ohne Vorlage wird die Notiz mit `# ${todayPrefix}\n\n` und Standard-Eigenschaften initialisiert.

### 27.3 Einstellungen (`SettingsModal.tsx` & `src/startupConfig.ts`)
- Neue Konfigurationsstruktur `DailyNoteConfig` (`dailyFolder`, `templatePath`), persistent in `localStorage` (`zuber_daily_config`).
- Im Tab *Editor & Files*:
  - **Zielordner:** Eingabefeld mit Datalist-Autovervollständigung aller bestehenden Vault-Ordner.
  - **Vorlage:** Dropdown-Auswahl aller Markdown-Dateien des Vaults oder Option *Keine Vorlage*.
  - Automatische Synchronisation mit dem Startverhalten (Startup Note: Daily Note).

---

## 28. Icon-Only „Neue Notiz“-Button & „New from Template“-Workflow (`isTemplate: true`)

### 28.1 Icon-Only „Neue Notiz“-Button (`FileSidebar.tsx`)
- Das bisherige Textlabel „New Note“ wurde entfernt; der Button rendert nun als kompakter, quadratischer Icon-Button (`.sidebar-icon-btn.icon-only`) mit `FilePlus`-Icon.
- Barrierefreiheit bleibt durch `title={t('sidebar.newNoteTitle')}` und `aria-label={t('sidebar.newNote')}` vollständig gewährleistet.

### 28.2 „New from Template“-Workflow
- **Template-Kennzeichnung (`isTemplate: true`):** Jede Markdown-Datei mit `isTemplate: true` in YAML-Frontmatter oder Properties gilt als Vorlage.
- **Dateibaum-Integration:**
  - Vorlagen-Notizen erhalten ein visuelles Badge (`.tree-template-badge`) mit `LayoutTemplate`-Icon.
  - Rechtsklick-Kontextmenü für `.md`-Dateien: Dynamischer Toggle *„Als Vorlage festlegen 📄“* bzw. *„Als Vorlage entfernen 📄“*.
  - Neuer Icon-Button *„Neue Notiz aus Vorlage erstellen…“* direkt neben dem „Neue Notiz“-Button in der Sidebar-Kopfzeile.
  - Kontextmenü für Ordner und Wurzelverzeichnis: *„Neue Notiz aus Vorlage erstellen…“*.
- **Vorlagenauswahl-Modal (`TemplateSelectModal.tsx`):**
  - Durchsuchbares Modal mit Echtzeit-Filterung über Titel, Pfad und Ordner.
  - Vollständige Tastaturnavigation (`Pfeiltasten`, `Enter` zur Auswahl, `Escape` zum Schließen).
- **Instanziierungs-Logik:**
  - Fragt nach dem Namen der neuen Notiz.
  - **Kritischer Schutz:** Entfernt `isTemplate: true` vollständig aus den Frontmatter-Properties der neuen Notiz, sodass instanziierte Notizen niemals selbst Vorlagen sind.
  - Ersetzt Variablen `{{date}}` (`YYYY-MM-DD`), `{{time}}` (`HH:mm`) und `{{title}}` im Textkörper und in String-Properties.
  - Speichert die neue Notiz im Zielordner und öffnet sie sofort im Editor.

---

## 29. Obsidian Bases Integration (`.base` Dateien und ```` ```base ```` Blöcke)

### 29.1 Übersicht & Abfrage-Engine (`src/base/baseEngine.ts`)
- **Dateityp `.base`:** Registriert als `AttachmentKind: 'base'` in Backend (`VaultService`) und Frontend.
- **Client-seitige Query-Engine:**
  - YAML-Definition: Unterstützt `filters`, `formulas`, `properties`, `views`, `order`, `groupBy`, `sort`, `limit`.
  - Filter-Funktionen: `file.inFolder("...")`, `file.hasTag("...")`, `file.hasLink("...")`, logische Verknüpfungen (`and`, `or`, `not`) und Vergleichsoperatoren (`==`, `!=`, `<`, `>`, `<=`, `>=`).
  - Formeln: Berechnungen mit Feldern und Datumsangaben (`(date(deadline) - today()) / '1 day'`), `round()`, mathematische Funktionen.
  - Sortierung & Gruppierung: Automatische Einteilung in Sektionen (nach Ordner oder Properties wie Status/Team) und Spaltensortierung.

### 29.2 Standalone Base-Editor & Visuelle Konfiguration (`BaseEditor.tsx`, `BaseToolbar.tsx`, `baseConfig.ts`)
- Wird geöffnet, wenn eine `.base`-Datei im Dateibaum angeklickt wird.
- **Bidirektionale Synchronisation (`src/base/baseConfig.ts`):**
  - Verluste-freie Serialisierung und Deserialisierung zwischen visueller Benutzeroberfläche und Obsidian-kompatiblem YAML (`parseBaseYaml`, `stringifyBaseYaml`). Unbekannte benutzerdefinierte YAML-Felder bleiben bei Änderungen erhalten (Graceful Preservation).
  - Automatisches, debounctes Speichern (500 ms) nach visuellen Anpassungen.
- **Interaktive Toolbar (`BaseToolbar.tsx`):**
  - **Ansichten-Tabs:** Wechsel zwischen definierten Ansichten (`views`), Hinzufügen neuer Ansichten (`+ Ansicht`), 3-Punkte-Kontextmenü für jede Ansicht (Umbenennen, Duplizieren, Löschen).
  - **Filter-Button:** Zeigt Badge mit Anzahl aktiver Filterregeln und öffnet das visuelle Filter-Popover.
  - **Filter-Chips-Leiste:** Zeigt aktive Filterbedingungen übersichtlich als Chips unterhalb der Toolbar mit Schnell-Löschen (`×`).
  - **Sortierung & Gruppierung:** Schnellauswahl der Sortierspalte mit Auf-/Absteigend-Umschalter sowie Gruppierung nach Frontmatter-Eigenschaften.
  - **Spalten-Manager-Button:** Öffnet den Spalten-Manager (`BaseColumnsModal.tsx`).
  - **Modus-Umschalter:** Nahtloser Wechsel zwischen **Visueller Ansicht** und **YAML-Quelltext**.
- **Visueller Filter-Builder (`BaseFilterPopover.tsx`):**
  - Popover zur intuitiven Konfiguration von Filterregeln (`file.inFolder`, `file.hasTag`, `file.hasLink`, `file.ext` und benutzerdefinierte Frontmatter-Properties).
  - Dynamische Operatoren: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `startsWith`, `!isEmpty`, `isEmpty`.
  - Dropdowns für Ordner, Tags und Autocomplete-Suche für Zielnotizen (`file.hasLink`) direkt aus dem Vault-Index extrahiert.
  - Filter-Chip-Anzeige: `[ 🔗 Verlinkt auf: [[Notizname]] × ]` mit `LinkIcon` und Schnell-Löschaktion.
- **Interaktive Tabellenansicht (`BaseTableView.tsx`):**
  - **Spaltenbreiten anpassen:** Drag-Handles (`.col-resize-handle`) am rechten Rand jeder Spaltenüberschrift mit Live-Feedback und Speicherung in `columnSize`.
  - **Spalten-Reihenfolge:** Spaltenüberschriften können per Drag & Drop verschoben werden.
  - **Spalten-Kontextmenü:** Schnellaktionen für Anzeigename umbenennen, Auf-/Absteigend sortieren und Spalte ausblenden.
  - **`+` Spalten-Hinzufügen-Dropdown:** Schnelles Einblenden weiterer im Vault vorhandener Frontmatter-Properties.
  - **Inline-Bearbeitung:** Klick in Datenzellen erlaubt direktes Editieren von Text, Zahlen und Checkboxen mit sofortiger Aktualisierung der Markdown-Frontmatter.
- **Kartenansicht (`BaseCardsView.tsx`):**
  - Responsive Kacheln (`type: cards`) mit konfigurierbarer Eigenschaftsauswahl (`order`), Ordner-Pills, Tags und Frontmatter-Feldern.
- **Interaktive Kanban-Board-Ansicht (`BaseBoardView.tsx`, `BaseBoardColumn.tsx`, `BaseBoardConfigModal.tsx`):**
  - Vollwertiges Board-Layout (`type: board`) mit horizontal scrollbaren Spalten (`BaseBoardColumn.tsx`), dynamisch gruppiert nach einer Frontmatter-Eigenschaft (z. B. `groupBy.property: status`).
  - **Konfigurierbare Spalten (`groupBy.columns`):** Unterstützt explizit geordnete Spalten (z. B. `['Open', 'inWork', 'Waiting', 'Finish']`) sowie eine Fallback-Spalte für Notizen ohne Status (`Kein Status`).
  - **Spaltentitel & Spaltenmenü:**
    - Der Spaltentitel ist rein statischer Text (kein versehentliches Inline-Editing bei Klick auf den Text).
    - **Spalte umbenennen:** Ausschließlich über das Drei-Punkte-Menü (`⋮`) via „Rename column“ erreichbar. Öffnet ein fokussiertes Eingabefeld mit automatischer Textselektion. `Enter` oder Klick außerhalb (`onBlur`) speichert die Umbenennung in `groupBy.columns`, `Escape` bricht ab.
    - **Spalte entfernen:** Option „Remove column“ im Menü `⋮` entfernt den Spaltenwert aus `groupBy.columns`. Notizen mit diesem Wert wandern automatisch in die Spalte „Kein Status“ (No Status).
    - Bei der Spalte „Kein Status“ ist das Drei-Punkte-Menü ausgeblendet.
  - **„+ Add Card“-Button im Spaltenkopf:**
    - Klick auf `+` neben dem Zähler erstellt eine neue Notiz direkt im gefilterten Zielordner (z. B. `file.inFolder("Ordner")`) oder im Verzeichnis der `.base`-Datei bzw. Vault-Root.
    - Vergibt automatisch kollisionsfreie Dateinamen (`Neue Notiz.md`, `Neue Notiz 1.md` etc.), setzt das Frontmatter passend zum Spaltenwert (`status: Warte`, bei „Kein Status“ weggelassen) via `api.saveNote()` und öffnet die Notiz sofort im Haupteditor.
  - **Board konfigurieren (2-Spalten-Layout):**
    - Toolbar-Button `⚙ Board` öffnet das zweispaltige Konfigurationsmodal (`BaseBoardConfigModal.tsx`, `max-width: 840px; width: 95vw`, `.base-board-config-grid`) mit flüssiger Tastatureingabe ohne Fokusverlust:
      - **Linke Spalte (Vertikale Spalten):** Auswahl der Gruppierungs-Property (`Group by`), sortierbare Spaltenliste (`ColumnConfigRow`), `+ Spalte hinzufügen` und Kartenlimit pro Spalte (`columnLimit`).
      - **Rechte Spalte (Horizontale Swimlanes & Karten-Inhalte):**
        - Auswahl der Swimlane-Property (`Swimlanes nach:` mit erster Option `Keine Swimlanes (Deaktiviert)`). Bei deaktivierten Swimlanes wird eine Hinweis-Box (`.base-board-swimlane-hint`) angezeigt; bei aktivierter Eigenschaft werden bestehende Werte aus den Vault-Notizen automatisch vorgeschlagen (`extractPropertyValues`), und die Swimlanes können über `SwimlaneConfigRow` frei sortiert, umbenannt, gelöscht oder über `+ Swimlane hinzufügen` ergänzt werden.
        - **Karten-Inhalte (`Card Properties` / `view.order`):** Checkliste aller in den Notizen der aktuellen Base erkannten Frontmatter-Eigenschaften (inkl. `tags`, `file.folder` und benutzerdefinierter Properties). Ausgewählte Eigenschaften lassen sich per Pfeiltasten (`↑`/`↓`) oder Drag & Drop sortieren, werden in `view.order` der `.base`-Datei gespeichert und auf `BaseBoardCard.tsx` unterhalb des Kartentitels dargestellt.
  - **2D-Kanban-Board mit wiederholten Spaltenköpfen je Swimlane-Reihe (`swimlanes`, `BaseBoardSwimlaneRow.tsx`):**
    - Ist keine Swimlane-Eigenschaft gesetzt (`!view.swimlanes?.property`), wird das 1D-Standard-Board gerendert.
    - Ist eine Swimlane-Eigenschaft (z. B. `prio`) gesetzt (`groupBoard2D` in `baseEngine.ts`), gliedert sich das Board in ergonomische Swimlane-Reihen (`.base-board-2d-container` & `.base-board-swimlane-row`):
      - **Keine losgelöste globale Spaltenkopfzeile:** Anstelle einer unübersichtlichen, weit entfernten Sticky-Kopfzeile rendert jede ausgeklappte Swimlane-Reihe direkt über ihren Karten-Zellen ein eigenes, synchron ausgerichtetes Spaltenkopf-Band (`.base-board-swimlane-columns-header`).
      - **Explizite Property-Name + Wert Swimlane-Kopfzeile:** Der Swimlane-Zeilenkopf (`.base-board-swimlane-header`) zeigt sowohl den konfigurierten Property-Namen (bzw. den Display-Namen aus den Base-Properties) als auch den Wert als kompaktes Badge an (z. B. `Prio: (1) High` oder `Status: In Progress`), bei nicht zugeordneten Notizen `Keine Zuordnung` / `No Swimlane`.
      - **Kontextuelle Notizerstellung (`+`-Button):** Jeder Spaltenkopf innerhalb einer Swimlane-Reihe besitzt einen eigenen `+`-Button (`.base-board-col-add-btn`). Ein Klick darauf öffnet den Notizerstellungs-Dialog mit **beiden** Frontmatter-Attributen vorausgefüllt (Spalten-Status wie `status: "Facing Backlog"` und Swimlane-Wert wie `prio: "(1) High"`), wobei der Zielordner automatisch anhand aktiver Base-Filter (`file.inFolder`) vorausgewählt wird.
      - **Persistenter Einklapp-Status (`collapsed: true/false`):** Das Ein-/Ausklappen einer Swimlane per Chevron (`▼` / `▶`) blendet Spaltenkopfzeile und Zellen-Reihe ein/aus und speichert `collapsed: boolean` (bzw. `unassignedCollapsed`) direkt im YAML der `.base`-Datei (`views[].swimlanes.lanes`).
      - **2D Drag & Drop (Dual-Property Write-Back):** Beim Ziehen einer Karte in eine Zelle `(targetColumn, targetSwimlane)` oder auf einen Spaltenkopf dieser Reihe werden **beide** Frontmatter-Eigenschaften (`groupBy.property` und `swimlanes.property`) gleichzeitig optimistisch im UI und atomar in einem einzigen Speichervorgang (`api.saveNote`) in der Markdown-Notiz aktualisiert (bzw. beim Ziehen in `Kein Status` oder `Keine Zuordnung` entfernt).
      - **Saubere leere Zellen (`.base-board-swimlane-cell.is-empty`):** Leere Zellen werden dezent gestrichelt ohne starre graue Kastenrahmen dargestellt und bieten ein klares, intuitives Drop-Ziel.
  - **Kartenlimit & Progressives Nachladen (`columnLimit`):** Begrenzt die sichtbaren Karten pro Spalte bzw. pro 2D-Zelle (Standard: `10`), sortiert nach Änderungsdatum (`mtime` absteigend). Überschreitet eine Spalte/Zelle das Limit, schaltet ein Button `⬇ {{count}} weitere anzeigen...` bzw. `⬆ Weniger anzeigen` die Ansicht um.
  - **Flüssiges Drag & Drop mit Frontmatter-Write-Back:** Verschieben einer Karte zwischen Spalten oder 2D-Zellen aktualisiert die Ziel-Attribute optimistisch im UI mit 0 ms Latenz und synchronisiert die Änderung persistent in die Frontmatter der Notiz (`api.saveNote` / `onCellChange`). Karten behalten ihre normale Deckkraft nach dem Loslassen bei (`BaseBoardCard.tsx`).
- **Spalten-Manager-Modal (`BaseColumnsModal.tsx`):**
  - Vollständiges Theme-Redesign im dunklen Modus (`var(--bg-primary)`, `.base-column-item` mit `var(--bg-secondary)` und Akzent-Hover) und übersichtlicher Checkliste aller im Vault gefundenen Eigenschaften mit Drag & Drop-Reihenfolge.
  - Vollständig lokalisierter „Fertig“-Button (`t('common.done')`).
- **New Base Erstellungs-Wizard (`NewBaseModal.tsx`):**
  - Vollständiges UI-Redesign mit dunklem Backdrop (`rgba(0, 0, 0, 0.65)` mit Blur), solider Karte (`var(--bg-primary)` ohne Durchscheinen), einheitlichem Header, abgerundetem Schließen-Button und dedizierter Footer-Leiste.
  - Formular-Kacheln für den Quellenbereich mit 4 Optionen: Notizen im Ordner (`file.inFolder`), Notizen mit Tag (`file.hasTag`), verlinkte Notizen (`file.hasLink` mit Autocomplete-Suchfeld) oder alle Notizen.
  - Segmented Control für die Start-Ansicht (Tabelle oder Kacheln).
  - Generiert sauberes Start-YAML mit automatischer `file.ext == "md"`-Filterung und `file.hasLink("Zielnotiz")`.

### 29.3 Inline-Base-Codeblöcke (`LivePreviewEditor.tsx`)
- Markdown-Codeblöcke mit Sprache ```` ```base ```` werden in Live-Preview und Lese-Modus interaktiv als `BaseView` dargestellt.
- Umschalt-Schaltflächen `[ View | Code ]` ermöglichen den direkten Wechsel zwischen gerenderter Datenbank-Ansicht und dem YAML-Codeblock.
- Automatisches Refactoring von Links und Pfadfiltern bei Umbenennung oder Verschieben von Notizen (`refactorBaseContent`).

---

## 30. Asymmetrische Recherche- & Referenzansicht (70/30 Split-View, Klick-Routing & Zen-Mode)

### 30.1 Konzept & Layout-Aufteilung (`src/components/ResearchPane.tsx`, `App.tsx`)
Zuber bietet neben der Einzelansicht eine asymmetrische, resizable **Recherche- & Referenzansicht (Research Split-View)**:
- **Haupteditor (Primary Pane – links auf Desktop / unten auf Smartphones):**
  - Standardgröße: **70 %** (persistent in `localStorage` unter `zuber_split_ratio`, geklemmt zwischen 20 % und 80 %).
  - Voller interaktiver Schreib- und Bearbeitungsfokus (`LivePreviewEditor`, `CanvasEditor`, `BaseEditor`).
  - Beim Schließen der Rechercheansicht kehrt der Haupteditor sofort auf 100 % Breite zurück.
- **Recherche- & Referenzbereich (Research Pane – rechts auf Desktop / oben auf Smartphones):**
  - Standardgröße: **30 %** (`100% - splitRatio`).
  - Strikter **Read-Only-Modus**. Keine versehentliche Modifikation von Referenzmaterial beim Nachschlagen.

### 30.2 Unterstützte Formate in der Rechercheansicht
1. **Markdown-Notizen (`.md`):** Vollständig gerendertes HTML (Reading Mode via `src/utils/readingMode.ts`) mit Callouts, Aufgabenlisten, Tabellen, Syntax-Highlighting, Mermaid-Diagrammen, inline Bildern und PDF-Vorschauen, bereinigt durch `DOMPurify`.
2. **Canvas-Diagramme (`.canvas`):** Interaktiver Pan- und Zoom-Viewer mit `@xyflow/react` (`readOnly={true}`, `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={false}`).
3. **Bilder (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`):** Zentrierter Bildbetrachter mit Zoom-In/Out/Fit-Toolbar.
4. **PDF-Dokumente (`.pdf`):** Eingebetteter Anhang-Viewer im `<iframe>` über `/api/vault/attachment?path=...`.
5. **Wissensgraph (`graph`):** Vollwertige interaktive `GraphView` umschaltbar direkt in der Recherche-Kopfzeile.

### 30.3 Klick-Routing & `Alt + Klick` Überschreibung
- **Wenn Rechercheansicht geschlossen ist (`isResearchOpen === false`):**
  - Jeder Klick im Dateibaum, auf Backlinks oder auf `[[Wiki-Links]]` öffnet die Notiz wie gewohnt im Haupteditor.
- **Wenn Rechercheansicht geöffnet ist (`isResearchOpen === true`):**
  - **Standard-Klick (`!event.altKey`):** Öffnet das Ziel automatisch in der **Rechercheansicht (rechts)**. Der Haupteditor bleibt unverändert auf der aktuellen Notiz gesperrt (Schreibkontext und Cursor bleiben erhalten).
  - **`Alt + Klick` (`event.altKey === true`):** Überschreibt das Routing und lädt die Notiz gezielt in den **Haupteditor (links)**. Browser-Standardaktionen werden durch `event.preventDefault()` unterdrückt.
  - **Zusätzliche Aktionen:**
    - Button *„Im Haupteditor öffnen“* (`ArrowLeft`-Icon) in der Recherche-Kopfzeile lädt das aktuelle Referenzdokument in den Haupteditor.
    - Kontextmenü im Dateibaum bietet *„In Rechercheansicht öffnen“* sowie *„Im Haupteditor öffnen (Alt+Klick)“*.

### 30.4 Responsiver Split & Interaktiver Resizer
- **Desktop (`>= 768px`):** Nebeneinander (**horizontal** / Spalten).
- **Smartphones (`< 768px`):** Untereinander (**vertikal** / Zeilen) mit Referenzansicht oben und Haupteditor unten, damit die Tastatur nicht das Schreibfeld verdeckt.
- **Manueller Umschalter:** Toolbar-Button in der Kopfzeile wechselt jederzeit zwischen Spalten- und Zeilensplit.
- **Draggable Splitter:** Trennlinie (`.split-resizer`) unterstützt Maus- und Touch-Gesten mit visuellem Hover- und Drag-Feedback.

### 30.5 Nahtlose Integration in den Zen-Modus (`Alt+Z`)
- Die Rechercheansicht bleibt beim Aktivieren des Zen-Modus im bestehenden Split-Verhältnis vollständig erhalten.
- Das gesamte umgebende Chrome (Header, Ribbons, Sidebars) wird ausgeblendet, während die 1-px-Trennlinie aktiv und per Maus/Touch ziehbar bleibt.

### 30.6 Toolbar-Höhenangleichung, Zurück-Navigation & Backlinks-Synchronisation
- **Einheitliche Toolbar-Höhen (`--pane-toolbar-height: 44px`):**
  - Sowohl die Markdown-Formatierungsleiste des Haupteditors (`.mobile-editor-toolbar` / `.editor-toolbar`) als auch die Kopfzeile der Rechercheansicht (`.research-pane-header`) nutzen die gemeinsame CSS-Variable `--pane-toolbar-height: 44px;` mit `box-sizing: border-box;`, `padding-top: 0; padding-bottom: 0;` und identischem `border-bottom: 1px solid var(--border-color);`.
  - Dadurch verläuft die horizontale Trennlinie im Split-Screen nahtlos und exakt bündig über den vertikalen Splitter hinweg.
- **Zurück-Button Routing (`handleGoBack` & `Alt+ArrowLeft`):**
  - Eigener Navigationsverlauf für die Rechercheansicht (`researchHistory: ResearchTarget[]` und `researchHistoryIndex`).
  - Wenn `isResearchOpen === true`: Der „Zurück“-Button in der oberen Kopfleiste (sowie der Tastatur-Shortcut `Alt+ArrowLeft`) steuert primär den Verlauf der Rechercheansicht (Rechts) und springt zur vorherigen Referenznotiz / zum Graph zurück.
  - Der Deaktiviert-Zustand (`disabled`) spiegelt bei geöffneter Rechercheansicht `researchHistoryIndex <= 0` wider.
  - Per `Alt + Klick` auf den Zurück-Button kann der Nutzer weiterhin gezielt im linken Haupteditor zurückspringen.
- **Synchronisation der Rechten Seitenleiste (Backlinks & Lokaler Graph):**
  - Bei geöffneter Rechercheansicht ermittelt die App dynamisch `rightSidebarTargetPath = researchTarget.path` und ruft `api.getBacklinks(...)` für die aktuell im Recherchefenster geladene Referenzdatei ab.
  - Ein optischer Indikator (`.backlinks-target-indicator`) im Backlinks-Panel signalisiert dem Nutzer unmissverständlich, für welche Notiz (`Recherche: [Name]` bzw. `Notiz: [Name]`) die eingehenden Verweise angezeigt werden.
  - Auch der Lokale Graph in der rechten Leiste zentriert sich automatisch auf die aktive Referenznotiz.
  - Sobald die Rechercheansicht geschlossen wird oder auf den globalen Graph umgeschaltet wird, fällt die Anzeige automatisch auf die aktive Hauptnotiz (`activeNote.path`) zurück.





