# LLM Developer Guide & Maintenance Playbooks (`doc/LLM_DEVELOPER_GUIDE.md`)

Dieses Dokument richtet sich direkt an **LLM-Coding-Agenten**, die diese Software in Zukunft warten, debuggen oder um neue Funktionen erweitern. Befolge die hier beschriebenen Rezepte ("Playbooks") und Checklisten, um Regressionen zu vermeiden.

---

## 1. Wichtigste Regeln vor jeder Code-Änderung

1. **Verändere niemals Dateien in `/home/ingo/Downloads/MarkdownEdit/vault`!**
   Dieses Verzeichnis enthält die echten, persönlichen Notizen und Anhänge des Benutzers (~1.808 Dateien). Für automatisierte Tests erstelle immer ein temporäres Verzeichnis mit `fs.mkdtemp(path.join(os.tmpdir(), 'vault-test-'))` (siehe [`server/vaultService.test.ts`](../server/vaultService.test.ts)).
2. **Event-Loop auf dem Server frei halten (`VaultService`):**
   Führe in Request-Handlern oder in Methoden wie `resolveWikiTarget`, `getTree` oder `buildGraph` **niemals** rekursive `fs.readdir`- oder `fs.readFile`-Schleifen über den gesamten Vault aus. Nutze immer die In-Memory-Maps (`this.files`, `this.notes`, `this.lowerPathIndex`, `this.nameIndex`, `this.aliasIndex`) in [`server/vaultService.ts`](../server/vaultService.ts).
3. **CodeMirror 6 Zeilenumbruch-Regel:**
   In [`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx) darf ein `ViewPlugin` niemals `Decoration.replace(...)` über einen Zeilenumbruch (`\n`) hinweg anwenden. Mehrzeilige Blöcke (wie Tabellen, Callouts oder Mathe-Blöcke) müssen über ein Block-/Zeilen-Widget in der ersten Zeile + `Decoration.line({ class: 'cm-lp-table-collapsed-line' })` für die Folgezeilen umgesetzt werden.
4. **Produktionsserver läuft über `dist/`:**
   Wenn der Server mit `npm start` läuft, liefert Express das gebaute Frontend aus `dist/` aus. Nach **jeder** Änderung in `src/`, `server/` oder `shared/` musst du `npm run build` ausführen (und bei Änderungen an `server/` oder `shared/` den Server-Prozess neu starten).

---

## 2. Playbooks für häufige Erweiterungen

### Playbook A: Eine neue Live-Preview-Syntax im Editor hinzufügen
*(Beispiel: Du sollst Callouts `> [!NOTE]` oder Inline-Mathematik `$...$` unterstützen)*

1. **Quellcode prüfen:** Öffne [`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx).
2. **Widget-Klasse anlegen:**
   Erstelle eine Unterklasse von `WidgetType` (aus `@codemirror/view`) mit:
   - `eq(other)`: Vergleicht alle relevanten Parameter (wichtig, damit CodeMirror das DOM-Element nicht bei jedem Tastendruck neu erzeugt!).
   - `toDOM()`: Erzeugt das HTML-Element.
   - `ignoreEvent()`: Gib `false` zurück, wenn ein Klick den Cursor in den Markdown-Code setzen soll (wie bei `TableWidget`), oder `true`, wenn das Widget eigene Klick-Handler hat (wie `CheckboxWidget` oder `WikiLinkWidget`).
3. **In `buildLivePreviewDecorations(view)` einhängen:**
   - **Für zeilenbasierte oder mehrzeilige Syntax:** Füge die Erkennung in die `while (pos <= vpTo)`-Zeilenschleife ein. Prüfe mit `selectionTouches(view, line.from, line.to)`, ob der Cursor sich in der Zeile (bzw. im mehrzeiligen Block) befindet. Nur wenn `selectionTouches === false` ist, füge die `Decoration` zum Array `decos` hinzu.
   - **Für Inline-Syntax (innerhalb einer Zeile):** Definiere einen regulären Ausdruck und scanne `slice = docText.slice(vpFrom, vpTo)`. Prüfe mit `inCodeFenceOrInlineCode(lineText, indexInLine)`, dass der Treffer nicht in einem Codeblock liegt, und mit `!selectionTouches(view, absFrom, absTo)`, dass der Cursor nicht im Bereich steht.
4. **Lese-Modus (`mode === 'reading'`) synchron halten:**
   Erweitere die Markdown-Vorverarbeitung (`renderedHtml`) in [`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx), damit die neue Syntax auch in der HTML-Leseansicht identisch gerendert wird.
5. **Styling ergänzen:** Füge die CSS-Klassen in [`src/styles.css`](../src/styles.css) hinzu.

---

### Playbook B: Einen neuen Frontmatter-Eigenschaftstyp hinzufügen
*(Beispiel: Du sollst einen Typ `'datetime'` oder `'url'` im Eigenschaften-Editor ergänzen)*

1. **Typ erweitern:** Füge den neuen Typ zu `export type PropertyType` in [`shared/types.ts`](../shared/types.ts) hinzu.
2. **Parser & Serializer anpassen:**
   - Passe [`inferPropertyType(key, value)`](../shared/markdownUtils.ts) an, damit bestehende YAML-Felder beim Laden automatisch diesem Typ zugeordnet werden.
   - Prüfe [`serializeNote(body, properties)`](../shared/markdownUtils.ts), wie der Wert nach YAML geschrieben werden soll.
3. **UI-Komponente erweitern:**
   Öffne [`src/components/PropertiesEditor.tsx`](../src/components/PropertiesEditor.tsx):
   - Ergänze das Icon und Label in `TYPE_ICONS` und `TYPE_ORDER`.
   - Ergänze die Typ-Konvertierung in `cycleType(index)`.
   - Ergänze das passende `<input>`-Element im Render-Switch.

---

### Playbook C: Einen neuen API-Endpunkt hinzufügen
*(Beispiel: Du sollst einen Endpunkt für Daily Notes oder Vorlagen hinzufügen)*

1. **Shared Types definieren:** Lege Request- und Response-Interfaces in [`shared/types.ts`](../shared/types.ts) an.
2. **Logik in `VaultService` implementieren:**
   Implementiere die Methode in [`server/vaultService.ts`](../server/vaultService.ts).
   - Nutze `this.resolveSafePath(relPath)` für alle Dateizugriffe, um Path-Traversal (`../`) automatisch zu verhindern.
   - Wenn eine Datei geschrieben oder gelöscht wird, aktualisiere **sofort** den In-Memory-Index über `await this.indexSingleFile(relPath)` bzw. `this.removeEntryFromIndex(relPath)` und rufe `this.invalidateCaches()` auf (warte nicht darauf, dass Chokidar 200ms später feuert!).
3. **Express-Route registrieren:**
   Füge die Route in [`server/index.ts`](../server/index.ts) unterhalb von `app.use('/api', authMiddleware)` hinzu.
4. **Frontend-Client erweitern:**
   Ergänze die Aufruffunktion in [`src/api.ts`](../src/api.ts).
5. **Unit-Test schreiben:**
   Ergänze einen Testfall in [`server/vaultService.test.ts`](../server/vaultService.test.ts) und führe `npx vitest run` aus.

---

### Playbook D: Arbeiten mit der IndexedDB Sync-Engine (`src/sync/`)
*(Beispiel: Du fügst eine neue Mutation oder Offline-Entität hinzu)*

1. **Mutation-Typ in `src/sync/localDb.ts` definieren:**
   Erweitere `OutboxMutation.type` (z. B. `'star_note'`).
2. **Replay in `syncEngine.flushOutbox()` einbauen:**
   Füge die entsprechende Server-API-Ausführung in den Replay-Loop von `flushOutbox()` in [`src/sync/syncEngine.ts`](../src/sync/syncEngine.ts) ein.
3. **Optimistic Update:**
   Aktualisiere die IndexedDB (`localDb.putNote` oder `localDb.setMeta`) immer **vor** dem Netzwerk-Aufruf, damit das UI sofort reagiert.

---

### Playbook E: Ein neues Farb-Theme hinzufügen
*(Beispiel: Du sollst ein Theme 'solarized-dark' ergänzen)*

1. **CSS-Variablen in `src/styles.css` anlegen:**
   Erstelle den Selektor `[data-theme='solarized-dark']` mit allen Knowmesh-Variablen (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--text-primary`, `--accent-color`, `--accent-secondary`, `--border-color`).
2. **Theme-Auswahl in `src/components/SettingsModal.tsx` eintragen:**
   Füge das neue Theme mit Name, Farbwerten und Beschreibung in das `themes`-Array ein.

---

## 3. Fehlerdiagnose & Troubleshooting

### Problem 1: Bilder laden langsam oder gar nicht
- **Ursache A (Server-Blockade):** Prüfe, ob irgendeine Funktion im Backend alle Dateien von der Festplatte liest, während der Browser parallel Bilder über `/api/vault/attachment` anfordert.
- **Ursache B (Pfadauflösung):** Prüfe in den Browser-DevTools die URL von `/api/vault/attachment?path=...&from=...`.
  - Enthält das Markdown URL-kodierte Leerzeichen wie `Projekte/3d%20Drucker/attachments/image1.png`? [`resolveWikiTarget`](../server/vaultService.ts) und `/api/vault/attachment` müssen `decodeURIComponent` anwenden.
  - Ist der Pfad relativ zum Notizordner angegeben (z.B. `attachments/image11.jpeg` innerhalb von `Projekte/Notiz.md`)? Dann muss das Frontend den Parameter `&from=Projekte/Notiz.md` an `/api/vault/attachment` übergeben (siehe `EmbedWidget` in [`src/components/LivePreviewEditor.tsx`](../src/components/LivePreviewEditor.tsx)).

### Problem 2: Tabellen werden nicht als HTML-Tabelle gerendert
- **Ursache:** Eine Zeile wird nur als Tabellenzeile erkannt (`isTableRow`), wenn sie mindestens ein `|` enthält, und ein Block gilt nur als Markdown-Tabelle, wenn die **zweite Zeile** eine gültige GFM-Trennlinie (`isTableSeparator`, z.B. `| --- | :---: |`) ist. Außerdem klappt die Tabelle absichtlich in den Markdown-Quelltext auf, solange sich der Cursor innerhalb der Tabellenzeilen befindet. Klicke in eine Zeile außerhalb der Tabelle, um das gerenderte `TableWidget` zu sehen.

### Problem 3: Änderungen im Code sind im Browser nicht sichtbar
- Prüfe mit `ps aux | grep tsx`, ob der Produktionsserver (`npm start` auf Port `3443`) läuft.
- Führe `npm run build` aus, damit Vite das aktualisierte Frontend-Bundle nach `dist/` schreibt.
- Wenn du Dateien in `server/` oder `shared/` geändert hast, starte den Server neu.

---

## 4. Checkliste vor Abschluss einer Aufgabe (Definition of Done)

Bevor du eine Aufgabe an der Software abschließt, führe immer folgende Schritte aus:

```bash
# 1. Alle Backend- & Markdown-Unit-Tests ausführen
npx vitest run

# 2. TypeScript-Prüfung & Produktions-Bundle für das Frontend bauen
npm run build
```

Beide Befehle müssen mit Exit-Code `0` ohne Fehler durchlaufen.
