// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findInNoteMatches,
  searchNotesFullTextOffline,
  searchVaultFiles,
  wrapMatchIndex,
} from './utils/mobileSearchUtils';
import { MobileSearchModal } from './components/MobileSearchModal';
import { I18nProvider } from './i18n';
import { syncEngine } from './sync/syncEngine';

describe('mobileSearchUtils', () => {
  it('finds case-insensitive in-note matches with line numbers and previews', () => {
    const body = 'Alpha first line\nSecond Beta line\nThird alpha beta line';
    const matches = findInNoteMatches(body, 'alpha');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      index: 0,
      from: 0,
      to: 5,
      line: 1,
      lineText: 'Alpha first line',
    });
    expect(matches[1]).toMatchObject({
      index: 1,
      line: 3,
      lineText: 'Third alpha beta line',
    });
  });

  it('wraps match index seamlessly for next (+1) and previous (-1)', () => {
    expect(wrapMatchIndex(0, -1, 5)).toBe(4);
    expect(wrapMatchIndex(4, 1, 5)).toBe(0);
    expect(wrapMatchIndex(2, 1, 5)).toBe(3);
    expect(wrapMatchIndex(0, 1, 0)).toBe(0);
  });

  it('searches vault files by filename and folder path', () => {
    const files = [
      { path: 'Projects/Roadmap.md' },
      { path: 'Boards/Architecture.canvas' },
      { path: 'Data/Tasks.base' },
    ];
    const hits = searchVaultFiles(files, 'canvas');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      path: 'Boards/Architecture.canvas',
      name: 'Architecture.canvas',
      folder: 'Boards',
    });
  });

  it('searches offline notes full-text and builds highlighted snippets', () => {
    const notes = [
      {
        path: 'Notes/Meeting.md',
        title: 'Meeting',
        body: 'Discussed quarterly roadmap and mobile search improvements in detail.',
        rawContent: '',
        properties: [],
        tags: [],
        updatedAt: 1000,
      },
      {
        path: 'Notes/Other.md',
        title: 'Other',
        body: 'Unrelated shopping list.',
        rawContent: '',
        properties: [],
        tags: [],
        updatedAt: 500,
      },
    ];
    const hits = searchNotesFullTextOffline(notes as any, 'mobile search');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('Notes/Meeting.md');
    expect(hits[0].matchCount).toBe(1);
    expect(hits[0].snippet.toLowerCase()).toContain('mobile search');
  });
});

describe('MobileSearchModal', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('defaults to in-note when activeNote is open and jumps to selected match', async () => {
    const onJumpToInNoteMatch = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <MobileSearchModal
            isOpen={true}
            onClose={onClose}
            activeNote={{ path: 'Daily.md', body: 'Hello world\nHello again' }}
            allFiles={[{ path: 'Daily.md' }, { path: 'Other.md' }]}
            commands={[]}
            onOpenFile={vi.fn()}
            onJumpToInNoteMatch={onJumpToInNoteMatch}
            onJumpToNoteWithSearch={vi.fn()}
            onOpenSettingsTab={vi.fn()}
          />
        </I18nProvider>
      );
    });

    const select = container.querySelector('[data-testid="mobile-search-scope-select"]') as HTMLSelectElement;
    expect(select.value).toBe('in-note');

    const input = container.querySelector('[data-testid="mobile-search-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'hello');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const items = container.querySelectorAll('.mobile-search-result-item');
    expect(items).toHaveLength(2);

    await act(async () => {
      (items[1] as HTMLButtonElement).click();
    });

    expect(onJumpToInNoteMatch).toHaveBeenCalledWith('hello', 1);
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to files when activeNote is null and supports fulltext + settings scopes', async () => {
    const getAllNotesMock = vi.fn().mockResolvedValue([
      {
        path: 'Projects/Plan.md',
        title: 'Plan',
        body: 'Offline fulltext match inside IndexedDB note.',
        rawContent: '',
        properties: [],
        tags: [],
        updatedAt: 2000,
      },
    ]);
    vi.spyOn(syncEngine, 'getLocalDb').mockReturnValue({
      getAllNotes: getAllNotesMock,
    } as any);

    const onJumpToNoteWithSearch = vi.fn();
    const onOpenSettingsTab = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <MobileSearchModal
            isOpen={true}
            onClose={onClose}
            activeNote={null}
            allFiles={[{ path: 'Projects/Plan.md' }]}
            commands={[]}
            onOpenFile={vi.fn()}
            onJumpToInNoteMatch={vi.fn()}
            onJumpToNoteWithSearch={onJumpToNoteWithSearch}
            onOpenSettingsTab={onOpenSettingsTab}
          />
        </I18nProvider>
      );
    });

    const select = container.querySelector('[data-testid="mobile-search-scope-select"]') as HTMLSelectElement;
    expect(select.value).toBe('files');

    // Switch to fulltext
    await act(async () => {
      select.value = 'fulltext';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(getAllNotesMock).toHaveBeenCalled();

    const input = container.querySelector('[data-testid="mobile-search-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'IndexedDB');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const fullTextItems = container.querySelectorAll('.mobile-search-result-item');
    expect(fullTextItems).toHaveLength(1);

    await act(async () => {
      (fullTextItems[0] as HTMLButtonElement).click();
    });

    expect(onJumpToNoteWithSearch).toHaveBeenCalledWith('Projects/Plan.md', 'IndexedDB', 0);

    // Switch to settings
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'appearance');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      select.value = 'settings';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const settingsItems = container.querySelectorAll('.mobile-search-result-item');
    expect(settingsItems.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      (settingsItems[0] as HTMLButtonElement).click();
    });

    expect(onOpenSettingsTab).toHaveBeenCalledWith('appearance');
  });
});
