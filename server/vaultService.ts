import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  AttachmentKind,
  BacklinkItem,
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  GraphEdge,
  GraphNode,
  NoteData,
  NoteSummary,
  SyncManifestEntry,
} from '../shared/types';
import {
  extractHeadings,
  extractLinksAndEmbeds,
  extractTags,
  extractCanvasLinksAndTags,
  getAttachmentKind,
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
  refactorMarkdownContent,
  refactorCanvasContent,
  refactorBaseContent,
  isNoteSendTarget,
  isNoteTemplate,
  type RenameMapping,
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
  isSendTarget?: boolean;
  isTemplate?: boolean;
}

function copyDirRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.DS_Store' || entry.isSymbolicLink()) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function resolveDemoVaultSeedDir(): string | null {
  const candidates = [
    '/app/demo-vault-seed',
    path.resolve(process.cwd(), 'vault'),
    path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'vault'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      const entries = fs.readdirSync(candidate).filter((e) => !e.startsWith('.'));
      if (entries.length > 0) return candidate;
    }
  }
  return null;
}

/**
 * Seeds `vaultDir` with the bundled public Demo Vault if `vaultDir` does not
 * exist or is completely empty (ignoring hidden files like `.git` or `.DS_Store`).
 * Never overwrites or touches an existing non-empty vault.
 */
export function ensureDemoVaultSeeded(vaultDir: string, seedDir?: string): boolean {
  const resolvedVault = path.resolve(vaultDir);
  if (!fs.existsSync(resolvedVault)) {
    fs.mkdirSync(resolvedVault, { recursive: true });
  }

  const entries = fs.readdirSync(resolvedVault).filter((e) => !e.startsWith('.'));
  if (entries.length > 0) return false;

  const resolvedSeed = seedDir ? path.resolve(seedDir) : resolveDemoVaultSeedDir();
  if (!resolvedSeed || resolvedSeed === resolvedVault || !fs.existsSync(resolvedSeed)) {
    return false;
  }

  copyDirRecursive(resolvedSeed, resolvedVault);
  return true;
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
  private backlinkIndex = new Map<string, Set<string>>();
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
    ensureDemoVaultSeeded(this.vaultDir);
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
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
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
      stat = fs.lstatSync(absPath);
    } catch {
      this.removeFromIndex(relPath);
      return false;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) return false;

    const name = path.basename(relPath);
    const extension = path.extname(name).slice(1).toLowerCase();
    const isNew = !this.files.has(relPath);

    // Register parent folders
    let parent = path.posix.dirname(relPath);
    while (parent && parent !== '.') {
      this.folders.add(parent);
      parent = path.posix.dirname(parent);
    }

    let noteSendTarget: boolean | undefined = undefined;
    let noteTemplate: boolean | undefined = undefined;

    if (extension === 'md') {
      let cached = this.notes.get(relPath);
      if (!cached || cached.updatedAt !== stat.mtimeMs) {
        const rawContent = fs.readFileSync(absPath, 'utf-8');
        cached = this.parseNote(relPath, rawContent, stat.mtimeMs);
        this.notes.set(relPath, cached);
      }
      noteSendTarget = cached.isSendTarget;
      noteTemplate = cached.isTemplate;
    } else if (extension === 'canvas') {
      const cached = this.notes.get(relPath);
      if (!cached || cached.updatedAt !== stat.mtimeMs) {
        const rawContent = fs.readFileSync(absPath, 'utf-8');
        this.notes.set(relPath, this.parseCanvas(relPath, rawContent, stat.mtimeMs));
      }
    } else if (extension === 'base') {
      const cached = this.notes.get(relPath);
      if (!cached || cached.updatedAt !== stat.mtimeMs) {
        const rawContent = fs.readFileSync(absPath, 'utf-8');
        this.notes.set(relPath, this.parseBase(relPath, rawContent, stat.mtimeMs));
      }
    }

    this.files.set(relPath, {
      path: relPath,
      name,
      basename: name.replace(/\.[^.]+$/, ''),
      extension,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      isSendTarget: noteSendTarget,
      isTemplate: noteTemplate,
    });

    this.invalidate(isNew);
    return true;
  }

  private parseNote(relPath: string, rawContent: string, mtimeMs: number): NoteData {
    const { frontmatter, properties, body } = parseMarkdownWithFrontmatter(rawContent);
    const { links, embeds } = extractLinksAndEmbeds(body);
    const isSendTarget = isNoteSendTarget(frontmatter, properties);
    const isTemplate = isNoteTemplate(frontmatter, properties);
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
      isSendTarget,
      isTemplate,
    };
  }

  private parseCanvas(relPath: string, rawContent: string, mtimeMs: number): NoteData {
    const { links, tags } = extractCanvasLinksAndTags(rawContent);
    return {
      path: relPath,
      name: path.basename(relPath).replace(/\.canvas$/i, ''),
      rawContent,
      body: rawContent,
      frontmatter: {},
      properties: [],
      links,
      embeds: [],
      tags,
      headings: [],
      updatedAt: mtimeMs,
    };
  }

  private parseBase(relPath: string, rawContent: string, mtimeMs: number): NoteData {
    return {
      path: relPath,
      name: path.basename(relPath).replace(/\.base$/i, ''),
      rawContent,
      body: rawContent,
      frontmatter: {},
      properties: [],
      links: [],
      embeds: [],
      tags: [],
      headings: [],
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
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
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
    // Fallback for canvas files without .canvas extension (only if no .md note matches)
    for (const f of this.files.values()) {
      if (f.extension === 'canvas') {
        const withoutExt = f.path.toLowerCase().replace(/\.canvas$/, '');
        if (!this.lowerPathIndex.has(withoutExt)) {
          this.lowerPathIndex.set(withoutExt, f.path);
        }
      }
    }
    // Prefer markdown notes, then canvas files, then the shortest path (Obsidian behaviour)
    for (const list of this.nameIndex.values()) {
      list.sort((a, b) => {
        const getPriority = (p: string) => (p.endsWith('.md') ? 0 : p.endsWith('.canvas') ? 1 : 2);
        return getPriority(a) - getPriority(b) || a.length - b.length;
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

    this.backlinkIndex.clear();
    for (const note of this.notes.values()) {
      for (const link of note.links) {
        const resolved = this.resolveWikiTarget(link, note.path);
        if (resolved && resolved !== note.path) {
          let set = this.backlinkIndex.get(resolved);
          if (!set) {
            set = new Set();
            this.backlinkIndex.set(resolved, set);
          }
          set.add(note.path);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // File watcher (incremental index updates + batched notifications)
  // ---------------------------------------------------------------------------

  public startWatcher(onChange: (batch: VaultChangeBatch) => void): void {
    this.changeCallbacks.add(onChange);
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.vaultDir, {
      ignored: [/(^|[/\\])\../, /(^|[/\\])\.git([/\\]|$)/], // ignore hidden dot files/folders (.git, .obsidian, etc.)
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    const handle = (event: string, fullPath: string) => {
      const relPath = this.toRelativePath(fullPath);
      if (!relPath || relPath.startsWith('..') || relPath.startsWith('.git') || relPath.includes('/.git')) return;
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
    try {
      const realVault = fs.realpathSync(this.vaultDir);
      let checkPath = resolved;
      while (!fs.existsSync(checkPath)) {
        const parent = path.dirname(checkPath);
        if (parent === checkPath) break;
        checkPath = parent;
      }
      if (fs.existsSync(checkPath)) {
        const realTarget = fs.realpathSync(checkPath);
        if (realTarget !== realVault && !realTarget.startsWith(realVault + path.sep)) {
          throw new Error('Ungültiger Dateipfad außerhalb des Vaults.');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('außerhalb des Vaults')) {
        throw err;
      }
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
        attachmentKind: getAttachmentKind(f.path),
        updatedAt: f.mtimeMs,
        mtimeMs: f.mtimeMs,
        isSendTarget: f.isSendTarget,
        isTemplate: f.isTemplate,
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

  public listAllFiles(): {
    path: string;
    name: string;
    basename: string;
    folder: string;
    extension: string;
    mtimeMs: number;
    mtime: number;
    frontmatter: Record<string, any>;
    tags: string[];
    isSendTarget?: boolean;
    isTemplate?: boolean;
  }[] {
    const list: any[] = [];
    for (const file of this.files.values()) {
      const note = this.notes.get(file.path);
      const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      list.push({
        path: file.path,
        name: file.name,
        basename: file.basename,
        folder,
        extension: file.extension,
        mtimeMs: file.mtimeMs,
        mtime: Math.round(file.mtimeMs),
        frontmatter: note?.frontmatter || {},
        tags: note?.tags || [],
        isSendTarget: file.isSendTarget,
        isTemplate: file.isTemplate,
      });
    }
    return list;
  }

  public getAllFiles() {
    return this.listAllFiles();
  }

  public getAllNotes(): NoteSummary[] {
    const list: NoteSummary[] = [];
    for (const [relPath, note] of this.notes.entries()) {
      if (!relPath.endsWith('.md')) continue;
      const file = this.files.get(relPath);
      const name = path.basename(relPath);
      const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
      list.push({
        path: relPath,
        name,
        basename: name.replace(/\.md$/i, ''),
        folder,
        frontmatter: note.frontmatter || {},
        tags: note.tags || [],
        mtime: file ? Math.round(file.mtimeMs) : Math.round(note.updatedAt || Date.now()),
        extension: 'md',
        isSendTarget: note.isSendTarget,
        isTemplate: note.isTemplate,
      });
    }
    return list;
  }

  public getVaultOverview(): {
    tree: FileTreeNode[];
    files: any[];
    notes: NoteSummary[];
  } {
    return {
      tree: this.getFileTree(),
      files: this.getAllFiles(),
      notes: this.getAllNotes(),
    };
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
        const relCanvas = this.lowerPathIndex.get(`${relCandidate.toLowerCase()}.canvas`);
        if (relCanvas) return relCanvas;
      }
    }

    // 1. Exact path (with or without .md / .canvas)
    const exact = this.lowerPathIndex.get(lower);
    if (exact) return exact;
    const exactCanvas = this.lowerPathIndex.get(`${lower}.canvas`);
    if (exactCanvas) return exactCanvas;

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
            (p.toLowerCase().endsWith(`/${lower}`) ||
              p.toLowerCase().endsWith(`/${lower}.md`) ||
              p.toLowerCase().endsWith(`/${lower}.canvas`))
        );
        if (scopedMatch) return scopedMatch;
      }
      const match = candidates.find(
        (p) =>
          p.toLowerCase().endsWith(`/${lower}`) ||
          p.toLowerCase().endsWith(`/${lower}.md`) ||
          p.toLowerCase().endsWith(`/${lower}.canvas`)
      );
      if (match) return match;
    }
    return null;
  }

  /**
   * Resolves a target with its classified AttachmentKind ('markdown', 'canvas', 'image', 'pdf', etc.).
   */
  public resolveWikiTargetWithKind(
    target: string,
    fromNotePath?: string
  ): { path: string; kind: AttachmentKind } | null {
    const resolved = this.resolveWikiTarget(target, fromNotePath);
    if (!resolved) return null;
    return {
      path: resolved,
      kind: getAttachmentKind(resolved),
    };
  }

  public getNote(relPath: string): NoteData {
    let resolvedRel = relPath;
    if (!this.notes.has(resolvedRel)) {
      if (this.notes.has(`${relPath}.base`)) {
        resolvedRel = `${relPath}.base`;
      } else if (this.notes.has(`${relPath}.canvas`)) {
        resolvedRel = `${relPath}.canvas`;
      } else if (this.notes.has(`${relPath}.md`)) {
        resolvedRel = `${relPath}.md`;
      }
    }
    const cached = this.notes.get(resolvedRel);
    if (cached) {
      // Cheap freshness check (single stat) in case the watcher has not fired yet
      try {
        const stat = fs.statSync(path.join(this.vaultDir, resolvedRel));
        if (stat.mtimeMs === cached.updatedAt) return cached;
      } catch {
        this.removeFromIndex(resolvedRel);
        throw new Error(`Notiz nicht gefunden: ${resolvedRel}`);
      }
    }
    this.resolveSafePath(resolvedRel);
    if (!this.indexFile(resolvedRel) || !this.notes.has(resolvedRel)) {
      throw new Error(`Notiz nicht gefunden: ${resolvedRel}`);
    }
    return this.notes.get(resolvedRel)!;
  }

  public getSyncManifest(): SyncManifestEntry[] {
    const manifest: SyncManifestEntry[] = [];
    for (const file of this.files.values()) {
      const note = this.notes.get(file.path);
      manifest.push({
        path: file.path,
        type:
          file.extension === 'md' || file.extension === 'canvas' || file.extension === 'base'
            ? 'markdown'
            : 'attachment',
        mtime: Math.round(file.mtimeMs),
        size: file.size || 0,
        frontmatter: note?.frontmatter || {},
        tags: note?.tags || [],
      });
    }
    return manifest;
  }

  public getNotesBatch(paths: string[]): NoteData[] {
    const result: NoteData[] = [];
    for (const p of paths) {
      let normalized = p;
      if (!this.notes.has(normalized)) {
        if (this.notes.has(`${p}.base`)) normalized = `${p}.base`;
        else if (this.notes.has(`${p}.canvas`)) normalized = `${p}.canvas`;
        else if (this.notes.has(`${p}.md`)) normalized = `${p}.md`;
        else if (!p.endsWith('.canvas') && !p.endsWith('.md') && !p.endsWith('.base')) normalized = `${p}.md`;
      }
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

  public isContentIdentical(
    existing: NoteData,
    incoming: {
      content?: string;
      rawContent?: string;
      body?: string;
      properties?: FrontmatterProperty[];
    }
  ): boolean {
    const isCanvas = existing.path.endsWith('.canvas');
    const isBase = existing.path.endsWith('.base');
    if (isCanvas || isBase) {
      const incomingRaw = (incoming.rawContent ?? incoming.content ?? incoming.body ?? '').replace(/\r\n/g, '\n').trim();
      const existingRaw = (existing.rawContent || existing.body || '').replace(/\r\n/g, '\n').trim();
      if (incomingRaw === existingRaw) return true;
      if (isCanvas) {
        try {
          const parsedIncoming = JSON.parse(incomingRaw);
          const parsedExisting = JSON.parse(existingRaw);
          return JSON.stringify(parsedIncoming) === JSON.stringify(parsedExisting);
        } catch {
          return incomingRaw === existingRaw;
        }
      }
      return false;
    }

    // Markdown note:
    const incomingRaw = incoming.rawContent ?? incoming.content;
    if (typeof incomingRaw === 'string') {
      const normIncomingRaw = incomingRaw.replace(/\r\n/g, '\n').trim();
      const normExistingRaw = (existing.rawContent || '').replace(/\r\n/g, '\n').trim();
      if (normIncomingRaw === normExistingRaw) {
        return true;
      }
    }

    const incomingBody = (incoming.body ?? '').replace(/\r\n/g, '\n').trim();
    const existingBody = (existing.body ?? '').replace(/\r\n/g, '\n').trim();
    if (incomingBody !== existingBody) {
      return false;
    }

    // Body matches! Now check frontmatter properties
    const incomingProps = incoming.properties ?? [];
    const existingProps = existing.properties ?? [];
    const serializedIncoming = serializeMarkdownWithFrontmatter(incomingProps, '').replace(/\r\n/g, '\n').trim();
    const serializedExisting = serializeMarkdownWithFrontmatter(existingProps, '').replace(/\r\n/g, '\n').trim();
    if (serializedIncoming !== serializedExisting) {
      return JSON.stringify(incomingProps) === JSON.stringify(existingProps);
    }

    return true;
  }

  public isFastForward(
    existing: NoteData,
    incoming: {
      content?: string;
      rawContent?: string;
      body?: string;
      properties?: FrontmatterProperty[];
    }
  ): boolean {
    const isCanvas = existing.path.endsWith('.canvas');
    const isBase = existing.path.endsWith('.base');
    if (isCanvas || isBase) {
      return false;
    }

    const incomingBody = (incoming.body ?? '').replace(/\r\n/g, '\n').trim();
    const existingBody = (existing.body ?? '').replace(/\r\n/g, '\n').trim();

    // Fast-forward check: incoming version is a clean continuation (prefix/suffix match)
    if (incomingBody.startsWith(existingBody) || incomingBody.endsWith(existingBody)) {
      const incomingProps = incoming.properties ?? [];
      const existingProps = existing.properties ?? [];
      const serializedIncoming = serializeMarkdownWithFrontmatter(incomingProps, '').replace(/\r\n/g, '\n').trim();
      const serializedExisting = serializeMarkdownWithFrontmatter(existingProps, '').replace(/\r\n/g, '\n').trim();
      return serializedIncoming === serializedExisting || JSON.stringify(incomingProps) === JSON.stringify(existingProps);
    }

    return false;
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
    const isCanvas = relPath.endsWith('.canvas');
    const isBase = relPath.endsWith('.base');
    const normalizedRel = isCanvas || isBase
      ? relPath
      : relPath.endsWith('.md')
        ? relPath
        : `${relPath}.md`;
    const existing = this.notes.get(normalizedRel);

    if (existing && !payload.forceOverwrite && typeof payload.baseMtime === 'number') {
      const diff = Math.abs(existing.updatedAt - payload.baseMtime);
      if (diff > 50) {
        if (this.isContentIdentical(existing, payload)) {
          // Content is identical: suppress conflict and return current server note
          return existing;
        }
        if (this.isFastForward(existing, payload)) {
          // Fast-forward resolution: incoming note is a clean extension of existing (e.g. forward typing)
          // Allow save to proceed
        } else {
          const conflictErr = new Error('Conflict') as Error & {
            statusCode: number;
            serverNote: NoteData;
          };
          conflictErr.statusCode = 409;
          conflictErr.serverNote = existing;
          throw conflictErr;
        }
      }
    }

    const absPath = this.resolveSafePath(normalizedRel);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });

    const raw = payload.rawContent ?? payload.content;
    const finalRawContent =
      typeof raw === 'string'
        ? raw
        : isCanvas || isBase
          ? (payload.body ?? '')
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
    if (stat.isFile()) {
      if (oldRelPath.endsWith('.canvas') && !finalNewRel.endsWith('.canvas')) {
        finalNewRel += '.canvas';
      } else if (oldRelPath.endsWith('.base') && !finalNewRel.endsWith('.base')) {
        finalNewRel += '.base';
      } else if (oldRelPath.endsWith('.md') && !finalNewRel.endsWith('.md')) {
        finalNewRel += '.md';
      }
    }

    const newAbs = this.resolveSafePath(finalNewRel);
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.renameSync(oldAbs, newAbs);

    this.removeFromIndex(oldRelPath);
    if (stat.isDirectory()) this.indexDirectory(finalNewRel);
    else this.indexFile(finalNewRel);

    const mapping: RenameMapping = {
      oldPath: oldRelPath,
      newPath: finalNewRel,
      isDirectory: stat.isDirectory(),
    };
    this.refactorVaultLinks([mapping]);
    this.invalidate(true);
    this.queueNotification(finalNewRel, true);

    return { newPath: finalNewRel };
  }

  public moveBatch(moves: Array<{ oldPath: string; newPath: string }>): { results: Array<{ oldPath: string; newPath: string }> } {
    const results: Array<{ oldPath: string; newPath: string }> = [];
    const mappings: RenameMapping[] = [];

    for (const move of moves) {
      const oldRelPath = move.oldPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      const oldAbs = this.resolveSafePath(oldRelPath);
      if (!fs.existsSync(oldAbs)) continue;

      const stat = fs.statSync(oldAbs);
      let finalNewRel = move.newPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      if (stat.isFile()) {
        if (oldRelPath.endsWith('.canvas') && !finalNewRel.endsWith('.canvas')) {
          finalNewRel += '.canvas';
        } else if (oldRelPath.endsWith('.base') && !finalNewRel.endsWith('.base')) {
          finalNewRel += '.base';
        } else if (oldRelPath.endsWith('.md') && !finalNewRel.endsWith('.md')) {
          finalNewRel += '.md';
        }
      }

      const newAbs = this.resolveSafePath(finalNewRel);
      fs.mkdirSync(path.dirname(newAbs), { recursive: true });
      fs.renameSync(oldAbs, newAbs);

      this.removeFromIndex(oldRelPath);
      if (stat.isDirectory()) this.indexDirectory(finalNewRel);
      else this.indexFile(finalNewRel);

      mappings.push({
        oldPath: oldRelPath,
        newPath: finalNewRel,
        isDirectory: stat.isDirectory(),
      });
      results.push({ oldPath: oldRelPath, newPath: finalNewRel });
    }

    if (mappings.length > 0) {
      this.refactorVaultLinks(mappings);
      this.invalidate(true);
      for (const res of results) {
        this.pendingPaths.add(res.newPath);
      }
      this.pendingStructural = true;
      this.queueNotification(results[0]?.newPath || '', true);
    }

    return { results };
  }

  private refactorVaultLinks(mappings: RenameMapping[]): void {
    if (!mappings || mappings.length === 0) return;

    for (const note of Array.from(this.notes.values())) {
      const isCanvas = note.path.endsWith('.canvas');
      const isMd = note.path.endsWith('.md');
      const isBase = note.path.endsWith('.base');
      if (!isMd && !isCanvas && !isBase) continue;

      const updated = isCanvas
        ? refactorCanvasContent(note.rawContent, mappings)
        : isBase
        ? refactorBaseContent(note.rawContent, mappings)
        : refactorMarkdownContent(note.rawContent, mappings);

      if (updated !== note.rawContent) {
        fs.writeFileSync(path.join(this.vaultDir, note.path), updated, 'utf-8');
        this.indexFile(note.path);
      }
    }
  }

  public notifyChange(relPath: string, structural = false): void {
    this.queueNotification(relPath, structural);
  }

  public copyEntry(sourcePath: string, targetPath?: string): { newPath: string } {
    const srcAbs = this.resolveSafePath(sourcePath);
    if (!fs.existsSync(srcAbs)) {
      throw new Error(`Quelle existiert nicht: ${sourcePath}`);
    }
    const stat = fs.statSync(srcAbs);

    let destRel = (targetPath || sourcePath).replace(/^[/\\]+/, '').replace(/\\/g, '/');
    let destAbs = this.resolveSafePath(destRel);

    // If destination is an existing directory and source is being copied into it:
    if (fs.existsSync(destAbs) && fs.statSync(destAbs).isDirectory() && destRel !== sourcePath) {
      destRel = path.posix.join(destRel, path.posix.basename(sourcePath));
      destAbs = this.resolveSafePath(destRel);
    } else if (stat.isFile()) {
      if (sourcePath.endsWith('.base') && !destRel.endsWith('.base')) {
        destRel += '.base';
        destAbs = this.resolveSafePath(destRel);
      } else if (sourcePath.endsWith('.canvas') && !destRel.endsWith('.canvas')) {
        destRel += '.canvas';
        destAbs = this.resolveSafePath(destRel);
      } else if (sourcePath.endsWith('.md') && !destRel.endsWith('.md')) {
        destRel += '.md';
        destAbs = this.resolveSafePath(destRel);
      }
    }

    // If source and target are identical or dest already exists, generate a copy name: e.g. "Name (Copy).md" or "Name (Copy 2).md"
    if (fs.existsSync(destAbs) || destRel === sourcePath) {
      const dir = path.posix.dirname(destRel);
      const ext = stat.isDirectory() ? '' : path.posix.extname(destRel);
      const base = stat.isDirectory() ? path.posix.basename(destRel) : path.posix.basename(destRel, ext);

      let counter = 1;
      let candidateRel = '';
      while (true) {
        const suffix = counter === 1 ? ' (Copy)' : ` (Copy ${counter})`;
        const newName = `${base}${suffix}${ext}`;
        candidateRel = dir === '.' || !dir ? newName : `${dir}/${newName}`;
        const candidateAbs = this.resolveSafePath(candidateRel);
        if (!fs.existsSync(candidateAbs)) {
          destRel = candidateRel;
          destAbs = candidateAbs;
          break;
        }
        counter++;
      }
    }

    fs.mkdirSync(path.dirname(destAbs), { recursive: true });

    if (stat.isDirectory()) {
      fs.cpSync(srcAbs, destAbs, { recursive: true });
      this.indexDirectory(destRel);
    } else {
      fs.copyFileSync(srcAbs, destAbs);
      this.indexFile(destRel);
    }

    return { newPath: destRel };
  }

  public deleteEntry(relPath: string): { deleted: boolean; path: string } {
    const absPath = this.resolveSafePath(relPath);
    if (fs.existsSync(absPath)) {
      fs.rmSync(absPath, { recursive: true, force: true });
    }
    this.removeFromIndex(relPath);
    return { deleted: true, path: relPath };
  }

  public removeEntryFromIndex(relPath: string): void {
    this.removeFromIndex(relPath);
  }

  public invalidateCaches(structural = true): void {
    this.invalidate(structural);
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
      const isCanvas = note.path.endsWith('.canvas');
      nodesMap.set(note.path, {
        id: note.path,
        label: note.name,
        path: note.path,
        type: isCanvas ? 'canvas' : 'note',
        kind: isCanvas ? 'canvas' : 'markdown',
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

    this.ensureLookups();

    const linked: BacklinkItem[] = [];
    const unlinked: BacklinkItem[] = [];
    const linkingSources = this.backlinkIndex.get(targetPath) ?? new Set<string>();

    for (const sourcePath of linkingSources) {
      const note = this.notes.get(sourcePath);
      if (!note || note.path === targetPath) continue;
      const matchingRaw = note.links.filter(
        (l) => this.resolveWikiTarget(l, note.path) === targetPath
      );
      if (matchingRaw.length === 0) continue;
      const needles = matchingRaw.map((l) => `[[${l.toLowerCase()}`);
      const lines = note.body.split(/\r?\n/);
      let foundInLines = false;
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (needles.some((n) => lower.includes(n))) {
          linked.push({
            sourcePath: note.path,
            sourceTitle: note.name,
            line: i + 1,
            snippet: lines[i].trim().slice(0, 300),
          });
          foundInLines = true;
        }
      }
      if (!foundInLines && note.path.endsWith('.canvas')) {
        linked.push({
          sourcePath: note.path,
          sourceTitle: note.name,
          line: 1,
          snippet: `Canvas-Verknüpfung auf ${matchingRaw.join(', ')}`,
        });
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
