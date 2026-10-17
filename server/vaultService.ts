import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  BacklinkItem,
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  GraphEdge,
  GraphNode,
  NoteData,
  SyncManifestEntry,
} from '../shared/types';
import {
  extractHeadings,
  extractLinksAndEmbeds,
  extractTags,
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';

export interface VaultChangeBatch {
  paths: string[];
  /** true if files/folders were added, removed or renamed (tree must be reloaded) */
  structural: boolean;
}

interface FileEntry {
  path: string;
  name: string;
  basename: string;
  extension: string;
  mtimeMs: number;
  size: number;
}

export class VaultService {
  private vaultDir: string;
  private watcher: FSWatcher | null = null;
  private changeCallbacks = new Set<(batch: VaultChangeBatch) => void>();

  // In-memory index: everything is read from disk once and then kept up to date
  // incrementally (own writes + chokidar events). This keeps every request O(1)/O(n)
  // in memory instead of walking/parsing the whole vault on each call.
  private files = new Map<string, FileEntry>();
  private notes = new Map<string, NoteData>();
  private folders = new Set<string>();
  private lowerPathIndex = new Map<string, string>();
  private nameIndex = new Map<string, string[]>();
  private aliasIndex = new Map<string, string>();
  private lookupDirty = true;
  private treeCache: FileTreeNode[] | null = null;
  private graphCache: GraphData | null = null;

  private pendingPaths = new Set<string>();
  private pendingStructural = false;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(vaultDir: string) {
    this.vaultDir = path.resolve(vaultDir);
    this.ensureVaultAndSeed();
    this.rebuildIndex();
  }

  public getVaultDir(): string {
    return this.vaultDir;
  }

  private ensureVaultAndSeed(): void {
    if (!fs.existsSync(this.vaultDir)) {
      fs.mkdirSync(this.vaultDir, { recursive: true });
    }

    const entries = fs.readdirSync(this.vaultDir).filter((e) => !e.startsWith('.'));
    if (entries.length > 0) return;

    // Seed initial interconnected Obsidian notes so the user has an immediate rich experience
    const folders = ['Projekte', 'Wissensbasis', 'Tägliche Notizen', 'Attachments'];
    for (const folder of folders) {
      fs.mkdirSync(path.join(this.vaultDir, folder), { recursive: true });
    }

    // Create sample SVG diagram in Attachments
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 200" width="640" height="200">
  <rect width="640" height="200" rx="14" fill="#1e1e2e"/>
  <rect x="30" y="55" width="160" height="90" rx="10" fill="#313244" stroke="#cba6f7" stroke-width="2"/>
  <text x="110" y="95" fill="#cdd6f4" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">Browser (HTTPS)</text>
  <text x="110" y="118" fill="#a6adc8" font-family="sans-serif" font-size="11" text-anchor="middle">Live-Preview &amp; Graph</text>
  <path d="M 195 100 L 235 100" stroke="#89b4fa" stroke-width="2.5" stroke-dasharray="4 3"/>
  <rect x="240" y="55" width="160" height="90" rx="10" fill="#313244" stroke="#89b4fa" stroke-width="2"/>
  <text x="320" y="95" fill="#cdd6f4" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">Web-Vault Server</text>
  <text x="320" y="118" fill="#a6adc8" font-family="sans-serif" font-size="11" text-anchor="middle">TLS + WebSocket Sync</text>
  <path d="M 405 100 L 445 100" stroke="#a6e3a1" stroke-width="2.5" stroke-dasharray="4 3"/>
  <rect x="450" y="55" width="160" height="90" rx="10" fill="#313244" stroke="#a6e3a1" stroke-width="2"/>
  <text x="530" y="95" fill="#cdd6f4" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle">Markdown Vault</text>
  <text x="530" y="118" fill="#a6adc8" font-family="sans-serif" font-size="11" text-anchor="middle">Lokale .md Dateien</text>
</svg>`;
    fs.writeFileSync(path.join(this.vaultDir, 'Attachments', 'architektur-diagramm.svg'), svgContent, 'utf-8');

    const welcomeNote = `---
tags:
  - willkommen
  - knowmesh
  - dashboard
aliases:
  - Startseite
  - Home
status: Aktiv
erstellt: 2026-10-16
favorit: true
priorität: 1
---

# Willkommen in Knowmesh

Dies ist deine selbstgehostete **Knowmesh Web-Applikation** mit verschlüsselter HTTPS-Verbindung, Echtzeit-Dateisystem-Synchronisation, visuellem **Frontmatter-Manager (Eigenschaften)** und interaktiver **Graph-Ansicht**.

> [!tip] Live-Preview Editor
> Klicke in eine beliebige Zeile, um den Markdown-Quellcode direkt zu bearbeiten. Sobald der Cursor die Zeile verlässt, werden Überschriften, **Fettdruck**, *Kursivschrift*, ==Markierungen==, \`Inline-Code\`, Aufgabenlisten und \`[[Wiki-Links]]\` interaktiv gerendert!

## Vernetzte Notizen im Vault

- [[Projekt-Architektur]] – Technische Übersicht zu Server, HTTPS, WebSockets und Editor
- [[Zettelkasten Methode]] – Wie du Notizen effektiv über bidirektionale Links vernetzt
- [[2026-10-16]] – Heutige tägliche Notiz & Aufgabenliste

## Eingebettetes Architektur-Diagramm

Über die Wiki-Embed-Syntax \`![[architektur-diagramm.svg]]\` werden Bilder und Anhänge direkt eingebettet:

![[architektur-diagramm.svg]]

## Wichtige Aufgaben

- [x] Verschlüsselte HTTPS-Verbindung und Passwort-Login einrichten
- [x] Visuelle Frontmatter-Eigenschaften (ohne rohes YAML) verwalten
- [x] Interaktive Graph-Ansicht mit Tag- und Link-Knoten testen
- [ ] Eigene Notizen im Dateibaum links anlegen oder bestehenden Vault einbinden

Probiere auch Inline-Tags wie #produktivität oder #wissen aus – ein Klick darauf filtert sofort deine Notizen!
`;

    const archNote = `---
tags:
  - architektur
  - sicherheit
  - knowmesh
autor: Ingo
status: Abgeschlossen
erstellt: 2026-10-16
verschlüsselt: true
---

# Projekt-Architektur

Diese Notiz beschreibt den Aufbau der Web-Applikation, die auf der [[Willkommen in Knowmesh|Startseite]] vorgestellt wird.

> [!info] Echtzeit-Synchronisation (Chokidar + WebSockets)
> Alle Dateien liegen als reguläre \`.md\`-Dateien auf dem Server. Wenn du Dateien parallel mit externen Editoren, Git oder Syncthing bearbeitest, erkennt der Server die Änderung sofort und aktualisiert den Browser live.

## Kernkomponenten

1. **Live-Preview Editor (CodeMirror 6)**
   - Unterstützt \`[[Wiki-Links]]\` mit Autovervollständigung (tippe einfach \`[[\`)
   - Unterstützt \`![[Einbettungen]]\` von Bildern und anderen Notizen
   - Interaktive Checklisten (\`- [ ]\`) und Callouts (\`> [!note]\`)
2. **Visuelle Eigenschaften (Frontmatter)**
   - Statt YAML-Code anzuzeigen, werden Metadaten oben als interaktive Formularfelder (Tags, Text, Datum, Checkbox, Zahl) dargestellt.
3. **Wissensgraph**
   - Sowohl als **Globaler Graph** als auch als **Lokaler Graph** in der rechten Seitenleiste verfügbar.
   - Verknüpft mit [[Zettelkasten Methode]] und [[2026-10-16]].

#webdev #markdown
`;

    const zettelkastenNote = `---
tags:
  - wissen
  - zettelkasten
  - produktivität
kategorie: Methodik
erstellt: 2026-10-16
bewertung: 5
---

# Zettelkasten Methode

Die **Zettelkasten Methode** lebt von atomaren Notizen und bidirektionalen Verknüpfungen.

> [!important] Backlinks automatisch erkennen
> In der rechten Seitenleiste siehst du unter **Backlinks** sofort alle Notizen, die auf diese Notiz verweisen – zum Beispiel [[Willkommen in Knowmesh]] und [[Projekt-Architektur]].

## Prinzipien

- **Atomarität**: Ein Gedanke pro Notiz.
- **Vernetzung**: Verlinke verwandte Konzepte mit \`[[Wiki-Links]]\`, z. B. zur [[Projekt-Architektur]].
- **Graph-Exploration**: Nutze die Graph-Ansicht, um Wissenscluster über #wissen und #knowmesh sichtbar zu machen.
`;

    const dailyNote = `---
tags:
  - daily
  - produktivität
datum: 2026-10-16
stimmung: Fokussiert
erledigt: false
---

# 2026-10-16

Heutiges Journal und Arbeitsprotokoll. Zurück zur [[Willkommen in Knowmesh|Startseite]].

> [!warning] Erinnerung
> Vergiss nicht, neue Erkenntnisse direkt mit der [[Zettelkasten Methode]] zu verknüpfen!

## Tagesziele

- [x] Server-Backend für [[Projekt-Architektur]] starten
- [x] Frontmatter-UI ohne YAML-Code testen
- [ ] Neue Ideen für das nächste Quartal sammeln
`;

    fs.writeFileSync(path.join(this.vaultDir, 'Willkommen in Knowmesh.md'), welcomeNote, 'utf-8');
    fs.writeFileSync(path.join(this.vaultDir, 'Projekte', 'Projekt-Architektur.md'), archNote, 'utf-8');
    fs.writeFileSync(path.join(this.vaultDir, 'Wissensbasis', 'Zettelkasten Methode.md'), zettelkastenNote, 'utf-8');
    fs.writeFileSync(path.join(this.vaultDir, 'Tägliche Notizen', '2026-10-16.md'), dailyNote, 'utf-8');
  }

  // ---------------------------------------------------------------------------
  // In-memory index
  // ---------------------------------------------------------------------------

  /** Full (synchronous) index build. Runs once at startup. */
  private rebuildIndex(): void {
    this.files.clear();
    this.notes.clear();
    this.folders.clear();

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = this.toRelativePath(fullPath);
        if (entry.isDirectory()) {
          this.folders.add(relPath);
          walk(fullPath);
        } else if (entry.isFile()) {
          this.indexFile(relPath);
        }
      }
    };
    walk(this.vaultDir);
    this.invalidate(true);
  }

  private invalidate(structural: boolean): void {
    this.graphCache = null;
    this.lookupDirty = true;
    if (structural) this.treeCache = null;
  }

  /** (Re-)index a single file. Returns false if the file does not exist. */
  public indexFile(relPath: string): boolean {
    const absPath = path.join(this.vaultDir, relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      this.removeFromIndex(relPath);
      return false;
    }
    if (!stat.isFile()) return false;

    const name = path.basename(relPath);
    const extension = path.extname(name).slice(1).toLowerCase();
    const isNew = !this.files.has(relPath);
    this.files.set(relPath, {
      path: relPath,
      name,
      basename: name.replace(/\.[^.]+$/, ''),
      extension,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });

    // Register parent folders
    let parent = path.posix.dirname(relPath);
    while (parent && parent !== '.') {
      this.folders.add(parent);
      parent = path.posix.dirname(parent);
    }

    if (extension === 'md') {
      const cached = this.notes.get(relPath);
      if (!cached || cached.updatedAt !== stat.mtimeMs) {
        const rawContent = fs.readFileSync(absPath, 'utf-8');
        this.notes.set(relPath, this.parseNote(relPath, rawContent, stat.mtimeMs));
      }
    }

    this.invalidate(isNew);
    return true;
  }

  private parseNote(relPath: string, rawContent: string, mtimeMs: number): NoteData {
    const { frontmatter, properties, body } = parseMarkdownWithFrontmatter(rawContent);
    const { links, embeds } = extractLinksAndEmbeds(body);
    return {
      path: relPath,
      name: path.basename(relPath).replace(/\.md$/i, ''),
      rawContent,
      body,
      frontmatter,
      properties,
      links,
      embeds,
      tags: extractTags(properties, body),
      headings: extractHeadings(body),
      updatedAt: mtimeMs,
    };
  }

  private removeFromIndex(relPath: string): void {
    const prefix = `${relPath}/`;
    let changed = this.files.delete(relPath) || this.folders.delete(relPath);
    this.notes.delete(relPath);
    for (const key of Array.from(this.files.keys())) {
      if (key.startsWith(prefix)) {
        this.files.delete(key);
        this.notes.delete(key);
        changed = true;
      }
    }
    for (const folder of Array.from(this.folders)) {
      if (folder.startsWith(prefix)) {
        this.folders.delete(folder);
        changed = true;
      }
    }
    if (changed) this.invalidate(true);
  }

  private indexDirectory(relDir: string): void {
    const absDir = path.join(this.vaultDir, relDir);
    if (!fs.existsSync(absDir)) return;
    this.folders.add(relDir);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const rel = this.toRelativePath(full);
        if (entry.isDirectory()) {
          this.folders.add(rel);
          walk(full);
        } else if (entry.isFile()) {
          this.indexFile(rel);
        }
      }
    };
    walk(absDir);
    this.invalidate(true);
  }

  /** Lazily rebuilt lookup maps for O(1) wiki-link resolution. */
  private ensureLookups(): void {
    if (!this.lookupDirty) return;
    this.lowerPathIndex.clear();
    this.nameIndex.clear();
    this.aliasIndex.clear();

    const addName = (key: string, p: string) => {
      const list = this.nameIndex.get(key);
      if (list) list.push(p);
      else this.nameIndex.set(key, [p]);
    };

    for (const f of this.files.values()) {
      const lowerPath = f.path.toLowerCase();
      this.lowerPathIndex.set(lowerPath, f.path);
      if (f.extension === 'md') {
        this.lowerPathIndex.set(lowerPath.replace(/\.md$/, ''), f.path);
      }
      addName(f.name.toLowerCase(), f.path);
      if (f.basename.toLowerCase() !== f.name.toLowerCase()) {
        addName(f.basename.toLowerCase(), f.path);
      }
    }
    // Prefer markdown notes, then the shortest path (Obsidian behaviour)
    for (const list of this.nameIndex.values()) {
      list.sort((a, b) => {
        const am = a.endsWith('.md') ? 0 : 1;
        const bm = b.endsWith('.md') ? 0 : 1;
        return am - bm || a.length - b.length;
      });
    }

    for (const note of this.notes.values()) {
      for (const prop of note.properties) {
        const k = prop.key.toLowerCase();
        if (k === 'aliases' || k === 'alias') {
          const arr = Array.isArray(prop.value) ? prop.value : [prop.value];
          for (const a of arr) {
            const alias = String(a ?? '').trim().toLowerCase();
            if (alias && !this.aliasIndex.has(alias)) this.aliasIndex.set(alias, note.path);
          }
        }
      }
    }
    this.lookupDirty = false;
  }

  // ---------------------------------------------------------------------------
  // File watcher (incremental index updates + batched notifications)
  // ---------------------------------------------------------------------------

  public startWatcher(onChange: (batch: VaultChangeBatch) => void): void {
    this.changeCallbacks.add(onChange);
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.vaultDir, {
      ignored: /(^|[/\\])\../, // ignore hidden dot files/folders (.obsidian, .git, etc.)
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    const handle = (event: string, fullPath: string) => {
      const relPath = this.toRelativePath(fullPath);
      if (!relPath || relPath.startsWith('..')) return;
      let structural = false;
      switch (event) {
        case 'add':
        case 'change':
          structural = !this.files.has(relPath);
          this.indexFile(relPath);
          break;
        case 'unlink':
        case 'unlinkDir':
          structural = true;
          this.removeFromIndex(relPath);
          break;
        case 'addDir':
          structural = !this.folders.has(relPath);
          this.folders.add(relPath);
          if (structural) this.invalidate(true);
          break;
      }
      this.queueNotification(relPath, structural);
    };

    this.watcher
      .on('add', (p) => handle('add', p))
      .on('change', (p) => handle('change', p))
      .on('unlink', (p) => handle('unlink', p))
      .on('addDir', (p) => handle('addDir', p))
      .on('unlinkDir', (p) => handle('unlinkDir', p));
  }

  private queueNotification(relPath: string, structural: boolean): void {
    this.pendingPaths.add(relPath);
    this.pendingStructural ||= structural;
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      const batch: VaultChangeBatch = {
        paths: Array.from(this.pendingPaths),
        structural: this.pendingStructural,
      };
      this.pendingPaths.clear();
      this.pendingStructural = false;
      this.notifyTimer = null;
      for (const cb of this.changeCallbacks) cb(batch);
    }, 200);
  }

  public async stopWatcher(): Promise<void> {
    if (this.watcher) await this.watcher.close();
    this.watcher = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public resolveSafePath(relPath: string): string {
    const cleaned = relPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const resolved = path.resolve(this.vaultDir, cleaned);
    if (resolved !== this.vaultDir && !resolved.startsWith(this.vaultDir + path.sep)) {
      throw new Error('Ungültiger Dateipfad außerhalb des Vaults.');
    }
    return resolved;
  }

  public toRelativePath(absPath: string): string {
    return path.relative(this.vaultDir, absPath).replace(/\\/g, '/');
  }

  public getFileTree(): FileTreeNode[] {
    if (this.treeCache) return this.treeCache;

    const root: FileTreeNode[] = [];
    const folderNodes = new Map<string, FileTreeNode>();
    const childrenOf = (parentRel: string): FileTreeNode[] => {
      if (!parentRel || parentRel === '.') return root;
      return getFolder(parentRel).children!;
    };
    const getFolder = (rel: string): FileTreeNode => {
      let node = folderNodes.get(rel);
      if (!node) {
        node = { name: path.posix.basename(rel), path: rel, type: 'folder', children: [] };
        folderNodes.set(rel, node);
        childrenOf(path.posix.dirname(rel)).push(node);
      }
      return node;
    };

    for (const folder of Array.from(this.folders).sort()) getFolder(folder);
    for (const f of this.files.values()) {
      childrenOf(path.posix.dirname(f.path)).push({
        name: f.name,
        path: f.path,
        type: 'file',
        extension: f.extension,
        updatedAt: f.mtimeMs,
      });
    }

    const sortRec = (nodes: FileTreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
      });
      for (const n of nodes) if (n.children) sortRec(n.children);
    };
    sortRec(root);

    this.treeCache = root;
    return root;
  }

  public listAllFiles(): { path: string; name: string; basename: string; extension: string; mtimeMs: number }[] {
    return Array.from(this.files.values());
  }

  public getAllFiles(): { path: string; name: string; basename: string; extension: string; mtimeMs: number }[] {
    return this.listAllFiles();
  }

  public getNoteOrNull(relPath: string): NoteData | null {
    try {
      return this.getNote(relPath);
    } catch {
      return null;
    }
  }

  /**
   * Resolves an Obsidian [[Wiki-Link]], ![[Embed]], or Markdown link/image path to an existing vault relative path.
   */
  public resolveWikiTarget(target: string, fromNotePath?: string): string | null {
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      // keep raw
    }
    const clean = decoded
      .split('#')[0]
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
    if (!clean) return null;
    this.ensureLookups();
    const lower = clean.toLowerCase();

    // 0. If source note path is given, check relative to the source note's directory first!
    // (Handles e.g. ![image11](attachments/image11.jpeg) inside "Projekte/3d Drucker/Note.md")
    if (fromNotePath) {
      const noteDir = path.posix.dirname(fromNotePath.replace(/\\/g, '/'));
      if (noteDir && noteDir !== '.') {
        const relCandidate = path.posix
          .normalize(`${noteDir}/${clean}`)
          .replace(/^\/+/, '');
        const relMatch = this.lowerPathIndex.get(relCandidate.toLowerCase());
        if (relMatch) return relMatch;
      }
    }

    // 1. Exact path (with or without .md)
    const exact = this.lowerPathIndex.get(lower);
    if (exact) return exact;

    // 2. File name / basename (if fromNotePath is given, prefer matches in same folder subtree)
    const byName = this.nameIndex.get(lower);
    if (byName && byName.length > 0) {
      if (fromNotePath && byName.length > 1) {
        const noteDir = path.posix.dirname(fromNotePath.replace(/\\/g, '/')).toLowerCase();
        const sameFolder = byName.find((p) =>
          p.toLowerCase().startsWith(noteDir + '/')
        );
        if (sameFolder) return sameFolder;
      }
      return byName[0];
    }

    // 3. Frontmatter aliases
    const alias = this.aliasIndex.get(lower);
    if (alias) return alias;

    // 4. Partial path suffix, e.g. [[Sub/Note]] or attachments/image1.png
    if (lower.includes('/')) {
      const base = lower.split('/').pop()!;
      const candidates = this.nameIndex.get(base) ?? [];
      if (fromNotePath) {
        const noteDir = path.posix.dirname(fromNotePath.replace(/\\/g, '/')).toLowerCase();
        const scopedMatch = candidates.find(
          (p) =>
            p.toLowerCase().startsWith(noteDir + '/') &&
            (p.toLowerCase().endsWith(`/${lower}`) || p.toLowerCase().endsWith(`/${lower}.md`))
        );
        if (scopedMatch) return scopedMatch;
      }
      const match = candidates.find(
        (p) => p.toLowerCase().endsWith(`/${lower}`) || p.toLowerCase().endsWith(`/${lower}.md`)
      );
      if (match) return match;
    }
    return null;
  }

  public getNote(relPath: string): NoteData {
    const cached = this.notes.get(relPath);
    if (cached) {
      // Cheap freshness check (single stat) in case the watcher has not fired yet
      try {
        const stat = fs.statSync(path.join(this.vaultDir, relPath));
        if (stat.mtimeMs === cached.updatedAt) return cached;
      } catch {
        this.removeFromIndex(relPath);
        throw new Error(`Notiz nicht gefunden: ${relPath}`);
      }
    }
    this.resolveSafePath(relPath);
    if (!this.indexFile(relPath) || !this.notes.has(relPath)) {
      throw new Error(`Notiz nicht gefunden: ${relPath}`);
    }
    return this.notes.get(relPath)!;
  }

  public getSyncManifest(): SyncManifestEntry[] {
    const manifest: SyncManifestEntry[] = [];
    for (const file of this.files.values()) {
      manifest.push({
        path: file.path,
        type: file.extension === 'md' ? 'markdown' : 'attachment',
        mtime: Math.round(file.mtimeMs),
        size: file.size || 0,
      });
    }
    return manifest;
  }

  public getNotesBatch(paths: string[]): NoteData[] {
    const result: NoteData[] = [];
    for (const p of paths) {
      const normalized = p.endsWith('.md') ? p : `${p}.md`;
      const note = this.notes.get(normalized);
      if (note) {
        result.push(note);
      } else {
        try {
          const loaded = this.getNote(normalized);
          if (loaded) result.push(loaded);
        } catch {
          // Ignore missing note
        }
      }
    }
    return result;
  }

  public saveNote(
    relPath: string,
    payload: {
      content?: string;
      rawContent?: string;
      body?: string;
      properties?: FrontmatterProperty[];
      baseMtime?: number;
      forceOverwrite?: boolean;
    }
  ): NoteData {
    const normalizedRel = relPath.endsWith('.md') ? relPath : `${relPath}.md`;
    const existing = this.notes.get(normalizedRel);

    if (existing && !payload.forceOverwrite && typeof payload.baseMtime === 'number') {
      const diff = Math.abs(existing.updatedAt - payload.baseMtime);
      if (diff > 50) {
        const conflictErr = new Error('Conflict') as Error & {
          statusCode: number;
          serverNote: NoteData;
        };
        conflictErr.statusCode = 409;
        conflictErr.serverNote = existing;
        throw conflictErr;
      }
    }

    const absPath = this.resolveSafePath(normalizedRel);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    const raw = payload.rawContent ?? payload.content;
    const finalRawContent =
      typeof raw === 'string'
        ? raw
        : serializeMarkdownWithFrontmatter(payload.properties ?? [], payload.body ?? '');

    fs.writeFileSync(absPath, finalRawContent, 'utf-8');
    this.indexFile(normalizedRel);
    return this.notes.get(normalizedRel)!;
  }

  public createFolder(relPath: string): void {
    const absPath = this.resolveSafePath(relPath);
    fs.mkdirSync(absPath, { recursive: true });
    this.folders.add(this.toRelativePath(absPath));
    this.invalidate(true);
  }

  public renameOrMove(oldRelPath: string, newRelPath: string): { newPath: string } {
    const oldAbs = this.resolveSafePath(oldRelPath);
    if (!fs.existsSync(oldAbs)) {
      throw new Error(`Quelle existiert nicht: ${oldRelPath}`);
    }
    const stat = fs.statSync(oldAbs);
    let finalNewRel = newRelPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (stat.isFile() && oldRelPath.endsWith('.md') && !finalNewRel.endsWith('.md')) {
      finalNewRel += '.md';
    }

    const newAbs = this.resolveSafePath(finalNewRel);
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.renameSync(oldAbs, newAbs);

    this.removeFromIndex(oldRelPath);
    if (stat.isDirectory()) this.indexDirectory(finalNewRel);
    else this.indexFile(finalNewRel);

    // If a markdown note was renamed, update [[OldName]] wiki-links across the vault
    if (stat.isFile() && oldRelPath.endsWith('.md')) {
      const oldBase = path.basename(oldRelPath, '.md');
      const newBase = path.basename(finalNewRel, '.md');
      if (oldBase !== newBase) {
        this.updateWikiLinksOnRename(oldBase, newBase);
      }
    }

    return { newPath: finalNewRel };
  }

  private updateWikiLinksOnRename(oldBase: string, newBase: string): void {
    const escaped = oldBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wikiRegex = new RegExp(
      `(\\[\\[)(?:[^\\]|#]*\\/)?${escaped}((?:#[^\\]|]+)?(?:\\|[^\\]]+)?\\]\\])`,
      'gi'
    );
    const oldLower = oldBase.toLowerCase();

    // Only touch notes whose (cached) link list references the old name
    for (const note of Array.from(this.notes.values())) {
      const references = note.links.some((l) => {
        const ll = l.toLowerCase();
        return ll === oldLower || ll.endsWith(`/${oldLower}`) || ll === `${oldLower}.md`;
      });
      if (!references) continue;
      const updated = note.rawContent.replace(wikiRegex, `$1${newBase}$2`);
      if (updated !== note.rawContent) {
        fs.writeFileSync(path.join(this.vaultDir, note.path), updated, 'utf-8');
        this.indexFile(note.path);
      }
    }
  }

  public deleteEntry(relPath: string): void {
    const absPath = this.resolveSafePath(relPath);
    if (fs.existsSync(absPath)) {
      fs.rmSync(absPath, { recursive: true, force: true });
    }
    this.removeFromIndex(relPath);
  }

  public deleteFile(relPath: string): void {
    this.deleteEntry(relPath);
  }

  public renameFile(oldRelPath: string, newRelPath: string): { newPath: string } {
    return this.renameOrMove(oldRelPath, newRelPath);
  }

  /** Alias kept for backwards compatibility */
  public buildGraphAndIndex(): GraphData {
    return this.buildGraph();
  }

  /** Graph of notes, tags and unresolved links. Cached until the vault changes. */
  public buildGraph(): GraphData {
    if (this.graphCache) return this.graphCache;

    const nodesMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const tagCountMap = new Map<string, number>();

    for (const note of this.notes.values()) {
      const folder = path.posix.dirname(note.path);
      nodesMap.set(note.path, {
        id: note.path,
        label: note.name,
        path: note.path,
        type: 'note',
        folder: folder === '.' ? '' : folder,
        degree: 0,
        tags: note.tags,
      });
    }

    const bump = (id: string) => {
      const n = nodesMap.get(id);
      if (n) n.degree++;
    };

    for (const note of this.notes.values()) {
      const seenTargets = new Set<string>();
      for (const rawLink of note.links) {
        const resolved = this.resolveWikiTarget(rawLink, note.path);
        let targetId: string;
        if (resolved && nodesMap.has(resolved)) {
          targetId = resolved;
        } else if (resolved) {
          continue; // link to an attachment, not part of the note graph
        } else {
          targetId = `unresolved:${rawLink}`;
          if (!nodesMap.has(targetId)) {
            nodesMap.set(targetId, { id: targetId, label: rawLink, type: 'unresolved', degree: 0 });
          }
        }
        if (targetId === note.path || seenTargets.has(targetId)) continue;
        seenTargets.add(targetId);
        edges.push({ source: note.path, target: targetId, type: 'wikilink' });
        bump(note.path);
        bump(targetId);
      }

      for (const tag of note.tags) {
        tagCountMap.set(tag, (tagCountMap.get(tag) ?? 0) + 1);
        const tagId = `tag:#${tag}`;
        if (!nodesMap.has(tagId)) {
          nodesMap.set(tagId, { id: tagId, label: `#${tag}`, type: 'tag', degree: 0 });
        }
        edges.push({ source: note.path, target: tagId, type: 'tag' });
        bump(note.path);
        bump(tagId);
      }
    }

    const tags = Array.from(tagCountMap.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    this.graphCache = { nodes: Array.from(nodesMap.values()), edges, tags };
    return this.graphCache;
  }

  /** Linked + unlinked mentions for a single note (computed on demand). */
  public getBacklinks(targetPath: string): { linked: BacklinkItem[]; unlinked: BacklinkItem[] } {
    const target = this.notes.get(targetPath);
    if (!target) return { linked: [], unlinked: [] };

    const linked: BacklinkItem[] = [];
    const unlinked: BacklinkItem[] = [];
    const linkingSources = new Set<string>();

    for (const note of this.notes.values()) {
      if (note.path === targetPath) continue;
      const matchingRaw = note.links.filter(
        (l) => this.resolveWikiTarget(l, note.path) === targetPath
      );
      if (matchingRaw.length === 0) continue;
      linkingSources.add(note.path);
      const needles = matchingRaw.map((l) => `[[${l.toLowerCase()}`);
      const lines = note.body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (needles.some((n) => lower.includes(n))) {
          linked.push({
            sourcePath: note.path,
            sourceTitle: note.name,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 300),
          });
        }
      }
    }

    // Unlinked mentions: title or alias appears as plain text
    const names = [target.name];
    for (const prop of target.properties) {
      const k = prop.key.toLowerCase();
      if (k === 'aliases' || k === 'alias') {
        const arr = Array.isArray(prop.value) ? prop.value : [prop.value];
        for (const a of arr) if (String(a ?? '').trim()) names.push(String(a).trim());
      }
    }
    const usable = names.filter((n) => n.length >= 4);
    if (usable.length > 0) {
      const alternation = usable.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const mentionRegex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'iu');
      for (const note of this.notes.values()) {
        if (note.path === targetPath || linkingSources.has(note.path)) continue;
        if (!mentionRegex.test(note.body)) continue; // fast whole-body pre-check
        const lines = note.body.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const stripped = lines[i].replace(/\[\[[^\]]*\]\]/g, '');
          if (mentionRegex.test(stripped)) {
            unlinked.push({
              sourcePath: note.path,
              sourceTitle: note.name,
              line: i + 1,
              snippet: lines[i].trim().slice(0, 300),
              isUnlinked: true,
            });
            break;
          }
        }
        if (unlinked.length >= 100) break;
      }
    }

    return { linked, unlinked };
  }

  public searchVault(query: string, tagFilter?: string): {
    path: string;
    name: string;
    matches: { line: number; text: string }[];
    tags: string[];
  }[] {
    const q = query.trim().toLowerCase();
    const cleanTag = tagFilter?.replace(/^#+/, '').toLowerCase();
    const results: {
      path: string;
      name: string;
      matches: { line: number; text: string }[];
      tags: string[];
    }[] = [];

    for (const note of this.notes.values()) {
      if (cleanTag && !note.tags.some((t) => t.toLowerCase() === cleanTag)) continue;

      if (!q) {
        results.push({
          path: note.path,
          name: note.name,
          matches: [{ line: 1, text: note.body.slice(0, 140).replace(/\n+/g, ' ').trim() }],
          tags: note.tags,
        });
      } else {
        const matches: { line: number; text: string }[] = [];
        if (note.name.toLowerCase().includes(q)) {
          matches.push({ line: 0, text: `Titel: ${note.name}` });
        }
        for (const prop of note.properties) {
          if (prop.key.toLowerCase().includes(q) || String(prop.value).toLowerCase().includes(q)) {
            matches.push({ line: 0, text: `Eigenschaft [${prop.key}]: ${String(prop.value)}` });
          }
        }
        if (note.body.toLowerCase().includes(q)) {
          const lines = note.body.split(/\r?\n/);
          for (let i = 0; i < lines.length && matches.length < 4; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              matches.push({ line: i + 1, text: lines[i].trim().slice(0, 160) });
            }
          }
        }
        if (matches.length > 0) {
          results.push({ path: note.path, name: note.name, matches, tags: note.tags });
        }
      }
      if (results.length >= 200) break;
    }

    return results;
  }
}
