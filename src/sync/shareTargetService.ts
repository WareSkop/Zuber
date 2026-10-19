import { api } from '../api';
import { syncEngine } from './syncEngine';

export interface SharedIncomingFile {
  name: string;
  type: string;
  blob: Blob;
}

export interface SharedIncomingPayload {
  id: number;
  title: string;
  text: string;
  url: string;
  files: SharedIncomingFile[];
  timestamp: number;
}

export const SHARE_DB_NAME = 'knowmesh_shared_incoming';
export const SHARE_STORE_NAME = 'knowmesh_shared_incoming';

const memoryShareStore: Map<number, SharedIncomingPayload> = new Map();

export function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB ist in dieser Umgebung nicht verfügbar.'));
      return;
    }
    const req = indexedDB.open(SHARE_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.createObjectStore(SHARE_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Fehler beim Öffnen von knowmesh_shared_incoming'));
  });
}

export async function getIncomingShares(): Promise<SharedIncomingPayload[]> {
  if (typeof indexedDB === 'undefined') {
    return Array.from(memoryShareStore.values());
  }
  try {
    const db = await openShareDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE_NAME, 'readonly');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result as SharedIncomingPayload[]) || []);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('[Knowmesh Share] Could not read incoming shares from IndexedDB, using memory fallback:', err);
    return Array.from(memoryShareStore.values());
  }
}

export async function removeIncomingShare(id: number): Promise<void> {
  memoryShareStore.delete(id);
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openShareDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => {
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('[Knowmesh Share] Could not remove incoming share from IndexedDB:', err);
  }
}

export async function clearAllIncomingShares(): Promise<void> {
  memoryShareStore.clear();
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openShareDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => {
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('[Knowmesh Share] Could not clear incoming shares from IndexedDB:', err);
  }
}

export async function saveIncomingShare(payload: SharedIncomingPayload): Promise<void> {
  memoryShareStore.set(payload.id, payload);
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openShareDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const req = store.put(payload);
      req.onsuccess = () => {
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch (err) {
    console.warn('[Knowmesh Share] Could not write incoming share to IndexedDB:', err);
  }
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'unnamed';
}

export function getUniqueInboxPath(fileName: string, existingPaths: Set<string>): string {
  let cleanName = sanitizeFileName(fileName);
  if (!cleanName.toLowerCase().endsWith('.md')) cleanName += '.md';
  let target = `Inbox/${cleanName}`;
  if (!existingPaths.has(target)) return target;

  const baseWithoutExt = cleanName.replace(/\.md$/i, '');
  const timestamp = Date.now();
  target = `Inbox/${baseWithoutExt}_${timestamp}.md`;
  let counter = 1;
  while (existingPaths.has(target)) {
    target = `Inbox/${baseWithoutExt}_${timestamp}_${counter}.md`;
    counter++;
  }
  return target;
}

export async function readBlobAsText(blob: Blob | any): Promise<string> {
  if (!blob) return '';
  if (typeof blob.text === 'function') {
    try {
      return await blob.text();
    } catch {}
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function saveAttachmentFile(file: SharedIncomingFile, safeName: string): Promise<string> {
  const targetPath = `attachments/${safeName}`;
  try {
    await api.createFolder('attachments');
  } catch {}

  const blob = file.blob instanceof Blob ? file.blob : new Blob([file.blob], { type: file.type });
  const fileObj = new File([blob], safeName, { type: file.type || blob.type || 'application/octet-stream' });

  try {
    const uploadRes = await api.uploadAttachment(fileObj);
    return uploadRes.path || targetPath;
  } catch (err) {
    // If offline or network issue, cache locally in localDb for offline viewing
    try {
      await syncEngine.getLocalDb().putAttachment({
        path: targetPath,
        blob,
        mtime: Date.now(),
        size: blob.size,
      });
    } catch (dbErr) {
      console.warn('[Knowmesh Share] Could not cache attachment in localDb:', dbErr);
    }
    return targetPath;
  }
}

export function cleanShareUrlQuery(): void {
  if (typeof window !== 'undefined' && window.location.search.includes('incoming_share')) {
    const url = new URL(window.location.href);
    url.searchParams.delete('incoming_share');
    const cleanSearch = url.searchParams.toString();
    const cleanUrl = url.pathname + (cleanSearch ? `?${cleanSearch}` : '') + url.hash;
    window.history.replaceState({}, '', cleanUrl || '/');
  }
}

export interface ProcessShareOptions {
  openNote?: (path: string) => Promise<void>;
  existingFiles?: string[];
}

/**
 * Ingest handler for Web Share Target items stored in IndexedDB (knowmesh_shared_incoming).
 * Processes Markdown files, PDFs, images, and plain text/URLs into the Inbox/ directory.
 * Returns the relative path of the last created note (or null if no items were processed).
 */
export async function processIncomingShares(options?: ProcessShareOptions): Promise<string | null> {
  const shares = await getIncomingShares();
  if (shares.length === 0) {
    cleanShareUrlQuery();
    return null;
  }

  // Ensure Inbox folder exists
  try {
    await api.createFolder('Inbox');
  } catch {}

  const existingFilePaths = new Set<string>(options?.existingFiles || []);
  let lastCreatedNotePath: string | null = null;

  for (const item of shares) {
    const title = (item.title || '').trim();
    const text = (item.text || '').trim();
    const url = (item.url || '').trim();
    const files = Array.isArray(item.files) ? item.files : [];

    if (files.length > 0) {
      for (const file of files) {
        const lowerName = (file.name || '').toLowerCase();
        const mimeType = (file.type || '').toLowerCase();

        // Case A: Markdown File (.md, text/markdown) or Plain Text (.txt, text/plain)
        if (
          lowerName.endsWith('.md') ||
          lowerName.endsWith('.markdown') ||
          mimeType === 'text/markdown' ||
          lowerName.endsWith('.txt') ||
          mimeType === 'text/plain'
        ) {
          const mdContent = await readBlobAsText(file.blob);
          const rawBaseName = file.name
            ? file.name.replace(/\.(md|markdown|txt)$/i, '')
            : title || `Note_${Date.now()}`;
          const sanitizedTitle = sanitizeFileName(rawBaseName);
          const targetPath = getUniqueInboxPath(`${sanitizedTitle}.md`, existingFilePaths);

          await api.saveNote({
            path: targetPath,
            body: mdContent,
            properties: [],
          });
          existingFilePaths.add(targetPath);
          lastCreatedNotePath = targetPath;
        }
        // Case B: PDF File (.pdf, application/pdf)
        else if (lowerName.endsWith('.pdf') || mimeType === 'application/pdf') {
          const safePdfName = sanitizeFileName(file.name || `document_${Date.now()}.pdf`);
          await saveAttachmentFile(file, safePdfName);

          const rawTitle = file.name ? file.name.replace(/\.pdf$/i, '').trim() : title || 'Shared PDF';
          const safeNoteBase = sanitizeFileName(rawTitle || `PDF_${Date.now()}`);
          const notePath = getUniqueInboxPath(`${Date.now()}_${safeNoteBase}.md`, existingFilePaths);

          const textSuffix = text ? `\n\n${text}` : '';
          const noteBody = `# ${rawTitle}\n\n![[attachments/${safePdfName}]]${textSuffix}\n`;

          await api.saveNote({
            path: notePath,
            body: noteBody,
            properties: [],
          });
          existingFilePaths.add(notePath);
          lastCreatedNotePath = notePath;
        }
        // Case C: Image shared (image/* or image extensions)
        else if (
          mimeType.startsWith('image/') ||
          /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(lowerName)
        ) {
          const safeImgName = sanitizeFileName(file.name || `image_${Date.now()}.png`);
          await saveAttachmentFile(file, safeImgName);

          const displayTitle = title || 'Shared Image';
          const safeNoteBase = sanitizeFileName(displayTitle);
          const notePath = getUniqueInboxPath(`${Date.now()}_${safeNoteBase}.md`, existingFilePaths);

          const textSuffix = text ? `\n\n${text}` : '';
          const noteBody = `# ${displayTitle}\n\n![[attachments/${safeImgName}]]${textSuffix}\n`;

          await api.saveNote({
            path: notePath,
            body: noteBody,
            properties: [],
          });
          existingFilePaths.add(notePath);
          lastCreatedNotePath = notePath;
        }
        // Other binary / document files
        else {
          const safeFileName = sanitizeFileName(file.name || `file_${Date.now()}`);
          await saveAttachmentFile(file, safeFileName);

          const displayTitle = title || file.name || 'Shared Attachment';
          const safeNoteBase = sanitizeFileName(displayTitle);
          const notePath = getUniqueInboxPath(`${Date.now()}_${safeNoteBase}.md`, existingFilePaths);

          const textSuffix = text ? `\n\n${text}` : '';
          const noteBody = `# ${displayTitle}\n\n![[attachments/${safeFileName}]]${textSuffix}\n`;

          await api.saveNote({
            path: notePath,
            body: noteBody,
            properties: [],
          });
          existingFilePaths.add(notePath);
          lastCreatedNotePath = notePath;
        }
      }
    } else {
      // Case D: Plain Text / URL shared (no binary file)
      const displayTitle = title || 'Shared Note';
      const safeNoteBase = sanitizeFileName(displayTitle);
      const notePath = getUniqueInboxPath(`${Date.now()}_${safeNoteBase}.md`, existingFilePaths);

      const linkPrefix = url ? `[Link](${url})\n\n` : '';
      const noteBody = `# ${displayTitle}\n\n${linkPrefix}${text || ''}\n`;

      await api.saveNote({
        path: notePath,
        body: noteBody,
        properties: [],
      });
      existingFilePaths.add(notePath);
      lastCreatedNotePath = notePath;
    }

    // Remove processed share item from IndexedDB
    await removeIncomingShare(item.id);
  }

  // Clean URL query parameter (?incoming_share=1)
  cleanShareUrlQuery();

  // Open the newly created note if callback provided
  if (lastCreatedNotePath && options?.openNote) {
    try {
      await options.openNote(lastCreatedNotePath);
    } catch (e) {
      console.warn('[Knowmesh Share] Could not open newly created share note:', e);
    }
  }

  return lastCreatedNotePath;
}
