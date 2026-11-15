import { api } from '../api';
import {
  decryptBytes,
  getMimeTypeForPath,
  toZencPath,
} from './folderCrypto';
import { unlockedFoldersStore } from './unlockedFoldersStore';

/**
 * Collects ordered candidate `.zenc` paths inside unlocked encrypted folders for a
 * relative embed target like `photo.png` or `attachments/photo.png`.
 */
export function collectEncryptedAttachmentCandidates(
  target: string,
  fromNotePath?: string
): Array<{ zencPath: string; key: CryptoKey }> {
  const cleanTarget = target.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanTarget) return [];

  const candidates: Array<{ zencPath: string; key: CryptoKey }> = [];
  const seen = new Set<string>();
  const addCandidate = (relPath: string, key: CryptoKey) => {
    const zencPath = toZencPath(relPath.replace(/\\/g, '/').replace(/^\/+/, ''));
    const lower = zencPath.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      candidates.push({ zencPath, key });
    }
  };

  const directUnlocked = unlockedFoldersStore.findUnlockedFolderForPath(cleanTarget);
  if (directUnlocked) {
    addCandidate(cleanTarget, directUnlocked.key);
  }

  if (fromNotePath) {
    const cleanNote = fromNotePath.replace(/\\/g, '/');
    const noteUnlocked = unlockedFoldersStore.findUnlockedFolderForPath(cleanNote);
    const slashIdx = cleanNote.lastIndexOf('/');
    const noteFolder = slashIdx >= 0 ? cleanNote.slice(0, slashIdx) : '';

    if (noteFolder) {
      const relativeCandidate = `${noteFolder}/${cleanTarget}`;
      const relUnlocked = unlockedFoldersStore.findUnlockedFolderForPath(relativeCandidate);
      if (relUnlocked) {
        addCandidate(relativeCandidate, relUnlocked.key);
        if (!cleanTarget.startsWith('attachments/')) {
          addCandidate(`${noteFolder}/attachments/${cleanTarget}`, relUnlocked.key);
        }
      }
    }

    if (noteUnlocked) {
      if (!cleanTarget.startsWith('attachments/')) {
        addCandidate(`${noteUnlocked.folderPath}/attachments/${cleanTarget}`, noteUnlocked.key);
      }
      addCandidate(`${noteUnlocked.folderPath}/${cleanTarget}`, noteUnlocked.key);
    }
  }

  return candidates;
}

/**
 * Resolves the primary `.zenc` candidate for a target inside an unlocked encrypted folder.
 */
export function resolveEncryptedAttachmentCandidate(
  target: string,
  fromNotePath?: string
): { zencPath: string; key: CryptoKey } | null {
  const candidates = collectEncryptedAttachmentCandidates(target, fromNotePath);
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * Fetches and decrypts an attachment inside an unlocked encrypted folder,
 * returning a temporary `blob:` URL (caller must revoke via `URL.revokeObjectURL`).
 * Returns `null` if the attachment is not inside an unlocked encrypted folder.
 */
export async function resolveDecryptedAttachmentUrl(
  target: string,
  fromNotePath?: string
): Promise<{ url: string; isObjectUrl: boolean } | null> {
  const candidates = collectEncryptedAttachmentCandidates(target, fromNotePath);
  if (candidates.length === 0) return null;

  let lastErr: unknown = null;
  for (const match of candidates) {
    try {
      const encryptedBytes = await api.downloadRawFile(match.zencPath);
      const plainBytes = await decryptBytes(encryptedBytes, match.key);
      const mime = getMimeTypeForPath(match.zencPath);
      const blob = new Blob([plainBytes as BlobPart], { type: mime });
      return {
        url: URL.createObjectURL(blob),
        isObjectUrl: true,
      };
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // Try next candidate path only when this candidate returned 404
      if (status && status !== 404) {
        throw err;
      }
    }
  }

  if (lastErr) throw lastErr;
  return null;
}
