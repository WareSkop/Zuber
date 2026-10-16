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

const TOKEN_STORAGE_KEY = 'basalt_token';
const ACTIVE_PROFILE_KEY = 'basalt_active_profile_id';
const PROFILES_STORAGE_KEY = 'basalt_vault_profiles';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem('obsidian_web_vault_token');
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem('obsidian_web_vault_token');
  }
}

export function getStoredProfiles(): VaultProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
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
  const activeId = localStorage.getItem(ACTIVE_PROFILE_KEY);
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

  const res = await fetch(fullUrl, {
    ...options,
    headers,
    credentials: 'include',
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
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

export const api = {
  checkAuthStatus(): Promise<{ authenticated: boolean; authRequired?: boolean; https: boolean; vaultPath: string }> {
    return apiFetch('/api/auth/status');
  },

  async login(password: string): Promise<{ authenticated: boolean; token: string }> {
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
    return res;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
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
