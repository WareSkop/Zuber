import { api } from '../api';
import {
  decryptBytes,
  getMimeTypeForPath,
  isZencPath,
  toZencPath,
} from './folderCrypto';
import { unlockedFoldersStore } from './unlockedFoldersStore';

/**
 * Resolves a target attachment path relative to `fromNotePath` if it is a relative name
 * (e.g. `photo.png` inside `Secret/note.md.zenc` -> `Secret/photo.png.zenc`).
 */
export function resolveEncryptedAttachmentCandidate(
  target: string,
  fromNotePath?: string
): { zencPath: string; key: CryptoKey } | null {
  const cleanTarget = target.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanTarget) return null;

  const directUnlocked = unlockedFoldersStore.findUnlockedFolderForPath(cleanTarget);
  if (directUnlocked) {
    return { zencPath: toZencPath(cleanTarget), key: directUnlocked.key };
  }

  if (fromNotePath) {
    const cleanNote = fromNotePath.replace(/\\/g, '/');
    const slashIdx = cleanNote.lastIndexOf('/');
    const noteFolder = slashIdx >= 0 ? cleanNote.slice(0, slashIdx) : '';
    if (noteFolder) {
      const relativeCandidate = `${noteFolder}/${cleanTarget}`;
      const relUnlocked = unlockedFoldersStore.findUnlockedFolderForPath(relativeCandidate);
      if (relUnlocked) {
        return { zencPath: toZencPath(relativeCandidate), key: relUnlocked.key };
      }
    }
  }

  if (isZencPath(cleanTarget)) {
    const unlocked = unlockedFoldersStore.findUnlockedFolderForPath(cleanTarget);
    if (unlocked) {
      return { zencPath: cleanTarget, key: unlocked.key };
    }
  }

  return null;
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
  const match = resolveEncryptedAttachmentCandidate(target, fromNotePath);
  if (!match) return null;

  const encryptedBytes = await api.downloadRawFile(match.zencPath);
  const plainBytes = await decryptBytes(encryptedBytes, match.key);
  const mime = getMimeTypeForPath(match.zencPath);
  const blob = new Blob([plainBytes as BlobPart], { type: mime });
  return {
    url: URL.createObjectURL(blob),
    isObjectUrl: true,
  };
}
