/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  LAST_ACTIVE_NOTE_KEY,
  recordLastActiveNote,
  clearLastActiveNote,
} from './startupConfig';
import {
  notifyVaultEntryDeleted,
  loadFavorites,
  saveFavorites,
  loadRecentNotes,
} from './utils/vaultNavigation';

describe('Note Deletion & Empty State Handling', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    (globalThis as any).window = globalThis;
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
    vi.restoreAllMocks();
  });

  describe('1. clearLastActiveNote in startupConfig', () => {
    it('sets and clears active note keys from localStorage', () => {
      recordLastActiveNote('Notes/MyNote.md');
      expect(localStorage.getItem(LAST_ACTIVE_NOTE_KEY)).toBe('Notes/MyNote.md');

      clearLastActiveNote();
      expect(localStorage.getItem(LAST_ACTIVE_NOTE_KEY)).toBeNull();
      expect(localStorage.getItem('knowmesh_last_active_note')).toBeNull();
    });
  });

  describe('2. notifyVaultEntryDeleted in vaultNavigation', () => {
    it('removes deleted note and its children from favorites and recent notes', () => {
      saveFavorites([
        { path: 'Notes/Active.md', type: 'file' },
        { path: 'Archive/Old.md', type: 'file' },
        { path: 'Archive/Sub/Deep.md', type: 'file' },
      ]);
      localStorage.setItem(
        'zuber_recent_notes',
        JSON.stringify(['Notes/Active.md', 'Archive/Old.md', 'Archive/Sub/Deep.md', 'Other.md'])
      );

      // Delete folder Archive
      notifyVaultEntryDeleted('Archive');

      const favs = loadFavorites();
      expect(favs.map((f) => f.path)).toEqual(['Notes/Active.md']);

      const recents = loadRecentNotes();
      expect(recents).toEqual(['Notes/Active.md', 'Other.md']);

      // Delete single file Notes/Active.md
      notifyVaultEntryDeleted('Notes/Active.md');
      expect(loadFavorites()).toEqual([]);
      expect(loadRecentNotes()).toEqual(['Other.md']);
    });
  });

  describe('3. App.tsx Deletion Logic', () => {
    it('verifies App.tsx does not open fallback note on delete and resets to null', () => {
      const appFile = path.resolve(__dirname, 'App.tsx');
      const content = fs.readFileSync(appFile, 'utf-8');

      // Verify that find((f) => f.extension === 'md' ...) fallback is removed
      expect(content).not.toMatch(/treeRes\.files\.find\(\(f\)\s*=>\s*f\.extension\s*===\s*'md'/);

      // Verify that activeNote is set to null and clearLastActiveNote() is invoked
      expect(content).toMatch(/if\s*\(isActiveOrChild\)\s*\{[\s\S]*?setActiveNote\(null\);[\s\S]*?clearLastActiveNote\(\);/);

      // Verify empty-workspace-state includes buttons
      expect(content).toContain('empty-workspace-state');
      expect(content).toContain('openCreateNoteDialog');
      expect(content).toContain('handleOpenTemplateModal');
      expect(content).toContain('handleOpenDailyNote');
      expect(content).toContain('openCreateCanvasDialog');
      expect(content).toContain('openCreateBaseDialog');
    });

    it('verifies FileSidebar.tsx notifies onActiveNoteDeleted on multi-delete', () => {
      const sidebarFile = path.resolve(__dirname, 'components/FileSidebar.tsx');
      const content = fs.readFileSync(sidebarFile, 'utf-8');

      expect(content).toContain('onActiveNoteDeleted');
      expect(content).toContain('notifyVaultEntryDeleted(p)');
    });
  });
});
