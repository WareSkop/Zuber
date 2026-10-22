import type {
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  NoteData,
  NoteSummary,
} from '../../shared/types';
import { getAttachmentKind } from '../../shared/markdownUtils';

export interface OutboxMutation {
  id: string;
  type: 'save_note' | 'create_folder' | 'rename' | 'delete' | 'upload_attachment';
  path: string;
  newPath?: string;
  body?: string;
  properties?: FrontmatterProperty[];
  baseMtime?: number; // Der mtime-Stand der Notiz vor der lokalen Bearbeitung
  timestamp: number;
  explicitClear?: boolean;
}

export interface CachedAttachment {
  path: string;
  blob: Blob;
  mtime: number;
  size: number;
}

export class LocalDb {
  private dbName: string;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  constructor(profileId: string = 'default') {
    this.dbName = `zuber_cache_${profileId.replace(/[^\w-]/g, '_')}`;
  }

  private async openDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB ist in dieser Umgebung nicht verfügbar.'));
        return;
      }

      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };

      request.onsuccess = async () => {
        this.db = request.result;
        try {
          const profileId = this.dbName.replace(/^zuber_cache_/, '');
          await this.migrateFromLegacyDb(profileId);
        } catch {}
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error || new Error('Fehler beim Öffnen von IndexedDB'));
      };
    });

    return this.initPromise;
  }

  private async migrateFromLegacyDb(profileId: string): Promise<void> {
    if (!this.db || typeof indexedDB === 'undefined') return;
    const legacyName = `knowmesh_cache_${profileId.replace(/[^\w-]/g, '_')}`;

    const currentNotesCount = await new Promise<number>((res) => {
      try {
        const tx = this.db!.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').count();
        req.onsuccess = () => res(req.result || 0);
        req.onerror = () => res(0);
      } catch {
        res(0);
      }
    });

    if (currentNotesCount > 0) return;

    const legacyDb = await new Promise<IDBDatabase | null>((res) => {
      const openReq = indexedDB.open(legacyName);
      openReq.onsuccess = () => {
        const db = openReq.result;
        if (db.objectStoreNames.length === 0) {
          db.close();
          try { indexedDB.deleteDatabase(legacyName); } catch {}
          res(null);
        } else {
          res(db);
        }
      };
      openReq.onerror = () => res(null);
    });

    if (!legacyDb) return;

    try {
      if (legacyDb.objectStoreNames.contains('meta')) {
        const metaEntries = await new Promise<{ key: string; value: any }[]>((res) => {
          const tx = legacyDb.transaction('meta', 'readonly');
          const store = tx.objectStore('meta');
          const keyReq = store.getAllKeys();
          keyReq.onsuccess = () => {
            const keys = keyReq.result;
            const valReq = store.getAll();
            valReq.onsuccess = () => {
              const vals = valReq.result;
              res(keys.map((k, i) => ({ key: String(k), value: vals[i] })));
            };
            valReq.onerror = () => res([]);
          };
          keyReq.onerror = () => res([]);
        });
        if (metaEntries.length > 0) {
          const tx = this.db.transaction('meta', 'readwrite');
          const store = tx.objectStore('meta');
          for (const { key, value } of metaEntries) {
            store.put(value, key);
          }
        }
      }

      if (legacyDb.objectStoreNames.contains('notes')) {
        const notes = await new Promise<any[]>((res) => {
          const tx = legacyDb.transaction('notes', 'readonly');
          const req = tx.objectStore('notes').getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        });
        if (notes.length > 0) {
          const tx = this.db.transaction('notes', 'readwrite');
          const store = tx.objectStore('notes');
          for (const note of notes) {
            store.put(note);
          }
        }
      }

      if (legacyDb.objectStoreNames.contains('attachments')) {
        const attachments = await new Promise<any[]>((res) => {
          const tx = legacyDb.transaction('attachments', 'readonly');
          const req = tx.objectStore('attachments').getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        });
        if (attachments.length > 0) {
          const tx = this.db.transaction('attachments', 'readwrite');
          const store = tx.objectStore('attachments');
          for (const att of attachments) {
            store.put(att);
          }
        }
      }

      if (legacyDb.objectStoreNames.contains('outbox')) {
        const mutations = await new Promise<any[]>((res) => {
          const tx = legacyDb.transaction('outbox', 'readonly');
          const req = tx.objectStore('outbox').getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        });
        if (mutations.length > 0) {
          const tx = this.db.transaction('outbox', 'readwrite');
          const store = tx.objectStore('outbox');
          for (const m of mutations) {
            store.put(m);
          }
        }
      }
    } finally {
      legacyDb.close();
    }
  }

  // --- Meta Store ---
  public async getMeta<T>(key: string): Promise<T | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  public async setMeta<T>(key: string, value: T): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Notes Store ---
  public async getNote(path: string): Promise<NoteData | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const req = store.get(path);
      req.onsuccess = () => resolve((req.result as NoteData) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllNotes(): Promise<NoteData[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as NoteData[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  public async putNote(note: NoteData): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const req = store.put(note);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    try {
      if (note.path.endsWith('.md')) {
        const allNotes = (await this.getMeta<NoteSummary[]>('allNotes')) || [];
        const name = note.name || note.path.split('/').pop() || '';
        const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
        const summary: NoteSummary = {
          path: note.path,
          name,
          basename: name.replace(/\.md$/i, ''),
          folder,
          frontmatter: note.frontmatter || {},
          tags: note.tags || [],
          mtime: Math.round(note.updatedAt || Date.now()),
          extension: 'md',
          isSendTarget: note.isSendTarget,
          isTemplate: note.isTemplate,
        };
        const idx = allNotes.findIndex((n) => n.path === note.path);
        if (idx >= 0) {
          allNotes[idx] = summary;
        } else {
          allNotes.push(summary);
        }
        await this.setMeta('allNotes', allNotes);
      }
    } catch {}
  }

  public async putNotesBatch(notes: NoteData[]): Promise<void> {
    if (notes.length === 0) return;
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      for (const note of notes) {
        store.put(note);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    try {
      const allNotes = (await this.getMeta<NoteSummary[]>('allNotes')) || [];
      const noteMap = new Map<string, NoteSummary>();
      for (const n of allNotes) {
        noteMap.set(n.path, n);
      }
      for (const note of notes) {
        if (!note.path.endsWith('.md')) continue;
        const name = note.name || note.path.split('/').pop() || '';
        const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '';
        noteMap.set(note.path, {
          path: note.path,
          name,
          basename: name.replace(/\.md$/i, ''),
          folder,
          frontmatter: note.frontmatter || {},
          tags: note.tags || [],
          mtime: Math.round(note.updatedAt || Date.now()),
          extension: 'md',
          isSendTarget: note.isSendTarget,
          isTemplate: note.isTemplate,
        });
      }
      await this.setMeta('allNotes', Array.from(noteMap.values()));
    } catch {}
  }

  public async deleteNote(path: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const req = store.delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteAttachment(path: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const req = store.delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteEntry(relPath: string): Promise<void> {
    const db = await this.openDb();
    const prefix = `${relPath}/`;

    // 1. Delete matching notes (exact match or children)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      store.delete(relPath);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    // 2. Delete matching attachments
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      store.delete(relPath);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    // 3. Update cached tree and allNotes in meta store
    try {
      const tree = await this.getMeta<FileTreeNode[]>('tree');
      if (tree) {
        const filterTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
          return nodes
            .filter((n) => n.path !== relPath && !n.path.startsWith(prefix))
            .map((n) => (n.children ? { ...n, children: filterTree(n.children) } : n));
        };
        await this.setMeta('tree', filterTree(tree));
      }

      const allNotes = await this.getMeta<{ path: string; name: string; basename: string }[]>('allNotes');
      if (allNotes) {
        await this.setMeta(
          'allNotes',
          allNotes.filter((n) => n.path !== relPath && !n.path.startsWith(prefix))
        );
      }

      const files = await this.getMeta<any[]>('files');
      if (files) {
        await this.setMeta(
          'files',
          files.filter((n) => n.path !== relPath && !n.path.startsWith(prefix))
        );
      }

      const folders = await this.getMeta<string[]>('folders');
      if (folders) {
        await this.setMeta(
          'folders',
          folders.filter((p) => p !== relPath && !p.startsWith(prefix))
        );
      }
    } catch {}
  }

  public async addEntryToTree(
    relPath: string,
    type: 'file' | 'folder',
    isSendTarget?: boolean,
    isTemplate?: boolean
  ): Promise<void> {
    try {
      const tree = (await this.getMeta<FileTreeNode[]>('tree')) || [];
      const parts = relPath.split('/').filter(Boolean);
      const updatedTree = insertNodeIntoTree(tree, parts, relPath, type, isSendTarget, isTemplate);
      await this.setMeta('tree', updatedTree);

      if (type === 'file') {
        const fileName = relPath.split('/').pop() || relPath;
        const basename = fileName.replace(/\.[^/.]+$/, '');
        const extension = fileName.includes('.') ? fileName.split('.').pop() : 'md';

        const allNotes =
          (await this.getMeta<NoteSummary[]>('allNotes')) || [];
        const existingNoteIdx = allNotes.findIndex((n) => n.path === relPath);
        const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
        if (existingNoteIdx < 0) {
          allNotes.push({
            path: relPath,
            name: fileName,
            basename,
            folder,
            frontmatter: {},
            tags: [],
            mtime: Date.now(),
            extension: 'md',
            isSendTarget,
            isTemplate,
          });
          await this.setMeta('allNotes', allNotes);
        } else {
          let noteChanged = false;
          if (isSendTarget !== undefined && allNotes[existingNoteIdx].isSendTarget !== isSendTarget) {
            allNotes[existingNoteIdx].isSendTarget = isSendTarget;
            noteChanged = true;
          }
          if (isTemplate !== undefined && allNotes[existingNoteIdx].isTemplate !== isTemplate) {
            allNotes[existingNoteIdx].isTemplate = isTemplate;
            noteChanged = true;
          }
          if (noteChanged) {
            await this.setMeta('allNotes', allNotes);
          }
        }

        const files = (await this.getMeta<any[]>('files')) || [];
        const existingFileIdx = files.findIndex((f) => f.path === relPath);
        if (existingFileIdx < 0) {
          files.push({ path: relPath, name: fileName, basename, extension, isSendTarget, isTemplate });
          await this.setMeta('files', files);
        } else {
          let fileChanged = false;
          if (isSendTarget !== undefined && files[existingFileIdx].isSendTarget !== isSendTarget) {
            files[existingFileIdx].isSendTarget = isSendTarget;
            fileChanged = true;
          }
          if (isTemplate !== undefined && files[existingFileIdx].isTemplate !== isTemplate) {
            files[existingFileIdx].isTemplate = isTemplate;
            fileChanged = true;
          }
          if (fileChanged) {
            await this.setMeta('files', files);
          }
        }
      } else if (type === 'folder') {
        const folders = (await this.getMeta<string[]>('folders')) || [];
        if (!folders.includes(relPath)) {
          folders.push(relPath);
          await this.setMeta('folders', folders);
        }
      }
    } catch {}
  }

  public async updateNodeSendTarget(relPath: string, isSendTarget: boolean): Promise<void> {
    try {
      // 1. Update tree
      const updateTreeRec = (nodes: FileTreeNode[]): FileTreeNode[] =>
        nodes.map((n) => {
          if (n.path === relPath) {
            return { ...n, isSendTarget };
          }
          if (n.children) {
            return { ...n, children: updateTreeRec(n.children) };
          }
          return n;
        });

      const tree = await this.getMeta<FileTreeNode[]>('tree');
      if (tree) {
        await this.setMeta('tree', updateTreeRec(tree));
      }

      // 2. Update files
      const files = await this.getMeta<any[]>('files');
      if (files) {
        const updatedFiles = files.map((f) => (f.path === relPath ? { ...f, isSendTarget } : f));
        await this.setMeta('files', updatedFiles);
      }

      // 3. Update allNotes
      const allNotes = await this.getMeta<any[]>('allNotes');
      if (allNotes) {
        const updatedNotes = allNotes.map((n) => (n.path === relPath ? { ...n, isSendTarget } : n));
        await this.setMeta('allNotes', updatedNotes);
      }

      // 4. Update cached note in notes store
      const note = await this.getNote(relPath);
      if (note) {
        note.isSendTarget = isSendTarget;
        await this.putNote(note);
      }
    } catch (err) {
      console.warn('Failed to update node send target in localDb:', err);
    }
  }

  public async updateNodeTemplate(relPath: string, isTemplate: boolean): Promise<void> {
    try {
      // 1. Update tree
      const updateTreeRec = (nodes: FileTreeNode[]): FileTreeNode[] =>
        nodes.map((n) => {
          if (n.path === relPath) {
            return { ...n, isTemplate };
          }
          if (n.children) {
            return { ...n, children: updateTreeRec(n.children) };
          }
          return n;
        });

      const tree = await this.getMeta<FileTreeNode[]>('tree');
      if (tree) {
        await this.setMeta('tree', updateTreeRec(tree));
      }

      // 2. Update files
      const files = await this.getMeta<any[]>('files');
      if (files) {
        const updatedFiles = files.map((f) => (f.path === relPath ? { ...f, isTemplate } : f));
        await this.setMeta('files', updatedFiles);
      }

      // 3. Update allNotes
      const allNotes = await this.getMeta<any[]>('allNotes');
      if (allNotes) {
        const updatedNotes = allNotes.map((n) => (n.path === relPath ? { ...n, isTemplate } : n));
        await this.setMeta('allNotes', updatedNotes);
      }

      // 4. Update cached note in notes store
      const note = await this.getNote(relPath);
      if (note) {
        note.isTemplate = isTemplate;
        await this.putNote(note);
      }
    } catch (err) {
      console.warn('Failed to update node template in localDb:', err);
    }
  }

  public async renameEntryInTree(oldPath: string, newPath: string): Promise<void> {
    const db = await this.openDb();
    const oldPrefix = `${oldPath}/`;
    const newPrefix = `${newPath}/`;

    // 1. Rename notes in IndexedDB
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const key = cursor.key as string;
          if (key === oldPath) {
            const val = cursor.value;
            val.path = newPath;
            val.name = newPath.split('/').pop()?.replace(/\.md$/, '') || newPath;
            store.delete(key);
            store.put(val);
          } else if (key.startsWith(oldPrefix)) {
            const val = cursor.value;
            val.path = newPrefix + key.slice(oldPrefix.length);
            val.name = val.path.split('/').pop()?.replace(/\.md$/, '') || val.path;
            store.delete(key);
            store.put(val);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    // 2. Rename attachments in IndexedDB
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const key = cursor.key as string;
          if (key === oldPath) {
            const val = cursor.value;
            val.path = newPath;
            val.name = newPath.split('/').pop() || newPath;
            store.delete(key);
            store.put(val);
          } else if (key.startsWith(oldPrefix)) {
            const val = cursor.value;
            val.path = newPrefix + key.slice(oldPrefix.length);
            val.name = val.path.split('/').pop() || val.path;
            store.delete(key);
            store.put(val);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });

    // 3. Update tree in meta
    try {
      const tree = await this.getMeta<FileTreeNode[]>('tree');
      if (tree) {
        await this.setMeta('tree', moveOrRenameNodeInTree(tree, oldPath, newPath));
      }

      // 4. Update allNotes in meta
      const allNotes = await this.getMeta<NoteSummary[]>('allNotes');
      if (allNotes) {
        const updatedNotes = allNotes.map((n) => {
          if (n.path === oldPath) {
            const name = newPath.split('/').pop() || newPath;
            const folder = newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : '';
            return { ...n, path: newPath, name, basename: name.replace(/\.[^/.]+$/, ''), folder };
          } else if (n.path.startsWith(oldPrefix)) {
            const subPath = newPrefix + n.path.slice(oldPrefix.length);
            const name = subPath.split('/').pop() || subPath;
            const folder = subPath.includes('/') ? subPath.slice(0, subPath.lastIndexOf('/')) : '';
            return { ...n, path: subPath, name, basename: name.replace(/\.[^/.]+$/, ''), folder };
          }
          return n;
        });
        await this.setMeta('allNotes', updatedNotes);
      }

      // 5. Update files in meta
      const files = await this.getMeta<any[]>('files');
      if (files) {
        const updatedFiles = files.map((f) => {
          if (f.path === oldPath) {
            const name = newPath.split('/').pop() || newPath;
            const extension = name.includes('.') ? name.split('.').pop() : 'md';
            return { path: newPath, name, basename: name.replace(/\.[^/.]+$/, ''), extension };
          } else if (f.path.startsWith(oldPrefix)) {
            const subPath = newPrefix + f.path.slice(oldPrefix.length);
            const name = subPath.split('/').pop() || subPath;
            const extension = name.includes('.') ? name.split('.').pop() : f.extension;
            return { path: subPath, name, basename: name.replace(/\.[^/.]+$/, ''), extension };
          }
          return f;
        });
        await this.setMeta('files', updatedFiles);
      }

      // 6. Update folders in meta
      const folders = await this.getMeta<string[]>('folders');
      if (folders) {
        const updatedFolders = folders.map((p) => {
          if (p === oldPath) return newPath;
          if (p.startsWith(oldPrefix)) return newPrefix + p.slice(oldPrefix.length);
          return p;
        });
        await this.setMeta('folders', updatedFolders);
      }
    } catch {}
  }

  // --- Attachments Store ---
  public async getAttachment(path: string): Promise<CachedAttachment | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const req = store.get(path);
      req.onsuccess = () => resolve((req.result as CachedAttachment) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  public async putAttachment(att: CachedAttachment): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const req = store.put(att);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllAttachmentKeys(): Promise<string[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const req = store.getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Outbox Store ---
  public async getOutbox(): Promise<OutboxMutation[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as OutboxMutation[]) ?? [];
        list.sort((a, b) => a.timestamp - b.timestamp);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async addOutboxMutation(mutation: OutboxMutation): Promise<void> {
    const db = await this.openDb();
    const existing = await this.getOutbox();
    const duplicate = existing.find(
      (m) => m.type === mutation.type && m.path === mutation.path
    );
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      if (duplicate) {
        store.delete(duplicate.id);
      }
      const req = store.put(mutation);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async removeOutboxMutation(id: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- Statistics & Maintenance ---
  public async getStats(): Promise<{ notesCount: number; attachmentsCount: number; approxBytes: number }> {
    const notes = await this.getAllNotes();
    const attKeys = await this.getAllAttachmentKeys();
    let approxBytes = 0;
    for (const n of notes) {
      approxBytes += (n.rawContent?.length || 0) * 2;
    }
    return {
      notesCount: notes.length,
      attachmentsCount: attKeys.length,
      approxBytes,
    };
  }

  public async reconcileTreeWithLocalState(): Promise<{
    tree: FileTreeNode[];
    files: { path: string; name: string; basename: string; extension: string; isSendTarget?: boolean }[];
  }> {
    const rawTree = (await this.getMeta<FileTreeNode[]>('tree')) || [];
    const rawFiles =
      (await this.getMeta<{ path: string; name: string; basename: string; extension: string; isSendTarget?: boolean }[]>(
        'files'
      )) || [];
    const rawFolders = (await this.getMeta<string[]>('folders')) || [];
    const localNotes = await this.getAllNotes();
    const outbox = await this.getOutbox();

    const deletedPaths = new Set<string>();
    for (const m of outbox) {
      if (m.type === 'delete' && m.path) {
        deletedPaths.add(m.path);
      }
    }

    const isDeleted = (p: string): boolean => {
      if (deletedPaths.has(p)) return true;
      for (const del of deletedPaths) {
        if (p.startsWith(`${del}/`)) return true;
      }
      return false;
    };

    const filterDeleted = (nodes: FileTreeNode[]): FileTreeNode[] =>
      nodes
        .filter((n) => !isDeleted(n.path))
        .map((n) => (n.children ? { ...n, children: filterDeleted(n.children) } : n));

    let currentTree = filterDeleted(rawTree);

    // Ensure all local folders and outbox create_folder mutations are in the tree
    const folderSet = new Set<string>(rawFolders);
    for (const m of outbox) {
      if (m.type === 'create_folder' && m.path) {
        folderSet.add(m.path);
      }
    }
    for (const folderPath of folderSet) {
      if (!folderPath || isDeleted(folderPath)) continue;
      const parts = folderPath.split('/').filter(Boolean);
      currentTree = insertNodeIntoTree(currentTree, parts, folderPath, 'folder');
    }

    // Ensure all local notes and outbox save_note mutations are in the tree and files list
    const localNoteMap = new Map<string, NoteData>();
    for (const n of localNotes) {
      if (n.path) localNoteMap.set(n.path, n);
    }

    const fileMap = new Map<
      string,
      {
        path: string;
        name: string;
        basename: string;
        extension: string;
        folder: string;
        frontmatter: Record<string, any>;
        tags: string[];
        mtime: number;
        isSendTarget?: boolean;
        isTemplate?: boolean;
      }
    >();
    for (const f of rawFiles) {
      if (f?.path && !isDeleted(f.path)) {
        const localNote = localNoteMap.get(f.path);
        const folder = (f as any).folder || (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '');
        fileMap.set(f.path, {
          ...f,
          folder,
          frontmatter: localNote?.frontmatter ?? (f as any).frontmatter ?? {},
          tags: localNote?.tags ?? (f as any).tags ?? [],
          mtime: localNote ? Math.round(localNote.updatedAt || Date.now()) : ((f as any).mtime || (f as any).mtimeMs || 0),
          isSendTarget: localNote?.isSendTarget ?? (f as any).isSendTarget,
          isTemplate: localNote?.isTemplate ?? (f as any).isTemplate,
        });
      }
    }

    const notePaths = new Set<string>();
    for (const n of localNotes) {
      if (n.path && !isDeleted(n.path)) {
        notePaths.add(n.path);
      }
    }
    for (const m of outbox) {
      if (m.type === 'save_note' && m.path && !isDeleted(m.path)) {
        notePaths.add(m.path);
      }
    }

    for (const filePath of notePaths) {
      const localNote = localNoteMap.get(filePath);
      const isSendTarget = localNote?.isSendTarget;
      const isTemplate = localNote?.isTemplate;
      const parts = filePath.split('/').filter(Boolean);
      currentTree = insertNodeIntoTree(currentTree, parts, filePath, 'file', isSendTarget, isTemplate);
      const fileName = filePath.split('/').pop() || filePath;
      const basename = fileName.replace(/\.[^/.]+$/, '');
      const extension = fileName.includes('.') ? fileName.split('.').pop() || 'md' : 'md';
      const folder = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, {
          path: filePath,
          name: fileName,
          basename,
          extension,
          folder,
          frontmatter: localNote?.frontmatter ?? {},
          tags: localNote?.tags ?? [],
          mtime: localNote ? Math.round(localNote.updatedAt || Date.now()) : Date.now(),
          isSendTarget,
          isTemplate,
        });
      } else {
        const existing = fileMap.get(filePath)!;
        if (localNote?.frontmatter) existing.frontmatter = localNote.frontmatter;
        if (localNote?.tags) existing.tags = localNote.tags;
        if (isSendTarget !== undefined) {
          existing.isSendTarget = isSendTarget;
        }
        if (isTemplate !== undefined) {
          existing.isTemplate = isTemplate;
        }
      }
    }

    const updatedFiles = Array.from(fileMap.values());
    await this.setMeta('tree', currentTree);
    await this.setMeta('files', updatedFiles);

    const allNotesSummary: NoteSummary[] = updatedFiles
      .filter((f) => f.extension === 'md')
      .map((f) => ({
        path: f.path,
        name: f.name,
        basename: f.basename,
        folder: f.folder,
        frontmatter: f.frontmatter,
        tags: f.tags,
        mtime: f.mtime,
        extension: 'md',
        isSendTarget: f.isSendTarget,
        isTemplate: f.isTemplate,
      }));
    await this.setMeta('allNotes', allNotesSummary);

    return { tree: currentTree, files: updatedFiles };
  }

  public async clearCache(): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meta', 'notes', 'attachments'], 'readwrite');
      tx.objectStore('meta').clear();
      tx.objectStore('notes').clear();
      tx.objectStore('attachments').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export function moveOrRenameNodeInTree(
  nodes: FileTreeNode[],
  oldPath: string,
  newPath: string
): FileTreeNode[] {
  let extractedNode: FileTreeNode | null = null;

  function extract(list: FileTreeNode[]): FileTreeNode[] {
    const nextList: FileTreeNode[] = [];
    for (const item of list) {
      if (item.path === oldPath) {
        extractedNode = { ...item };
      } else {
        if (item.children) {
          nextList.push({
            ...item,
            children: extract(item.children),
          });
        } else {
          nextList.push(item);
        }
      }
    }
    return nextList;
  }

  const treeWithoutOld = extract(nodes);
  if (!extractedNode) {
    return nodes;
  }

  const oldPrefix = `${oldPath}/`;
  const newPrefix = `${newPath}/`;

  function updateDescendants(node: FileTreeNode): FileTreeNode {
    let p = node.path;
    if (p === oldPath) {
      p = newPath;
    } else if (p.startsWith(oldPrefix)) {
      p = newPrefix + p.slice(oldPrefix.length);
    }
    const nm = p.split('/').pop() || p;
    const ext = node.type === 'file' && nm.includes('.') ? nm.split('.').pop() : node.extension;
    const kind = node.type === 'file' ? getAttachmentKind(p) : undefined;
    return {
      ...node,
      path: p,
      name: nm,
      extension: ext,
      attachmentKind: kind,
      children: node.children ? node.children.map(updateDescendants) : undefined,
    };
  }

  const updatedNode = updateDescendants(extractedNode);

  const destParts = newPath.split('/').filter(Boolean);
  destParts.pop(); // Remove target file/folder name to get parent folder parts

  if (destParts.length === 0) {
    // Placed at root
    return sortTreeNodes([...treeWithoutOld, updatedNode]);
  }

  function insertIntoParent(list: FileTreeNode[], remainingParts: string[], currentAcc: string): FileTreeNode[] {
    const [currentFolder, ...rest] = remainingParts;
    const folderPath = currentAcc ? `${currentAcc}/${currentFolder}` : currentFolder;

    let found = false;
    const result = list.map((item) => {
      if (item.name === currentFolder && item.type === 'folder') {
        found = true;
        if (rest.length === 0) {
          const children = item.children || [];
          return {
            ...item,
            children: sortTreeNodes([...children.filter((c) => c.path !== updatedNode.path), updatedNode]),
          };
        } else {
          return {
            ...item,
            children: insertIntoParent(item.children || [], rest, folderPath),
          };
        }
      }
      return item;
    });

    if (!found) {
      const newFolder: FileTreeNode = {
        name: currentFolder,
        path: folderPath,
        type: 'folder',
        children: rest.length === 0
          ? [updatedNode]
          : insertIntoParent([], rest, folderPath),
        updatedAt: Date.now(),
      };
      return sortTreeNodes([...list, newFolder]);
    }
    return result;
  }

  return sortTreeNodes(insertIntoParent(treeWithoutOld, destParts, ''));
}

export function insertNodeIntoTree(
  nodes: FileTreeNode[],
  parts: string[],
  fullPath: string,
  type: 'file' | 'folder',
  isSendTarget?: boolean,
  isTemplate?: boolean
): FileTreeNode[] {
  if (parts.length === 0) return nodes;
  const [currentPart, ...remaining] = parts;
  const isLeaf = remaining.length === 0;

  if (isLeaf) {
    const existingLeafIdx = nodes.findIndex(
      (n) => n.path === fullPath || (n.name === currentPart && n.type === type)
    );
    if (existingLeafIdx >= 0) {
      let changed = false;
      const updatedNode = { ...nodes[existingLeafIdx] };
      if (isSendTarget !== undefined && updatedNode.isSendTarget !== isSendTarget) {
        updatedNode.isSendTarget = isSendTarget;
        changed = true;
      }
      if (isTemplate !== undefined && updatedNode.isTemplate !== isTemplate) {
        updatedNode.isTemplate = isTemplate;
        changed = true;
      }
      if (changed) {
        const updated = [...nodes];
        updated[existingLeafIdx] = updatedNode;
        return updated;
      }
      return nodes;
    }
    const newNode: FileTreeNode = {
      name: currentPart,
      path: fullPath,
      type,
      extension: type === 'file' && currentPart.includes('.') ? currentPart.split('.').pop() : undefined,
      attachmentKind: type === 'file' ? getAttachmentKind(fullPath) : undefined,
      children: type === 'folder' ? [] : undefined,
      updatedAt: Date.now(),
      isSendTarget,
      isTemplate,
    };
    const updated = [...nodes, newNode];
    return sortTreeNodes(updated);
  }

  // Intermediate directory
  let existingFolderIdx = nodes.findIndex(
    (n) => n.name === currentPart && n.type === 'folder'
  );
  let targetFolder: FileTreeNode;
  let nextNodes: FileTreeNode[];

  if (existingFolderIdx >= 0) {
    targetFolder = nodes[existingFolderIdx];
    nextNodes = [...nodes];
  } else {
    const allParts = fullPath.split('/').filter(Boolean);
    const folderPath = allParts.slice(0, allParts.length - remaining.length).join('/');
    targetFolder = {
      name: currentPart,
      path: folderPath,
      type: 'folder',
      children: [],
      updatedAt: Date.now(),
    };
    nextNodes = [...nodes, targetFolder];
    existingFolderIdx = nextNodes.length - 1;
  }

  const updatedChildren = insertNodeIntoTree(
    targetFolder.children || [],
    remaining,
    fullPath,
    type,
    isSendTarget,
    isTemplate
  );

  nextNodes[existingFolderIdx] = {
    ...targetFolder,
    children: updatedChildren,
  };

  return sortTreeNodes(nextNodes);
}

function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function generateMutationId(type: string, path: string): string {
  const safe = path.replace(/[^\w-]/g, '_');
  const rand = Math.random().toString(36).substring(2, 9);
  return `${type}_${safe}_${Date.now()}_${rand}`;
}


