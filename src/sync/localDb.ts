import type {
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  NoteData,
} from '../../shared/types';

export interface OutboxMutation {
  id: string;
  type: 'save_note' | 'create_folder' | 'rename' | 'delete' | 'upload_attachment';
  path: string;
  newPath?: string;
  body?: string;
  properties?: FrontmatterProperty[];
  baseMtime?: number; // Der mtime-Stand der Notiz vor der lokalen Bearbeitung
  timestamp: number;
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
    this.dbName = `knowmesh_cache_${profileId.replace(/[^\w-]/g, '_')}`;
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

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error || new Error('Fehler beim Öffnen von IndexedDB'));
      };
    });

    return this.initPromise;
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const req = store.put(note);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async putNotesBatch(notes: NoteData[]): Promise<void> {
    if (notes.length === 0) return;
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      for (const note of notes) {
        store.put(note);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
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
