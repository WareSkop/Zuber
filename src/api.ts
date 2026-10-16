import type {
  BacklinkItem,
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  NoteData,
} from '../shared/types';

const TOKEN_STORAGE_KEY = 'obsidian_web_vault_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) errMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

export const api = {
  checkAuthStatus(): Promise<{ authenticated: boolean; https: boolean; vaultPath: string }> {
    return apiFetch('/api/auth/status');
  },

  async login(password: string): Promise<{ authenticated: boolean; token: string }> {
    const res = await apiFetch<{ authenticated: boolean; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (res.token) {
      setStoredToken(res.token);
    }
    return res;
  },

  async logout(): Promise<void> {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setStoredToken(null);
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
    return `/api/vault/attachment?${params.toString()}`;
  },

  async uploadAttachment(
    file: File
  ): Promise<{ path: string; name: string; wikiEmbed: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'Attachments');
    return apiFetch('/api/vault/upload', {
      method: 'POST',
      body: formData,
    });
  },
};
