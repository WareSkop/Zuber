import {
  api,
  rawApi,
  registerOfflineSyncDelegate,
  ApiConflictError,
  ApiHttpError,
  getActiveProfile,
  getBaseUrl,
  getStoredProfiles,
  saveStoredProfiles,
} from '../api';
import { LocalDb, type OutboxMutation, type CachedAttachment, generateMutationId } from './localDb';
import { processIncomingShares, type ProcessShareOptions } from './shareTargetService';
import { clientLogger } from '../utils/logger';
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
  extractCanvasLinksAndTags,
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
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.currentProfile = getActiveProfile();
    this.localDb = new LocalDb(this.currentProfile.id);
    registerOfflineSyncDelegate(this);
    this.init();
  }

  private async init() {
    if (typeof window === 'undefined') return;

    // Load user's chosen offline attachment folders from local DB
    try {
      const savedFolders = await this.localDb.getMeta<string[]>('syncedAttachmentFolders');
      if (savedFolders && Array.isArray(savedFolders)) {
        this.syncedAttachmentFolders = savedFolders;
      }
    } catch {}

    // Monitor browser online/offline events
    window.addEventListener('online', () => {
      this.checkConnectionAndSync();
    });
    window.addEventListener('offline', () => {
      this.setSyncState('offline');
    });

    // Periodic reconnect probe when browser reports online but syncState fell back to offline
    this.reconnectTimer = setInterval(() => {
      if (
        typeof navigator !== 'undefined' &&
        navigator.onLine &&
        this.syncState === 'offline' &&
        !this.isSyncing
      ) {
        this.checkConnectionAndSync().catch(() => {});
      }
    }, 15000);

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

  public getLocalDb(): LocalDb {
    return this.localDb;
  }

  public async hasLocalData(): Promise<boolean> {
    try {
      const notes = await this.localDb.getAllNotes();
      if (notes.length > 0) return true;
      const cachedTree = await this.localDb.getMeta<FileTreeNode[]>('tree');
      return Boolean(cachedTree && cachedTree.length > 0);
    } catch {
      return false;
    }
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

  private isContentIdentical(
    localBody: string,
    localProps: FrontmatterProperty[] = [],
    serverNote: NoteData
  ): boolean {
    const isCanvas = serverNote.path.endsWith('.canvas');
    if (isCanvas) {
      const incomingRaw = (localBody || '').trim();
      const existingRaw = (serverNote.rawContent || serverNote.body || '').trim();
      if (incomingRaw === existingRaw) return true;
      try {
        const parsedIncoming = JSON.parse(incomingRaw);
        const parsedExisting = JSON.parse(existingRaw);
        return JSON.stringify(parsedIncoming) === JSON.stringify(parsedExisting);
      } catch {
        return incomingRaw === existingRaw;
      }
    }

    const normLocal = (localBody || '').replace(/\r\n/g, '\n').trim();
    const normServer = (serverNote.body || '').replace(/\r\n/g, '\n').trim();
    if (normLocal !== normServer) {
      return false;
    }

    // Body is identical! Now check frontmatter properties
    const serializedLocal = serializeMarkdownWithFrontmatter(localProps, '').replace(/\r\n/g, '\n').trim();
    const serializedServer = serializeMarkdownWithFrontmatter(serverNote.properties || [], '').replace(/\r\n/g, '\n').trim();
    if (serializedLocal !== serializedServer) {
      return JSON.stringify(localProps) === JSON.stringify(serverNote.properties || []);
    }

    return true;
  }

  private addOrUpdateConflict(item: ConflictItem): void {
    const existingIndex = this.activeConflicts.findIndex((c) => c.path === item.path);
    if (existingIndex >= 0) {
      this.activeConflicts[existingIndex] = item;
    } else {
      this.activeConflicts.push(item);
    }
    this.setSyncState('conflict');
    this.notifyConflictListeners();
  }

  public async getSyncedFolders(): Promise<string[]> {
    return [...this.syncedAttachmentFolders];
  }

  public async setSyncedFolders(folders: string[]): Promise<void> {
    this.syncedAttachmentFolders = folders;
    await this.localDb.setMeta('syncedAttachmentFolders', folders);
  }

  /**
   * Immediately marks the engine as online after a successful server authentication/login
   * and triggers a background delta sync (including flushing any offline outbox items).
   */
  public notifyAuthenticatedOnline(): void {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setSyncState('offline');
      return;
    }
    if (this.syncState === 'offline') {
      this.setSyncState('online');
    }
    this.syncNow().catch((err) => {
      console.warn('[Knowmesh Sync] Post-auth sync error:', err);
    });
  }

  public async checkConnectionAndSync(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setSyncState('offline');
      return false;
    }

    try {
      const status = await api.checkAuthStatus(3000);
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
          // Always read the latest note data from local IndexedDB so all edits made offline
          // (whether via body, raw editor, or frontmatter) are sent to the server.
          const latestLocalNote = await this.localDb.getNote(m.path);
          const bodyToSend = latestLocalNote ? latestLocalNote.body : (m.body ?? '');
          const propsToSend = latestLocalNote ? latestLocalNote.properties : (m.properties ?? []);
          const rawToSend = latestLocalNote?.rawContent;

          const saved = await rawApi.saveNote({
            path: m.path,
            body: bodyToSend,
            properties: propsToSend,
            rawContent: rawToSend,
            baseMtime: m.baseMtime ?? 0,
            forceOverwrite: false,
          });
          await this.localDb.putNote(saved);
        } else if (m.type === 'create_folder') {
          await rawApi.createFolder(m.path);
        } else if (m.type === 'rename' && m.newPath) {
          await rawApi.renameEntry(m.path, m.newPath);
        } else if (m.type === 'delete') {
          await rawApi.deleteEntry(m.path);
        }

        // Mutation succeeded on server, remove from outbox
        await this.localDb.removeOutboxMutation(m.id);
      } catch (err: any) {
        if (err instanceof ApiConflictError) {
          const latestLocalNote = await this.localDb.getNote(m.path);
          const localBody = latestLocalNote?.body ?? m.body ?? '';
          const localProps = latestLocalNote?.properties ?? m.properties ?? [];

          // 1. Content equality check
          if (this.isContentIdentical(localBody, localProps, err.serverNote)) {
            clientLogger.info('sync', `[Outbox Replay] Content of "${m.path}" is identical to server version. Silently updating local cache and dropping mutation.`);
            await this.localDb.putNote(err.serverNote);
            await this.localDb.removeOutboxMutation(m.id);
            continue;
          }

          // 2. Empty local version protection (avoid wiping server note)
          const trimmedLocal = localBody.trim();
          const trimmedServer = (err.serverNote.body || '').trim();
          if (trimmedLocal === '' && trimmedServer.length > 0 && !m.explicitClear) {
            clientLogger.warn('sync', `[Outbox Replay] Empty local version detected for "${m.path}" while server has content. Suppressing conflict and adopting server version.`);
            await this.localDb.putNote(err.serverNote);
            await this.localDb.removeOutboxMutation(m.id);
            continue;
          }

          // 3. Genuine conflict: deduplicated add/update
          clientLogger.warn('sync', `[Outbox Replay] Conflict on "${m.path}": queuing in ConflictModal.`);
          this.addOrUpdateConflict({
            id: m.id,
            path: m.path,
            localBody,
            localProperties: localProps,
            localTimestamp: m.timestamp,
            serverNote: err.serverNote,
          });
        } else if (err instanceof ApiHttpError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408) {
          // Permanent client-side validation error (e.g., invalid path): remove invalid mutation so it doesn't block queue forever
          console.warn(`[Knowmesh Sync] Dropping non-retryable mutation ${m.id} (HTTP ${err.status}):`, err);
          await this.localDb.removeOutboxMutation(m.id);
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

      const remainingOutbox = await this.localDb.getOutbox();
      const pendingLocalPaths = new Set<string>();
      for (const m of remainingOutbox) {
        if (m.type === 'save_note' && m.path) pendingLocalPaths.add(m.path);
        if (m.type === 'rename' && m.newPath) pendingLocalPaths.add(m.newPath);
      }

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
        if (sEntry.type === 'markdown' && !pendingLocalPaths.has(path)) {
          const lNote = localNoteMap.get(path);
          if (!lNote || sEntry.mtime > lNote.updatedAt) {
            pathsToDownload.push(path);
          }
        }
      }

      // Detect locally cached notes that were deleted on the server (preserve pending local creations!)
      for (const [lPath] of localNoteMap) {
        if (!serverFileMap.has(lPath) && !pendingLocalPaths.has(lPath)) {
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
        const treeData = await rawApi.getTree();
        await this.localDb.setMeta('tree', treeData.tree);
        await this.localDb.setMeta('files', treeData.files);
        if (remainingOutbox.length > 0) {
          await this.localDb.reconcileTreeWithLocalState();
        }
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
    const outbox = await this.localDb.getOutbox();
    const hasOutbox = outbox.length > 0;

    if (!hasOutbox && navigator.onLine && this.syncState !== 'offline') {
      try {
        const res = await rawApi.getTree();
        await this.localDb.setMeta('tree', res.tree);
        await this.localDb.setMeta('files', res.files);
        return res.tree;
      } catch {
        this.setSyncState('offline');
      }
    }
    const reconciled = await this.localDb.reconcileTreeWithLocalState();
    return reconciled.tree;
  }

  public async getTreeData(): Promise<{
    tree: FileTreeNode[];
    files: { path: string; name: string; basename: string; extension: string }[];
    vaultPath: string;
  }> {
    const outbox = await this.localDb.getOutbox();
    const hasOutbox = outbox.length > 0;

    if (!hasOutbox && navigator.onLine && this.syncState !== 'offline') {
      try {
        const res = await rawApi.getTree();
        await this.localDb.setMeta('tree', res.tree);
        await this.localDb.setMeta('files', res.files);
        return res;
      } catch {
        this.setSyncState('offline');
      }
    }

    const reconciled = await this.localDb.reconcileTreeWithLocalState();
    return {
      tree: reconciled.tree,
      files: reconciled.files,
      vaultPath: 'Knowmesh Vault (Offline)',
    };
  }

  public async getNote(path: string): Promise<NoteData> {
    // Check local database first if we have local uncommitted changes
    const localNote = await this.localDb.getNote(path);
    const outbox = await this.localDb.getOutbox();
    const hasOutbox = outbox.some((m) => m.path === path);

    if (hasOutbox && localNote) {
      return localNote;
    }

    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const serverNote = await rawApi.getNote(path);
        if (!hasOutbox) {
          await this.localDb.putNote(serverNote);
          return serverNote;
        }
      } catch {
        this.setSyncState('offline');
      }
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
    explicitClear?: boolean;
  }): Promise<NoteData> {
    const isCanvas = payload.path.endsWith('.canvas');
    const raw =
      typeof payload.rawContent === 'string'
        ? payload.rawContent
        : isCanvas
          ? (payload.body || '{}')
          : serializeMarkdownWithFrontmatter(payload.properties || [], payload.body || '');

    let updatedNote: NoteData;

    if (isCanvas) {
      const { links, tags } = extractCanvasLinksAndTags(raw);
      updatedNote = {
        path: payload.path,
        name: payload.path.split('/').pop()?.replace(/\.canvas$/, '') || payload.path,
        rawContent: raw,
        body: raw,
        frontmatter: {},
        properties: [],
        links,
        embeds: [],
        tags,
        headings: [],
        updatedAt: Date.now(),
      };
    } else {
      const parsed = parseMarkdownWithFrontmatter(raw);
      const { links, embeds } = extractLinksAndEmbeds(parsed.body);
      const tags = extractTags(parsed.properties, parsed.body);
      const headings = extractHeadings(parsed.body);

      updatedNote = {
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
    }

    // Optimistically update local database
    await this.localDb.putNote(updatedNote);
    await this.localDb.addEntryToTree(payload.path, 'file');

    // If online, try to persist to server directly
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const saved = await rawApi.saveNote(payload);
        await this.localDb.putNote(saved);
        return saved;
      } catch (err: any) {
        if (err instanceof ApiConflictError) {
          const localBody = payload.body || '';
          const localProps = payload.properties || [];

          // 1. Content equality check
          if (this.isContentIdentical(localBody, localProps, err.serverNote)) {
            clientLogger.info('sync', `[Direct Save] Content of "${payload.path}" is identical to server version. Silently updating local cache.`);
            await this.localDb.putNote(err.serverNote);
            return err.serverNote;
          }

          // 2. Empty local version protection (avoid wiping server note)
          const trimmedLocal = localBody.trim();
          const trimmedServer = (err.serverNote.body || '').trim();
          if (trimmedLocal === '' && trimmedServer.length > 0 && !payload.explicitClear) {
            clientLogger.warn('sync', `[Direct Save] Empty local version detected for "${payload.path}" while server has content. Suppressing conflict and adopting server version.`);
            await this.localDb.putNote(err.serverNote);
            return err.serverNote;
          }

          // 3. Genuine conflict: deduplicated add/update
          clientLogger.warn('sync', `[Direct Save] Conflict on "${payload.path}": queuing in ConflictModal.`);
          const conflictId = `save-${payload.path}-${Date.now()}`;
          this.addOrUpdateConflict({
            id: conflictId,
            path: payload.path,
            localBody,
            localProperties: localProps,
            localTimestamp: Date.now(),
            serverNote: err.serverNote,
          });
          throw err;
        }
        console.warn(`[Knowmesh Sync] Server unreachable during save, switching to offline outbox:`, err);
        this.setSyncState('offline');
      }
    }

    // If offline or save failed without 409, queue in Outbox
    const mutation: OutboxMutation = {
      id: generateMutationId('save', payload.path),
      type: 'save_note',
      path: payload.path,
      body: updatedNote.body,
      properties: updatedNote.properties,
      baseMtime: payload.baseMtime ?? 0,
      timestamp: Date.now(),
      explicitClear: payload.explicitClear,
    };
    await this.localDb.addOutboxMutation(mutation);
    return updatedNote;
  }

  public async createNote(
    relPath: string,
    body: string = '',
    properties: FrontmatterProperty[] = []
  ): Promise<NoteData> {
    return this.saveNote({
      path: relPath,
      body,
      properties,
    });
  }

  public async createFolder(relPath: string): Promise<{ ok: boolean; path: string }> {
    // 1. Locally insert into tree
    await this.localDb.addEntryToTree(relPath, 'folder');

    // 2. If online, call server API
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const res = await rawApi.createFolder(relPath);
        return res;
      } catch (err: any) {
        console.warn(`[Knowmesh Sync] Server unreachable during createFolder, queueing in outbox:`, err);
        this.setSyncState('offline');
      }
    }

    // 3. Queue in outbox if offline or server unreachable
    const mutation: OutboxMutation = {
      id: generateMutationId('folder', relPath),
      type: 'create_folder',
      path: relPath,
      timestamp: Date.now(),
    };
    await this.localDb.addOutboxMutation(mutation);
    return { ok: true, path: relPath };
  }

  public async renameEntry(oldPath: string, newPath: string): Promise<{ newPath: string }> {
    // 1. Locally rename in DB and tree
    await this.localDb.renameEntryInTree(oldPath, newPath);

    // 2. If online, call server API
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const res = await rawApi.renameEntry(oldPath, newPath);
        return res;
      } catch (err: any) {
        console.warn(`[Knowmesh Sync] Server unreachable during renameEntry, queueing in outbox:`, err);
        this.setSyncState('offline');
      }
    }

    // 3. Queue in outbox
    const mutation: OutboxMutation = {
      id: generateMutationId('rename', oldPath),
      type: 'rename',
      path: oldPath,
      newPath,
      timestamp: Date.now(),
    };
    await this.localDb.addOutboxMutation(mutation);
    return { newPath };
  }

  public async copyEntry(sourcePath: string, targetPath?: string): Promise<{ newPath: string }> {
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        const res = await rawApi.copyEntry(sourcePath, targetPath);
        return res;
      } catch (err: any) {
        this.setSyncState('offline');
      }
    }

    const note = await this.localDb.getNote(sourcePath);
    if (note) {
      const parts = sourcePath.split('/');
      const originalFileName = parts.pop() || '';
      const originalBaseName = originalFileName.replace(/\.md$/, '');
      const folder = targetPath ?? parts.join('/');
      const newName = `${originalBaseName} (Copy).md`;
      const newPath = folder ? `${folder}/${newName}` : newName;

      const saved = await this.saveNote({
        path: newPath,
        rawContent: note.rawContent,
        body: note.body,
        properties: note.properties,
        baseMtime: 0,
      });
      return { newPath: saved.path };
    }
    throw new Error(`Quelle nicht gefunden: ${sourcePath}`);
  }

  public async deleteEntry(relPath: string): Promise<void> {
    // 1. Purge from local IndexedDB immediately
    await this.localDb.deleteEntry(relPath);

    // 2. If online, call server API
    if (navigator.onLine && this.syncState !== 'offline') {
      try {
        await rawApi.deleteEntry(relPath);
        return;
      } catch (err: any) {
        console.warn(`[Knowmesh Sync] Server unreachable during deleteEntry, queueing in outbox:`, err);
        this.setSyncState('offline');
      }
    }

    // 3. If offline or network issue, queue in Outbox
    const mutation: OutboxMutation = {
      id: generateMutationId('delete', relPath),
      type: 'delete',
      path: relPath,
      timestamp: Date.now(),
    };
    await this.localDb.addOutboxMutation(mutation);
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

  public async processIncomingShares(options?: ProcessShareOptions): Promise<string | null> {
    return processIncomingShares(options);
  }
}

export const syncEngine = new SyncEngine();
export { processIncomingShares };

