import type {
  BacklinkItem,
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  NoteData,
  SecuritySettingsResponse,
  SyncManifestEntry,
  UpdateSecurityRequest,
  UploadResponse,
  VaultProfile,
} from '../shared/types';

const TOKEN_STORAGE_KEY = 'knowmesh_token';
const ACTIVE_PROFILE_KEY = 'knowmesh_active_profile_id';
const PROFILES_STORAGE_KEY = 'knowmesh_vault_profiles';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem('basalt_token') || localStorage.getItem('obsidian_web_vault_token');
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem('basalt_token');
    localStorage.removeItem('obsidian_web_vault_token');
  }
}

export function getStoredProfiles(): VaultProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY) || localStorage.getItem('basalt_vault_profiles');
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
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

export function getActiveProfile(): VaultProfile {
  const profiles = getStoredProfiles();
  const activeId = localStorage.getItem(ACTIVE_PROFILE_KEY) || localStorage.getItem('basalt_active_profile_id');
  const found = profiles.find((p) => p.id === activeId);
  return found || profiles[0];
}

export function setActiveProfile(profileId: string): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
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

const OFFLINE_AUTH_VERIFIER_KEY = 'knowmesh_offline_auth_verifier';

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
    console.warn('[Knowmesh Auth] Could not store offline password verifier', err);
  }
}

export async function verifyOfflinePassword(password: string): Promise<boolean> {
  if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) return false;
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_VERIFIER_KEY);
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
  return Boolean(localStorage.getItem(OFFLINE_AUTH_VERIFIER_KEY));
}

export function migrateLegacyStorageKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!localStorage.getItem(TOKEN_STORAGE_KEY)) {
      const oldToken = localStorage.getItem('basalt_token') || localStorage.getItem('obsidian_web_vault_token');
      if (oldToken) localStorage.setItem(TOKEN_STORAGE_KEY, oldToken);
    }
    if (!localStorage.getItem(ACTIVE_PROFILE_KEY)) {
      const oldActive = localStorage.getItem('basalt_active_profile_id') || localStorage.getItem('obsidian_active_profile_id');
      if (oldActive) localStorage.setItem(ACTIVE_PROFILE_KEY, oldActive);
    }
    if (!localStorage.getItem(PROFILES_STORAGE_KEY)) {
      const oldProfiles = localStorage.getItem('basalt_vault_profiles') || localStorage.getItem('obsidian_vault_profiles');
      if (oldProfiles) localStorage.setItem(PROFILES_STORAGE_KEY, oldProfiles);
    }
    if (!localStorage.getItem('knowmesh_open_tabs')) {
      const oldTabs = localStorage.getItem('obsidian_web_open_tabs') || localStorage.getItem('basalt_open_tabs');
      if (oldTabs) localStorage.setItem('knowmesh_open_tabs', oldTabs);
    }
    if (!localStorage.getItem('knowmesh_theme')) {
      const oldTheme = localStorage.getItem('basalt_theme') || localStorage.getItem('obsidian_theme');
      if (oldTheme) localStorage.setItem('knowmesh_theme', oldTheme);
    }
  } catch (err) {
    console.warn('[Knowmesh] Legacy storage key migration error:', err);
  }
}

if (typeof window !== 'undefined') {
  migrateLegacyStorageKeys();
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const baseUrl = getBaseUrl();
  const fullUrl = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

  // Default timeout of 6s to avoid hanging indefinitely on dead connections
  let timeoutId: any;
  let signal = options.signal;
  if (!signal) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 6000);
    signal = controller.signal;
  }

  try {
    const res = await fetch(fullUrl, {
      ...options,
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

    return (await res.json()) as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export const api = {
  checkAuthStatus(timeoutMs = 3000): Promise<{ authenticated: boolean; authRequired?: boolean; https: boolean; vaultPath: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return apiFetch<{ authenticated: boolean; authRequired?: boolean; https: boolean; vaultPath: string }>(
      '/api/auth/status',
      { signal: controller.signal }
    ).finally(() => clearTimeout(timeoutId));
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
        const token = getStoredToken() || 'knowmesh_offline_session_token';
        setStoredToken(token);
        return { authenticated: true, token, offline: true };
      }
      if (!hasOfflineAuthVerifier()) {
        throw new Error('Keine Verbindung zum Knowmesh-Server. Für die allererste Anmeldung wird eine Internetverbindung benötigt.');
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
    files: { path: string; name: string; basename: string; extension: string }[];
    vaultPath: string;
  }> {
    return apiFetch('/api/vault/tree');
  },

  getNote(path: string): Promise<NoteData> {
    return apiFetch(`/api/vault/note?path=${encodeURIComponent(path)}`);
  },

  saveNote(payload: {
    path: string;
    rawContent?: string;
    body?: string;
    properties?: FrontmatterProperty[];
    baseMtime?: number;
    forceOverwrite?: boolean;
  }): Promise<NoteData> {
    return apiFetch('/api/vault/note', {
      method: 'POST',
      body: JSON.stringify(payload),
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

  getGraph(): Promise<GraphData> {
    return apiFetch('/api/vault/graph');
  },

  getBacklinks(path: string): Promise<{ linked: BacklinkItem[]; unlinked: BacklinkItem[] }> {
    return apiFetch(`/api/vault/backlinks?path=${encodeURIComponent(path)}`);
  },

  search(
    q: string,
    tag?: string
  ): Promise<{
    results: {
      path: string;
      name: string;
      matches: { line: number; text: string }[];
      tags: string[];
    }[];
  }> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    return apiFetch(`/api/vault/search?${params.toString()}`);
  },

  resolveWikiLink(
    target: string,
    fromNotePath?: string
  ): Promise<{ target: string; resolvedPath: string | null }> {
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

  async uploadAttachment(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'attachments');
    const res = await apiFetch<UploadResponse>('/api/vault/upload', {
      method: 'POST',
      body: formData,
    });
    return {
      ...res,
      wikiEmbed: res.wikiEmbed || (res.path ? `![[${res.path}]]` : `![[${res.name}]]`),
    };
  },
};
