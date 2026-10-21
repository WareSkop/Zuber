export interface FavoriteItem {
  path: string;
  type: 'file' | 'folder';
}

export const loadFavorites = (): FavoriteItem[] => {
  try {
    const raw = localStorage.getItem('zuber_favorites') || localStorage.getItem('knowmesh_favorites');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      if (typeof item === 'string') {
        const isFile = item.endsWith('.md') || item.endsWith('.canvas');
        return { path: item, type: isFile ? 'file' : 'folder' };
      }
      return { path: item.path, type: item.type || 'file' };
    });
  } catch {
    return [];
  }
};

export const saveFavorites = (favorites: FavoriteItem[]): void => {
  try {
    localStorage.setItem('zuber_favorites', JSON.stringify(favorites));
    window.dispatchEvent(new CustomEvent('zuber_favorites_changed'));
    window.dispatchEvent(new CustomEvent('knowmesh_favorites_changed'));
  } catch {}
};

export const loadRecentNotes = (): string[] => {
  try {
    const raw = localStorage.getItem('zuber_recent_notes') || localStorage.getItem('knowmesh_recent_notes');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const recordRecentNote = (notePath: string): void => {
  if (!notePath || (!notePath.endsWith('.md') && !notePath.endsWith('.canvas'))) return;
  try {
    const current = loadRecentNotes();
    const filtered = current.filter((p) => p !== notePath);
    const updated = [notePath, ...filtered].slice(0, 10);
    localStorage.setItem('zuber_recent_notes', JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('zuber_recent_changed'));
    window.dispatchEvent(new CustomEvent('knowmesh_recent_changed'));
  } catch {}
};

export const notifyVaultEntryRenamed = (oldPath: string, newPath: string): void => {
  try {
    const favs = loadFavorites();
    let favChanged = false;
    const nextFavs = favs.map((item) => {
      let p = item.path;
      if (p === oldPath) {
        favChanged = true;
        return { ...item, path: newPath };
      }
      if (p.startsWith(oldPath + '/')) {
        favChanged = true;
        return { ...item, path: newPath + p.slice(oldPath.length) };
      }
      return item;
    });
    if (favChanged) {
      saveFavorites(nextFavs);
    }
  } catch {}

  try {
    const recents = loadRecentNotes();
    let recChanged = false;
    const nextRecents = recents.map((p) => {
      if (p === oldPath) {
        recChanged = true;
        return newPath;
      }
      if (p.startsWith(oldPath + '/')) {
        recChanged = true;
        return newPath + p.slice(oldPath.length);
      }
      return p;
    });
    if (recChanged) {
      localStorage.setItem('zuber_recent_notes', JSON.stringify(nextRecents));
      window.dispatchEvent(new CustomEvent('zuber_recent_changed'));
      window.dispatchEvent(new CustomEvent('knowmesh_recent_changed'));
    }
  } catch {}
};

export const notifyVaultEntryDeleted = (deletedPath: string): void => {
  try {
    const favs = loadFavorites();
    const nextFavs = favs.filter(
      (item) => item.path !== deletedPath && !item.path.startsWith(deletedPath + '/')
    );
    if (nextFavs.length !== favs.length) {
      saveFavorites(nextFavs);
    }
  } catch {}

  try {
    const recents = loadRecentNotes();
    const nextRecents = recents.filter(
      (p) => p !== deletedPath && !p.startsWith(deletedPath + '/')
    );
    if (nextRecents.length !== recents.length) {
      localStorage.setItem('zuber_recent_notes', JSON.stringify(nextRecents));
      window.dispatchEvent(new CustomEvent('zuber_recent_changed'));
      window.dispatchEvent(new CustomEvent('knowmesh_recent_changed'));
    }
  } catch {}
};
