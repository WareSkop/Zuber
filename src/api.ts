import type {
  AttachmentKind,
  BacklinkItem,
  EmailConfig,
  FileTreeNode,
  FrontmatterProperty,
  GitConfig,
  GitRemoteConfig,
  GitStatusInfo,
  GitFileCommit,
  GitFileHistoryResponse,
  GitFileVersionResponse,
  GraphData,
  ImapConfig,
  NoteData,
  NoteSummary,
  SecuritySettingsResponse,
  SmtpConfig,
  SyncManifestEntry,
  UpdateSecurityRequest,
  UploadResponse,
  VaultProfile,
  LogLevel,
  LogsResponse,
} from '../shared/types';
import { clientLogger } from './utils/logger';
import {
  extractHeadings,
  extractLinksAndEmbeds,
  extractTags,
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';
import {
  LOCK_FILENAME,
  decryptText,
  encryptBytes,
  encryptText,
  getLogicalExtension,
  isZencPath,
  stripZencExt,
  toZencPath,
  type FolderLockMetadata,
} from './crypto/folderCrypto';
import { FolderLockedError, unlockedFoldersStore } from './crypto/unlockedFoldersStore';

const TOKEN_STORAGE_KEY = 'zuber_token';
const ACTIVE_PROFILE_KEY = 'zuber_active_profile_id';
const PROFILES_STORAGE_KEY = 'zuber_vault_profiles';

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function') {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') {
      return localStorage;
    }
  } catch {}
  return null;
}

export function getStoredToken(): string | null {
  const s = getSafeStorage();
  return (
    s?.getItem(TOKEN_STORAGE_KEY) ||
    s?.getItem('knowmesh_token') ||
    s?.getItem('basalt_token') ||
    s?.getItem('obsidian_web_vault_token') ||
    null
  );
}

export function setStoredToken(token: string | null): void {
  const s = getSafeStorage();
  if (!s) return;
  if (token) {
    s.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    s.removeItem(TOKEN_STORAGE_KEY);
    s.removeItem('knowmesh_token');
    s.removeItem('basalt_token');
    s.removeItem('obsidian_web_vault_token');
  }
}

export function getStoredProfiles(): VaultProfile[] {
  try {
    const s = getSafeStorage();
    const raw =
      s?.getItem(PROFILES_STORAGE_KEY) ||
      s?.getItem('knowmesh_vault_profiles') ||
      s?.getItem('basalt_vault_profiles');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [
    {
      id: 'default',
      name: 'Aktueller Server',
      serverUrl: typeof window !== 'undefined' ? window.location.origin : '',
      token: getStoredToken() || undefined,
    },
  ];
}

export function saveStoredProfiles(profiles: VaultProfile[]): void {
  getSafeStorage()?.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function getActiveProfile(): VaultProfile {
  const profiles = getStoredProfiles();
  const s = getSafeStorage();
  const activeId =
    s?.getItem(ACTIVE_PROFILE_KEY) ||
    s?.getItem('knowmesh_active_profile_id') ||
    s?.getItem('basalt_active_profile_id');
  const found = profiles.find((p) => p.id === activeId);
  return found || profiles[0];
}

export function setActiveProfile(profileId: string): void {
  getSafeStorage()?.setItem(ACTIVE_PROFILE_KEY, profileId);
  const profiles = getStoredProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (profile?.token) {
    setStoredToken(profile.token);
  }
}

export function getBaseUrl(): string {
  const active = getActiveProfile();
  if (active && active.serverUrl) {
    return active.serverUrl.replace(/\/+$/, '');
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export class ApiConflictError extends Error {
  public statusCode = 409;
  public serverNote: NoteData;

  constructor(message: string, serverNote: NoteData) {
    super(message);
    this.name = 'ApiConflictError';
    this.serverNote = serverNote;
  }
}

export class ApiHttpError extends Error {
  public status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

const OFFLINE_AUTH_VERIFIER_KEY = 'zuber_offline_auth_verifier';

export async function storeOfflinePasswordHash(password: string): Promise<void> {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) return;
  try {
    const saltBytes = new Uint8Array(16);
    window.crypto.getRandomValues(saltBytes);
    const saltHex = Array.from(saltBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const enc = new TextEncoder();
    const data = enc.encode(`${saltHex}:${password}`);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashBytes = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const record = { salt: saltHex, hash: hashHex, timestamp: Date.now() };
    localStorage.setItem(OFFLINE_AUTH_VERIFIER_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn('[Zuber Auth] Could not store offline password verifier', err);
  }
}

export async function verifyOfflinePassword(password: string): Promise<boolean> {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) return false;
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_VERIFIER_KEY) || localStorage.getItem('knowmesh_offline_auth_verifier');
    if (!raw) return false;
    const { salt, hash } = JSON.parse(raw);
    if (!salt || !hash) return false;

    const enc = new TextEncoder();
    const data = enc.encode(`${salt}:${password}`);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashBytes = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return hashHex === hash;
  } catch {
    return false;
  }
}

export function hasOfflineAuthVerifier(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return Boolean(
    localStorage.getItem(OFFLINE_AUTH_VERIFIER_KEY) ||
    localStorage.getItem('knowmesh_offline_auth_verifier')
  );
}

export function migrateLegacyStorageKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keyMap: Record<string, string[]> = {
      zuber_token: ['knowmesh_token', 'basalt_token', 'obsidian_web_vault_token'],
      zuber_active_profile_id: ['knowmesh_active_profile_id', 'basalt_active_profile_id', 'obsidian_active_profile_id'],
      zuber_vault_profiles: ['knowmesh_vault_profiles', 'basalt_vault_profiles', 'obsidian_vault_profiles'],
      zuber_offline_auth_verifier: ['knowmesh_offline_auth_verifier'],
      zuber_open_tabs: ['knowmesh_open_tabs', 'obsidian_web_open_tabs', 'basalt_open_tabs'],
      zuber_theme: ['knowmesh_theme', 'basalt_theme', 'obsidian_theme'],
      zuber_language: ['knowmesh_language'],
      zuber_sidebar_widths: ['knowmesh_sidebar_widths'],
      zuber_graph_settings: ['knowmesh_graph_settings', 'basalt_graph_settings'],
      zuber_font_settings: ['knowmesh_font_settings'],
      zuber_show_favorites_panel: ['knowmesh_show_favorites_panel'],
      zuber_show_recent_panel: ['knowmesh_show_recent_panel'],
      zuber_favorites: ['knowmesh_favorites'],
      zuber_recent_notes: ['knowmesh_recent_notes'],
      zuber_canvas_grid: ['knowmesh_canvas_grid'],
      zuber_startup_config: ['knowmesh_startup_config'],
      zuber_last_active_note: ['knowmesh_last_active_note'],
      zuber_log_level: ['knowmesh_log_level'],
    };

    for (const [newKey, oldKeys] of Object.entries(keyMap)) {
      if (!localStorage.getItem(newKey)) {
        for (const oldKey of oldKeys) {
          const val = localStorage.getItem(oldKey);
          if (val !== null) {
            localStorage.setItem(newKey, val);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Zuber] Legacy storage key migration error:', err);
  }
}

if (typeof window !== 'undefined') {
  migrateLegacyStorageKeys();
}

let serverClockOffset = 0;

export function getServerClockOffset(): number {
  return serverClockOffset;
}

export function setServerClockOffset(offset: number): void {
  serverClockOffset = offset;
}

export function toNormalizedServerTime(clientTimestamp: number): number {
  return clientTimestamp + serverClockOffset;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs: customTimeoutMs, ...fetchOptions } = options;
  const token = getStoredToken();
  const headers = new Headers(fetchOptions.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(fetchOptions.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const baseUrl = getBaseUrl();
  const fullUrl = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

  // Default timeout of 6s for normal requests; 120s for file uploads, archive imports, and remote Git sync
  const isLongRunning =
    fetchOptions.body instanceof FormData ||
    path.includes('/api/vault/upload') ||
    path.includes('/api/vault/import') ||
    path.includes('/api/vault/git/');
  const defaultTimeoutMs = customTimeoutMs ?? (isLongRunning ? 120000 : 6000);

  let timeoutId: any;
  let signal = fetchOptions.signal;
  if (!signal) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), defaultTimeoutMs);
    signal = controller.signal;
  }

  try {
    const res = await fetch(fullUrl, {
      ...fetchOptions,
      headers,
      credentials: 'include',
      signal,
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      let serverNote: NoteData | undefined;
      try {
        const data = await res.json();
        if (data.error) errMsg = data.error;
        if (data.serverNote) serverNote = data.serverNote;
      } catch {}

      if (res.status === 409 && serverNote) {
        throw new ApiConflictError(errMsg || 'Konflikt beim Speichern', serverNote);
      }
      throw new ApiHttpError(errMsg, res.status);
    }

    const serverTimeHeader = res.headers.get('x-server-time');
    if (serverTimeHeader) {
      const st = Number(serverTimeHeader);
      if (!isNaN(st) && st > 0) {
        serverClockOffset = st - Date.now();
      }
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        path.includes('/api/email/')
          ? 'Request timed out while waiting for mail server response.'
          : 'Request timed out while waiting for server response.'
      );
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        path.includes('/api/email/')
          ? 'Request timed out while waiting for mail server response.'
          : 'Request timed out while waiting for server response.'
      );
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export interface OfflineSyncDelegate {
  getTreeData?(): Promise<{
    tree: FileTreeNode[];
    files: { path: string; name: string; basename: string; extension: string; isSendTarget?: boolean }[];
    vaultPath: string;
  }>;
  getNote?(path: string): Promise<NoteData>;
  saveNote(payload: {
    path: string;
    rawContent?: string;
    body?: string;
    properties?: FrontmatterProperty[];
    baseMtime?: number;
    forceOverwrite?: boolean;
    explicitClear?: boolean;
  }): Promise<NoteData>;
  createFolder(path: string): Promise<{ ok: boolean; path: string }>;
  renameEntry?(oldPath: string, newPath: string): Promise<{ newPath: string }>;
  moveBatch?(moves: Array<{ oldPath: string; newPath: string }>): Promise<{ ok: boolean; results: Array<{ oldPath: string; newPath: string }> }>;
  deleteEntry?(path: string): Promise<{ ok: boolean } | void>;
  copyEntry?(sourcePath: string, targetPath?: string): Promise<{ newPath: string }>;
}

let offlineSyncDelegate: OfflineSyncDelegate | null = null;

export function registerOfflineSyncDelegate(delegate: OfflineSyncDelegate | null) {
  offlineSyncDelegate = delegate;
}

export const rawApi = {
  getTree(): Promise<{
    tree: FileTreeNode[];
    files: any[];
    notes?: NoteSummary[];
    vaultPath: string;
  }> {
    return apiFetch('/api/vault/tree');
  },

  getVaultOverview(): Promise<{
    tree: FileTreeNode[];
    files: any[];
    notes: NoteSummary[];
  }> {
    return apiFetch('/api/vault/overview');
  },

  async getNote(path: string): Promise<NoteData> {
    const unlocked = unlockedFoldersStore.findUnlockedFolderForPath(path);
    if (isZencPath(path) || unlocked) {
      if (!unlocked) {
        const folderGuess = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : path;
        throw new FolderLockedError(folderGuess);
      }
      const zencPath = toZencPath(path);
      const rawBytes = await rawApi.downloadRawFile(zencPath);
      const plainText = await decryptText(rawBytes, unlocked.key);
      const logicalPath = stripZencExt(zencPath);
      const ext = getLogicalExtension(zencPath);
      const name = (logicalPath.split('/').pop() || logicalPath).replace(/\.(md|canvas|base)$/i, '');
      const now = Date.now();
      if (ext === 'canvas' || ext === 'base') {
        return {
          path: zencPath,
          name,
          frontmatter: {},
          properties: [],
          body: plainText,
          rawContent: plainText,
          tags: [],
          links: [],
          embeds: [],
          headings: [],
          updatedAt: now,
        };
      }
      const { frontmatter, properties, body } = parseMarkdownWithFrontmatter(plainText);
      const { links, embeds } = extractLinksAndEmbeds(body);
      const tags = extractTags(properties, body);
      const headings = extractHeadings(body);
      return {
        path: zencPath,
        name,
        frontmatter,
        properties,
        body,
        rawContent: plainText,
        tags,
        links,
        embeds,
        headings,
        updatedAt: now,
      };
    }
    return apiFetch(`/api/vault/note?path=${encodeURIComponent(path)}`);
  },

  async saveNote(payload: {
    path: string;
    rawContent?: string;
    body?: string;
    properties?: FrontmatterProperty[];
    baseMtime?: number;
    forceOverwrite?: boolean;
    explicitClear?: boolean;
  }): Promise<NoteData> {
    const unlocked = unlockedFoldersStore.findUnlockedFolderForPath(payload.path);
    if (isZencPath(payload.path) || unlocked) {
      if (!unlocked) {
        const folderGuess = payload.path.includes('/')
          ? payload.path.slice(0, payload.path.lastIndexOf('/'))
          : payload.path;
        throw new FolderLockedError(folderGuess);
      }
      const logicalBase = stripZencExt(payload.path);
      const hasKnownExt = /\.(md|canvas|base)$/i.test(logicalBase);
      const logicalPath = hasKnownExt ? logicalBase : `${logicalBase}.md`;
      const zencPath = toZencPath(logicalPath);
      const ext = getLogicalExtension(zencPath);

      const raw = payload.rawContent;
      const finalRaw =
        typeof raw === 'string'
          ? raw
          : ext === 'canvas' || ext === 'base'
            ? (payload.body ?? '')
            : serializeMarkdownWithFrontmatter(payload.properties ?? [], payload.body ?? '');

      const encrypted = await encryptText(finalRaw, unlocked.key);
      const slashIdx = zencPath.lastIndexOf('/');
      const folder = slashIdx >= 0 ? zencPath.slice(0, slashIdx) : '';
      const fileName = slashIdx >= 0 ? zencPath.slice(slashIdx + 1) : zencPath;
      await rawApi.uploadRawFile(folder, fileName, encrypted);

      const name = (logicalPath.split('/').pop() || logicalPath).replace(/\.(md|canvas|base)$/i, '');
      const now = Date.now();
      if (ext === 'canvas' || ext === 'base') {
        return {
          path: zencPath,
          name,
          frontmatter: {},
          properties: [],
          body: finalRaw,
          rawContent: finalRaw,
          tags: [],
          links: [],
          embeds: [],
          headings: [],
          updatedAt: now,
        };
      }
      const { frontmatter, properties, body } = parseMarkdownWithFrontmatter(finalRaw);
      const { links, embeds } = extractLinksAndEmbeds(body);
      const tags = extractTags(properties, body);
      const headings = extractHeadings(body);
      return {
        path: zencPath,
        name,
        frontmatter,
        properties,
        body,
        rawContent: finalRaw,
        tags,
        links,
        embeds,
        headings,
        updatedAt: now,
      };
    }

    return apiFetch('/api/vault/note', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 20000,
    });
  },

  async downloadRawFile(filePath: string): Promise<Uint8Array> {
    const token = getStoredToken();
    const params = new URLSearchParams({ target: filePath });
    if (token) params.set('token', token);
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${getBaseUrl()}/api/vault/attachment?${params.toString()}`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) {
      throw new ApiHttpError(`Download failed (${res.status}): ${filePath}`, res.status);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  async uploadRawFile(
    folder: string,
    fileName: string,
    data: Uint8Array | Blob
  ): Promise<UploadResponse> {
    const formData = new FormData();
    const blob =
      data instanceof Blob
        ? data
        : new Blob([data as BlobPart], { type: 'application/octet-stream' });
    formData.append('file', blob, fileName);
    const params = new URLSearchParams({ folder, exactName: '1' });
    return apiFetch<UploadResponse>(`/api/vault/upload?${params.toString()}`, {
      method: 'POST',
      body: formData,
    });
  },

  async getFolderLockMetadata(folderPath: string): Promise<FolderLockMetadata> {
    const clean = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return apiFetch<FolderLockMetadata>(
      `/api/vault/folder-lock?folder=${encodeURIComponent(clean)}`
    );
  },

  saveFolderLockMetadata(
    folderPath: string,
    metadata: FolderLockMetadata
  ): Promise<{ ok: boolean; path: string }> {
    const clean = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return apiFetch<{ ok: boolean; path: string }>('/api/vault/folder-lock', {
      method: 'POST',
      body: JSON.stringify({ folder: clean, metadata }),
    });
  },

  createFolder(path: string): Promise<{ ok: boolean; path: string }> {
    return apiFetch('/api/vault/folder', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  renameEntry(oldPath: string, newPath: string): Promise<{ newPath: string }> {
    return apiFetch('/api/vault/rename', {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    });
  },

  moveBatch(moves: Array<{ oldPath: string; newPath: string }>): Promise<{ ok: boolean; results: Array<{ oldPath: string; newPath: string }> }> {
    return apiFetch('/api/vault/move-batch', {
      method: 'POST',
      body: JSON.stringify({ moves }),
    });
  },

  copyEntry(sourcePath: string, targetPath?: string): Promise<{ newPath: string }> {
    return apiFetch('/api/vault/copy', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, targetPath }),
    });
  },

  deleteEntry(path: string): Promise<{ ok: boolean }> {
    return apiFetch(`/api/vault/entry?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  },
};

export const api = {
  checkAuthStatus(timeoutMs = 3000): Promise<{ authenticated: boolean; authRequired?: boolean; https: boolean; vaultPath: string; serverTime?: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return apiFetch<{ authenticated: boolean; authRequired?: boolean; https: boolean; vaultPath: string; serverTime?: number }>(
      '/api/auth/status',
      { signal: controller.signal }
    )
      .then((data) => {
        if (typeof data.serverTime === 'number') {
          serverClockOffset = data.serverTime - Date.now();
        }
        return data;
      })
      .finally(() => clearTimeout(timeoutId));
  },

  async login(password: string): Promise<{ authenticated: boolean; token: string; offline?: boolean }> {
    try {
      const res = await apiFetch<{ authenticated: boolean; token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (res.token) {
        setStoredToken(res.token);
        const active = getActiveProfile();
        if (active) {
          const profiles = getStoredProfiles().map((p) =>
            p.id === active.id ? { ...p, token: res.token } : p
          );
          saveStoredProfiles(profiles);
        }
      }
      await storeOfflinePasswordHash(password);
      return res;
    } catch (err: any) {
      if (err instanceof ApiHttpError || (err.status && err.status >= 400 && err.status < 500)) {
        throw err;
      }
      // Network error or offline
      const isValid = await verifyOfflinePassword(password);
      if (isValid) {
        const token = getStoredToken() || 'zuber_offline_session_token';
        setStoredToken(token);
        return { authenticated: true, token, offline: true };
      }
      if (!hasOfflineAuthVerifier()) {
        throw new Error('Keine Verbindung zum Zuber-Server. Für die allererste Anmeldung wird eine Internetverbindung benötigt.');
      }
      throw new Error('Ungültiges Passwort (Offline-Prüfung).');
    }
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({ revokeAll: false }) });
    } catch {
      // Offline logout succeeds locally
    } finally {
      setStoredToken(null);
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          await caches.delete('knowmesh-attachments-v1');
          await caches.delete('zuber-attachments-v1');
        } catch {}
      }
    }
  },

  getSecuritySettings(): Promise<SecuritySettingsResponse> {
    return apiFetch('/api/settings/security');
  },

  updateSecuritySettings(req: UpdateSecurityRequest): Promise<{ ok: boolean; authEnabled: boolean; token?: string }> {
    return apiFetch('/api/settings/security', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  getSyncManifest(): Promise<SyncManifestEntry[]> {
    return apiFetch('/api/vault/sync-manifest');
  },

  getNotesBatch(paths: string[]): Promise<{ notes: NoteData[] }> {
    return apiFetch('/api/vault/notes-batch', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    });
  },

  getTree(): Promise<{
    tree: FileTreeNode[];
    files: any[];
    notes?: NoteSummary[];
    vaultPath: string;
  }> {
    if (offlineSyncDelegate?.getTreeData && typeof navigator !== 'undefined' && !navigator.onLine) {
      return offlineSyncDelegate.getTreeData();
    }
    return rawApi.getTree();
  },

  getVaultOverview(): Promise<{
    tree: FileTreeNode[];
    files: any[];
    notes: NoteSummary[];
  }> {
    return rawApi.getVaultOverview();
  },

  getNote(path: string): Promise<NoteData> {
    if (offlineSyncDelegate?.getNote) {
      return offlineSyncDelegate.getNote(path);
    }
    return rawApi.getNote(path);
  },

  saveNote(payload: {
    path: string;
    rawContent?: string;
    body?: string;
    properties?: FrontmatterProperty[];
    baseMtime?: number;
    forceOverwrite?: boolean;
    explicitClear?: boolean;
  }): Promise<NoteData> {
    if (offlineSyncDelegate) {
      return offlineSyncDelegate.saveNote(payload);
    }
    return rawApi.saveNote(payload);
  },

  createFolder(path: string): Promise<{ ok: boolean; path: string }> {
    if (offlineSyncDelegate) {
      return offlineSyncDelegate.createFolder(path);
    }
    return rawApi.createFolder(path);
  },

  renameEntry(oldPath: string, newPath: string): Promise<{ newPath: string }> {
    if (offlineSyncDelegate?.renameEntry) {
      return offlineSyncDelegate.renameEntry(oldPath, newPath);
    }
    return rawApi.renameEntry(oldPath, newPath);
  },

  moveBatch(moves: Array<{ oldPath: string; newPath: string }>): Promise<{ ok: boolean; results: Array<{ oldPath: string; newPath: string }> }> {
    if (offlineSyncDelegate?.moveBatch) {
      return offlineSyncDelegate.moveBatch(moves);
    }
    return rawApi.moveBatch(moves);
  },

  copyEntry(sourcePath: string, targetPath?: string): Promise<{ newPath: string }> {
    if (offlineSyncDelegate?.copyEntry) {
      return offlineSyncDelegate.copyEntry(sourcePath, targetPath);
    }
    return rawApi.copyEntry(sourcePath, targetPath);
  },

  async deleteEntry(path: string): Promise<{ ok: boolean }> {
    if (offlineSyncDelegate?.deleteEntry) {
      await offlineSyncDelegate.deleteEntry(path);
      return { ok: true };
    }
    return rawApi.deleteEntry(path);
  },

  getGraph(): Promise<GraphData> {
    return apiFetch('/api/vault/graph');
  },

  getBacklinks(path: string): Promise<{ linked: BacklinkItem[]; unlinked: BacklinkItem[] }> {
    return apiFetch(`/api/vault/backlinks?path=${encodeURIComponent(path)}`);
  },

  search(
    q: string,
    tag?: string,
    sort: 'relevance' | 'newest' = 'relevance'
  ): Promise<{
    results: {
      path: string;
      name: string;
      matches: { line: number; text: string }[];
      tags: string[];
      score?: number;
      mtime?: number;
    }[];
  }> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (sort) params.set('sort', sort);
    return apiFetch(`/api/vault/search?${params.toString()}`);
  },

  resolveWikiLink(
    target: string,
    fromNotePath?: string
  ): Promise<{ target: string; resolvedPath: string | null; path?: string | null; exists?: boolean; kind?: AttachmentKind }> {
    const params = new URLSearchParams({ target });
    if (fromNotePath) params.set('from', fromNotePath);
    return apiFetch(`/api/vault/resolve?${params.toString()}`);
  },

  getAttachmentUrl(target: string, fromNotePath?: string): string {
    const token = getStoredToken();
    const params = new URLSearchParams({ target });
    if (fromNotePath) params.set('from', fromNotePath);
    if (token) params.set('token', token);
    const baseUrl = getBaseUrl();
    return `${baseUrl}/api/vault/attachment?${params.toString()}`;
  },

  async uploadAttachment(
    file: File,
    targetFolder = 'attachments',
    activeNotePath?: string
  ): Promise<UploadResponse> {
    let effectiveFolder = targetFolder;
    if (effectiveFolder === 'attachments' && activeNotePath) {
      const activeUnlocked = unlockedFoldersStore.findUnlockedFolderForPath(activeNotePath);
      if (activeUnlocked) {
        effectiveFolder = `${activeUnlocked.folderPath}/attachments`;
      }
    }

    const unlocked = unlockedFoldersStore.findUnlockedFolderForPath(effectiveFolder);
    if (unlocked) {
      const plainBytes = new Uint8Array(await file.arrayBuffer());
      const encrypted = await encryptBytes(plainBytes, unlocked.key);
      const rawName = (file.name || 'image.png').replace(/[\\/\0]/g, '_');
      const dotIdx = rawName.lastIndexOf('.');
      const rawExt = dotIdx >= 0 ? rawName.slice(dotIdx) : '';
      let ext = rawExt;
      if (!ext && file.type) {
        if (file.type === 'image/png') ext = '.png';
        else if (file.type === 'image/jpeg' || file.type === 'image/jpg') ext = '.jpg';
        else if (file.type === 'image/gif') ext = '.gif';
        else if (file.type === 'image/webp') ext = '.webp';
        else if (file.type === 'image/svg+xml') ext = '.svg';
        else if (file.type === 'application/pdf') ext = '.pdf';
        else ext = '.png';
      }
      let base = (dotIdx >= 0 ? rawName.slice(0, dotIdx) : rawName).replace(/[^\w.-]/g, '_');
      if (!base || base === 'blob') base = 'pasted-image';
      const uniqueLogicalName = `${base}-${Date.now()}${ext || '.png'}`;
      const zencName = toZencPath(uniqueLogicalName);
      const res = await rawApi.uploadRawFile(effectiveFolder, zencName, encrypted);
      return {
        ...res,
        name: uniqueLogicalName,
        wikiEmbed: `![[${uniqueLogicalName}]]`,
      };
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', effectiveFolder);
    const res = await apiFetch<UploadResponse>(
      `/api/vault/upload?folder=${encodeURIComponent(effectiveFolder)}`,
      {
        method: 'POST',
        body: formData,
      }
    );
    return {
      ...res,
      wikiEmbed: res.wikiEmbed || (res.path ? `![[${res.path}]]` : `![[${res.name}]]`),
    };
  },

  downloadRawFile(filePath: string): Promise<Uint8Array> {
    return rawApi.downloadRawFile(filePath);
  },

  uploadRawFile(folder: string, fileName: string, data: Uint8Array | Blob): Promise<UploadResponse> {
    return rawApi.uploadRawFile(folder, fileName, data);
  },

  getFolderLockMetadata(folderPath: string): Promise<FolderLockMetadata> {
    return rawApi.getFolderLockMetadata(folderPath);
  },

  saveFolderLockMetadata(
    folderPath: string,
    metadata: FolderLockMetadata
  ): Promise<{ ok: boolean; path: string }> {
    return rawApi.saveFolderLockMetadata(folderPath, metadata);
  },

  getGitStatus(): Promise<GitStatusInfo> {
    return apiFetch('/api/vault/git/status');
  },

  getGitConfig(): Promise<GitConfig> {
    return apiFetch('/api/vault/git/config');
  },

  saveGitConfig(config: Partial<GitConfig>): Promise<GitConfig> {
    return apiFetch('/api/vault/git/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  commitGit(payload?: { reason?: string }): Promise<{ committed: boolean; commitHash?: string; message?: string }> {
    return apiFetch('/api/vault/git/commit', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  testGitRemote(remote?: Partial<GitRemoteConfig>): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/vault/git/test-remote', {
      method: 'POST',
      body: JSON.stringify({ remote }),
    });
  },

  pushGit(): Promise<{ success: boolean; message: string }> {
    return apiFetch('/api/vault/git/push', {
      method: 'POST',
    });
  },

  getFileGitHistory(path: string): Promise<GitFileHistoryResponse> {
    return apiFetch(`/api/vault/git/file-history?path=${encodeURIComponent(path)}`);
  },

  getFileGitVersion(path: string, hash: string): Promise<GitFileVersionResponse> {
    return apiFetch(`/api/vault/git/file-version?path=${encodeURIComponent(path)}&hash=${encodeURIComponent(hash)}`);
  },

  restoreFileGitVersion(path: string, hash: string): Promise<{ ok: boolean; note: NoteData }> {
    return apiFetch('/api/vault/git/file-restore', {
      method: 'POST',
      body: JSON.stringify({ path, hash }),
    });
  },

  async uploadEntries(
    targetFolder: string,
    files: File[],
    relativePaths?: string[]
  ): Promise<{ success: boolean; count: number; paths: string[] }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine && offlineSyncDelegate) {
      let count = 0;
      const uploadedPaths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const rel = relativePaths?.[i] || file.name;
        if (rel.endsWith('.md') || rel.endsWith('.canvas')) {
          const fullRel = targetFolder ? `${targetFolder}/${rel}`.replace(/\/+/g, '/') : rel;
          const text = await file.text();
          await offlineSyncDelegate.saveNote({
            path: fullRel,
            rawContent: text,
          });
          count++;
          uploadedPaths.push(fullRel);
        }
      }
      if (count > 0) {
        return { success: true, count, paths: uploadedPaths };
      }
      throw new Error('Offline: Nur .md und .canvas Dateien können offline importiert werden.');
    }

    const formData = new FormData();
    formData.append('targetFolder', targetFolder || '');
    for (const file of files) {
      formData.append('files', file);
    }
    if (relativePaths && relativePaths.length > 0) {
      formData.append('paths', JSON.stringify(relativePaths));
    }

    const token = getStoredToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const baseUrl = getBaseUrl();
    const res = await fetch(`${baseUrl}/api/vault/upload-entries`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data.error) errMsg = data.error;
      } catch {}
      throw new Error(errMsg);
    }

    return res.json();
  },

  async downloadEntry(path: string, isDirectory = false): Promise<void> {
    const token = getStoredToken();
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/api/vault/download?path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    try {
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const res = await fetch(url, { headers, credentials: 'include' });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data.error) errMsg = data.error;
        } catch {}
        throw new Error(errMsg);
      }

      let filename = path.split('/').pop() || (isDirectory ? 'vault.zip' : 'file');
      if (isDirectory && !filename.endsWith('.zip')) {
        filename = `${filename || 'vault'}.zip`;
      }
      const disposition = res.headers.get('Content-Disposition');
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      if (!isDirectory && (path.endsWith('.md') || path.endsWith('.canvas') || path.endsWith('.base')) && offlineSyncDelegate?.getNote) {
        try {
          const note = await offlineSyncDelegate.getNote(path);
          if (note && note.rawContent !== undefined) {
            const content = note.rawContent;
            const mimeType = path.endsWith('.canvas')
              ? 'application/json;charset=utf-8'
              : path.endsWith('.base')
                ? 'text/yaml;charset=utf-8'
                : 'text/markdown;charset=utf-8';
            const blob = new Blob([content], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = path.split('/').pop() || 'note.md';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
            return;
          }
        } catch {}
      }
      throw err;
    }
  },

  async downloadBatch(paths: string[]): Promise<void> {
    if (!paths || paths.length === 0) return;
    const token = getStoredToken();
    const baseUrl = getBaseUrl();
    const headers = new Headers({
      'Content-Type': 'application/json',
    });
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`${baseUrl}/api/vault/download-batch`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ paths }),
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data.error) errMsg = data.error;
      } catch {}
      throw new Error(errMsg);
    }

    const blob = await res.blob();
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `zuber-export-${dateStr}.zip`;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  },

  async getLogs(): Promise<LogsResponse> {
    return apiFetch<LogsResponse>('/api/logs');
  },

  async setLogLevel(level: LogLevel): Promise<{ ok: boolean; level: LogLevel }> {
    return apiFetch<{ ok: boolean; level: LogLevel }>('/api/logs/level', {
      method: 'POST',
      body: JSON.stringify({ level }),
    });
  },

  async clearServerLogs(): Promise<{ ok: boolean }> {
    return apiFetch<{ ok: boolean }>('/api/logs', {
      method: 'DELETE',
    });
  },

  async checkLinkEmbed(url: string): Promise<{
    embeddable: boolean;
    reason?: string;
    headerValue?: string;
    status?: number;
    uncertain?: boolean;
  }> {
    return apiFetch(`/api/link-embed-check?url=${encodeURIComponent(url)}`);
  },

  async getEmailStatus(): Promise<EmailConfig> {
    return apiFetch<EmailConfig>('/api/email/status');
  },

  async saveEmailConfig(config: {
    smtp?: Partial<SmtpConfig>;
    imap?: Partial<ImapConfig>;
  }): Promise<EmailConfig> {
    return apiFetch<EmailConfig>('/api/email/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  async testSmtp(payload: {
    to?: string;
    smtp?: Partial<SmtpConfig>;
  }): Promise<{ ok: boolean; message?: string; error?: string }> {
    return apiFetch('/api/email/test-smtp', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 60000,
    });
  },

  async testImap(payload: {
    imap?: Partial<ImapConfig>;
  }): Promise<{ ok: boolean; messageCount?: number; availableFolders?: string[]; error?: string }> {
    return apiFetch('/api/email/test-imap', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 60000,
    });
  },

  async pollImapNow(): Promise<{ ok: boolean; imported: number; status: EmailConfig }> {
    return apiFetch('/api/email/poll-now', {
      method: 'POST',
      timeoutMs: 60000,
    });
  },

  async sendNoteByEmail(payload: {
    notePath: string;
    to: string;
    subject?: string;
    message?: string;
    format: 'md' | 'pdf';
    pdfBase64?: string;
  }): Promise<{ ok: boolean; error?: string }> {
    return apiFetch('/api/email/send-note', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 60000,
    });
  },
};
