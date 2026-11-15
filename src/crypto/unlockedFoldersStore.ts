export const AUTO_LOCK_STORAGE_KEY = 'zuber_folder_autolock_minutes';
export const DEFAULT_AUTO_LOCK_MINUTES = 15;

export class FolderLockedError extends Error {
  readonly folderPath: string;
  constructor(folderPath: string) {
    super(`Folder "${folderPath}" is locked.`);
    this.name = 'FolderLockedError';
    this.folderPath = folderPath;
  }
}

export function normalizeFolderPath(folderPath: string): string {
  return folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function getAutoLockMinutes(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_AUTO_LOCK_MINUTES;
  const raw = localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
  if (raw === null) return DEFAULT_AUTO_LOCK_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_AUTO_LOCK_MINUTES;
  return parsed;
}

export function setAutoLockMinutes(minutes: number): void {
  if (typeof localStorage === 'undefined') return;
  const safe = Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : DEFAULT_AUTO_LOCK_MINUTES;
  localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(safe));
  unlockedFoldersStore.refreshAutoLockTimer();
}

type PurgeHandler = (folderPath: string) => void | Promise<void>;

class UnlockedFoldersStore {
  private keys = new Map<string, CryptoKey>();
  private listeners = new Set<() => void>();
  private purgeHandlers = new Set<PurgeHandler>();
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private listenersBound = false;

  constructor() {
    this.bindWindowListeners();
  }

  private bindWindowListeners(): void {
    if (this.listenersBound || typeof window === 'undefined') return;
    this.listenersBound = true;

    const resetActivity = () => {
      if (this.keys.size > 0) {
        this.refreshAutoLockTimer();
      }
    };

    window.addEventListener('pointerdown', resetActivity, { passive: true });
    window.addEventListener('keydown', resetActivity, { passive: true });
    window.addEventListener('touchstart', resetActivity, { passive: true });
    window.addEventListener('beforeunload', () => {
      this.lockAllFolders();
    });
  }

  public registerPurgeHandler(handler: PurgeHandler): () => void {
    this.purgeHandlers.add(handler);
    return () => {
      this.purgeHandlers.delete(handler);
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }

  private triggerPurge(folderPath: string): void {
    for (const handler of this.purgeHandlers) {
      try {
        void handler(folderPath);
      } catch {}
    }
  }

  public refreshAutoLockTimer(): void {
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.keys.size === 0) return;

    const minutes = getAutoLockMinutes();
    if (minutes <= 0) return;

    this.inactivityTimer = setTimeout(() => {
      this.lockAllFolders();
    }, minutes * 60_000);
  }

  public unlockFolder(folderPath: string, key: CryptoKey): void {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) return;
    this.keys.set(normalized, key);
    this.refreshAutoLockTimer();
    this.emit();
  }

  public lockFolder(folderPath: string): void {
    const normalized = normalizeFolderPath(folderPath);
    if (!normalized) return;
    const existed = this.keys.delete(normalized);
    this.triggerPurge(normalized);
    if (this.keys.size === 0 && this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (existed) {
      this.emit();
    }
  }

  public lockAllFolders(): void {
    if (this.keys.size === 0) return;
    const locked = Array.from(this.keys.keys());
    this.keys.clear();
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    for (const folder of locked) {
      this.triggerPurge(folder);
    }
    this.emit();
  }

  public isFolderUnlocked(folderPath: string): boolean {
    return this.keys.has(normalizeFolderPath(folderPath));
  }

  public getFolderKey(folderPath: string): CryptoKey | null {
    return this.keys.get(normalizeFolderPath(folderPath)) ?? null;
  }

  public getUnlockedFolderPaths(): string[] {
    return Array.from(this.keys.keys());
  }

  /**
   * Finds the matching unlocked folder and CryptoKey for a given file path
   * (e.g. `Secret/Sub/note.md.zenc` -> `{ folderPath: 'Secret', key }`).
   */
  public findUnlockedFolderForPath(
    filePath: string
  ): { folderPath: string; key: CryptoKey } | null {
    const normalized = normalizeFolderPath(filePath);
    let bestMatch: { folderPath: string; key: CryptoKey } | null = null;
    for (const [folder, key] of this.keys.entries()) {
      if (normalized === folder || normalized.startsWith(`${folder}/`)) {
        if (!bestMatch || folder.length > bestMatch.folderPath.length) {
          bestMatch = { folderPath: folder, key };
        }
      }
    }
    return bestMatch;
  }
}

export const unlockedFoldersStore = new UnlockedFoldersStore();

/**
 * Given a set of known encrypted folder paths, returns the deepest encrypted
 * folder containing `filePath`, or `null` if the path is not inside an encrypted folder.
 */
export function findEncryptedFolderForPath(
  filePath: string,
  encryptedFolders: Iterable<string>
): string | null {
  const normalized = normalizeFolderPath(filePath);
  let best: string | null = null;
  for (const rawFolder of encryptedFolders) {
    const folder = normalizeFolderPath(rawFolder);
    if (!folder) continue;
    if (normalized === folder || normalized.startsWith(`${folder}/`)) {
      if (!best || folder.length > best.length) {
        best = folder;
      }
    }
  }
  return best;
}
