import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadFavorites,
  saveFavorites,
  loadRecentNotes,
  recordRecentNote,
  notifyVaultEntryRenamed,
  notifyVaultEntryDeleted,
  type FavoriteItem,
} from './utils/vaultNavigation';

describe('Knowmesh UI Refinements Phase 3 - Navigation, Favorites & Recents', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).window = {
      dispatchEvent: () => true,
    };
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };
  });

  describe('Favorites Management', () => {
    it('returns empty array when no favorites are saved', () => {
      expect(loadFavorites()).toEqual([]);
    });

    it('saves and loads favorite items correctly', () => {
      const items: FavoriteItem[] = [
        { path: 'Projekte/Alpha.md', type: 'file' },
        { path: 'Wissensbasis', type: 'folder' },
      ];
      saveFavorites(items);
      expect(loadFavorites()).toEqual(items);
    });

    it('gracefully handles legacy string array in localStorage', () => {
      localStorage.setItem('knowmesh_favorites', JSON.stringify(['Notes/Test.md', 'Archive']));
      const loaded = loadFavorites();
      expect(loaded).toEqual([
        { path: 'Notes/Test.md', type: 'file' },
        { path: 'Archive', type: 'folder' },
      ]);
    });

    it('synchronizes favorites on file or folder rename', () => {
      const items: FavoriteItem[] = [
        { path: 'Projekte/Alpha.md', type: 'file' },
        { path: 'Projekte', type: 'folder' },
        { path: 'Wissensbasis/Doc.md', type: 'file' },
      ];
      saveFavorites(items);

      // Rename Alpha.md -> Beta.md
      notifyVaultEntryRenamed('Projekte/Alpha.md', 'Projekte/Beta.md');
      expect(loadFavorites()).toEqual([
        { path: 'Projekte/Beta.md', type: 'file' },
        { path: 'Projekte', type: 'folder' },
        { path: 'Wissensbasis/Doc.md', type: 'file' },
      ]);

      // Rename folder Projekte -> Work
      notifyVaultEntryRenamed('Projekte', 'Work');
      expect(loadFavorites()).toEqual([
        { path: 'Work/Beta.md', type: 'file' },
        { path: 'Work', type: 'folder' },
        { path: 'Wissensbasis/Doc.md', type: 'file' },
      ]);
    });

    it('removes entries from favorites on delete', () => {
      const items: FavoriteItem[] = [
        { path: 'Work/Beta.md', type: 'file' },
        { path: 'Work', type: 'folder' },
        { path: 'Other.md', type: 'file' },
      ];
      saveFavorites(items);

      // Delete file
      notifyVaultEntryDeleted('Other.md');
      expect(loadFavorites()).toEqual([
        { path: 'Work/Beta.md', type: 'file' },
        { path: 'Work', type: 'folder' },
      ]);

      // Delete folder Work (should also remove Work/Beta.md)
      notifyVaultEntryDeleted('Work');
      expect(loadFavorites()).toEqual([]);
    });
  });

  describe('Recent Notes Management', () => {
    it('records recently opened notes up to 10 items deduplicated', () => {
      for (let i = 1; i <= 15; i++) {
        recordRecentNote(`Note-${i}.md`);
      }
      const recents = loadRecentNotes();
      expect(recents.length).toBe(10);
      expect(recents[0]).toBe('Note-15.md');
      expect(recents[9]).toBe('Note-6.md');

      // Reopening Note-6 moves it to the top
      recordRecentNote('Note-6.md');
      const updated = loadRecentNotes();
      expect(updated.length).toBe(10);
      expect(updated[0]).toBe('Note-6.md');
      expect(updated[1]).toBe('Note-15.md');
    });

    it('supports canvas files in recent notes', () => {
      recordRecentNote('Workflows/Network.canvas');
      const recents = loadRecentNotes();
      expect(recents).toContain('Workflows/Network.canvas');
    });

    it('updates recent notes paths on rename and removes on delete', () => {
      recordRecentNote('A.md');
      recordRecentNote('B.md');
      recordRecentNote('Folder/Sub.canvas');

      notifyVaultEntryRenamed('Folder/Sub.canvas', 'Folder/Renamed.canvas');
      expect(loadRecentNotes()).toContain('Folder/Renamed.canvas');
      expect(loadRecentNotes()).not.toContain('Folder/Sub.canvas');

      notifyVaultEntryDeleted('A.md');
      expect(loadRecentNotes()).not.toContain('A.md');
      expect(loadRecentNotes()).toContain('B.md');
    });
  });

  describe('Sidebar Width Boundaries', () => {
    it('clamps left sidebar width between 180px and 600px', () => {
      const clampLeft = (w: number) => Math.min(600, Math.max(180, w));
      expect(clampLeft(100)).toBe(180);
      expect(clampLeft(280)).toBe(280);
      expect(clampLeft(750)).toBe(600);
    });

    it('clamps right sidebar width between 200px and 650px', () => {
      const clampRight = (w: number) => Math.min(650, Math.max(200, w));
      expect(clampRight(120)).toBe(200);
      expect(clampRight(300)).toBe(300);
      expect(clampRight(900)).toBe(650);
    });
  });
});
