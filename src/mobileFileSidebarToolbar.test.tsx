// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileSidebar } from './components/FileSidebar';
import { I18nProvider } from './i18n';

// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mockMatchMedia(matchesMobile: boolean) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: matchesMobile ? 390 : 1280,
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width') ? matchesMobile : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('Mobile vs Desktop FileSidebar Toolbar', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders consolidated + New dropdown with all 5 creation options on mobile (< 768px)', async () => {
    mockMatchMedia(true);

    const onCreateNote = vi.fn();
    const onOpenTemplateSelect = vi.fn();
    const onCreateCanvas = vi.fn();
    const onCreateBase = vi.fn();
    const onCreateFolder = vi.fn();
    const onOpenDailyNote = vi.fn();
    const onRefresh = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <FileSidebar
            tree={[]}
            activePath={null}
            tags={[]}
            selectedTagFilter={null}
            onSelectNote={vi.fn()}
            onCreateNote={onCreateNote}
            onOpenTemplateSelect={onOpenTemplateSelect}
            onCreateCanvas={onCreateCanvas}
            onCreateBase={onCreateBase}
            onCreateFolder={onCreateFolder}
            onOpenDailyNote={onOpenDailyNote}
            onRenameEntry={vi.fn()}
            onDeleteEntry={vi.fn()}
            onRefresh={onRefresh}
            onSelectTagFilter={vi.fn()}
          />
        </I18nProvider>
      );
    });

    const actionBar = container.querySelector('.sidebar-action-bar');
    expect(actionBar?.classList.contains('is-mobile')).toBe(true);

    const newBtn = container.querySelector('.sidebar-mobile-new-btn') as HTMLButtonElement;
    expect(newBtn).toBeTruthy();

    // Separate desktop creation buttons should NOT be in the top bar on mobile
    expect(container.querySelector('.sidebar-action-bar [title="New Canvas"]')).toBeNull();
    expect(container.querySelector('.sidebar-action-bar [title="New Folder"]')).toBeNull();

    // Open + New BottomSheet
    await act(async () => {
      newBtn.click();
    });

    const actionRows = Array.from(document.body.querySelectorAll('.bottom-sheet-action-row')) as HTMLButtonElement[];
    expect(actionRows.length).toBe(5);

    // Click each of the 5 creation actions
    await act(async () => {
      actionRows[0].click();
    });
    expect(onCreateNote).toHaveBeenCalledTimes(1);

    await act(async () => {
      newBtn.click();
    });
    const rows2 = Array.from(document.body.querySelectorAll('.bottom-sheet-action-row')) as HTMLButtonElement[];
    await act(async () => {
      rows2[3].click();
    });
    expect(onCreateBase).toHaveBeenCalledTimes(1);
  });

  it('preserves individual desktop toolbar buttons on >= 768px', async () => {
    mockMatchMedia(false);

    await act(async () => {
      root.render(
        <I18nProvider>
          <FileSidebar
            tree={[]}
            activePath={null}
            tags={[]}
            selectedTagFilter={null}
            onSelectNote={vi.fn()}
            onCreateNote={vi.fn()}
            onOpenTemplateSelect={vi.fn()}
            onCreateCanvas={vi.fn()}
            onCreateBase={vi.fn()}
            onCreateFolder={vi.fn()}
            onOpenDailyNote={vi.fn()}
            onRenameEntry={vi.fn()}
            onDeleteEntry={vi.fn()}
            onRefresh={vi.fn()}
            onSelectTagFilter={vi.fn()}
          />
        </I18nProvider>
      );
    });

    const actionBar = container.querySelector('.sidebar-action-bar');
    expect(actionBar?.classList.contains('is-mobile')).toBe(false);
    expect(container.querySelector('.sidebar-mobile-new-btn')).toBeNull();
    expect(container.querySelectorAll('.sidebar-action-bar .sidebar-icon-btn').length).toBeGreaterThanOrEqual(7);
  });
});
