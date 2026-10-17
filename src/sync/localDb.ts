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

  public async addEntryToTree(relPath: string, type: 'file' | 'folder'): Promise<void> {
    try {
      const tree = (await this.getMeta<FileTreeNode[]>('tree')) || [];
      const parts = relPath.split('/').filter(Boolean);
      const updatedTree = insertNodeIntoTree(tree, parts, relPath, type);
      await this.setMeta('tree', updatedTree);

      if (type === 'file') {
        const fileName = relPath.split('/').pop() || relPath;
        const basename = fileName.replace(/\.[^/.]+$/, '');
        const extension = fileName.includes('.') ? fileName.split('.').pop() : 'md';

        const allNotes = (await this.getMeta<{ path: string; name: string; basename: string }[]>('allNotes')) || [];
        if (!allNotes.some((n) => n.path === relPath)) {
          allNotes.push({ path: relPath, name: fileName, basename });
          await this.setMeta('allNotes', allNotes);
        }

        const files = (await this.getMeta<any[]>('files')) || [];
        if (!files.some((f) => f.path === relPath)) {
          files.push({ path: relPath, name: fileName, basename, extension });
          await this.setMeta('files', files);
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

    // 2. Update tree in meta
    try {
      const tree = await this.getMeta<FileTreeNode[]>('tree');
      if (tree) {
        const updateTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
          return nodes.map((node) => {
            let updatedNode = { ...node };
            if (node.path === oldPath) {
              updatedNode.path = newPath;
              updatedNode.name = newPath.split('/').pop() || newPath;
              if (updatedNode.type === 'file' && updatedNode.name.includes('.')) {
                updatedNode.extension = updatedNode.name.split('.').pop();
              }
            } else if (node.path.startsWith(oldPrefix)) {
              updatedNode.path = newPrefix + node.path.slice(oldPrefix.length);
            }
            if (updatedNode.children) {
              updatedNode.children = updateTree(updatedNode.children);
            }
            return updatedNode;
          });
        };
        await this.setMeta('tree', sortTreeNodes(updateTree(tree)));
      }

      // 3. Update allNotes in meta
      const allNotes = await this.getMeta<{ path: string; name: string; basename: string }[]>('allNotes');
      if (allNotes) {
        const updatedNotes = allNotes.map((n) => {
          if (n.path === oldPath) {
            const name = newPath.split('/').pop() || newPath;
            return { path: newPath, name, basename: name.replace(/\.[^/.]+$/, '') };
          } else if (n.path.startsWith(oldPrefix)) {
            const subPath = newPrefix + n.path.slice(oldPrefix.length);
            const name = subPath.split('/').pop() || subPath;
            return { path: subPath, name, basename: name.replace(/\.[^/.]+$/, '') };
          }
          return n;
        });
        await this.setMeta('allNotes', updatedNotes);
      }

      // 4. Update files in meta
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

      // 5. Update folders in meta
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

function insertNodeIntoTree(
  nodes: FileTreeNode[],
  parts: string[],
  fullPath: string,
  type: 'file' | 'folder'
): FileTreeNode[] {
  if (parts.length === 0) return nodes;
  const [currentPart, ...remaining] = parts;
  const isLeaf = remaining.length === 0;

  let existingIndex = nodes.findIndex((n) => n.name === currentPart);

  if (isLeaf) {
    if (existingIndex >= 0) {
      return nodes;
    }
    const newNode: FileTreeNode = {
      name: currentPart,
      path: fullPath,
      type,
      extension: type === 'file' && currentPart.includes('.') ? currentPart.split('.').pop() : undefined,
      children: type === 'folder' ? [] : undefined,
      updatedAt: Date.now(),
    };
    const updated = [...nodes, newNode];
    return sortTreeNodes(updated);
  }

  // Intermediate directory
  let targetFolder: FileTreeNode;
  let nextNodes: FileTreeNode[];

  if (existingIndex >= 0 && nodes[existingIndex].type === 'folder') {
    targetFolder = nodes[existingIndex];
    nextNodes = [...nodes];
  } else {
    const folderPath = fullPath.split('/').slice(0, fullPath.split('/').length - remaining.length).join('/');
    targetFolder = {
      name: currentPart,
      path: folderPath,
      type: 'folder',
      children: [],
      updatedAt: Date.now(),
    };
    nextNodes = [...nodes, targetFolder];
    existingIndex = nextNodes.length - 1;
  }

  const updatedChildren = insertNodeIntoTree(
    targetFolder.children || [],
    remaining,
    fullPath,
    type
  );

  nextNodes[existingIndex] = {
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

