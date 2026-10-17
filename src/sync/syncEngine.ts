import {
  api,
  ApiConflictError,
  getActiveProfile,
  getBaseUrl,
  getStoredProfiles,
  saveStoredProfiles,
} from '../api';
import { LocalDb, type OutboxMutation, type CachedAttachment } from './localDb';
import type {
  BacklinkItem,
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  NoteData,
  SyncManifestEntry,
  VaultProfile,
} from '../../shared/types';
import {
  extractHeadings,
  extractLinksAndEmbeds,
  extractTags,
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../../shared/markdownUtils';

export type SyncState = 'online' | 'offline' | 'syncing' | 'synced' | 'conflict';

export interface ConflictItem {
  id: string;
  path: string;
  localBody: string;
  localProperties: FrontmatterProperty[];
  localTimestamp: number;
  serverNote: NoteData;
}

export type ConflictResolution = 'keep_local' | 'keep_server' | 'keep_both';

class SyncEngine {
  private localDb: LocalDb;
  private currentProfile: VaultProfile;
  private syncState: SyncState = 'offline';
  private listeners = new Set<(state: SyncState) => void>();
  private conflictListeners = new Set<(conflicts: ConflictItem[]) => void>();
  private activeConflicts: ConflictItem[] = [];
  private isSyncing = false;
  private syncedAttachmentFolders: string[] = ['attachments'];
  private blobUrls = new Map<string, string>();

  constructor() {
    this.currentProfile = getActiveProfile();
    this.localDb = new LocalDb(this.currentProfile.id);
    this.init();
  }

  private async init() {
    if (typeof window === 'undefined') return;

    // Load user's chosen offline attachment folders from local DB
    const savedFolders = await this.localDb.getMeta<string[]>('syncedAttachmentFolders');
    if (savedFolders && Array.isArray(savedFolders)) {
      this.syncedAttachmentFolders = savedFolders;
    }

    // Monitor browser online/offline events
    window.addEventListener('online', () => {
      this.checkConnectionAndSync();
    });
    window.addEventListener('offline', () => {
      this.setSyncState('offline');
    });

    // Initial check
    this.checkConnectionAndSync();
  }

  public switchProfile(profileId: string) {
    this.currentProfile = getActiveProfile();
    this.localDb = new LocalDb(profileId);
    this.activeConflicts = [];
    this.notifyConflictListeners();
    this.checkConnectionAndSync();
  }

  public subscribe(cb: (state: SyncState) => void): () => void {
    this.listeners.add(cb);
    cb(this.syncState);
    return () => this.listeners.delete(cb);
  }

  public subscribeConflicts(cb: (conflicts: ConflictItem[]) => void): () => void {
    this.conflictListeners.add(cb);
    cb(this.activeConflicts);
    return () => this.conflictListeners.delete(cb);
  }

  public getSyncState(): SyncState {
    return this.syncState;
  }

  public getActiveConflicts(): ConflictItem[] {
    return [...this.activeConflicts];
  }

  private setSyncState(newState: SyncState) {
    this.syncState = newState;
    for (const cb of this.listeners) {
      cb(newState);
    }
  }

  private notifyConflictListeners() {
    for (const cb of this.conflictListeners) {
      cb([...this.activeConflicts]);
    }
  }

  public async getSyncedFolders(): Promise<string[]> {
    return [...this.syncedAttachmentFolders];
  }

  public async setSyncedFolders(folders: string[]): Promise<void> {
    this.syncedAttachmentFolders = folders;
    await this.localDb.setMeta('syncedAttachmentFolders', folders);
  }

  public async checkConnectionAndSync(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setSyncState('offline');
      return false;
    }

    try {
      const status = await api.checkAuthStatus();
      if (status.authenticated || status.authRequired === false) {
        if (this.syncState === 'offline') {
          this.setSyncState('online');
        }
        // Trigger background sync
        this.syncNow().catch((err) => {
          console.warn('[Knowmesh Sync] Sync error:', err);
        });
        return true;
      }
    } catch {
      this.setSyncState('offline');
      return false;
    }
    return false;
  }

  // --- Outbox Processing & Reconnect ---
  public async flushOutbox(): Promise<void> {
    const mutations = await this.localDb.getOutbox();
    if (mutations.length === 0) return;

    for (const m of mutations) {
      try {
        if (m.type === 'save_note') {
          await api.saveNote({
            path: m.path,
            body: m.body,
            properties: m.properties,
            baseMtime: m.baseMtime,
            forceOverwrite: false,
          });
        } else if (m.type === 'create_folder') {
          await api.createFolder(m.path);
        } else if (m.type === 'rename' && m.newPath) {
          await api.renameEntry(m.path, m.newPath);
        } else if (m.type === 'delete') {
          await api.deleteEntry(m.path);
        }

        // Mutation succeeded on server, remove from outbox
        await this.localDb.removeOutboxMutation(m.id);
      } catch (err: any) {
        if (err instanceof ApiConflictError) {
          // Add to conflicts modal queue
          if (!this.activeConflicts.some((c) => c.id === m.id)) {
            this.activeConflicts.push({
              id: m.id,
              path: m.path,
              localBody: m.body || '',
              localProperties: m.properties || [],
              localTimestamp: m.timestamp,
              serverNote: err.serverNote,
            });
            this.setSyncState('conflict');
            this.notifyConflictListeners();
          }
        } else {
          console.warn(`[Knowmesh Sync] Failed to replay mutation ${m.id}:`, err);
          // If offline or network issue, abort outbox flushing for now
          break;
        }
      }
    }
  }

  // --- Delta-Sync with Server ---
  public async syncNow(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    this.setSyncState('syncing');

    try {
      // Step 1: Flush local pending edits first
      await this.flushOutbox();

      // Step 2: Fetch server sync manifest
      const manifest = await api.getSyncManifest();
      const serverFileMap = new Map<string, SyncManifestEntry>();
      for (const entry of manifest) {
        serverFileMap.set(entry.path, entry);
      }

      // Step 3: Compare with local notes
      const localNotes = await this.localDb.getAllNotes();
      const localNoteMap = new Map<string, NoteData>();
      for (const n of localNotes) {
        localNoteMap.set(n.path, n);
      }

      const pathsToDownload: string[] = [];
      for (const [path, sEntry] of serverFileMap) {
        if (sEntry.type === 'markdown') {
          const lNote = localNoteMap.get(path);
          if (!lNote || sEntry.mtime > lNote.updatedAt) {
            pathsToDownload.push(path);
          }
        }
      }

      // Detect locally deleted notes that no longer exist on server
      for (const [lPath] of localNoteMap) {
        if (!serverFileMap.has(lPath)) {
          await this.localDb.deleteNote(lPath);
        }
      }

      // Step 4: Batch download changed/new notes in chunks of 50
      const chunkSize = 50;
      for (let i = 0; i < pathsToDownload.length; i += chunkSize) {
        const chunk = pathsToDownload.slice(i, i + chunkSize);
        const { notes } = await api.getNotesBatch(chunk);
        await this.localDb.putNotesBatch(notes);
      }

      // Step 5: Refresh tree & graph caches
      try {
        const treeData = await api.getTree();
        await this.localDb.setMeta('tree', treeData.tree);
        await this.localDb.setMeta('files', treeData.files);
      } catch {}

      try {
        const graphData = await api.getGraph();
        await this.localDb.setMeta('graph', graphData);
      } catch {}

      // Step 6: Background sync of binary attachments for selected offline folders
      this.syncAttachmentsBackground(manifest).catch((err) => {
        console.warn('[Knowmesh Sync] Attachment sync warning:', err);
      });

      if (this.activeConflicts.length > 0) {
        this.setSyncState('conflict');
      } else {
        this.setSyncState('synced');
      }
    } catch (err) {
      console.warn('[Knowmesh Sync] Sync failed:', err);
      this.setSyncState('offline');
    } finally {
      this.isSyncing = false;
    }
  }

  private async syncAttachmentsBackground(manifest: SyncManifestEntry[]): Promise<void> {
    const attachmentEntries = manifest.filter(
      (m) =>
        m.type === 'attachment' &&
        this.syncedAttachmentFolders.some((f) => m.path.startsWith(f) || f === '*')
    );

    for (const att of attachmentEntries) {
      const existing = await this.localDb.getAttachment(att.path);
      if (!existing || att.mtime > existing.mtime) {
        try {
          const url = api.getAttachmentUrl(att.path);
          const res = await fetch(url);
          if (res.ok) {
            const blob = await res.blob();
            await this.localDb.putAttachment({
              path: att.path,
              blob,
              mtime: att.mtime,
              size: blob.size,
            });
          }
        } catch {
          // Ignore background attachment download errors
        }
      }
    }
  }

  // --- Offline-First Data Access Methods ---
  public async getTree(): Promise<FileTreeNode[]> {
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const res = await api.getTree();
        await this.localDb.setMeta('tree', res.tree);
        return res.tree;
      } catch {}
    }
    const cached = await this.localDb.getMeta<FileTreeNode[]>('tree');
    return cached || [];
  }

  public async getNote(path: string): Promise<NoteData> {
    // Check local database first if we have local uncommitted changes
    const localNote = await this.localDb.getNote(path);

    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const serverNote = await api.getNote(path);
        // Only overwrite local cache if local doesn't have an uncommitted outbox mutation
        const outbox = await this.localDb.getOutbox();
        const hasOutbox = outbox.some((m) => m.path === path);
        if (!hasOutbox) {
          await this.localDb.putNote(serverNote);
          return serverNote;
        }
      } catch {}
    }

    if (localNote) return localNote;
    throw new Error(`Notiz nicht gefunden: ${path}`);
  }

  public async saveNote(payload: {
    path: string;
    rawContent?: string;
    body?: string;
    properties?: FrontmatterProperty[];
    baseMtime?: number;
    forceOverwrite?: boolean;
  }): Promise<NoteData> {
    const raw =
      typeof payload.rawContent === 'string'
        ? payload.rawContent
        : serializeMarkdownWithFrontmatter(payload.properties || [], payload.body || '');

    const parsed = parseMarkdownWithFrontmatter(raw);
    const { links, embeds } = extractLinksAndEmbeds(parsed.body);
    const tags = extractTags(parsed.properties, parsed.body);
    const headings = extractHeadings(parsed.body);

    const updatedNote: NoteData = {
      path: payload.path,
      name: payload.path.split('/').pop()?.replace(/\.md$/, '') || payload.path,
      rawContent: raw,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      properties: parsed.properties,
      links,
      embeds,
      tags,
      headings,
      updatedAt: Date.now(),
    };

    // Optimistically update local database
    await this.localDb.putNote(updatedNote);

    // If online, try to persist to server directly
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const saved = await api.saveNote(payload);
        await this.localDb.putNote(saved);
        return saved;
      } catch (err: any) {
        if (err instanceof ApiConflictError) {
          const conflictId = `save-${payload.path}-${Date.now()}`;
          this.activeConflicts.push({
            id: conflictId,
            path: payload.path,
            localBody: payload.body || '',
            localProperties: payload.properties || [],
            localTimestamp: Date.now(),
            serverNote: err.serverNote,
          });
          this.setSyncState('conflict');
          this.notifyConflictListeners();
          throw err;
        }
      }
    }

    // If offline or save failed without 409, queue in Outbox
    const mutation: OutboxMutation = {
      id: `save-${payload.path}-${Date.now()}`,
      type: 'save_note',
      path: payload.path,
      body: payload.body,
      properties: payload.properties,
      baseMtime: payload.baseMtime,
      timestamp: Date.now(),
    };
    await this.localDb.addOutboxMutation(mutation);
    return updatedNote;
  }

  public async resolveAttachmentUrl(target: string, fromNotePath?: string): Promise<string> {
    // Check if we have this attachment cached in IndexedDB
    const cached = await this.localDb.getAttachment(target);
    if (cached && cached.blob) {
      if (!this.blobUrls.has(target)) {
        this.blobUrls.set(target, URL.createObjectURL(cached.blob));
      }
      return this.blobUrls.get(target)!;
    }
    // Fallback to online attachment URL
    return api.getAttachmentUrl(target, fromNotePath);
  }

  // --- Interactive Conflict Resolution ---
  public async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution
  ): Promise<void> {
    const conflict = this.activeConflicts.find((c) => c.id === conflictId);
    if (!conflict) return;

    if (resolution === 'keep_local') {
      // Overwrite server with local version
      await api.saveNote({
        path: conflict.path,
        body: conflict.localBody,
        properties: conflict.localProperties,
        forceOverwrite: true,
      });
      await this.localDb.removeOutboxMutation(conflict.id);
    } else if (resolution === 'keep_server') {
      // Overwrite local DB with server version and drop mutation
      await this.localDb.putNote(conflict.serverNote);
      await this.localDb.removeOutboxMutation(conflict.id);
    } else if (resolution === 'keep_both') {
      // 1. Accept server note for original path
      await this.localDb.putNote(conflict.serverNote);
      await this.localDb.removeOutboxMutation(conflict.id);

      // 2. Create conflict copy for local version
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
      const baseName = conflict.path.replace(/\.md$/, '');
      const conflictPath = `${baseName} (Konflikt ${timeStr}).md`;

      await this.saveNote({
        path: conflictPath,
        body: conflict.localBody,
        properties: conflict.localProperties,
      });
    }

    this.activeConflicts = this.activeConflicts.filter((c) => c.id !== conflictId);
    if (this.activeConflicts.length === 0) {
      this.setSyncState(navigator.onLine ? 'synced' : 'offline');
    }
    this.notifyConflictListeners();
  }

  public async resolveAllConflicts(resolution: ConflictResolution): Promise<void> {
    const list = [...this.activeConflicts];
    for (const c of list) {
      await this.resolveConflict(c.id, resolution);
    }
  }

  public async getStats() {
    return this.localDb.getStats();
  }

  public async clearCache() {
    return this.localDb.clearCache();
  }
}

export const syncEngine = new SyncEngine();
