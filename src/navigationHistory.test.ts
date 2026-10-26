/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import enTranslations from './locales/en.json';
import deTranslations from './locales/de.json';

describe('Navigation History Stack & Topbar Back Button', () => {
  describe('1. Navigation history stack logic', () => {
    // Pure implementation replicating the history reducer logic in App.tsx
    class NavigationHistoryTracker {
      public history: string[] = [];
      public historyIndex: number = -1;
      public isNavigating = false;

      public push(newPath: string) {
        if (this.isNavigating) return;
        if (this.historyIndex >= 0 && this.history[this.historyIndex] === newPath) return;

        const sliced = this.history.slice(0, this.historyIndex + 1);
        let updated = [...sliced, newPath];
        if (updated.length > 50) {
          updated = updated.slice(updated.length - 50);
        }
        this.history = updated;
        this.historyIndex = updated.length - 1;
      }

      public canGoBack(): boolean {
        return this.historyIndex > 0;
      }

      public goBack(): string | null {
        if (!this.canGoBack()) return null;
        this.isNavigating = true;
        this.historyIndex -= 1;
        const target = this.history[this.historyIndex];
        // navigation completes
        this.isNavigating = false;
        return target;
      }

      public pruneDeleted(deletedPath: string) {
        this.history = this.history.filter(
          (p) => p !== deletedPath && !p.startsWith(deletedPath + '/')
        );
        this.historyIndex = Math.min(this.historyIndex, this.history.length - 1);
      }
    }

    it('initializes with empty history and disabled back button', () => {
      const tracker = new NavigationHistoryTracker();
      expect(tracker.history).toEqual([]);
      expect(tracker.historyIndex).toBe(-1);
      expect(tracker.canGoBack()).toBe(false);
    });

    it('adds first note but remains disabled (cannot go back from initial note)', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      expect(tracker.history).toEqual(['Notes/NoteA.md']);
      expect(tracker.historyIndex).toBe(0);
      expect(tracker.canGoBack()).toBe(false);
    });

    it('tracks opening Note B and enables back button', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      tracker.push('Notes/NoteB.md');
      expect(tracker.history).toEqual(['Notes/NoteA.md', 'Notes/NoteB.md']);
      expect(tracker.historyIndex).toBe(1);
      expect(tracker.canGoBack()).toBe(true);
    });

    it('tracks canvas files alongside markdown notes', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      tracker.push('Notes/NoteB.md');
      tracker.push('Workflows/Project.canvas');
      expect(tracker.history).toEqual([
        'Notes/NoteA.md',
        'Notes/NoteB.md',
        'Workflows/Project.canvas',
      ]);
      expect(tracker.historyIndex).toBe(2);
      expect(tracker.canGoBack()).toBe(true);
    });

    it('navigates back to Note B, then Note A, and disables back button at root', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      tracker.push('Notes/NoteB.md');
      tracker.push('Workflows/Project.canvas');

      // Click Back 1: returns to NoteB
      const back1 = tracker.goBack();
      expect(back1).toBe('Notes/NoteB.md');
      expect(tracker.historyIndex).toBe(1);
      expect(tracker.canGoBack()).toBe(true);

      // Click Back 2: returns to NoteA
      const back2 = tracker.goBack();
      expect(back2).toBe('Notes/NoteA.md');
      expect(tracker.historyIndex).toBe(0);
      expect(tracker.canGoBack()).toBe(false);

      // Click Back 3: cannot go back further
      const back3 = tracker.goBack();
      expect(back3).toBeNull();
      expect(tracker.historyIndex).toBe(0);
    });

    it('does not record duplicate entries when opening the currently active path', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      tracker.push('Notes/NoteA.md');
      expect(tracker.history).toEqual(['Notes/NoteA.md']);
      expect(tracker.historyIndex).toBe(0);
    });

    it('slices off forward history when a new note is opened after going back', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      tracker.push('Notes/NoteB.md');
      tracker.push('Workflows/Project.canvas');

      // Go back to Note B
      tracker.goBack();
      expect(tracker.historyIndex).toBe(1);

      // Now open Note C -> Project.canvas is discarded from forward stack
      tracker.push('Notes/NoteC.md');
      expect(tracker.history).toEqual(['Notes/NoteA.md', 'Notes/NoteB.md', 'Notes/NoteC.md']);
      expect(tracker.historyIndex).toBe(2);
    });

    it('limits history stack to 50 items', () => {
      const tracker = new NavigationHistoryTracker();
      for (let i = 1; i <= 60; i++) {
        tracker.push(`Notes/Note_${i}.md`);
      }
      expect(tracker.history.length).toBe(50);
      expect(tracker.history[0]).toBe('Notes/Note_11.md');
      expect(tracker.history[49]).toBe('Notes/Note_60.md');
      expect(tracker.historyIndex).toBe(49);
    });

    it('prunes deleted files from history stack', () => {
      const tracker = new NavigationHistoryTracker();
      tracker.push('Notes/NoteA.md');
      tracker.push('Notes/NoteB.md');
      tracker.push('Notes/NoteC.md');

      tracker.pruneDeleted('Notes/NoteB.md');
      expect(tracker.history).toEqual(['Notes/NoteA.md', 'Notes/NoteC.md']);
      expect(tracker.historyIndex).toBe(1);
    });
  });

  describe('2. Localization', () => {
    it('contains nav.goBack in EN and DE localization files', () => {
      expect((enTranslations as any).nav?.goBack).toBe('Go Back (Alt+←)');
      expect((deTranslations as any).nav?.goBack).toBe('Zurück (Alt+←)');
    });
  });

  describe('3. CSS Styling in src/styles.css', () => {
    it('defines .topbar-nav-back-btn with hover and disabled rules', () => {
      const stylesPath = path.resolve(__dirname, 'styles.css');
      const css = fs.readFileSync(stylesPath, 'utf-8');

      expect(css).toContain('.topbar-nav-back-btn');
      expect(css).toContain('.topbar-nav-back-btn:hover:not(:disabled)');
      expect(css).toContain('.topbar-nav-back-btn:disabled');
      expect(css).toMatch(/opacity:\s*0\.35/);
      expect(css).toMatch(/cursor:\s*not-allowed/);
    });
  });

  describe('4. Source code integration in src/App.tsx', () => {
    it('contains history state, handleGoBack, and topbar-nav-back-btn markup', () => {
      const appPath = path.resolve(__dirname, 'App.tsx');
      const content = fs.readFileSync(appPath, 'utf-8');

      expect(content).toContain('topbar-nav-back-btn');
      expect(content).toContain('handleGoBack');
      expect(content).toContain('historyIndex <= 0');
      expect(content).toContain("t('nav.goBack'");
      expect(content).toContain('ArrowLeft');
      expect(content).toContain("e.key === 'ArrowLeft'");
      expect(content).toContain('isHistoryNavigatingRef');
    });
  });
});
